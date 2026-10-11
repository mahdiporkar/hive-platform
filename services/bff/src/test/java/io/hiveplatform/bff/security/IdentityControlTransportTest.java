package io.hiveplatform.bff.security;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
/** Transport policy of the BFF → authorization identity-control channel. */
class IdentityControlTransportTest {
 static final String PASSWORD="p".repeat(40);
 static IdentityControlClient client(String url,boolean local,boolean controlHttp){return new IdentityControlClient(url,PASSWORD,local,controlHttp,new ObjectMapper());}

 @Test void httpsIsAcceptedWithoutAnyOptIn(){
  assertThatCode(()->client("https://authz.internal.example:8443",false,false)).doesNotThrowAnyException();
 }
 @Test void plainHttpIsRejectedUnlessExplicitlyEnabled(){
  assertThatThrownBy(()->client("http://srv-captain--hive-authorization:8082",false,false)).hasMessageContaining("requires HTTPS");
 }
 @Test void explicitlyEnabledHttpReachesTheInternalAuthorizationService(){
  for(String url:new String[]{"http://srv-captain--hive-authorization:8082","http://hive-authorization:8082","http://10.0.1.17:8082","http://172.16.4.2:8082","http://192.168.1.9:8082"})
   assertThatCode(()->client(url,false,true)).as(url).doesNotThrowAnyException();
 }
 @Test void explicitlyEnabledHttpNeverReachesExternalEndpoints(){
  for(String url:new String[]{"http://evil.example.com:8082","http://hive-authorization.husbantech.com","http://8.8.8.8:8082","http://141.11.45.119:8082",
    "http://10.0.1.17.nip.io:8082","http://0x0a000001:8082","http://10:8082","http://[2001:db8::1]:8082","http://169.254.169.254/latest"})
   assertThatThrownBy(()->client(url,false,true)).as(url).hasMessageContaining("requires HTTPS");
 }
 @Test void credentialsQueriesAndFragmentsInTheEndpointAreRefused(){
  for(String url:new String[]{"http://bff:secret@srv-captain--hive-authorization:8082","http://srv-captain--hive-authorization:8082?x=1","https://authz.internal.example#frag"})
   assertThatThrownBy(()->client(url,false,true)).as(url).isInstanceOf(IllegalArgumentException.class);
 }
 @Test void developmentLoopbackExceptionIsUnchanged(){
  assertThatCode(()->client("http://localhost:8082",true,false)).doesNotThrowAnyException();
  assertThatThrownBy(()->client("http://srv-captain--hive-authorization:8082",true,false)).hasMessageContaining("requires HTTPS");
 }
 @Test void theCredentialGoesOnlyToTheConfiguredEndpointAndRedirectsAreNotFollowed() throws Exception {
  var elsewhere=new AtomicInteger();var seen=new AtomicReference<String>();
  HttpServer other=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
  other.createContext("/",exchange->{elsewhere.incrementAndGet();exchange.sendResponseHeaders(200,-1);exchange.close();});other.start();
  HttpServer authz=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
  authz.createContext("/internal/identity/providers/primary",exchange->{seen.set(exchange.getRequestHeaders().getFirst("Authorization"));
   exchange.getResponseHeaders().add("Location","http://127.0.0.1:"+other.getAddress().getPort()+"/steal");exchange.sendResponseHeaders(302,-1);exchange.close();});
  authz.start();
  try{
   var control=client("http://127.0.0.1:"+authz.getAddress().getPort(),false,true);
   assertThatThrownBy(()->control.provider("primary")).isInstanceOf(ResponseStatusException.class);
   assertThat(seen.get()).isEqualTo("Basic "+java.util.Base64.getEncoder().encodeToString(("bff:"+PASSWORD).getBytes(StandardCharsets.UTF_8)));
   assertThat(elsewhere.get()).isZero();
  }finally{authz.stop(0);other.stop(0);}
 }
 @Test void internalHostClassification(){
  assertThat(IdentityControlClient.internalHost("SRV-CAPTAIN--HIVE-AUTHORIZATION")).isTrue();
  assertThat(IdentityControlClient.internalHost("127.0.0.1")).isTrue();
  assertThat(IdentityControlClient.internalHost("100.64.0.1")).isFalse();
  assertThat(IdentityControlClient.internalHost("999.1.1.1")).isFalse();
  assertThat(IdentityControlClient.internalHost("-bad")).isFalse();
 }
}
