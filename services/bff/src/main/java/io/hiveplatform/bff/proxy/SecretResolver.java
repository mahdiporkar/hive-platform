package io.hiveplatform.bff.proxy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.hiveplatform.spring.HiveException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.function.Function;
import org.springframework.http.HttpStatus;

/**
 * Resolves credential references inside the BFF only. {@code env:HIVE_SECRET_<NAME>} reads a JSON object from the
 * environment; {@code file:<name>} reads {@code <name>.json} below {@code HIVE_SECRET_ROOT} (a mounted secret volume).
 * Values are never logged, returned to callers or persisted.
 */
public final class SecretResolver {
  public record Credential(String username, String password, String clientId, String clientSecret) {
    @Override public String toString() { return "Credential[REDACTED]"; }
  }

  private static final long MAX_BYTES = 64 * 1024;
  private final ObjectMapper json;
  private final Path root;
  private final Function<String, String> environment;

  public SecretResolver(ObjectMapper json, String root, Function<String, String> environment) {
    this.json = json;
    this.environment = environment;
    Path resolved = null;
    if (root != null && !root.isBlank()) {
      try {
        resolved = Path.of(root).toRealPath();
      } catch (Exception e) {
        throw new IllegalStateException("HIVE_SECRET_ROOT is not accessible");
      }
    }
    this.root = resolved;
  }

  public Credential resolve(String reference) {
    try {
      JsonNode node;
      if (reference != null && reference.matches("env:HIVE_SECRET_[A-Z0-9_]{1,80}")) {
        String value = environment.apply(reference.substring(4));
        if (value == null || value.isBlank()) throw unavailable();
        node = json.readTree(value);
      } else if (reference != null && reference.matches("file:[a-z0-9][a-z0-9-]{0,79}")) {
        if (root == null) throw unavailable();
        Path candidate = root.resolve(reference.substring(5) + ".json").normalize();
        if (!candidate.startsWith(root) || !Files.isRegularFile(candidate)) throw unavailable();
        Path real = candidate.toRealPath();
        if (!real.startsWith(root) || Files.size(real) > MAX_BYTES) throw unavailable();
        node = json.readTree(Files.readAllBytes(real));
      } else {
        throw unavailable();
      }
      if (!node.isObject()) throw unavailable();
      return new Credential(text(node, "username"), text(node, "password"), text(node, "clientId"), text(node, "clientSecret"));
    } catch (HiveException known) {
      throw known;
    } catch (Exception other) {
      throw unavailable();
    }
  }

  private static String text(JsonNode node, String field) {
    JsonNode value = node.get(field);
    return value == null || value.isNull() ? null : value.asText();
  }

  private static HiveException unavailable() {
    return new HiveException(HttpStatus.BAD_GATEWAY, "CREDENTIAL_UNAVAILABLE", "The credential referenced by the route's authentication profile is unavailable");
  }
}
