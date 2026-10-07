package io.hiveplatform.bff.security;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
/** Bounded server-only refresh with a Redis ownership lease across BFF instances. */
public final class TokenRefresh {
 private final TokenVault vault;private final StringRedisTemplate redis;private final ClientRegistrationRepository providers;private final ObjectMapper json;
 private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).followRedirects(HttpClient.Redirect.NEVER).build();
 public TokenRefresh(TokenVault vault,StringRedisTemplate redis,ClientRegistrationRepository providers,ObjectMapper json){this.vault=vault;this.redis=redis;this.providers=providers;this.json=json;}
 public VaultRecord ensureFresh(String handle){
  var record=vault.read(handle);if(record.accessExpiresAt().isAfter(Instant.now().plusSeconds(15)))return record;
  String lock="hive:refresh:"+UUID.fromString(handle),owner=UUID.randomUUID().toString();
  for(int attempt=0;attempt<60;attempt++) {
   if(Boolean.TRUE.equals(redis.opsForValue().setIfAbsent(lock,owner,Duration.ofSeconds(15)))) {
    try {
     record=vault.read(handle);if(record.accessExpiresAt().isAfter(Instant.now().plusSeconds(15)))return record;
     var refreshed=refresh(record);vault.writeWhileOwned(handle,refreshed,lock,owner);return refreshed;
    }finally{redis.execute(new DefaultRedisScript<Long>("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",Long.class),List.of(lock),owner);}
   }
   try{Thread.sleep(100);}catch(InterruptedException interrupted){Thread.currentThread().interrupt();throw new IllegalStateException("Refresh interrupted");}
   record=vault.read(handle);if(record.accessExpiresAt().isAfter(Instant.now().plusSeconds(15)))return record;
  }
  throw new IllegalStateException("Refresh busy");
 }
 private VaultRecord refresh(VaultRecord record){
  if(record.refreshToken()==null||record.refreshToken().isBlank())throw new IllegalStateException("Session cannot refresh");
  var provider=providers.findByRegistrationId(record.providerId());if(provider==null)throw new IllegalStateException("Provider unavailable");
  String basic=Base64.getEncoder().encodeToString((encode(provider.getClientId())+":"+encode(provider.getClientSecret())).getBytes(StandardCharsets.UTF_8));
  var request=HttpRequest.newBuilder(URI.create(provider.getProviderDetails().getTokenUri())).timeout(Duration.ofSeconds(5)).header("Authorization","Basic "+basic).header("Content-Type","application/x-www-form-urlencoded").POST(HttpRequest.BodyPublishers.ofString("grant_type=refresh_token&refresh_token="+encode(record.refreshToken()))).build();
  try {
   var response=http.send(request,TokenResponseBody.limited(65536));
   if(response.statusCode()!=200||response.body().length>65536)throw new IllegalStateException("Refresh rejected");
   var body=json.readTree(response.body());var lifetime=body.path("expires_in");String access=body.path("access_token").asText("");
   if(!lifetime.isIntegralNumber()||!lifetime.canConvertToLong()||lifetime.asLong()<=0||lifetime.asLong()>86400||access.isBlank()||access.length()>16384||!"Bearer".equalsIgnoreCase(body.path("token_type").asText()))throw new IllegalStateException("Invalid refresh response");
   return record.refreshed(access,body.path("refresh_token").asText(null),Instant.now().plusSeconds(lifetime.asLong()),Instant.now());
  }catch(InterruptedException interrupted){Thread.currentThread().interrupt();throw new IllegalStateException("Refresh interrupted");}
   catch(java.io.IOException failed){throw new IllegalStateException("Refresh unavailable");}
 }
 private static String encode(String value){return URLEncoder.encode(value,StandardCharsets.UTF_8);}
}