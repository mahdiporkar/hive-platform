package io.hiveplatform.bff.control;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.hiveplatform.spring.CorrelationId;
import io.hiveplatform.spring.HiveException;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;

/**
 * The BFF's only channel to the authorization service (control plane and runtime APIs). Machine Basic credentials,
 * no redirects, bounded responses, propagated correlation id. Upstream PlatformErrors are surfaced with their code.
 */
public final class ControlPlaneClient {
  public record Raw(int status, String contentType, byte[] body) {}

  private static final int MAX_BYTES = 4 * 1024 * 1024;
  private final URI base;
  private final String authorization;
  private final ObjectMapper json;
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).followRedirects(HttpClient.Redirect.NEVER).build();

  public ControlPlaneClient(String url, String password, boolean allowHttp, ObjectMapper json) {
    this.base = URI.create(url == null ? "" : url);
    boolean schemeOk = "https".equals(base.getScheme()) || (allowHttp && "http".equals(base.getScheme()));
    if (base.getHost() == null || !schemeOk || base.getUserInfo() != null || base.getQuery() != null || base.getFragment() != null)
      throw new IllegalArgumentException("HIVE_AUTHORIZATION_URL must be an HTTPS origin (HTTP only with HIVE_CONTROL_ALLOW_HTTP=true)");
    if (password == null || password.length() < 32) throw new IllegalArgumentException("HIVE_INTERNAL_PASSWORD must contain at least 32 characters");
    this.authorization = "Basic " + Base64.getEncoder().encodeToString(("bff:" + password).getBytes(StandardCharsets.UTF_8));
    this.json = json;
  }

  public JsonNode get(String path) { return parse(exchange("GET", path, null, null, Map.of())); }

  public JsonNode post(String path, Object body) {
    try {
      return parse(exchange("POST", path, json.writeValueAsBytes(body), "application/json", Map.of()));
    } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
      throw new IllegalStateException(e);
    }
  }

  public <T> T post(String path, Object body, Class<T> type) {
    try {
      return json.treeToValue(post(path, body), type);
    } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
      throw new HiveException(HttpStatus.BAD_GATEWAY, "CONTROL_PLANE_RESPONSE_INVALID", "Control plane returned an unexpected document");
    }
  }

  /** Raw passthrough for administrative calls; the caller decides how to relay status and body. */
  public Raw exchange(String method, String pathAndQuery, byte[] body, String contentType, Map<String, String> headers) {
    try {
      var builder = HttpRequest.newBuilder(base.resolve(pathAndQuery)).timeout(Duration.ofSeconds(15))
          .header("Authorization", authorization).header("Accept", "application/json").header(CorrelationId.HEADER, CorrelationId.current());
      headers.forEach(builder::header);
      if (body == null) builder.method(method, HttpRequest.BodyPublishers.noBody());
      else builder.header("Content-Type", contentType == null ? "application/json" : contentType).method(method, HttpRequest.BodyPublishers.ofByteArray(body));
      HttpResponse<InputStream> response = http.send(builder.build(), HttpResponse.BodyHandlers.ofInputStream());
      byte[] bytes;
      try (InputStream in = response.body()) {
        bytes = in.readNBytes(MAX_BYTES + 1);
      }
      if (bytes.length > MAX_BYTES) throw new HiveException(HttpStatus.BAD_GATEWAY, "CONTROL_PLANE_RESPONSE_TOO_LARGE", "Control plane response exceeded the limit");
      return new Raw(response.statusCode(), response.headers().firstValue("Content-Type").orElse("application/json"), bytes);
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      throw unavailable();
    } catch (IOException failure) {
      throw unavailable();
    }
  }

  private JsonNode parse(Raw raw) {
    JsonNode node;
    try {
      node = raw.body().length == 0 ? json.createObjectNode() : json.readTree(raw.body());
    } catch (IOException e) {
      throw new HiveException(HttpStatus.BAD_GATEWAY, "CONTROL_PLANE_RESPONSE_INVALID", "Control plane returned malformed JSON");
    }
    if (raw.status() / 100 == 2) return node;
    String code = node.path("code").asText("CONTROL_PLANE_REJECTED");
    String message = node.path("message").asText("Control plane rejected the request");
    HttpStatus status = Set.of(400, 401, 403, 404, 409, 422).contains(raw.status()) ? HttpStatus.valueOf(raw.status()) : HttpStatus.BAD_GATEWAY;
    throw new HiveException(status, code, message);
  }

  private static HiveException unavailable() {
    return new HiveException(HttpStatus.SERVICE_UNAVAILABLE, "CONTROL_PLANE_UNAVAILABLE", "The authorization service is unavailable");
  }
}
