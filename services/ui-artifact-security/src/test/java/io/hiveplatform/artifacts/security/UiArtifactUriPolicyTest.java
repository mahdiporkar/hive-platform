package io.hiveplatform.artifacts.security;

import static io.hiveplatform.artifacts.security.UiArtifactUriPolicy.ArtifactType.JSON_MANIFEST;
import static io.hiveplatform.artifacts.security.UiArtifactUriPolicy.ArtifactType.REMOTE_ENTRY;
import static io.hiveplatform.artifacts.security.UiArtifactUriPolicy.ArtifactType.EXTERNAL_ORIGIN;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class UiArtifactUriPolicyTest {
  @Test void acceptsAdministratorConfiguredOriginWithoutPerMfeAllowlist() {
    var policy=new UiArtifactUriPolicy("PRODUCTION_INTERNET",false,"");
    assertThat(policy.validateConfigured(
        "https://example-mfe.company.com/remoteEntry.js",REMOTE_ENTRY,"Remote Entry").toString())
        .isEqualTo("https://example-mfe.company.com/remoteEntry.js");
    assertThat(policy.validateConfigured(
        "https://example-mfe.company.com/mf-manifest.json",JSON_MANIFEST,"MF manifest").toString())
        .endsWith("/mf-manifest.json");
  }

  @Test void acceptsExternalIntegrationBasePathButRejectsCredentialsAndMetadataTargets() {
    var policy=new UiArtifactUriPolicy("PRODUCTION_INTERNET",false,"");
    assertThat(policy.validateConfigured("https://example.com/superset",EXTERNAL_ORIGIN,
        "Superset").toString()).isEqualTo("https://example.com/superset");
    assertThatThrownBy(()->policy.validateConfigured(
        "https://user:secret@example.com/superset",EXTERNAL_ORIGIN,"Superset"))
        .hasMessageContaining("credentials");
    assertThatThrownBy(()->policy.validateConfigured(
        "https://169.254.169.254/latest/meta-data",EXTERNAL_ORIGIN,"Superset"))
        .hasMessageContaining("blocked");
  }

  @Test void rejectsMalformedCredentialsQueriesFragmentsAndWrongExtensions() {
    var policy=new UiArtifactUriPolicy("PRODUCTION_INTERNET",false,"");
    assertThatThrownBy(()->policy.validateConfigured("not a URL",REMOTE_ENTRY,"Remote Entry"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(()->policy.validateConfigured(
        "https://user:pass@example.com/remoteEntry.js",REMOTE_ENTRY,"Remote Entry"))
        .hasMessageContaining("without credentials");
    assertThatThrownBy(()->policy.validateConfigured(
        "https://example.com/remoteEntry.js?x=1",REMOTE_ENTRY,"Remote Entry"))
        .hasMessageContaining("query");
    assertThatThrownBy(()->policy.validateConfigured(
        "https://example.com/remoteEntry.json",REMOTE_ENTRY,"Remote Entry"))
        .hasMessageContaining("JavaScript");
  }

  @Test void productionInternetRejectsSsrfTargetsButEnterpriseCanUsePrivateNetworks() {
    var internet=new UiArtifactUriPolicy("PRODUCTION_INTERNET",true,"");
    for(String host:new String[]{"127.0.0.1","0.0.0.0","169.254.169.254","10.20.30.40","[::1]"}) {
      assertThatThrownBy(()->internet.validateConfigured(
          "http://"+host+":8080/remoteEntry.js",REMOTE_ENTRY,"Remote Entry"))
          .as(host).isInstanceOf(IllegalArgumentException.class);
    }
    var enterprise=new UiArtifactUriPolicy("INTERNAL_ENTERPRISE",true,"","10.20.0.0/16");
    assertThat(enterprise.validateConfigured(
        "http://10.20.30.40:8080/remoteEntry.js",REMOTE_ENTRY,"Remote Entry").getHost())
        .isEqualTo("10.20.30.40");
    assertThatThrownBy(()->enterprise.validateConfigured(
        "http://127.0.0.1:8080/remoteEntry.js",REMOTE_ENTRY,"Remote Entry"))
        .hasMessageContaining("loopback");
    assertThatThrownBy(()->enterprise.validateConfigured(
        "http://192.168.1.10:8080/remoteEntry.js",REMOTE_ENTRY,"Remote Entry"))
        .hasMessageContaining("ALLOWED_PRIVATE_CIDRS");
  }

  @Test void developmentBridgeReplacesLoopbackHostAndPreservesArbitraryPort() {
    var policy=new UiArtifactUriPolicy("DEVELOPMENT",true,"localhost");
    assertThat(policy.prepareForFetch(
        "http://127.0.0.1:3999/remoteEntry.js",REMOTE_ENTRY,"Remote Entry").toString())
        .isEqualTo("http://localhost:3999/remoteEntry.js");
  }

  @Test void rejectsMalformedEnterpriseCidrConfiguration() {
    assertThatThrownBy(()->new UiArtifactUriPolicy(
        "INTERNAL_ENTERPRISE",false,"","private-network"))
        .hasMessageContaining("CIDR");
  }

  @Test void unrestrictedPolicyAllowsAnMfeOutsideDockerOrAnApprovedCidr() {
    var policy=new UiArtifactUriPolicy("UNRESTRICTED",true,"","");
    assertThat(policy.validateConfigured(
        "http://192.168.50.15:4100/remoteEntry.js",REMOTE_ENTRY,"Remote Entry").getHost())
        .isEqualTo("192.168.50.15");
    assertThat(policy.validateConfigured(
        "http://127.0.0.1:4100/remoteEntry.js",REMOTE_ENTRY,"Remote Entry").getHost())
        .isEqualTo("127.0.0.1");
    assertThatThrownBy(()->policy.validateConfigured(
        "http://169.254.169.254/latest/remoteEntry.js",REMOTE_ENTRY,"Remote Entry"))
        .hasMessageContaining("blocked");
  }

  @Test void assetResolutionCannotEscapeRegisteredDirectory() {
    var policy=new UiArtifactUriPolicy("DEVELOPMENT",true,"");
    assertThat(policy.prepareAssetForFetch(
        "http://localhost:3002/assets/remoteEntry.js","chunk.123.js").toString())
        .isEqualTo("http://localhost:3002/assets/chunk.123.js");
    assertThatThrownBy(()->policy.prepareAssetForFetch(
        "http://localhost:3002/assets/remoteEntry.js","../secret"))
        .hasMessageContaining("invalid MFE asset path");
  }
}
