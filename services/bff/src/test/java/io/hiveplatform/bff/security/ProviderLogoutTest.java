package io.hiveplatform.bff.security;
import static org.assertj.core.api.Assertions.assertThat;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
class ProviderLogoutTest {
 HttpServer idp;String origin;final AtomicReference<String> body=new AtomicReference<>(),authorization=new AtomicReference<>();
 @BeforeEach void start() throws Exception {
  idp=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
  idp.createContext("/realms/u/protocol/openid-connect/logout",exchange->{
   authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
   body.set(new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8));
   exchange.sendResponseHeaders("POST".equals(exchange.getRequestMethod())?204:405,-1);exchange.close();});
  idp.start();origin="http://127.0.0.1:"+idp.getAddress().getPort();
 }
 @AfterEach void stop(){idp.stop(0);}
 TokenRefresh refresh(String endSession){
  var registration=ClientRegistration.withRegistrationId("primary").clientId("hive-bff").clientSecret("s3cret").authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
   .redirectUri("{baseUrl}/login/oauth2/code/{registrationId}").authorizationUri(origin+"/auth").tokenUri(origin+"/token").issuerUri(origin+"/realms/u")
   .providerConfigurationMetadata(Map.of("end_session_endpoint",endSession)).build();
  return new TokenRefresh(null,null,new InMemoryClientRegistrationRepository(registration),new ObjectMapper());
 }
 VaultRecord record(String refreshToken){return new VaultRecord("primary","access",refreshToken,Instant.now().plusSeconds(60),Instant.now().plusSeconds(600));}
 @Test void endsTheProviderSessionWithClientAuthentication(){
  assertThat(refresh(origin+"/realms/u/protocol/openid-connect/logout").endProviderSession(record("refresh-1"))).isTrue();
  assertThat(body.get()).isEqualTo("refresh_token=refresh-1");
  assertThat(authorization.get()).isEqualTo("Basic "+java.util.Base64.getEncoder().encodeToString("hive-bff:s3cret".getBytes(StandardCharsets.UTF_8)));
 }
 @Test void neverSendsCredentialsToAnotherOrigin(){
  assertThat(refresh("http://127.0.0.2:1/realms/u/protocol/openid-connect/logout").endProviderSession(record("refresh-1"))).isFalse();
  assertThat(body.get()).isNull();
 }
 @Test void reportsSessionsWithoutRefreshTokenAsNotEnded(){
  assertThat(refresh(origin+"/realms/u/protocol/openid-connect/logout").endProviderSession(record(null))).isFalse();
  assertThat(body.get()).isNull();
 }
}
