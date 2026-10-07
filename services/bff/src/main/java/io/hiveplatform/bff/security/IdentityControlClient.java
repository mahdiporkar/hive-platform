package io.hiveplatform.bff.security;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
public final class IdentityControlClient {
 public record Provider(String code,String name,String issuer,String tenantId,List<String> domains,String clientId,String secretReference,String authorizationEndpoint,String tokenEndpoint,String jwksUri,boolean enabled,long revision){}
 public record Canonical(String id,String tenantId,String displayName,String issuer,String subject){}
 private final URI base;private final String authorization;private final ObjectMapper json;
 private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).followRedirects(HttpClient.Redirect.NEVER).build();
 public IdentityControlClient(String url,String password,boolean local,ObjectMapper json){this.base=URI.create(url);if(base.getHost()==null||base.getUserInfo()!=null||base.getQuery()!=null||base.getFragment()!=null||!("https".equals(base.getScheme())||local&&"http".equals(base.getScheme())&&Set.of("localhost","127.0.0.1").contains(base.getHost())))throw new IllegalArgumentException("Identity control endpoint requires HTTPS");if(password.length()<32)throw new IllegalArgumentException("Identity control credential is required");this.authorization="Basic "+Base64.getEncoder().encodeToString(("bff:"+password).getBytes(StandardCharsets.UTF_8));this.json=json;}
 public Provider provider(String code){if(!code.matches("[a-z][a-z0-9-]{2,79}"))throw new IllegalArgumentException("Invalid provider code");return call("/internal/identity/providers/"+code,null,Provider.class);}
 public Provider route(String code,String tenant,String domain){var query=new ArrayList<String>();if(code!=null)query.add("code="+encode(code));if(tenant!=null)query.add("tenant="+encode(tenant));if(domain!=null)query.add("domain="+encode(domain));return call("/internal/identity/route?"+String.join("&",query),null,Provider.class);}
 public Canonical sync(String provider,String issuer,String subject,String name){return call("/internal/identity/login",Map.of("providerCode",provider,"issuer",issuer,"subject",subject,"displayName",name),Canonical.class);}
 private <T>T call(String path,Object payload,Class<T> type){try{
  var builder=HttpRequest.newBuilder(base.resolve(path)).timeout(Duration.ofSeconds(5)).header("Authorization",authorization).header("Accept","application/json");
  if(payload!=null)builder.header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(payload)));else builder.GET();
  var response=http.send(builder.build(),TokenResponseBody.limited(262144));
  if(response.statusCode()==404)throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Identity provider unavailable");
  if(response.statusCode()==409)throw new ResponseStatusException(HttpStatus.CONFLICT,"Explicit provider selection required");
  if(response.statusCode()!=200)throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"Identity control request rejected");
  return json.readValue(response.body(),type);
 }catch(java.io.IOException failed){throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"Identity control unavailable");}catch(InterruptedException interrupted){Thread.currentThread().interrupt();throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"Identity control interrupted");}}
 private static String encode(String value){return URLEncoder.encode(value,StandardCharsets.UTF_8);}
}