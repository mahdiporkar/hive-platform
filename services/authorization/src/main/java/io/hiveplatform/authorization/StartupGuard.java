package io.hiveplatform.authorization;

import io.hiveplatform.spring.ProductionGuard;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/** Fails closed on unsafe production configuration and reports the effective (non-secret) configuration at startup. */
@Component
class StartupGuard {
  private static final Logger log = LoggerFactory.getLogger(StartupGuard.class);
  private final String summary;

  StartupGuard(@Value("${hive.profile:production}") String profile, @Value("${hive.environment:production}") String environment,
      @Value("${hive.identity.allow-local-http:false}") boolean idpLocalHttp, @Value("${hive.artifacts.network-policy}") String artifactPolicy,
      @Value("${hive.artifacts.allow-http}") boolean artifactHttp, @Value("${hive.artifacts.require-integrity}") boolean integrity,
      @Value("${hive.internal.password:}") String internal, @Value("${hive.provisioning.password:}") String provisioning,
      @Value("${spring.datasource.password:}") String database, @Value("${hive.authorization.cache.enabled:false}") boolean cache,
      @Value("${hive.bootstrap.admin-subject:}") String bootstrap, @Value("${hive.targets.network-policy}") String targetPolicy) {
    new ProductionGuard(profile)
        .rule("HIVE_IDP_ALLOW_LOCAL_HTTP must be false", () -> idpLocalHttp)
        .rule("HIVE_ARTIFACT_NETWORK_POLICY must not be DEVELOPMENT", () -> "DEVELOPMENT".equalsIgnoreCase(artifactPolicy) || "DEV".equalsIgnoreCase(artifactPolicy))
        // Browsers never load upstream artifacts directly (the BFF artifact gateway serves them same-origin); plain HTTP
        // is acceptable only towards an explicitly allowlisted private network.
        .rule("HIVE_ARTIFACT_ALLOW_HTTP requires HIVE_ARTIFACT_NETWORK_POLICY=INTERNAL_ENTERPRISE", () -> artifactHttp
            && !"INTERNAL_ENTERPRISE".equalsIgnoreCase(artifactPolicy) && !"INTERNAL".equalsIgnoreCase(artifactPolicy))
        .rule("HIVE_ARTIFACT_REQUIRE_INTEGRITY must be true", () -> !integrity)
        .rule("HIVE_INTERNAL_PASSWORD is required (BFF channel)", internal::isBlank)
        .rule("HIVE_DB_PASSWORD must have at least 16 characters", () -> database.length() < 16)
        .rule("HIVE_TARGET_NETWORK_POLICY must not be DEVELOPMENT", () -> "DEVELOPMENT".equalsIgnoreCase(targetPolicy))
        .enforce("hive-authorization");
    summary = "profile=" + profile + " environment=" + environment + " artifactPolicy=" + artifactPolicy + " targetPolicy=" + targetPolicy
        + " decisionCache=" + cache + " provisioningCredential=" + (provisioning.isBlank() ? "disabled" : "enabled") + " firstAdministrator=" + (bootstrap.isBlank() ? "not configured" : "configured");
  }

  @EventListener(ApplicationReadyEvent.class)
  void report() { log.info("Hive authorization service ready: {}", summary); }
}
