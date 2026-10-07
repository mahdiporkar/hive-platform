package io.hiveplatform.bff.proxy;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.hiveplatform.artifacts.security.UiArtifactUriPolicy;
import io.hiveplatform.bff.control.ControlPlaneClient;
import io.hiveplatform.bff.observability.ObservabilityPublisher;
import io.hiveplatform.bff.security.TokenVaultCrypto;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration
@EnableScheduling
class ProxyConfiguration {
  @Bean
  TargetGuard targetGuard(@Value("${hive.proxy.allowed-origins:}") String origins, @Value("${hive.proxy.network-policy}") String mode,
      @Value("${hive.proxy.allow-http:false}") boolean allowHttp, @Value("${hive.proxy.allowed-private-cidrs:}") String cidrs) {
    return new TargetGuard(origins, new UiArtifactUriPolicy(mode, allowHttp, "", cidrs));
  }

  @Bean
  ObservabilityPublisher observabilityPublisher(ControlPlaneClient control) { return new ObservabilityPublisher(control); }

  @Bean
  SecretResolver secretResolver(ObjectMapper json, @Value("${hive.secrets.root:}") String root) { return new SecretResolver(json, root, System::getenv); }

  @Bean
  LegacyTokens legacyTokens(StringRedisTemplate redis, ObjectMapper json, SecretResolver secrets, TargetGuard guard, ObservabilityPublisher observability,
      @Value("${hive.vault.key-id:current}") String keyId, @Value("${hive.vault.key:}") String key, @Value("${hive.vault.previous-keys:}") String previous) {
    TokenVaultCrypto crypto = key.isBlank() ? null : new TokenVaultCrypto(keyId, key, previous);
    return new LegacyTokens(redis, json, crypto, secrets, guard, (event, details) -> observability.audit(event, event.endsWith("failed") ? "FAILURE" : "SUCCESS", "system:bff", details));
  }
}
