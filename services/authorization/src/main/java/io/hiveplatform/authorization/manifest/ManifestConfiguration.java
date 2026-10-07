package io.hiveplatform.authorization.manifest;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.hiveplatform.artifacts.security.UiArtifactUriPolicy;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

@Configuration
class ManifestConfiguration {
  @Bean
  @Primary
  UiArtifactUriPolicy artifactPolicy(@Value("${hive.artifacts.network-policy}") String mode, @Value("${hive.artifacts.allow-http}") boolean allowHttp,
      @Value("${hive.artifacts.development-host:}") String developmentHost, @Value("${hive.artifacts.allowed-private-cidrs:}") String cidrs) {
    return new UiArtifactUriPolicy(mode, allowHttp, developmentHost, cidrs);
  }

  /** Outbound service targets: administrator-managed, never metadata/link-local; the BFF additionally pins exact origins. */
  @Bean
  @Qualifier("targetPolicy")
  UiArtifactUriPolicy targetPolicy(@Value("${hive.targets.network-policy}") String mode, @Value("${hive.targets.allow-http}") boolean allowHttp,
      @Value("${hive.targets.allowed-private-cidrs:}") String cidrs) {
    return new UiArtifactUriPolicy(mode, allowHttp, "", cidrs);
  }

  @Bean
  ManifestDocuments manifestDocuments(UiArtifactUriPolicy policy, @Value("${hive.artifacts.require-integrity}") boolean requireIntegrity) {
    return new ManifestDocuments(policy, requireIntegrity);
  }

  @Bean
  ManifestFetcher manifestFetcher(UiArtifactUriPolicy policy, ObjectMapper json) {
    return new ManifestFetcher(policy, json);
  }
}
