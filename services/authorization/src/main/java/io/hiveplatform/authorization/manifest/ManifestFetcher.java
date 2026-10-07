package io.hiveplatform.authorization.manifest;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.hiveplatform.artifacts.security.UiArtifactUriPolicy;
import io.hiveplatform.spring.HiveException;
import java.io.InputStream;
import java.net.ConnectException;
import java.net.URI;
import java.net.UnknownHostException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.Locale;
import org.springframework.http.HttpStatus;

/**
 * Fetches manifests from registered locations. The network policy is re-applied with DNS resolution immediately
 * before each fetch; redirects are never followed; bodies are bounded to 1 MiB; failures carry a precise cause.
 */
public final class ManifestFetcher {
  private static final int MAX_BYTES = 1_048_576;
  private final UiArtifactUriPolicy policy;
  private final ObjectMapper json;
  private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build();

  public ManifestFetcher(UiArtifactUriPolicy policy, ObjectMapper json) {
    this.policy = policy;
    this.json = json;
  }

  public JsonNode fetch(String url) {
    URI target;
    try {
      target = policy.prepareForFetch(url, UiArtifactUriPolicy.ArtifactType.JSON_MANIFEST, "Manifest");
    } catch (IllegalArgumentException rejected) {
      throw failure("MANIFEST_LOCATION_REJECTED", rejected.getMessage());
    }
    try {
      var request = HttpRequest.newBuilder(target).timeout(Duration.ofSeconds(10)).header("Accept", "application/json").GET().build();
      HttpResponse<InputStream> response = client.send(request, HttpResponse.BodyHandlers.ofInputStream());
      try (InputStream body = response.body()) {
        if (response.statusCode() / 100 == 3) throw failure("MANIFEST_REDIRECT_REFUSED", "Manifest endpoint redirected; redirects are not followed");
        if (response.statusCode() / 100 != 2) throw failure("MANIFEST_HTTP_ERROR", "Manifest endpoint returned HTTP " + response.statusCode());
        String type = response.headers().firstValue("Content-Type").orElse("").toLowerCase(Locale.ROOT);
        if (!type.isBlank() && !type.contains("json")) throw failure("MANIFEST_CONTENT_TYPE", "Manifest endpoint must return JSON, returned " + type);
        byte[] bytes = body.readNBytes(MAX_BYTES + 1);
        if (bytes.length > MAX_BYTES) throw failure("MANIFEST_TOO_LARGE", "Manifest exceeds the 1 MiB limit");
        try {
          return json.readTree(bytes);
        } catch (java.io.IOException malformed) {
          throw failure("MANIFEST_NOT_JSON", "Manifest body is not valid JSON");
        }
      }
    } catch (HiveException known) {
      throw known;
    } catch (HttpTimeoutException timeout) {
      throw failure("MANIFEST_TIMEOUT", "Manifest fetch timed out");
    } catch (UnknownHostException dns) {
      throw failure("MANIFEST_DNS", "Manifest host could not be resolved");
    } catch (ConnectException refused) {
      throw failure("MANIFEST_UNREACHABLE", "Manifest host refused the connection or is unreachable");
    } catch (javax.net.ssl.SSLException tls) {
      throw failure("MANIFEST_TLS", "Manifest TLS handshake failed");
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      throw failure("MANIFEST_INTERRUPTED", "Manifest fetch was interrupted");
    } catch (Exception other) {
      throw failure("MANIFEST_FETCH_FAILED", "Unable to fetch manifest: " + other.getClass().getSimpleName());
    }
  }

  private static HiveException failure(String code, String message) {
    return new HiveException(HttpStatus.BAD_GATEWAY, code, message);
  }
}
