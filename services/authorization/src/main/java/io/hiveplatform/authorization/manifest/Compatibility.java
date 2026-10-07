package io.hiveplatform.authorization.manifest;

import io.hiveplatform.spring.HiveException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;

/**
 * Server-side twin of {@code @hive-platform/contracts} {@code checkCompatibility}. Both implementations are driven by
 * {@code tests/contracts/compatibility-cases.json}. Versions are never guessed: missing or malformed versions,
 * unsupported majors and unknown future minors are rejected with a specific code.
 */
public final class Compatibility {
  public record Diagnostic(String code, String message, String severity) {}

  /** Supported line per checked field: {major, highest supported minor, lowest non-deprecated minor}. */
  public static final Map<String, int[]> SUPPORTED = Map.of(
      "contractVersion", new int[] {1, 1, 1},
      "schemaVersion", new int[] {1, 0, 0},
      "runtimeVersion", new int[] {1, 0, 0});

  private static final Pattern SEMVER = Pattern.compile("(0|[1-9]\\d{0,8})\\.(0|[1-9]\\d{0,8})\\.(0|[1-9]\\d{0,8})");

  private Compatibility() {}

  public static int[] parse(Object value, String field) {
    if (value == null || "".equals(value)) throw failure("VERSION_MISSING", field + " is required");
    if (!(value instanceof String text) || !SEMVER.matcher(text).matches()) throw failure("VERSION_INVALID", field + " must be a stable major.minor.patch version");
    String[] parts = text.split("\\.");
    return new int[] {Integer.parseInt(parts[0]), Integer.parseInt(parts[1]), Integer.parseInt(parts[2])};
  }

  /** Checks the version descriptor of a micro-frontend manifest; returns warnings, throws on incompatibility. */
  public static List<Diagnostic> check(Map<String, ?> descriptor) {
    List<Diagnostic> warnings = new ArrayList<>();
    for (String field : List.of("contractVersion", "schemaVersion", "runtimeVersion")) checkField(descriptor.get(field), field, warnings);
    parse(descriptor.get("manifestVersion"), "manifestVersion");
    return warnings;
  }

  /** Resource manifests carry only a schema version and their own content version. */
  public static void checkResourceManifest(Map<String, ?> descriptor) {
    checkField(descriptor.get("schemaVersion"), "schemaVersion", new ArrayList<>());
    parse(descriptor.get("manifestVersion"), "manifestVersion");
  }

  private static void checkField(Object value, String field, List<Diagnostic> warnings) {
    int[] version = parse(value, field);
    int[] supported = SUPPORTED.get(field);
    if (version[0] != supported[0]) throw failure("VERSION_MAJOR_UNSUPPORTED", field + ": supported major " + supported[0] + ", received " + version[0]);
    if (version[1] > supported[1]) throw failure("VERSION_MINOR_UNSUPPORTED", field + ": supported through " + supported[0] + "." + supported[1] + ".x, received " + value);
    if (version[1] < supported[2]) warnings.add(new Diagnostic("VERSION_DEPRECATED",
        field + " " + supported[0] + "." + version[1] + ".x is supported but deprecated; use " + supported[0] + "." + supported[2] + ".x", "WARNING"));
  }

  public static int compare(String left, String right) {
    int[] a = parse(left, "version"), b = parse(right, "version");
    for (int i = 0; i < 3; i++) if (a[i] != b[i]) return Integer.compare(a[i], b[i]);
    return 0;
  }

  private static HiveException failure(String code, String message) {
    return new HiveException(HttpStatus.UNPROCESSABLE_ENTITY, code, message);
  }
}
