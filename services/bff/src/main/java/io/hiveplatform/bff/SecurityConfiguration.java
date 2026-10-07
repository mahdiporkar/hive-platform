package io.hiveplatform.bff;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
@Configuration
class SecurityConfiguration {
  @Bean InMemoryUserDetailsManager users() { return new InMemoryUserDetailsManager(); }
  @Bean SecurityFilterChain security(HttpSecurity http) throws Exception {
    return http.authorizeHttpRequests(auth -> auth
        .requestMatchers("/actuator/health", "/actuator/health/liveness", "/actuator/health/readiness").permitAll()
        .anyRequest().denyAll())
      .exceptionHandling(errors -> errors.authenticationEntryPoint((request,response,failure) -> response.sendError(401)))
      .build();
  }
}