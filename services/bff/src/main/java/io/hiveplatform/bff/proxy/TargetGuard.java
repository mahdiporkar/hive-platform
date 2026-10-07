package io.hiveplatform.bff.proxy;

import io.hiveplatform.artifacts.security.UiArtifactUriPolicy;
import io.hiveplatform.spring.HiveException;
import java.net.URI;
import java.util.Arrays;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;

/**
 * Second, deployment-owned trust boundary for outbound calls. A registered target is used only if its exact origin
 * is approved for this BFF ({@code HIVE_PROXY_ALLOWED_ORIGINS}) and its resolved addresses pass the outbound network
 * policy (metadata, link-local and reserved ranges are never reachable). Browsers can never supply a target URL.
 */
public final class TargetGuard {
  private final Set<String> approved;
  private final UiArtifactUriPolicy policy;

  public TargetGuard(String approvedOrigins, UiArtifactUriPolicy policy) {
    this.approved = Arrays.stream(approvedOrigins == null ? new String[0] : approvedOrigins.split(",")).map(String::trim).filter(s -> !s.isEmpty())
        .map(TargetGuard::origin).collect(Collectors.toUnmodifiableSet());
    this.policy = policy;
  }

  public URI resolve(String baseUrl, String upstreamPath, String rawQuery) {
    URI base = URI.create(baseUrl);
    String origin = origin(baseUrl);
    if (!approved.contains(origin)) throw new HiveException(HttpStatus.BAD_GATEWAY, "TARGET_NOT_APPROVED", "The service target origin is not approved for this deployment");
    try {
      policy.prepareForFetch(origin, UiArtifactUriPolicy.ArtifactType.EXTERNAL_ORIGIN, "Service target");
    } catch (IllegalArgumentException blocked) {
      throw new HiveException(HttpStatus.BAD_GATEWAY, "TARGET_BLOCKED", blocked.getMessage());
    }
    if (rawQuery != null && (rawQuery.length() > 4096 || rawQuery.chars().anyMatch(c -> c < 0x20 || c == 0x7f || c == '#')))
      throw new HiveException(HttpStatus.BAD_REQUEST, "QUERY_INVALID", "Query string is not acceptable");
    String basePath = base.getRawPath() == null || "/".equals(base.getRawPath()) ? "" : base.getRawPath().replaceAll("/+$", "");
    String path = basePath + (upstreamPath.startsWith("/") ? upstreamPath : "/" + upstreamPath);
    return URI.create(origin + path + (rawQuery == null || rawQuery.isEmpty() ? "" : "?" + rawQuery));
  }

  static String origin(String value) {
    URI uri;
    try {
      uri = URI.create(value.trim());
    } catch (RuntimeException invalid) {
      throw new IllegalArgumentException("Invalid target origin");
    }
    String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
    String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
    if (!Set.of("http", "https").contains(scheme) || host.isBlank() || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null)
      throw new IllegalArgumentException("Target must be an HTTP(S) origin");
    boolean defaultPort = uri.getPort() < 0 || ("http".equals(scheme) && uri.getPort() == 80) || ("https".equals(scheme) && uri.getPort() == 443);
    return scheme + "://" + (host.contains(":") ? "[" + host + "]" : host) + (defaultPort ? "" : ":" + uri.getPort());
  }
}
