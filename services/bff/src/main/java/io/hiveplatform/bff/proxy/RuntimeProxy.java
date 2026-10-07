package io.hiveplatform.bff.proxy;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.hiveplatform.bff.control.ControlPlaneClient;
import io.hiveplatform.bff.observability.ObservabilityPublisher;
import io.hiveplatform.bff.security.IdentityConfiguration;
import io.hiveplatform.bff.security.SessionIdentity;
import io.hiveplatform.bff.security.TokenRefresh;
import io.hiveplatform.spring.CorrelationId;
import io.hiveplatform.spring.HiveException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.InputStream;
import java.net.ConnectException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

/**
 * Runtime gateway: {@code /api/routes/<registered prefix>/<path>}. Every request is resolved by the control plane to a
 * registered route operation (default deny), authorized server-side for AUTHENTICATED operations, sent only to the
 * registered and deployment-approved target, and carries credentials injected here (user token or legacy token),
 * never supplied by or returned to the browser.
 */
@RestController
public class RuntimeProxy {
  public static final String PREFIX = "/api/routes";
  public record Decision(boolean allowed, String reason) {}
  public record Target(String key, String baseUrl, int connectTimeoutMs, int responseTimeoutMs, int maxRequestBytes, int maxResponseBytes) {}
  public record Resolved(String routeKey, String operationKey, String applicationKey, String moduleKey, String method, String pathTemplate, String access,
      String authentication, String resourceKey, String action, Target target, LegacyTokens.Profile legacy, String upstreamPath, Decision decision) {}

  /** Request headers a browser may pass through; everything else (cookies, authorization, forwarding headers) is dropped. */
  static final List<String> REQUEST_HEADERS = List.of("Accept", "Accept-Language", "Content-Type", "If-Match", "If-None-Match", "If-Modified-Since", "If-Unmodified-Since");
  /** Response headers relayed to the browser; upstream cookies and server details never reach it. */
  static final List<String> RESPONSE_HEADERS = List.of("Content-Type", "Content-Disposition", "Content-Language", "Cache-Control", "ETag", "Last-Modified", "Expires");
  private static final Set<String> BODY_METHODS = Set.of("POST", "PUT", "PATCH", "DELETE");

  private final ControlPlaneClient control;
  private final TargetGuard guard;
  private final LegacyTokens legacy;
  private final ObjectProvider<TokenRefresh> refresh;
  private final ObservabilityPublisher observability;
  private final ObjectMapper json;
  private final Map<Integer, HttpClient> clients = new ConcurrentHashMap<>();

  public RuntimeProxy(ControlPlaneClient control, TargetGuard guard, LegacyTokens legacy, ObjectProvider<TokenRefresh> refresh, ObservabilityPublisher observability, ObjectMapper json) {
    this.control = control;
    this.guard = guard;
    this.legacy = legacy;
    this.refresh = refresh;
    this.observability = observability;
    this.json = json;
  }

  @RequestMapping(value = PREFIX + "/**", method = {RequestMethod.GET, RequestMethod.HEAD, RequestMethod.POST, RequestMethod.PUT, RequestMethod.PATCH, RequestMethod.DELETE})
  public void proxy(HttpServletRequest request, HttpServletResponse response) throws IOException {
    long started = System.nanoTime();
    String method = request.getMethod();
    SessionIdentity identity = identity();
    String actor = identity == null ? null : "user:" + identity.id();
    String path = request.getRequestURI().substring(PREFIX.length());
    if (path.isEmpty()) path = "/";
    Resolved route = null;
    try {
      var body = new HashMap<String, Object>();
      body.put("method", method);
      body.put("path", path);
      if (identity != null) body.put("userId", identity.id());
      route = control.post("/internal/routing/resolve", body, Resolved.class);
      if (!route.decision().allowed()) {
        boolean anonymous = "UNAUTHENTICATED".equals(route.decision().reason());
        throw new HiveException(anonymous ? HttpStatus.UNAUTHORIZED : HttpStatus.FORBIDDEN, anonymous ? "AUTHENTICATION_REQUIRED" : "ACCESS_DENIED",
            anonymous ? "This operation requires a signed-in user" : "Not permitted: " + route.decision().reason());
      }
      forward(route, identity, request, response, started, actor);
    } catch (HiveException failure) {
      writeError(response, failure);
      String outcome = switch (failure.status().value()) {
        case 401 -> "UNAUTHENTICATED";
        case 403 -> "DENIED";
        case 404 -> "NOT_FOUND";
        case 502, 503, 504 -> route == null ? "REJECTED" : "UPSTREAM_ERROR";
        default -> "REJECTED";
      };
      log(route, method, actor, failure.status().value(), null, started, outcome, failure.code());
    }
  }

  private void forward(Resolved route, SessionIdentity identity, HttpServletRequest request, HttpServletResponse response, long started, String actor) throws IOException {
    Target target = route.target();
    if (request.getContentLengthLong() > target.maxRequestBytes()) throw new HiveException(HttpStatus.PAYLOAD_TOO_LARGE, "REQUEST_TOO_LARGE", "Request body exceeds " + target.maxRequestBytes() + " bytes");
    byte[] body = null;
    if (BODY_METHODS.contains(route.method())) {
      try (InputStream in = request.getInputStream()) {
        body = in.readNBytes(target.maxRequestBytes() + 1);
      }
      if (body.length > target.maxRequestBytes()) throw new HiveException(HttpStatus.PAYLOAD_TOO_LARGE, "REQUEST_TOO_LARGE", "Request body exceeds " + target.maxRequestBytes() + " bytes");
    }
    URI uri = guard.resolve(target.baseUrl(), route.upstreamPath(), request.getQueryString());
    var builder = HttpRequest.newBuilder(uri).timeout(Duration.ofMillis(target.responseTimeoutMs()));
    for (String header : REQUEST_HEADERS) {
      String value = request.getHeader(header);
      if (value != null && value.length() <= 1024 && value.chars().noneMatch(c -> c < 0x20 && c != '\t')) builder.header(header, value);
    }
    builder.header(CorrelationId.HEADER, CorrelationId.current()).header("X-Hive-Route", route.routeKey()).header("X-Hive-Operation", route.operationKey());
    if (identity != null) builder.header("X-Hive-User-Id", identity.id()).header("X-Hive-Tenant-Id", identity.tenantId());
    String credential = credential(route, identity, request);
    if (credential != null) builder.header("Authorization", credential);
    builder.method(route.method(), body == null || body.length == 0 ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofByteArray(body));
    HttpResponse<InputStream> upstream;
    try {
      upstream = client(target.connectTimeoutMs()).send(builder.build(), HttpResponse.BodyHandlers.ofInputStream());
    } catch (HttpConnectTimeoutException | ConnectException unreachable) {
      throw new HiveException(HttpStatus.BAD_GATEWAY, "UPSTREAM_UNREACHABLE", "The service target is unreachable");
    } catch (HttpTimeoutException timeout) {
      throw new HiveException(HttpStatus.GATEWAY_TIMEOUT, "UPSTREAM_TIMEOUT", "The service target did not answer within " + target.responseTimeoutMs() + " ms");
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      throw new HiveException(HttpStatus.SERVICE_UNAVAILABLE, "UPSTREAM_INTERRUPTED", "Interrupted");
    } catch (IOException failure) {
      throw new HiveException(HttpStatus.BAD_GATEWAY, "UPSTREAM_FAILED", "The service target connection failed");
    }
    byte[] payload;
    try (InputStream in = upstream.body()) {
      payload = in.readNBytes(target.maxResponseBytes() + 1);
    } catch (HttpTimeoutException timeout) {
      throw new HiveException(HttpStatus.GATEWAY_TIMEOUT, "UPSTREAM_TIMEOUT", "The service target response timed out");
    }
    if (payload.length > target.maxResponseBytes()) throw new HiveException(HttpStatus.BAD_GATEWAY, "RESPONSE_TOO_LARGE", "The service target response exceeds " + target.maxResponseBytes() + " bytes");
    if ("LEGACY".equals(route.authentication()) && upstream.statusCode() == 401) legacy.invalidate(route.legacy());
    response.setStatus(upstream.statusCode());
    for (String header : RESPONSE_HEADERS) upstream.headers().firstValue(header).ifPresent(value -> response.setHeader(header, value));
    response.setHeader("Cache-Control", upstream.headers().firstValue("Cache-Control").orElse("no-store"));
    if (!"HEAD".equals(route.method())) response.getOutputStream().write(payload);
    log(route, route.method(), actor, upstream.statusCode(), upstream.statusCode(), started, upstream.statusCode() >= 500 ? "UPSTREAM_ERROR" : "SUCCESS", null);
  }

  private String credential(Resolved route, SessionIdentity identity, HttpServletRequest request) {
    return switch (route.authentication()) {
      case "FORWARD_TOKEN" -> {
        if (identity == null) yield null;
        TokenRefresh tokens = refresh.getIfAvailable();
        var session = request.getSession(false);
        Object handle = session == null ? null : session.getAttribute(IdentityConfiguration.VAULT_HANDLE);
        if (tokens == null || !(handle instanceof String vaultHandle)) throw new HiveException(HttpStatus.UNAUTHORIZED, "SESSION_EXPIRED", "The session has no usable credential");
        try {
          yield "Bearer " + tokens.ensureFresh(vaultHandle).accessToken();
        } catch (RuntimeException expired) {
          throw new HiveException(HttpStatus.UNAUTHORIZED, "SESSION_EXPIRED", "The session expired; sign in again");
        }
      }
      case "LEGACY" -> legacy.token(route.legacy(), route.target().baseUrl()).header();
      default -> null;
    };
  }

  private HttpClient client(int connectTimeoutMs) {
    return clients.computeIfAbsent(connectTimeoutMs, timeout -> HttpClient.newBuilder().connectTimeout(Duration.ofMillis(timeout))
        .followRedirects(HttpClient.Redirect.NEVER).version(HttpClient.Version.HTTP_1_1).build());
  }

  private void log(Resolved route, String method, String actor, int status, Integer upstream, long started, String outcome, String reason) {
    observability.apiLog(new ObservabilityPublisher.ApiLogEntry(CorrelationId.current(), actor, method, route == null ? null : route.routeKey(),
        route == null ? null : route.operationKey(), route == null ? null : route.pathTemplate(), status, upstream, (int) ((System.nanoTime() - started) / 1_000_000),
        outcome, reason, route == null ? null : route.access()));
  }

  private void writeError(HttpServletResponse response, HiveException failure) throws IOException {
    if (response.isCommitted()) return;
    response.resetBuffer();
    response.setStatus(failure.status().value());
    response.setContentType("application/json");
    response.setHeader("Cache-Control", "no-store");
    response.getOutputStream().write(json.writeValueAsBytes(Map.of("code", failure.code(), "message", failure.getMessage(), "correlationId", CorrelationId.current())));
  }

  static SessionIdentity identity() {
    var authentication = SecurityContextHolder.getContext().getAuthentication();
    return authentication != null && authentication.getPrincipal() instanceof SessionIdentity identity ? identity : null;
  }
}
