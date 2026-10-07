package io.hiveplatform.authorization;
import java.util.ArrayList;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
@Configuration
class SecurityConfiguration {
 @Bean InMemoryUserDetailsManager users(@Value("${hive.internal.password:}")String internal,@Value("${hive.provisioning.password:}")String provisioning){var users=new ArrayList<UserDetails>();var encoder=new BCryptPasswordEncoder();if(!internal.isBlank()){requireSecret(internal);users.add(User.withUsername("bff").password("{bcrypt}"+encoder.encode(internal)).roles("IDENTITY_RUNTIME").build());}if(!provisioning.isBlank()){requireSecret(provisioning);users.add(User.withUsername("provisioner").password("{bcrypt}"+encoder.encode(provisioning)).roles("IDENTITY_PROVISIONING").build());}return new InMemoryUserDetailsManager(users);}
 private static void requireSecret(String secret){if(secret.length()<32)throw new IllegalArgumentException("Service credential must contain at least 32 characters");}
 @Bean @Order(1) SecurityFilterChain internal(HttpSecurity http)throws Exception{
  return http.securityMatcher("/internal/**","/provisioning/**")
   .sessionManagement(s->s.sessionCreationPolicy(org.springframework.security.config.http.SessionCreationPolicy.STATELESS))
   .requestCache(c->c.requestCache(new org.springframework.security.web.savedrequest.NullRequestCache()))
   // These endpoints accept only machine Basic credentials, never session cookies.
   .csrf(c->c.disable()).httpBasic(b->{})
   .authorizeHttpRequests(a->a.requestMatchers("/internal/identity/**").hasRole("IDENTITY_RUNTIME").requestMatchers("/provisioning/identity/**").hasRole("IDENTITY_PROVISIONING").anyRequest().denyAll()).build();
 }
 @Bean SecurityFilterChain security(HttpSecurity http)throws Exception{
  return http.authorizeHttpRequests(a->a.requestMatchers("/actuator/health","/actuator/health/liveness","/actuator/health/readiness").permitAll().anyRequest().denyAll()).exceptionHandling(e->e.authenticationEntryPoint((request,response,failure)->response.sendError(401))).build();
 }
}