package io.hiveplatform.authorization;

import java.util.ArrayList;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.firewall.HttpStatusRequestRejectedHandler;
import org.springframework.security.web.firewall.RequestRejectedHandler;
import org.springframework.security.web.savedrequest.NullRequestCache;

/**
 * The authorization service is never browser-facing. Two machine principals exist:
 * {@code bff} (RUNTIME: runtime APIs and admin calls on behalf of a canonical user) and
 * {@code provisioner} (PROVISIONING: deployment automation). Both are disabled unless configured with a strong secret.
 */
@Configuration
class SecurityConfiguration {
  /** Firewall rejections (encoded traversal, duplicate slashes, backslashes...) are client errors, not authentication failures. */
  @Bean RequestRejectedHandler requestRejectedHandler() { return new HttpStatusRequestRejectedHandler(); }

  @Bean
  InMemoryUserDetailsManager users(@Value("${hive.internal.password:}") String internal, @Value("${hive.provisioning.password:}") String provisioning) {
    var users = new ArrayList<UserDetails>();
    var encoder = new BCryptPasswordEncoder();
    if (!internal.isBlank()) {
      requireSecret(internal);
      users.add(User.withUsername("bff").password("{bcrypt}" + encoder.encode(internal)).roles("RUNTIME").build());
    }
    if (!provisioning.isBlank()) {
      requireSecret(provisioning);
      users.add(User.withUsername("provisioner").password("{bcrypt}" + encoder.encode(provisioning)).roles("PROVISIONING").build());
    }
    return new InMemoryUserDetailsManager(users);
  }

  private static void requireSecret(String secret) {
    if (secret.length() < 32) throw new IllegalArgumentException("Service credential must contain at least 32 characters");
  }

  @Bean
  @Order(1)
  SecurityFilterChain services(HttpSecurity http) throws Exception {
    return http.securityMatcher("/internal/**", "/provisioning/**", "/admin/**")
        .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .requestCache(c -> c.requestCache(new NullRequestCache()))
        // Only machine Basic credentials are accepted here, never cookies, so CSRF does not apply.
        .csrf(c -> c.disable())
        .httpBasic(b -> {})
        .authorizeHttpRequests(a -> a
            .requestMatchers("/internal/**").hasRole("RUNTIME")
            .requestMatchers("/provisioning/**").hasRole("PROVISIONING")
            // Platform roles are enforced per handler by AdminAuthorization.
            .requestMatchers("/admin/**").hasAnyRole("RUNTIME", "PROVISIONING")
            .anyRequest().denyAll())
        .build();
  }

  @Bean
  SecurityFilterChain security(HttpSecurity http) throws Exception {
    return http.authorizeHttpRequests(a -> a
            .requestMatchers("/actuator/health", "/actuator/health/liveness", "/actuator/health/readiness", "/error").permitAll()
            .anyRequest().denyAll())
        .exceptionHandling(e -> e.authenticationEntryPoint((request, response, failure) -> response.sendError(401)))
        .build();
  }
}
