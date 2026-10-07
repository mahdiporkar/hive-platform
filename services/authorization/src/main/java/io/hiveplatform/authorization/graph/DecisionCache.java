package io.hiveplatform.authorization.graph;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.HexFormat;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * Optional short-lived decision cache keyed by a global graph epoch. Every projected tuple change increments the
 * epoch before and after the OpenFGA write, so no decision computed before a change is served after it.
 * Redis is acceleration only: read failures fall through to OpenFGA, but an epoch bump failure aborts the write.
 */
@Component
public class DecisionCache {
  private static final String EPOCH = "hive:authz:epoch";
  private final StringRedisTemplate redis;
  private final Duration ttl;

  public DecisionCache(ObjectProvider<StringRedisTemplate> redis, @Value("${hive.authorization.cache.enabled:false}") boolean enabled,
      @Value("${hive.authorization.cache.ttl:5s}") Duration ttl) {
    this.redis = enabled ? redis.getIfAvailable() : null;
    this.ttl = ttl;
  }

  public boolean enabled() { return redis != null; }

  public String epoch() {
    if (redis == null) return null;
    try {
      String value = redis.opsForValue().get(EPOCH);
      if (value != null) return value;
      redis.opsForValue().setIfAbsent(EPOCH, "0");
      return redis.opsForValue().get(EPOCH);
    } catch (RuntimeException unavailable) {
      return null;
    }
  }

  public Boolean get(String epoch, OpenFgaClient.Tuple tuple) {
    if (redis == null || epoch == null) return null;
    try {
      String value = redis.opsForValue().get(key(epoch, tuple));
      return value == null ? null : "1".equals(value);
    } catch (RuntimeException unavailable) {
      return null;
    }
  }

  public void put(String epoch, OpenFgaClient.Tuple tuple, boolean allowed) {
    if (redis == null || epoch == null) return;
    try { redis.opsForValue().set(key(epoch, tuple), allowed ? "1" : "0", ttl); } catch (RuntimeException ignored) { /* acceleration only */ }
  }

  public void invalidate() {
    if (redis == null) return;
    Long value = redis.opsForValue().increment(EPOCH);
    if (value == null) throw new IllegalStateException("Decision cache epoch could not be advanced");
  }

  private static String key(String epoch, OpenFgaClient.Tuple tuple) {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256").digest((tuple.user() + '\0' + tuple.relation() + '\0' + tuple.object()).getBytes(StandardCharsets.UTF_8));
      return "hive:authz:decision:" + epoch + ":" + HexFormat.of().formatHex(digest);
    } catch (NoSuchAlgorithmException impossible) {
      throw new IllegalStateException(impossible);
    }
  }
}
