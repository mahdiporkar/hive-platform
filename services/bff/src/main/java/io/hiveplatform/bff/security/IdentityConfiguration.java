package io.hiveplatform.bff.security;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Instant;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrations;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.savedrequest.NullRequestCache;
@Configuration
@ConditionalOnProperty(name="hive.identity.enabled",havingValue="true")
public class IdentityConfiguration {
 public static final String VAULT_HANDLE="HIVE_VAULT_HANDLE",RETURN_URL="HIVE_RETURN_URL";
 @Bean TokenVault tokenVault(StringRedisTemplate redis,ObjectMapper json,@Value("${hive.vault.key-id}")String id,@Value("${hive.vault.key}")String key,@Value("${hive.vault.previous-keys:}")String previous){return new TokenVault(redis,json,new TokenVaultCrypto(id,key,previous));}
 @Bean TokenRefresh tokenRefresh(TokenVault vault,StringRedisTemplate redis,ClientRegistrationRepository providers,ObjectMapper json){return new TokenRefresh(vault,redis,providers,json);}
 @Bean IdentityControlClient identityControl(@Value("${hive.identity.control-url}")String url,@Value("${hive.identity.control-password}")String password,@Value("${hive.identity.allow-local-http:false}")boolean local,ObjectMapper json){return new IdentityControlClient(url,password,local,json);}
 @Bean ClientRegistrationRepository registrations(IdentityControlClient control,@Value("${hive.identity.allowed-origins:}")String origins,@Value("${hive.identity.issuer}")String issuer,@Value("${hive.identity.client-id}")String client,@Value("${hive.identity.client-secret}")String secret,@Value("${hive.identity.allow-local-http:false}")boolean local){
  var uri=java.net.URI.create(issuer);
  if(!"https".equals(uri.getScheme())&&!(local&&"http".equals(uri.getScheme())&&java.util.Set.of("localhost","127.0.0.1").contains(uri.getHost())))throw new IllegalArgumentException("OIDC issuer requires HTTPS");
  var registration=ClientRegistrations.fromIssuerLocation(issuer).registrationId("primary").clientId(client).clientSecret(secret).scope("openid","profile").redirectUri("{baseUrl}/login/oauth2/code/{registrationId}").clientSettings(ClientRegistration.ClientSettings.builder().requireProofKey(true).build()).build();
  return new DynamicRegistrations(registration,control,origins,local);
 }
 @Bean @Order(1) SecurityFilterChain identitySecurity(HttpSecurity http,TokenVault vault,ClientRegistrationRepository registrations,IdentityControlClient control) throws Exception {
  var clients=new RequestAuthorizedClients();var contexts=new HttpSessionSecurityContextRepository();
  return http.securityMatcher("/auth/**","/oauth2/**","/login/oauth2/**","/api/me/**")
   .authorizeHttpRequests(auth->auth.requestMatchers("/api/me/**").authenticated().anyRequest().permitAll())
   .requestCache(cache->cache.requestCache(new NullRequestCache()))
   .securityContext(context->context.securityContextRepository(contexts))
   .exceptionHandling(errors->errors.authenticationEntryPoint((request,response,error)->response.sendError(401)))
   .oauth2Login(login->login.clientRegistrationRepository(registrations).authorizedClientRepository(clients)
    .failureHandler((request,response,error)->{var session=request.getSession(false);if(session!=null){Object previous=session.getAttribute(VAULT_HANDLE);if(previous instanceof String handle)vault.delete(handle);session.invalidate();}response.sendError(401);})
    .successHandler((request,response,authentication)->{
     try {
      var oauth=(OAuth2AuthenticationToken)authentication;var oidc=(OidcUser)oauth.getPrincipal();
      OAuth2AuthorizedClient client=clients.loadAuthorizedClient(oauth.getAuthorizedClientRegistrationId(),oauth,request);
      if(client==null||client.getAccessToken().getExpiresAt()==null)throw new IllegalStateException("Validated token missing");
      var registration=client.getClientRegistration();
      if(!registration.getProviderDetails().getIssuerUri().equals(oidc.getIssuer().toString()))throw new IllegalStateException("Issuer mismatch");
      var canonical=control.sync(registration.getRegistrationId(),oidc.getIssuer().toString(),oidc.getSubject(),oidc.getFullName()==null?oidc.getSubject():oidc.getFullName());
      var session=request.getSession();Object old=session.getAttribute(VAULT_HANDLE);if(old instanceof String handle)vault.delete(handle);
      String handle=vault.store(new VaultRecord(registration.getRegistrationId(),client.getAccessToken().getTokenValue(),client.getRefreshToken()==null?null:client.getRefreshToken().getTokenValue(),client.getAccessToken().getExpiresAt(),Instant.now().plusSeconds(1800)));
      session.setAttribute(VAULT_HANDLE,handle);session.setMaxInactiveInterval(1800);
      var identity=new SessionIdentity(canonical.id(),canonical.tenantId(),canonical.issuer(),canonical.subject(),canonical.displayName());
      var safe=SecurityContextHolder.createEmptyContext();safe.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(identity,null,List.of()));
      SecurityContextHolder.setContext(safe);contexts.saveContext(safe,request,response);
      clients.removeAuthorizedClient(registration.getRegistrationId(),oauth,request,response);
      Object destination=session.getAttribute(RETURN_URL);session.removeAttribute(RETURN_URL);
      response.sendRedirect(ReturnUrl.validate(destination instanceof String path?path:"/"));
     }catch(RuntimeException failure){SecurityContextHolder.clearContext();var session=request.getSession(false);if(session!=null){Object handle=session.getAttribute(VAULT_HANDLE);if(handle instanceof String value)vault.delete(value);session.invalidate();}response.sendError(HttpServletResponse.SC_UNAUTHORIZED);}
    }))
   .logout(logout->logout.logoutUrl("/auth/logout").addLogoutHandler((request,response,authentication)->{var session=request.getSession(false);if(session!=null&&session.getAttribute(VAULT_HANDLE)instanceof String handle)vault.delete(handle);}).logoutSuccessHandler((request,response,authentication)->response.setStatus(204)).deleteCookies("HIVE_SESSION"))
   .build();
 }
}