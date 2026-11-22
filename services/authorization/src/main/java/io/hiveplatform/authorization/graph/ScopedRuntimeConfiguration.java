package io.hiveplatform.authorization.graph;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.*;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.*;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.security.web.SecurityFilterChain;

/** Opt-in generic read-only runtime contract, isolated from the privileged BFF/admin filter chain. */
@Configuration
@ConditionalOnProperty(name="hive.scoped-runtime.enabled",havingValue="true")
public class ScopedRuntimeConfiguration {
  @Bean @Order(0)
  SecurityFilterChain scopedRuntime(HttpSecurity http,@Value("${hive.scoped-runtime.issuer}") String issuer,
      @Value("${hive.scoped-runtime.jwks}") String jwks,@Value("${hive.scoped-runtime.audience}") String audience,
      @Value("${hive.scoped-runtime.allow-local-http:false}") boolean allowLocalHttp) throws Exception {
    if(!trusted(issuer,allowLocalHttp) || !trusted(jwks,allowLocalHttp) || audience.isBlank())throw new IllegalArgumentException("Scoped runtime requires HTTPS issuer/JWKS and audience");
    var decoder=NimbusJwtDecoder.withJwkSetUri(jwks).build();
    decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(JwtValidators.createDefaultWithIssuer(issuer),jwt ->
      jwt.getAudience().contains(audience) && jwt.getSubject()!=null && jwt.getExpiresAt()!=null
        ? OAuth2TokenValidatorResult.success():OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token"))));
    return http.securityMatcher("/runtime/scoped/**").csrf(c->c.disable())
      .sessionManagement(s->s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
      .authorizeHttpRequests(a->a.requestMatchers(org.springframework.http.HttpMethod.POST,"/runtime/scoped/check").authenticated().anyRequest().denyAll())
      .oauth2ResourceServer(o->o.jwt(j->j.decoder(decoder))).build();
  }
  /** Plain HTTP only when explicitly enabled, and then only to this machine (as hive.identity.allow-local-http). */
  static boolean trusted(String url,boolean allowLocalHttp) {
    if(url.startsWith("https://"))return true;
    if(!allowLocalHttp || !url.startsWith("http://"))return false;
    String host=java.net.URI.create(url).getHost();
    return "127.0.0.1".equals(host) || "localhost".equals(host);
  }
}
