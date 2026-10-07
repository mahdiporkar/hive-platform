package io.hiveplatform.spring;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** Removes credential material before values reach logs, audit details or API error messages. */
public final class Redaction {
  public static final String MASK = "[REDACTED]";
  private static final Set<String> SENSITIVE = Set.of("password", "passwd", "secret", "token", "accesstoken", "refreshtoken",
      "idtoken", "authorization", "cookie", "setcookie", "apikey", "privatekey", "clientsecret", "credential", "credentials");
  private static final Pattern BEARER = Pattern.compile("(?i)bearer\\s+[A-Za-z0-9._~+/=-]+");
  private static final Pattern JWT = Pattern.compile("eyJ[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]*");
  private static final Pattern BASIC = Pattern.compile("(?i)basic\\s+[A-Za-z0-9+/=]{8,}");

  private Redaction() {}

  public static boolean sensitiveKey(String key) {
    if (key == null) return false;
    String normalized = key.toLowerCase(Locale.ROOT).replaceAll("[^a-z]", "");
    return SENSITIVE.contains(normalized) || SENSITIVE.stream().anyMatch(s -> s.length() > 5 && normalized.endsWith(s));
  }

  public static String text(String value) {
    if (value == null) return null;
    String result = BEARER.matcher(value).replaceAll("Bearer " + MASK);
    result = BASIC.matcher(result).replaceAll("Basic " + MASK);
    return JWT.matcher(result).replaceAll(MASK);
  }

  /** Recursively masks sensitive keys and token-shaped strings in JSON-like maps and lists. */
  public static Object value(Object value) {
    if (value instanceof Map<?, ?> map) {
      var copy = new LinkedHashMap<String, Object>();
      map.forEach((k, v) -> copy.put(String.valueOf(k), sensitiveKey(String.valueOf(k)) ? MASK : value(v)));
      return copy;
    }
    if (value instanceof Iterable<?> list) {
      var copy = new ArrayList<Object>();
      list.forEach(item -> copy.add(value(item)));
      return copy;
    }
    if (value instanceof String s) return text(s);
    return value;
  }

  public static String safeMessage(String message) {
    if (message == null) return "Invalid request";
    String cleaned = text(message).replaceAll("[\\r\\n\\t]+", " ");
    return cleaned.length() > 300 ? cleaned.substring(0, 300) : cleaned;
  }
}
