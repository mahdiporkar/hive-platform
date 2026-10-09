package io.hiveplatform.bff.mfe;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import io.hiveplatform.artifacts.security.UiArtifactUriPolicy;
import io.hiveplatform.bff.control.ControlPlaneClient;
import io.hiveplatform.spring.HiveException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Gateway behavior against a real local HTTP upstream: path confinement, integrity, content types, caching, versions. */
class ArtifactGatewayTest {
  private HttpServer upstream;
  private final AtomicInteger hits = new AtomicInteger();
  private volatile String entry = "var remote; remote = {get(){}, init(){}};";
  private ControlPlaneClient control;
  private ArtifactGateway gateway;
  private String origin;

  @BeforeEach
  void start() throws Exception {
    upstream = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    upstream.createContext("/", exchange -> {
      hits.incrementAndGet();
      String path = exchange.getRequestURI().getPath();
      byte[] body;
      String type;
      switch (path) {
        case "/app/remoteEntry.js" -> { body = entry.getBytes(StandardCharsets.UTF_8); type = "text/javascript"; }
        case "/app/assets/chunk.js" -> { body = "self.chunk=1;".getBytes(); type = "application/javascript"; }
        case "/app/assets/style.css" -> { body = ".x{}".getBytes(); type = "text/css"; }
        case "/app/assets/fake.js" -> { body = "<html>".getBytes(); type = "text/html"; }
        case "/app/redirect.js" -> { exchange.getResponseHeaders().add("Location", "http://169.254.169.254/"); exchange.sendResponseHeaders(302, -1); exchange.close(); return; }
        default -> { exchange.sendResponseHeaders(404, -1); exchange.close(); return; }
      }
      exchange.getResponseHeaders().add("Content-Type", type);
      exchange.sendResponseHeaders(200, body.length);
      exchange.getResponseBody().write(body);
      exchange.close();
    });
    upstream.start();
    origin = "http://127.0.0.1:" + upstream.getAddress().getPort();
    control = mock(ControlPlaneClient.class);
    resolveTo("1.0.0", origin + "/app/remoteEntry.js", sri(entry), 7);
    gateway = new ArtifactGateway(control, new ObjectMapper(), new UiArtifactUriPolicy("DEVELOPMENT", true, ""),
        new ArtifactGateway.Settings(Duration.ofMillis(0), Duration.ofSeconds(60), 1024 * 1024, 8 * 1024 * 1024, Duration.ofSeconds(2), Duration.ofSeconds(5)));
  }

  @AfterEach
  void stop() { upstream.stop(0); }

  private void resolveTo(String version, String url, String integrity, long revision) {
    String body = "{\"moduleKey\":\"reports\",\"manifestVersion\":\"" + version + "\",\"url\":\"" + url + "\",\"integrity\":\"" + integrity
        + "\",\"format\":\"WEBPACK_FEDERATION\",\"revision\":" + revision + "}";
    when(control.exchange(eq("GET"), anyString(), any(), any(), any())).thenReturn(new ControlPlaneClient.Raw(200, "application/json", body.getBytes()));
  }

  private static String sri(String text) throws Exception {
    return "sha384-" + Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-384").digest(text.getBytes(StandardCharsets.UTF_8)));
  }

  private String code(Runnable call) {
    try { call.run(); return "OK"; } catch (HiveException e) { return e.code(); }
  }

  @Test
  void servesEntryChunksAndStylesBelowTheRegisteredDirectory() {
    assertThat(new String(gateway.serve("reports", "1.0.0", "remoteEntry.js", null).body())).isEqualTo(entry);
    assertThat(gateway.serve("reports", "1.0.0", "assets/chunk.js", null).contentType()).contains("javascript");
    assertThat(gateway.serve("reports", "1.0.0", "assets/style.css", null).contentType()).isEqualTo("text/css");
  }

  @Test
  void refusesTraversalOtherVersionsRedirectsAndMislabelledScript() {
    assertThat(code(() -> gateway.serve("reports", "1.0.0", "../secret.js", null))).isEqualTo("MFE_ASSET_PATH_INVALID");
    assertThat(code(() -> gateway.serve("reports", "1.0.0", "assets/%2e%2e/x.js", null))).isEqualTo("MFE_ASSET_PATH_INVALID");
    assertThat(code(() -> gateway.serve("reports", "0.9.0", "remoteEntry.js", null))).isEqualTo("MFE_VERSION_NOT_ACTIVE");
    assertThat(code(() -> gateway.serve("reports", "1.0.0", "redirect.js", null))).isEqualTo("MFE_REDIRECT_REFUSED");
    assertThat(code(() -> gateway.serve("reports", "1.0.0", "assets/fake.js", null))).isEqualTo("MFE_CONTENT_TYPE");
    assertThat(code(() -> gateway.serve("reports", "1.0.0", "missing.js", null))).isEqualTo("MFE_ASSET_NOT_FOUND");
  }

  @Test
  void entryMustMatchRegisteredIntegrity() {
    entry = "var remote; /* tampered */";
    assertThat(code(() -> gateway.serve("reports", "1.0.0", "remoteEntry.js", null))).isEqualTo("ARTIFACT_INTEGRITY_MISMATCH");
  }

  @Test
  void unavailableModulesAreNotFoundAndNeverFetched() {
    when(control.exchange(eq("GET"), anyString(), any(), any(), any())).thenReturn(new ControlPlaneClient.Raw(404, "application/json", new byte[0]));
    assertThat(code(() -> gateway.serve("reports", "1.0.0", "remoteEntry.js", null))).isEqualTo("MFE_MODULE_UNAVAILABLE");
    assertThat(hits.get()).isZero();
  }

  @Test
  void cachesPerRevisionAndRefetchesAfterActivation() throws Exception {
    gateway.serve("reports", "1.0.0", "assets/chunk.js", null);
    gateway.serve("reports", "1.0.0", "assets/chunk.js", null);
    assertThat(hits.get()).isEqualTo(1);
    resolveTo("1.0.0", origin + "/app/remoteEntry.js", sri(entry), 8);
    gateway.serve("reports", "1.0.0", "assets/chunk.js", null);
    assertThat(hits.get()).isEqualTo(2);
    verify(control, times(3)).exchange(eq("GET"), eq("/internal/runtime/artifacts/reports"), any(), any(), eq(Map.of()));
  }

  @Test
  void blockedDestinationsAreRefusedByTheGatewayPolicy() {
    var strict = new ArtifactGateway(control, new ObjectMapper(), new UiArtifactUriPolicy("PRODUCTION_INTERNET", true, ""),
        new ArtifactGateway.Settings(Duration.ZERO, Duration.ofSeconds(1), 1024, 1024, Duration.ofSeconds(1), Duration.ofSeconds(1)));
    assertThatThrownBy(() -> strict.serve("reports", "1.0.0", "remoteEntry.js", null)).isInstanceOf(HiveException.class)
        .extracting(e -> ((HiveException) e).code()).isEqualTo("MFE_TARGET_BLOCKED");
    assertThat(hits.get()).isZero();
  }
}
