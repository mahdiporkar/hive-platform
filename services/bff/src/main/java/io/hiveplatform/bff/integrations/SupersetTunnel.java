package io.hiveplatform.bff.integrations;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.hiveplatform.bff.control.ControlPlaneClient;
import io.hiveplatform.bff.observability.ObservabilityPublisher;
import io.hiveplatform.bff.proxy.SecretResolver;
import io.hiveplatform.bff.proxy.TargetGuard;
import io.hiveplatform.bff.security.SessionIdentity;
import io.hiveplatform.bff.security.TokenVaultCrypto;
import io.hiveplatform.spring.CorrelationId;
import io.hiveplatform.spring.HiveException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

/**
 * Same-origin authorized tunnel to an optional Superset instance: {@code /api/integrations/superset/{key}/...}.
 * Every request is decided by the control plane (integration access + asset view grants; default deny for unlisted
 * operations). The BFF authenticates to Superset with a service account resolved from a secret reference; that token
 * is cached encrypted in Redis and never leaves the BFF. Browser cookies and credentials are never forwarded.
 */
@RestController
class SupersetTunnel {
  record Resolution(boolean allowed, String reason, String baseUrl, boolean tlsRequired, String credentialReference, long revision, String operation) {}

  private static final String PREFIX = "/api/integrations/superset/";
  private static final List<String> REQUEST_HEADERS = List.of("Accept", "Accept-Language", "Content-Type");
  private static final List<String> RESPONSE_HEADERS = List.of("Content-Type", "Content-Language", "ETag", "Last-Modified");
  private static final Set<String> DASHBOARD_KEYS = Set.of("dashboard_id", "dashboardId");
  private static final Set<String> CHART_KEYS = Set.of("slice_id", "sliceId", "chart_id", "chartId");
  private static final int MAX_BODY = 1024 * 1024, MAX_RESPONSE = 5 * 1024 * 1024;

  private final ControlPlaneClient control;
  private final TargetGuard guard;
  private final SecretResolver secrets;
  private final StringRedisTemplate redis;
  private final TokenVaultCrypto crypto;
  private final ObservabilityPublisher observability;
  private final ObjectMapper json;
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).followRedirects(HttpClient.Redirect.NEVER).version(HttpClient.Version.HTTP_1_1).build();

  SupersetTunnel(ControlPlaneClient control, TargetGuard guard, SecretResolver secrets, StringRedisTemplate redis, ObservabilityPublisher observability, ObjectMapper json,
      @org.springframework.beans.factory.annotation.Value("${hive.vault.key-id:current}") String keyId, @org.springframework.beans.factory.annotation.Value("${hive.vault.key:}") String key,
      @org.springframework.beans.factory.annotation.Value("${hive.vault.previous-keys:}") String previous) {
    this.control = control;
    this.guard = guard;
    this.secrets = secrets;
    this.redis = redis;
    this.observability = observability;
    this.json = json;
    this.crypto = key.isBlank() ? null : new TokenVaultCrypto(keyId, key, previous);
  }

  @RequestMapping(value = PREFIX + "{integration}/**", method = {RequestMethod.GET, RequestMethod.POST})
  void tunnel(@PathVariable String integration, HttpServletRequest request, HttpServletResponse response) throws IOException {
    long started = System.nanoTime();
    var authentication = SecurityContextHolder.getContext().getAuthentication();
    SessionIdentity identity = authentication != null && authentication.getPrincipal() instanceof SessionIdentity s ? s : null;
    String path = request.getRequestURI().substring((PREFIX + integration).length());
    if (path.isEmpty()) path = "/";
    String outcome = "SUCCESS", reason = null;
    int status = 500;
    try {
      if (!integration.matches("[a-z][a-z0-9-]{1,59}") || path.contains("//") || path.contains("\\") || path.toLowerCase().contains("%2") || path.contains("/../") || path.endsWith("/.."))
        throw new HiveException(HttpStatus.BAD_REQUEST, "ROUTE_PATH_INVALID", "Invalid integration path");
      if (identity == null) throw new HiveException(HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED", "Sign in to use this integration");
      byte[] body = null;
      String[] hint = {"", ""};
      if ("POST".equals(request.getMethod())) {
        try (InputStream in = request.getInputStream()) { body = in.readNBytes(MAX_BODY + 1); }
        if (body.length > MAX_BODY) throw new HiveException(HttpStatus.PAYLOAD_TOO_LARGE, "REQUEST_TOO_LARGE", "Request body too large");
        hint = inspect(body);
      }
      var resolve = new HashMap<String, Object>();
      resolve.put("integration", integration); resolve.put("method", request.getMethod()); resolve.put("path", path);
      resolve.put("hintType", hint[0]); resolve.put("hintId", hint[1]); resolve.put("userId", identity.id());
      Resolution decision = control.post("/internal/integrations/superset/resolve", resolve, Resolution.class);
      if (!decision.allowed()) throw new HiveException(decision.reason().equals("INTEGRATION_UNAVAILABLE") ? HttpStatus.NOT_FOUND : HttpStatus.FORBIDDEN, "ACCESS_DENIED", "Not permitted: " + decision.reason());
      URI target = guard.resolve(decision.baseUrl(), path, request.getQueryString());
      if (decision.tlsRequired() && !"https".equals(target.getScheme())) throw new HiveException(HttpStatus.BAD_GATEWAY, "TLS_REQUIRED", "Integration requires TLS");
      var builder = HttpRequest.newBuilder(target).timeout(Duration.ofSeconds(30)).header(CorrelationId.HEADER, CorrelationId.current())
          .header("Authorization", "Bearer " + serviceToken(integration, decision, target));
      for (String header : REQUEST_HEADERS) { String value = request.getHeader(header); if (value != null && value.length() < 512) builder.header(header, value); }
      builder.method(request.getMethod(), body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofByteArray(body));
      HttpResponse<InputStream> upstream;
      try { upstream = http.send(builder.build(), HttpResponse.BodyHandlers.ofInputStream()); }
      catch (IOException failure) { throw new HiveException(HttpStatus.BAD_GATEWAY, "UPSTREAM_UNREACHABLE", "Superset is unreachable"); }
      catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); throw new HiveException(HttpStatus.SERVICE_UNAVAILABLE, "UPSTREAM_INTERRUPTED", "Interrupted"); }
      byte[] payload;
      try (InputStream in = upstream.body()) { payload = in.readNBytes(MAX_RESPONSE + 1); }
      if (payload.length > MAX_RESPONSE) throw new HiveException(HttpStatus.BAD_GATEWAY, "RESPONSE_TOO_LARGE", "Superset response too large");
      if (upstream.statusCode() == 401) redis.delete(cacheKey(integration, decision));
      if ("health".equals(decision.operation()))
        control.post("/internal/integrations/superset/" + integration + "/health", Map.of("status", upstream.statusCode() == 200 ? "ACTIVE" : "UNREACHABLE"));
      status = upstream.statusCode();
      response.setStatus(status);
      for (String header : RESPONSE_HEADERS) upstream.headers().firstValue(header).ifPresent(v -> response.setHeader(header, v));
      response.setHeader("Cache-Control", "no-store");
      response.getOutputStream().write(payload);
      if (status >= 500) outcome = "UPSTREAM_ERROR";
    } catch (HiveException failure) {
      status = failure.status().value();
      outcome = status == 401 ? "UNAUTHENTICATED" : status == 403 ? "DENIED" : status == 404 ? "NOT_FOUND" : status >= 500 ? "UPSTREAM_ERROR" : "REJECTED";
      reason = failure.code();
      if (!response.isCommitted()) {
        response.setStatus(status);
        response.setContentType("application/json");
        response.getOutputStream().write(json.writeValueAsBytes(Map.of("code", failure.code(), "message", failure.getMessage(), "correlationId", CorrelationId.current())));
      }
    }
    observability.apiLog(new ObservabilityPublisher.ApiLogEntry(CorrelationId.current(), identity == null ? null : "user:" + identity.id(), request.getMethod(),
        "superset:" + integration, null, "/api/integrations/superset/" + integration + (path.startsWith("/api/v1/") ? "/api/v1/…" : path), status, null,
        (int) ((System.nanoTime() - started) / 1_000_000), outcome, reason, "AUTHENTICATED"));
  }

  /** Service-account access token, acquired once per integration revision and cached encrypted until shortly before expiry. */
  private String serviceToken(String integration, Resolution decision, URI target) throws IOException {
    if (crypto == null) throw new HiveException(HttpStatus.SERVICE_UNAVAILABLE, "VAULT_UNAVAILABLE", "Token vault key is not configured");
    String key = cacheKey(integration, decision);
    String cached = redis.opsForValue().get(key);
    if (cached != null) {
      try { return crypto.decrypt(cached); } catch (RuntimeException corrupt) { redis.delete(key); }
    }
    var credential = secrets.resolve(decision.credentialReference());
    if (credential.username() == null || credential.password() == null) throw new HiveException(HttpStatus.BAD_GATEWAY, "CREDENTIAL_INCOMPLETE", "Superset service account needs username and password");
    URI login = guard.resolve(decision.baseUrl(), "/api/v1/security/login", null);
    var body = json.writeValueAsString(Map.of("username", credential.username(), "password", credential.password(), "provider", "db", "refresh", false));
    HttpResponse<byte[]> answer;
    try { answer = http.send(HttpRequest.newBuilder(login).timeout(Duration.ofSeconds(10)).header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofByteArray()); }
    catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); throw new HiveException(HttpStatus.SERVICE_UNAVAILABLE, "UPSTREAM_INTERRUPTED", "Interrupted"); }
    catch (IOException failure) { throw new HiveException(HttpStatus.BAD_GATEWAY, "UPSTREAM_UNREACHABLE", "Superset is unreachable"); }
    if (answer.statusCode() != 200 || answer.body().length > 65536) throw new HiveException(HttpStatus.BAD_GATEWAY, "INTEGRATION_LOGIN_REJECTED", "Superset rejected the service account (HTTP " + answer.statusCode() + ")");
    String token = json.readTree(answer.body()).path("access_token").asText("");
    if (token.isBlank() || token.length() > 16384) throw new HiveException(HttpStatus.BAD_GATEWAY, "INTEGRATION_LOGIN_REJECTED", "Superset returned no access token");
    redis.opsForValue().set(key, crypto.encrypt(token), ttl(token));
    observability.audit("integration.superset.token.acquired", "SUCCESS", "system:bff", Map.of("integration", integration, "revision", decision.revision()));
    return token;
  }

  /** Lifetime from the JWT `exp` claim (issued by the trusted, registered instance) minus a 30 s margin; 4 minutes otherwise. */
  private Duration ttl(String token) {
    try {
      String[] parts = token.split("\\.");
      long exp = json.readTree(Base64.getUrlDecoder().decode(parts[1])).path("exp").asLong(0);
      long seconds = exp - Instant.now().getEpochSecond() - 30;
      if (seconds > 0) return Duration.ofSeconds(Math.min(seconds, 3600));
    } catch (RuntimeException | IOException ignored) { /* opaque token */ }
    return Duration.ofMinutes(4);
  }

  private static String cacheKey(String integration, Resolution decision) { return "hive:integration:superset:" + integration + ":" + decision.revision(); }

  /** Finds the dashboard or chart a chart-data request is about (reference SupersetRequestInspector behavior). */
  private String[] inspect(byte[] body) {
    try {
      JsonNode root = json.readTree(body);
      String dashboard = find(root, DASHBOARD_KEYS);
      if (dashboard != null && dashboard.matches("[a-z0-9-]{1,64}")) return new String[] {"DASHBOARD", dashboard};
      String chart = find(root, CHART_KEYS);
      if (chart != null && chart.matches("[a-z0-9-]{1,64}")) return new String[] {"CHART", chart};
    } catch (IOException | RuntimeException ignored) { /* no hint: the control plane denies */ }
    return new String[] {"", ""};
  }

  private static String find(JsonNode node, Set<String> names) {
    if (node == null) return null;
    if (node.isObject()) {
      for (Iterator<String> fields = node.fieldNames(); fields.hasNext(); ) {
        String name = fields.next();
        JsonNode value = node.get(name);
        if (names.contains(name) && value.isValueNode()) return value.asText();
        String nested = find(value, names);
        if (nested != null) return nested;
      }
    } else if (node.isArray()) for (JsonNode child : node) { String nested = find(child, names); if (nested != null) return nested; }
    return null;
  }
}
