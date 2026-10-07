package io.hiveplatform.artifacts.security;

import static io.hiveplatform.artifacts.security.UiArtifactUriPolicy.ArtifactType.JSON_MANIFEST;
import static io.hiveplatform.artifacts.security.UiArtifactUriPolicy.ArtifactType.REMOTE_ENTRY;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/**
 * The documented network-location matrix. Registration ({@code validateConfigured}) is offline;
 * fetch ({@code prepareForFetch}) resolves DNS, so the fetch rows use literals and localhost only.
 *
 * <p>Policy semantics being pinned down:</p>
 * <ul>
 *   <li>UNRESTRICTED: no address-class restriction for administrator-managed targets. Only
 *       targets that are never a legitimate artifact host stay blocked: cloud metadata,
 *       link-local, multicast, unspecified (0.0.0.0/::) and reserved ranges.</li>
 *   <li>DEVELOPMENT: like UNRESTRICTED, plus loopback is rewritten to the development host so a
 *       BFF inside Docker can reach an MFE served on the developer's machine.</li>
 *   <li>INTERNAL_ENTERPRISE: private ranges only when listed in allowed CIDRs; loopback blocked.</li>
 *   <li>PRODUCTION_INTERNET: public addresses only.</li>
 * </ul>
 */
class UiArtifactNetworkMatrixTest {

  private static UiArtifactUriPolicy policy(String mode, boolean http) {
    return new UiArtifactUriPolicy(mode, http, "", "10.0.0.0/8,192.168.0.0/16");
  }

  // ---------------------------------------------------------------- registration acceptance

  @ParameterizedTest(name = "[{index}] {0} accepts {1}")
  @CsvSource({
      // A/B loopback
      "UNRESTRICTED, http://localhost:3000/remoteEntry.js",
      "UNRESTRICTED, http://127.0.0.1:3000/remoteEntry.js",
      "DEVELOPMENT,  http://localhost:3000/remoteEntry.js",
      // C host.docker.internal / D docker service DNS / H public DNS
      "UNRESTRICTED, http://host.docker.internal:3002/remoteEntry.js",
      "UNRESTRICTED, http://mfe-records:80/remoteEntry.js",
      "UNRESTRICTED, https://cdn.example.com/records/remoteEntry.js",
      "PRODUCTION_INTERNET, https://cdn.example.com/records/remoteEntry.js",
      "INTERNAL_ENTERPRISE, https://mfe.corp.example/remoteEntry.js",
      // E/F/G private IPv4 literals
      "UNRESTRICTED, http://10.20.30.40:3000/remoteEntry.js",
      "UNRESTRICTED, http://172.16.5.9/remoteEntry.js",
      "UNRESTRICTED, http://192.168.10.25:3000/remoteEntry.js",
      "INTERNAL_ENTERPRISE, https://10.20.30.40/remoteEntry.js",
      "INTERNAL_ENTERPRISE, https://192.168.10.25/remoteEntry.js",
      // I public IPv4 / J IPv6
      "UNRESTRICTED, https://203.0.114.10/remoteEntry.js",
      "PRODUCTION_INTERNET, https://93.184.216.34/remoteEntry.js",
      "UNRESTRICTED, http://[2001:db8::10]:3000/remoteEntry.js",
      "UNRESTRICTED, https://[2606:4700::6810:84e5]/remoteEntry.js",
      "PRODUCTION_INTERNET, https://[2606:4700::6810:84e5]/remoteEntry.js",
      // K HTTPS
      "PRODUCTION_INTERNET, https://mfe.example.com/assets/remoteEntry.js",
  })
  void registrationAccepts(String mode, String url) {
    assertThat(policy(mode, true).validateConfigured(url, REMOTE_ENTRY, "Remote Entry"))
        .isEqualTo(URI.create(url));
  }

  @ParameterizedTest(name = "[{index}] {0} rejects {1}")
  @CsvSource({
      // PRODUCTION_INTERNET: no loopback / private
      "PRODUCTION_INTERNET, http://localhost:3000/remoteEntry.js",
      "PRODUCTION_INTERNET, https://10.20.30.40/remoteEntry.js",
      "PRODUCTION_INTERNET, https://192.168.10.25/remoteEntry.js",
      "PRODUCTION_INTERNET, https://[fd00::1]/remoteEntry.js",
      // INTERNAL_ENTERPRISE: private outside allowed CIDRs, loopback
      "INTERNAL_ENTERPRISE, https://172.16.5.9/remoteEntry.js",
      "INTERNAL_ENTERPRISE, https://127.0.0.1/remoteEntry.js",
      // Never-legitimate targets in every mode, including UNRESTRICTED
      "UNRESTRICTED, http://169.254.169.254/remoteEntry.js",
      "UNRESTRICTED, http://metadata.google.internal/remoteEntry.js",
      "UNRESTRICTED, http://0.0.0.0/remoteEntry.js",
      "UNRESTRICTED, http://224.0.0.1/remoteEntry.js",
      "UNRESTRICTED, http://[fe80::1]/remoteEntry.js",
      "UNRESTRICTED, http://[ff02::1]/remoteEntry.js",
  })
  void registrationRejects(String mode, String url) {
    assertThatThrownBy(() -> policy(mode, true).validateConfigured(url, REMOTE_ENTRY, "Remote Entry"))
        .isInstanceOf(IllegalArgumentException.class);
  }

  // ---------------------------------------------------------------- scheme (L / M)

  @Test void httpIsAcceptedOnlyWhenAllowHttpIsTrue() {
    assertThat(policy("UNRESTRICTED", true)
        .validateConfigured("http://192.168.10.25:3000/remoteEntry.js", REMOTE_ENTRY, "Remote Entry"))
        .isNotNull();
    assertThatThrownBy(() -> policy("UNRESTRICTED", false)
        .validateConfigured("http://192.168.10.25:3000/remoteEntry.js", REMOTE_ENTRY, "Remote Entry"))
        .hasMessageContaining("must use HTTPS");
    assertThat(policy("UNRESTRICTED", false)
        .validateConfigured("https://192.168.10.25/remoteEntry.js", REMOTE_ENTRY, "Remote Entry"))
        .isNotNull();
  }

  // ---------------------------------------------------------------- fetch-time agreement (§4)

  @ParameterizedTest(name = "[{index}] fetch agrees with registration: {0} {1}")
  @CsvSource({
      "UNRESTRICTED, http://127.0.0.1:3000/remoteEntry.js",
      "UNRESTRICTED, http://localhost:3000/remoteEntry.js",
      "UNRESTRICTED, http://10.20.30.40:3000/remoteEntry.js",
      "UNRESTRICTED, http://172.16.5.9/remoteEntry.js",
      "UNRESTRICTED, http://192.168.10.25:3000/remoteEntry.js",
      "UNRESTRICTED, https://203.0.114.10/remoteEntry.js",
      "UNRESTRICTED, http://[2001:db8::10]:3000/remoteEntry.js",
      "DEVELOPMENT,  http://192.168.10.25:3000/remoteEntry.js",
      "INTERNAL_ENTERPRISE, https://10.20.30.40/remoteEntry.js",
      "PRODUCTION_INTERNET, https://93.184.216.34/remoteEntry.js",
  })
  void whateverRegistrationAcceptsFetchAlsoAccepts(String mode, String url) {
    var policy = policy(mode, true);
    URI registered = policy.validateConfigured(url, REMOTE_ENTRY, "Remote Entry");
    URI fetch = policy.prepareForFetch(url, REMOTE_ENTRY, "Remote Entry");
    assertThat(fetch).isEqualTo(registered);
  }

  @Test void developmentBridgeIsTheOnlyModeThatRewritesLoopback() {
    var development = new UiArtifactUriPolicy("DEVELOPMENT", true, "10.0.0.5", "");
    assertThat(development.prepareForFetch("http://localhost:3002/remoteEntry.js",
        REMOTE_ENTRY, "Remote Entry").getHost()).isEqualTo("10.0.0.5");
    var unrestricted = new UiArtifactUriPolicy("UNRESTRICTED", true, "10.0.0.5", "");
    // Outside DEVELOPMENT a leftover development host is ignored, never fatal and never applied.
    assertThat(unrestricted.prepareForFetch("http://127.0.0.1:3002/remoteEntry.js",
        REMOTE_ENTRY, "Remote Entry").getHost()).isEqualTo("127.0.0.1");
  }

  // ---------------------------------------------------------------- chunks (N / O / P)

  @Test void chunkIsResolvedRelativeToTheRegisteredRemoteEntryDirectory() {
    var policy = policy("UNRESTRICTED", true);
    assertThat(policy.prepareAssetForFetch("http://192.168.10.25:3000/records/remoteEntry.js",
        "static/js/925.chunk.js"))
        .isEqualTo(URI.create("http://192.168.10.25:3000/records/static/js/925.chunk.js"));
  }

  @ParameterizedTest(name = "[{index}] chunk rejected: {0}")
  @CsvSource({
      "../secret.js",
      "static/../../etc/passwd",
      "static/%2e%2e/x.js",
      "static%2fx.js",
      "chunk.js?x=1",
      "chunk.js#frag",
      "static\\x.js",
  })
  void chunkTraversalAndInjectionAreRejected(String asset) {
    assertThatThrownBy(() -> policy("UNRESTRICTED", true)
        .prepareAssetForFetch("http://192.168.10.25:3000/records/remoteEntry.js", asset))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test void chunkCannotChangeOriginEvenInUnrestrictedMode() {
    // A protocol-relative looking asset path is treated as a plain path below the artifact
    // directory: the origin of the registered remoteEntry is the only origin ever fetched.
    URI resolved = policy("UNRESTRICTED", true)
        .prepareAssetForFetch("http://192.168.10.25:3000/records/remoteEntry.js", "//evil.example/x.js");
    assertThat(resolved.getHost()).isEqualTo("192.168.10.25");
    assertThat(resolved.getPath()).startsWith("/records/");
  }

  // ---------------------------------------------------------------- manifests (Q / R)

  @Test void mfManifestAndResourceManifestUrlsFollowTheSameNetworkRules() {
    var policy = policy("UNRESTRICTED", true);
    assertThat(policy.validateConfigured("http://192.168.10.25:3000/mf-manifest.json",
        JSON_MANIFEST, "MF manifest")).isNotNull();
    assertThat(policy.validateConfigured("http://192.168.10.25:3000/resource-manifest.json",
        JSON_MANIFEST, "Resource manifest")).isNotNull();
    assertThatThrownBy(() -> policy.validateConfigured("http://192.168.10.25:3000/manifest.txt",
        JSON_MANIFEST, "MF manifest")).hasMessageContaining("JSON");
    assertThatThrownBy(() -> policy.validateConfigured("http://user:pw@192.168.10.25/m.json",
        JSON_MANIFEST, "MF manifest")).isInstanceOf(IllegalArgumentException.class);
  }

  // ---------------------------------------------------------------- diagnosable failures (§11)

  @Test void failureMessagesNameTheActualCause() {
    var policy = policy("PRODUCTION_INTERNET", false);
    assertThatThrownBy(() -> policy.validateConfigured("http://cdn.example.com/x.js", REMOTE_ENTRY, "Remote Entry"))
        .hasMessageContaining("HTTPS");
    assertThatThrownBy(() -> policy.validateConfigured("https://10.1.1.1/x.js", REMOTE_ENTRY, "Remote Entry"))
        .hasMessageContaining("private target");
    assertThatThrownBy(() -> policy.validateConfigured("https://169.254.169.254/x.js", REMOTE_ENTRY, "Remote Entry"))
        .hasMessageContaining("blocked by the UI artifact network policy");
    assertThatThrownBy(() -> policy.validateConfigured("https://cdn.example.com/x.txt", REMOTE_ENTRY, "Remote Entry"))
        .hasMessageContaining("JavaScript");
    assertThatThrownBy(() -> policy.validateConfigured("not a url", REMOTE_ENTRY, "Remote Entry"))
        .hasMessageContaining("Invalid");
    assertThatThrownBy(() -> policy.prepareForFetch("https://no-such-host.invalid/x.js", REMOTE_ENTRY, "Remote Entry"))
        .hasMessageContaining("cannot be resolved");
  }
}
