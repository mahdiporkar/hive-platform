package io.hiveplatform.bff.proxy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.hiveplatform.bff.security.TokenVaultCrypto;
import io.hiveplatform.spring.HiveException;
import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.BiConsumer;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.http.HttpStatus;

/**
 * Server-side legacy service tokens. Tokens are acquired from the route's own registered target, cached in Redis
 * AES-GCM encrypted under a key that includes the profile revision (so configuration changes invalidate it), expire
 * before the upstream expiry minus the configured skew, are acquired once across BFF instances (Redis lease), and
 * are protected by a per-profile circuit breaker. Neither credentials nor tokens ever leave this class except as the
 * outbound Authorization header.
 */
public final class LegacyTokens {
  public record Profile(String key, long revision, String tokenEndpointPath, String requestFormat, String credentialReference, String tokenPointer,
      String expiresInPointer, String tokenTypePointer, String scheme, String scope, String audience, int expirySkewSeconds, int maxResponseBytes) {}
  public record Token(String header, Instant expiresAt) {
    @Override public String toString() { return "Token[REDACTED]"; }
  }

  private final StringRedisTemplate redis;
  private final ObjectMapper json;
  private final TokenVaultCrypto crypto;
  private final SecretResolver secrets;
  private final TargetGuard guard;
  private final BiConsumer<String, Map<String, Object>> audit;
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).followRedirects(HttpClient.Redirect.NEVER).build();
  private final Map<String, Breaker> breakers = new ConcurrentHashMap<>();

  public LegacyTokens(StringRedisTemplate redis, ObjectMapper json, TokenVaultCrypto crypto, SecretResolver secrets, TargetGuard guard,
      BiConsumer<String, Map<String, Object>> audit) {
    this.redis = redis;
    this.json = json;
    this.crypto = crypto;
    this.secrets = secrets;
    this.guard = guard;
    this.audit = audit;
  }

  public Token token(Profile profile, String targetBaseUrl) {
    if (crypto == null) throw new HiveException(HttpStatus.SERVICE_UNAVAILABLE, "LEGACY_VAULT_UNAVAILABLE", "Legacy token vault key is not configured");
    Token cached = read(profile);
    if (cached != null) return cached;
    String lock = "hive:legacy-lock:" + profile.key(), owner = UUID.randomUUID().toString();
    for (int attempt = 0; attempt < 50; attempt++) {
      if (Boolean.TRUE.equals(redis.opsForValue().setIfAbsent(lock, owner, Duration.ofSeconds(10)))) {
        try {
          cached = read(profile);
          if (cached != null) return cached;
          return acquire(profile, targetBaseUrl);
        } finally {
          redis.execute(new DefaultRedisScript<>("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end", Long.class), List.of(lock), owner);
        }
      }
      sleep();
      cached = read(profile);
      if (cached != null) return cached;
    }
    throw new HiveException(HttpStatus.SERVICE_UNAVAILABLE, "LEGACY_TOKEN_BUSY", "Legacy token acquisition is in progress elsewhere; retry");
  }

  /** Called when the upstream rejects a cached token (HTTP 401): the next request acquires a fresh one. */
  public void invalidate(Profile profile) {
    redis.delete(key(profile));
    audit.accept("legacy-token.invalidated", Map.of("profile", profile.key(), "reason", "UPSTREAM_401"));
  }

  public boolean cached(Profile profile) { return Boolean.TRUE.equals(redis.hasKey(key(profile))); }

  private Token read(Profile profile) {
    String raw = redis.opsForValue().get(key(profile));
    if (raw == null) return null;
    try {
      JsonNode node = json.readTree(crypto.decrypt(raw));
      Instant expires = Instant.parse(node.path("expiresAt").asText());
      if (!Instant.now().isBefore(expires.minusSeconds(profile.expirySkewSeconds()))) return null;
      return new Token(node.path("header").asText(), expires);
    } catch (Exception corrupt) {
      redis.delete(key(profile));
      return null;
    }
  }

  private Token acquire(Profile profile, String targetBaseUrl) {
    Breaker breaker = breakers.computeIfAbsent(profile.key(), k -> new Breaker());
    if (breaker.open()) throw new HiveException(HttpStatus.SERVICE_UNAVAILABLE, "LEGACY_TOKEN_CIRCUIT_OPEN", "Legacy token endpoint is temporarily unavailable");
    try {
      Token token = request(profile, targetBaseUrl);
      breaker.success();
      long ttl = Duration.between(Instant.now(), token.expiresAt().minusSeconds(profile.expirySkewSeconds())).toMillis();
      if (ttl > 0) {
        var payload = new LinkedHashMap<String, Object>();
        payload.put("header", token.header());
        payload.put("expiresAt", token.expiresAt().toString());
        redis.opsForValue().set(key(profile), crypto.encrypt(json.writeValueAsString(payload)), Duration.ofMillis(ttl));
      }
      audit.accept("legacy-token.acquired", Map.of("profile", profile.key(), "revision", profile.revision(), "expiresAt", token.expiresAt().toString()));
      return token;
    } catch (HiveException failure) {
      breaker.failure();
      audit.accept("legacy-token.failed", Map.of("profile", profile.key(), "code", failure.code()));
      throw failure;
    } catch (Exception failure) {
      breaker.failure();
      audit.accept("legacy-token.failed", Map.of("profile", profile.key(), "code", "LEGACY_TOKEN_ERROR"));
      throw new HiveException(HttpStatus.BAD_GATEWAY, "LEGACY_TOKEN_ERROR", "Legacy token acquisition failed");
    }
  }

  private Token request(Profile profile, String targetBaseUrl) throws Exception {
    var credential = secrets.resolve(profile.credentialReference());
    URI endpoint = guard.resolve(targetBaseUrl, profile.tokenEndpointPath(), null);
    var builder = HttpRequest.newBuilder(endpoint).timeout(Duration.ofSeconds(5)).header("Accept", "application/json");
    switch (profile.requestFormat()) {
      case "JSON" -> {
        var body = new LinkedHashMap<String, String>();
        put(body, "username", credential.username());
        put(body, "password", credential.password());
        put(body, "client_id", credential.clientId());
        put(body, "client_secret", credential.clientSecret());
        put(body, "scope", profile.scope());
        put(body, "audience", profile.audience());
        builder.header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
      }
      case "FORM_URLENCODED" -> builder.header("Content-Type", "application/x-www-form-urlencoded")
          .POST(HttpRequest.BodyPublishers.ofString(form("username", required(credential.username()), "password", required(credential.password()), "scope", profile.scope(), "audience", profile.audience())));
      case "HTTP_BASIC" -> builder.header("Authorization", "Basic " + Base64.getEncoder().encodeToString((required(first(credential.clientId(), credential.username())) + ":"
              + required(first(credential.clientSecret(), credential.password()))).getBytes(StandardCharsets.UTF_8)))
          .header("Content-Type", "application/x-www-form-urlencoded").POST(HttpRequest.BodyPublishers.ofString(form("scope", profile.scope(), "audience", profile.audience())));
      case "OAUTH_CLIENT_CREDENTIALS" -> builder.header("Content-Type", "application/x-www-form-urlencoded")
          .POST(HttpRequest.BodyPublishers.ofString(form("grant_type", "client_credentials", "client_id", required(credential.clientId()), "client_secret", required(credential.clientSecret()),
              "scope", profile.scope(), "audience", profile.audience())));
      default -> throw new HiveException(HttpStatus.BAD_GATEWAY, "LEGACY_FORMAT_UNSUPPORTED", "Unsupported legacy request format");
    }
    HttpResponse<InputStream> response = http.send(builder.build(), HttpResponse.BodyHandlers.ofInputStream());
    byte[] bytes;
    try (InputStream in = response.body()) {
      bytes = in.readNBytes(profile.maxResponseBytes() + 1);
    }
    if (response.statusCode() / 100 != 2) throw new HiveException(HttpStatus.BAD_GATEWAY, "LEGACY_TOKEN_REJECTED", "Legacy token endpoint returned HTTP " + response.statusCode());
    if (bytes.length == 0 || bytes.length > profile.maxResponseBytes()) throw new HiveException(HttpStatus.BAD_GATEWAY, "LEGACY_TOKEN_RESPONSE_INVALID", "Legacy token response is empty or too large");
    JsonNode root;
    try { root = json.readTree(bytes); } catch (Exception e) { throw new HiveException(HttpStatus.BAD_GATEWAY, "LEGACY_TOKEN_RESPONSE_INVALID", "Legacy token response is not JSON"); }
    JsonNode access = root.at(profile.tokenPointer()), lifetime = root.at(profile.expiresInPointer());
    if (!access.isTextual() || access.asText().isBlank() || access.asText().length() > 16384 || access.asText().chars().anyMatch(c -> c < 0x21 || c > 0x7e))
      throw new HiveException(HttpStatus.BAD_GATEWAY, "LEGACY_TOKEN_RESPONSE_INVALID", "Legacy token missing at " + profile.tokenPointer());
    if (!lifetime.canConvertToLong() || lifetime.asLong() <= 0 || lifetime.asLong() > 86400)
      throw new HiveException(HttpStatus.BAD_GATEWAY, "LEGACY_TOKEN_RESPONSE_INVALID", "Legacy token lifetime missing or out of range at " + profile.expiresInPointer());
    String scheme = profile.scheme();
    if (profile.tokenTypePointer() != null && root.at(profile.tokenTypePointer()).isTextual() && root.at(profile.tokenTypePointer()).asText().matches("[A-Za-z][A-Za-z0-9-]{0,31}"))
      scheme = root.at(profile.tokenTypePointer()).asText();
    if ("bearer".equalsIgnoreCase(scheme)) scheme = "Bearer";
    return new Token(scheme + " " + access.asText(), Instant.now().plusSeconds(lifetime.asLong()));
  }

  private static String key(Profile profile) { return "hive:legacy:" + profile.key() + ":" + profile.revision(); }

  private static String form(String... pairs) {
    List<String> parts = new ArrayList<>();
    for (int i = 0; i < pairs.length; i += 2) if (pairs[i + 1] != null)
      parts.add(URLEncoder.encode(pairs[i], StandardCharsets.UTF_8) + "=" + URLEncoder.encode(pairs[i + 1], StandardCharsets.UTF_8));
    return String.join("&", parts);
  }

  private static void put(Map<String, String> body, String key, String value) { if (value != null) body.put(key, value); }
  private static String first(String a, String b) { return a == null || a.isBlank() ? b : a; }

  private static String required(String value) {
    if (value == null || value.isBlank()) throw new HiveException(HttpStatus.BAD_GATEWAY, "CREDENTIAL_INCOMPLETE", "The referenced credential is incomplete for this request format");
    return value;
  }

  private static void sleep() {
    try {
      Thread.sleep(100);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new HiveException(HttpStatus.SERVICE_UNAVAILABLE, "LEGACY_TOKEN_INTERRUPTED", "Interrupted");
    }
  }

  /** Five consecutive failures open the circuit for 30 seconds (reference behavior). */
  private static final class Breaker {
    private final AtomicInteger failures = new AtomicInteger();
    private final AtomicLong openUntil = new AtomicLong();
    boolean open() { return System.currentTimeMillis() < openUntil.get(); }
    void success() { failures.set(0); }
    void failure() { if (failures.incrementAndGet() >= 5) { openUntil.set(System.currentTimeMillis() + 30_000); failures.set(0); } }
  }
}
