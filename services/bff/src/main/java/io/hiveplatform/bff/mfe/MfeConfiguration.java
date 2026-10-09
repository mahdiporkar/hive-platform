package io.hiveplatform.bff.mfe;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.hiveplatform.artifacts.security.UiArtifactUriPolicy;
import io.hiveplatform.bff.control.ControlPlaneClient;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Artifact gateway configuration. The network policy is deployment-wide (set once, never per registration): the
 * control plane validates every registered address, and this second boundary re-checks resolved addresses per fetch.
 */
@Configuration
class MfeConfiguration {
  @Bean
  ArtifactGateway artifactGateway(ControlPlaneClient control, ObjectMapper json,
      @Value("${hive.mfe.network-policy}") String mode, @Value("${hive.mfe.allow-http:false}") boolean allowHttp,
      @Value("${hive.mfe.allowed-private-cidrs:}") String cidrs, @Value("${hive.mfe.development-host:}") String developmentHost,
      @Value("${hive.mfe.resolve-ttl-ms:5000}") long resolveTtl, @Value("${hive.mfe.cache-ttl-seconds:60}") long cacheTtl,
      @Value("${hive.mfe.max-asset-bytes:20971520}") int maxAssetBytes, @Value("${hive.mfe.cache-budget-bytes:67108864}") long cacheBudget,
      @Value("${hive.mfe.connect-timeout-ms:3000}") long connectTimeout, @Value("${hive.mfe.response-timeout-ms:15000}") long responseTimeout) {
    return new ArtifactGateway(control, json, new UiArtifactUriPolicy(mode, allowHttp, developmentHost, cidrs),
        new ArtifactGateway.Settings(Duration.ofMillis(resolveTtl), Duration.ofSeconds(cacheTtl), maxAssetBytes, cacheBudget,
            Duration.ofMillis(connectTimeout), Duration.ofMillis(responseTimeout)));
  }
}
