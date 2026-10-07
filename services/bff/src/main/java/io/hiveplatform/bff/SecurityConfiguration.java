package io.hiveplatform.bff;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.firewall.HttpStatusRequestRejectedHandler;
import org.springframework.security.web.firewall.RequestRejectedHandler;
import org.springframework.security.web.savedrequest.NullRequestCache;

/**
 * Browser-facing access model. Route-level decisions belong to the runtime proxy (per operation), so the filter
 * chains only separate anonymous-capable paths, session-required paths and everything else (denied). CSRF protects
 * every unsafe method. When identity is enabled, {@code IdentityConfiguration} supplies the equivalent chain with login.
 */
@Configuration
public class SecurityConfiguration {
  public static final String[] ANONYMOUS_CAPABLE = {"/api/public/**", "/api/routes/**", "/auth/csrf"};
  public static final String[] SESSION_REQUIRED = {"/api/me/**", "/api/admin/**"};

  /** Firewall rejections (encoded traversal, duplicate slashes, backslashes...) are client errors, not authentication failures. */
  @Bean RequestRejectedHandler requestRejectedHandler() { return new HttpStatusRequestRejectedHandler(); }

  @Bean InMemoryUserDetailsManager users() { return new InMemoryUserDetailsManager(); }

  /** Public-only deployment: anonymous runtime works, session paths answer 401. */
  @Bean
  @Order(1)
  @ConditionalOnProperty(name = "hive.identity.enabled", havingValue = "false", matchIfMissing = true)
  SecurityFilterChain anonymousRuntime(HttpSecurity http) throws Exception {
    return http.securityMatcher("/api/**", "/auth/**")
        .requestCache(cache -> cache.requestCache(new NullRequestCache()))
        .authorizeHttpRequests(auth -> auth.requestMatchers(ANONYMOUS_CAPABLE).permitAll().requestMatchers(SESSION_REQUIRED).authenticated().anyRequest().denyAll())
        .exceptionHandling(errors -> errors.authenticationEntryPoint((request, response, failure) -> response.sendError(401)))
        .build();
  }

  @Bean
  @Order(10)
  SecurityFilterChain fallback(HttpSecurity http) throws Exception {
    return http.requestCache(cache -> cache.requestCache(new NullRequestCache()))
        .authorizeHttpRequests(auth -> auth.requestMatchers("/actuator/health", "/actuator/health/liveness", "/actuator/health/readiness", "/error").permitAll().anyRequest().denyAll())
        .exceptionHandling(errors -> errors.authenticationEntryPoint((request, response, failure) -> response.sendError(401)))
        .build();
  }
}
