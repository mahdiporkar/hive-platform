package io.hiveplatform.bff.security;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** Application-level AES-256-GCM envelope. The key is provided by a secret store, never source control. */
public final class TokenVaultCrypto {
  private static final SecureRandom RANDOM = new SecureRandom();
  private final String keyId;
  private final Map<String, SecretKey> keys;

  public TokenVaultCrypto(String keyId, String keyBase64) {
    this(keyId, keyBase64, "");
  }

  public TokenVaultCrypto(String keyId, String keyBase64, String previousKeys) {
    this.keyId = validateKeyId(keyId);
    Map<String, SecretKey> configured = new LinkedHashMap<>();
    configured.put(this.keyId, decodeKey(keyBase64));
    if (previousKeys != null && !previousKeys.isBlank()) {
      for (String entry : previousKeys.split(",")) {
        String[] parts = entry.trim().split("=", 2);
        if (parts.length != 2) {
          throw new IllegalArgumentException("Previous token vault keys must use key-id=base64");
        }
        String previousId = validateKeyId(parts[0]);
        if (configured.putIfAbsent(previousId, decodeKey(parts[1])) != null) {
          throw new IllegalArgumentException("Duplicate token vault key identifier");
        }
      }
    }
    this.keys = Map.copyOf(configured);
  }

  public String encrypt(String value) {
    try {
      byte[] iv = new byte[12]; RANDOM.nextBytes(iv);
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.ENCRYPT_MODE, keys.get(keyId), new GCMParameterSpec(128, iv));
      byte[] ciphertext = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
      return keyId + "." + Base64.getUrlEncoder().withoutPadding().encodeToString(iv) + "." + Base64.getUrlEncoder().withoutPadding().encodeToString(ciphertext);
    } catch (Exception e) { throw new IllegalStateException("Token encryption failed", e); }
  }

  public String decrypt(String envelope) {
    try {
      String[] parts = envelope.split("\\.");
      SecretKey key = parts.length == 3 ? keys.get(parts[0]) : null;
      if (key == null) throw new IllegalArgumentException("Unknown token key identifier");
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, Base64.getUrlDecoder().decode(parts[1])));
      return new String(cipher.doFinal(Base64.getUrlDecoder().decode(parts[2])), StandardCharsets.UTF_8);
    } catch (Exception e) { throw new IllegalStateException("Token decryption failed", e); }
  }

  private static String validateKeyId(String value) {
    if (value == null || !value.matches("[A-Za-z0-9_-]{1,64}")) {
      throw new IllegalArgumentException("Invalid token vault key identifier");
    }
    return value;
  }

  private static SecretKey decodeKey(String encoded) {
    try {
      byte[] raw = Base64.getDecoder().decode(encoded == null ? "" : encoded.trim());
      if (raw.length != 32) throw new IllegalArgumentException("Token vault key must be 256 bits");
      return new SecretKeySpec(raw, "AES");
    } catch (IllegalArgumentException invalid) {
      throw new IllegalArgumentException("Token vault key must be valid Base64 for 256 bits", invalid);
    }
  }
}
