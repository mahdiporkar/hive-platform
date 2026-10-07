package io.hiveplatform.bff;

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

  StartupGuard(@Value("${hive.profile:production}") String profile, @Value("${hive.identity.enabled:false}") boolean identity,
      @Value("${hive.identity.allow-local-http:false}") boolean oidcLocalHttp, @Value("${hive.vault.key:}") String vaultKey,
      @Value("${server.servlet.session.cookie.secure:true}") boolean secureCookie, @Value("${spring.data.redis.password:}") String redisPassword,
      @Value("${hive.proxy.network-policy}") String proxyPolicy, @Value("${hive.proxy.allowed-origins:}") String allowedOrigins,
      @Value("${hive.control.allow-http:false}") boolean controlHttp) {
    new ProductionGuard(profile)
        .rule("HIVE_OIDC_ALLOW_LOCAL_HTTP must be false", () -> identity && oidcLocalHttp)
        .rule("HIVE_VAULT_KEY is required", vaultKey::isBlank)
        .rule("the HIVE_SESSION cookie must be Secure", () -> !secureCookie)
        .rule("HIVE_REDIS_PASSWORD is required", redisPassword::isBlank)
        .rule("HIVE_PROXY_NETWORK_POLICY must not be DEVELOPMENT", () -> "DEVELOPMENT".equalsIgnoreCase(proxyPolicy))
        .enforce("hive-bff");
    summary = "profile=" + profile + " identity=" + (identity ? "enabled" : "disabled (public runtime only)") + " proxyPolicy=" + proxyPolicy
        + " approvedTargetOrigins=" + (allowedOrigins.isBlank() ? 0 : allowedOrigins.split(",").length) + " controlChannel=" + (controlHttp ? "http (internal network)" : "https");
  }

  @EventListener(ApplicationReadyEvent.class)
  void report() { log.info("Hive BFF ready: {}", summary); }
}
