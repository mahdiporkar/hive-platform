package io.hiveplatform.bff.security;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.data.redis.core.StringRedisTemplate;
/** Encrypted records with an absolute deadline. Access tokens never enter ordinary session state. */
public final class TokenVault {
 private final StringRedisTemplate redis;private final ObjectMapper json;private final TokenVaultCrypto crypto;
 public TokenVault(StringRedisTemplate redis,ObjectMapper json,TokenVaultCrypto crypto){this.redis=redis;this.json=json;this.crypto=crypto;}
 public String store(VaultRecord record){String handle=UUID.randomUUID().toString();write(handle,record);return handle;}
 public void write(String handle,VaultRecord record){
  Duration ttl=Duration.between(Instant.now(),record.sessionExpiresAt());
  if(ttl.isNegative()||ttl.isZero())throw new IllegalArgumentException("Session expired");
  try {redis.opsForValue().set(key(handle),crypto.encrypt(json.writeValueAsString(record)),ttl);}catch(com.fasterxml.jackson.core.JsonProcessingException e){throw new IllegalStateException("Vault encoding failed");}
 }
 public void writeWhileOwned(String handle,VaultRecord record,String lock,String owner){
  long ttl=Duration.between(Instant.now(),record.sessionExpiresAt()).toMillis();if(ttl<=0)throw new IllegalArgumentException("Session expired");
  try {
   String envelope=crypto.encrypt(json.writeValueAsString(record));
   Long written=redis.execute(new org.springframework.data.redis.core.script.DefaultRedisScript<Long>("if redis.call('get',KEYS[1]) == ARGV[1] and redis.call('exists',KEYS[2]) == 1 then redis.call('psetex',KEYS[2],ARGV[2],ARGV[3]); return 1 else return 0 end",Long.class),java.util.List.of(lock,key(handle)),owner,Long.toString(ttl),envelope);
   if(!Long.valueOf(1).equals(written))throw new IllegalStateException("Refresh ownership lost or session revoked");
  }catch(com.fasterxml.jackson.core.JsonProcessingException e){throw new IllegalStateException("Vault encoding failed");}
 }
 public VaultRecord read(String handle){
  String envelope=redis.opsForValue().get(key(handle));if(envelope==null)throw new IllegalStateException("Vault record unavailable");
  try {var record=json.readValue(crypto.decrypt(envelope),VaultRecord.class);if(!record.sessionExpiresAt().isAfter(Instant.now())){delete(handle);throw new IllegalStateException("Session expired");}return record;}
  catch(com.fasterxml.jackson.core.JsonProcessingException e){throw new IllegalStateException("Vault record invalid");}
 }
 public void delete(String handle){redis.delete(key(handle));}
 private static String key(String handle){if(handle==null||!UUID.fromString(handle).toString().equals(handle))throw new IllegalArgumentException("Invalid vault handle");return "hive:vault:"+handle;}
}