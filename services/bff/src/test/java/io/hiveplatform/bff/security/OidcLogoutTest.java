package io.hiveplatform.bff.security;
import static org.assertj.core.api.Assertions.assertThat;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.web.util.UriComponentsBuilder;

class OidcLogoutTest {
 private static ClientRegistration registration(Map<String,Object> metadata) {
  return ClientRegistration.withRegistrationId("primary").clientId("hive-bff").clientSecret("secret").authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
   .redirectUri("{baseUrl}/login/oauth2/code/{registrationId}").authorizationUri("https://id.example/auth").tokenUri("https://id.example/token")
   .jwkSetUri("https://id.example/certs").issuerUri("https://id.example").providerConfigurationMetadata(metadata).build();
 }

 @Test void endsTheProviderSessionWithIdTokenHintClientAndThisOriginAsPostLogoutTarget() {
  var url=OidcLogout.endSessionUrl(registration(Map.of("end_session_endpoint","https://id.example/realms/u/protocol/openid-connect/logout")),"header.payload.signature","https://erp.example/");
  var query=UriComponentsBuilder.fromUriString(url).build().getQueryParams();
  assertThat(url).startsWith("https://id.example/realms/u/protocol/openid-connect/logout?");
  assertThat(query.getFirst("id_token_hint")).isEqualTo("header.payload.signature");
  assertThat(query.getFirst("client_id")).isEqualTo("hive-bff");
  assertThat(java.net.URLDecoder.decode(query.getFirst("post_logout_redirect_uri"),java.nio.charset.StandardCharsets.UTF_8)).isEqualTo("https://erp.example/");
 }

 @Test void withoutAnEndSessionEndpointThereIsNoProviderLogout() {
  assertThat(OidcLogout.endSessionUrl(registration(Map.of()),"token","https://erp.example/")).isNull();
 }

 @Test void postLogoutTargetIsTheOriginTheBrowserUsesNeverARequestedPath() {
  var request=new MockHttpServletRequest("POST","/auth/logout");
  // Behind the TLS terminator the forwarded-header handling has already applied X-Forwarded-Proto/Host.
  request.setScheme("https");request.setServerName("erp.demo.example");request.setServerPort(443);request.setQueryString("next=https://evil.example");
  assertThat(OidcLogout.postLogoutRedirectUri(request)).isEqualTo("https://erp.demo.example/");
  var local=new MockHttpServletRequest("POST","/auth/logout");local.setServerName("127.0.0.1");local.setServerPort(32790);
  assertThat(OidcLogout.postLogoutRedirectUri(local)).isEqualTo("http://127.0.0.1:32790/");
 }

 @Test void signOutDeletesTheTokensAndAnswersWithTheProviderLogoutOnlyForAProviderSession() throws Exception {
  var vault=new InMemoryVault();
  var registrations=new InMemoryClientRegistrationRepository(registration(Map.of("end_session_endpoint","https://id.example/logout")));
  var request=new MockHttpServletRequest("POST","/auth/logout");request.setServerName("127.0.0.1");request.setServerPort(32790);
  request.getSession().setAttribute(IdentityConfiguration.VAULT_HANDLE,vault.put(new VaultRecord("primary","access","refresh",Instant.now().plusSeconds(60),Instant.now().plusSeconds(600),"id.token.value")));
  var response=new MockHttpServletResponse();
  OidcLogout.endVaultRecord(vault.vault).logout(request,response,null);
  assertThat(vault.deleted).isTrue();
  OidcLogout.providerLogout(registrations,new ObjectMapper()).onLogoutSuccess(request,response,null);
  assertThat(response.getStatus()).isEqualTo(200);
  assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
  assertThat(new ObjectMapper().readTree(response.getContentAsString()).path("logoutUrl").asText()).startsWith("https://id.example/logout?id_token_hint=id.token.value&client_id=hive-bff&post_logout_redirect_uri=");

  var anonymous=new MockHttpServletResponse();
  OidcLogout.providerLogout(registrations,new ObjectMapper()).onLogoutSuccess(new MockHttpServletRequest("POST","/auth/logout"),anonymous,null);
  assertThat(anonymous.getStatus()).isEqualTo(204);
  assertThat(anonymous.getContentAsString()).isEmpty();
 }

 /** The real vault (encryption and JSON included) over an in-memory stand-in for Redis. */
 private static final class InMemoryVault {
  final Map<String,String> values=new java.util.HashMap<>();boolean deleted;
  final TokenVault vault;
  @SuppressWarnings("unchecked") InMemoryVault(){
   var redis=org.mockito.Mockito.mock(org.springframework.data.redis.core.StringRedisTemplate.class);
   var ops=org.mockito.Mockito.mock(org.springframework.data.redis.core.ValueOperations.class);
   org.mockito.Mockito.when(redis.opsForValue()).thenReturn(ops);
   org.mockito.Mockito.doAnswer(call->{values.put(call.getArgument(0),call.getArgument(1));return null;}).when(ops).set(org.mockito.ArgumentMatchers.anyString(),org.mockito.ArgumentMatchers.anyString(),org.mockito.ArgumentMatchers.any(java.time.Duration.class));
   org.mockito.Mockito.when(ops.get(org.mockito.ArgumentMatchers.any())).thenAnswer(call->values.get((String)call.getArgument(0)));
   org.mockito.Mockito.when(redis.delete(org.mockito.ArgumentMatchers.anyString())).thenAnswer(call->{deleted=values.remove((String)call.getArgument(0))!=null;return deleted;});
   var key=java.util.Base64.getEncoder().encodeToString(new byte[32]);
   vault=new TokenVault(redis,new ObjectMapper().findAndRegisterModules(),new TokenVaultCrypto("test",key));
  }
  String put(VaultRecord record){
   var handle=vault.store(record);
   assertThat(values.values()).noneMatch(v->v.contains(record.idToken())); // encrypted at rest
   assertThat(vault.read(handle).idToken()).isEqualTo(record.idToken());
   return handle;
  }
 }
}
