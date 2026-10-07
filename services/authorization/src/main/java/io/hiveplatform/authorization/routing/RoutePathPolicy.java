package io.hiveplatform.authorization.routing;

import java.util.regex.Pattern;

/** Canonical, deliberately small route-pattern language. Administrator regex is never executed. */
public final class RoutePathPolicy {
  private static final Pattern SEGMENT = Pattern.compile("[A-Za-z0-9._~-]+|\\{[A-Za-z][A-Za-z0-9_]{0,63}}|\\*");
  private RoutePathPolicy() {}

  // Encodings that would change path structure if decoded: / \ . ? # and % itself.
  private static final Pattern STRUCTURAL_ENCODING =
      Pattern.compile("(?i)%(2f|5c|2e|3f|23|25)");
  private static final Pattern MALFORMED_ENCODING = Pattern.compile("%(?![0-9A-Fa-f]{2})");

  /**
   * Canonical form of a runtime request path. Well-formed percent-encodings of ordinary
   * characters (for example {@code %20}) are kept opaque and compared byte-for-byte; encodings
   * that would alter path structure are rejected so no double-decoding ambiguity exists.
   */
  public static String path(String value) {
    if (value == null || !value.startsWith("/") || value.length() > 500) fail();
    if (value.contains("\\") || value.contains("//") || value.indexOf('\0') >= 0
        || value.chars().anyMatch(c -> c < 0x20 || c == 0x7f)
        || value.contains("?") || value.contains("#")
        || STRUCTURAL_ENCODING.matcher(value).find()
        || MALFORMED_ENCODING.matcher(value).find()) fail();
    for (String segment:value.split("/",-1)) if (segment.equals(".") || segment.equals("..")) fail();
    return value.length()>1 && value.endsWith("/") ? value.substring(0,value.length()-1) : value;
  }

  /** Route definitions (prefixes, patterns, rewrites, base paths) never contain encodings. */
  public static String definition(String value) {
    String normalized=path(value);
    if (normalized.contains("%")) fail();
    return normalized;
  }

  public static String prefix(String value) {
    String normalized=definition(value);
    return normalized.equals("/") ? "/" : normalized+"/";
  }

  public static String pattern(String value) {
    String normalized=definition(value);
    if (normalized.equals("/") || normalized.equals("/**")) return normalized;
    String[] parts=normalized.substring(1).split("/",-1);
    for(int i=0;i<parts.length;i++) {
      if (parts[i].equals("**") && i==parts.length-1) continue;
      if (!SEGMENT.matcher(parts[i]).matches()) throw new IllegalArgumentException("INVALID_PATH_PATTERN");
    }
    return normalized;
  }

  public static boolean matches(String pattern,String relative) {
    String[] expected=pattern.substring(1).split("/",-1);
    String[] actual=relative.substring(1).split("/",-1);
    int i=0;
    for(;i<expected.length;i++) {
      if (expected[i].equals("**")) return i==expected.length-1;
      if (i>=actual.length) return false;
      if (!(expected[i].equals("*") || expected[i].startsWith("{") || expected[i].equals(actual[i]))) return false;
    }
    return i==actual.length;
  }

  /**
   * True when some request path could match both patterns. Used at configuration time so an
   * ambiguous pair (equal specificity) is refused when saved, not discovered by a user's 409.
   */
  public static boolean overlaps(String first,String second) {
    String[] a=first.substring(1).split("/",-1), b=second.substring(1).split("/",-1);
    int i=0;
    for(;i<a.length&&i<b.length;i++) {
      if(a[i].equals("**")||b[i].equals("**")) return true;
      boolean wildA=a[i].equals("*")||a[i].startsWith("{"), wildB=b[i].equals("*")||b[i].startsWith("{");
      if(!wildA&&!wildB&&!a[i].equals(b[i])) return false;
    }
    if(i<a.length) return a[i].equals("**");
    if(i<b.length) return b[i].equals("**");
    return true;
  }

  public static int specificity(String pattern) {
    int score=0;
    for(String segment:pattern.split("/")) score += segment.equals("**")?0:(segment.equals("*")||segment.startsWith("{"))?1:10;
    return score;
  }

  private static void fail(){throw new IllegalArgumentException("INVALID_CANONICAL_PATH");}
}
