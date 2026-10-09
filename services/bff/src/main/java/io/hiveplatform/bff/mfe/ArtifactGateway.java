package io.hiveplatform.bff.mfe;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.hiveplatform.artifacts.security.UiArtifactUriPolicy;
import io.hiveplatform.bff.control.ControlPlaneClient;
import io.hiveplatform.spring.HiveException;
import java.io.IOException;
import java.io.InputStream;
import java.net.ConnectException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;

/**
 * Dynamic artifact gateway: serves the files of registered micro-frontends from a stable, same-origin, version-scoped
 * path ({@code /api/mfe/{module}/{version}/{asset}}) so browsers never contact an MFE host and no reverse-proxy rule is
 * needed per registration.
 *
 * <p>Trust boundaries: the upstream location comes only from the control plane's registry (an operator-registered,
 * policy-validated artifact URL of the module's <em>active</em> revision) and only when the module is part of the
 * caller's runtime context. Requested assets must stay below the directory of that entry (same origin, no traversal),
 * resolved addresses are re-checked against this BFF's network policy on every upstream fetch, redirects are refused,
 * nothing from the browser (cookies, authorization, headers) is forwarded, responses are size-bounded and content types
 * are checked. The entry itself is verified against its registered integrity before it is served.
 *
 * <p>Cache: resolutions are cached per caller and module for a short TTL ({@code HIVE_MFE_RESOLVE_TTL_MS}); assets per
 * catalog revision and upstream URL. An activation, rollback or deactivation bumps the revision, so it takes effect as
 * soon as the caller's resolution expires; no Hive component is redeployed or restarted.
 */
public final class ArtifactGateway {
  public record Settings(Duration resolveTtl, Duration cacheTtl, int maxAssetBytes, long cacheBudgetBytes, Duration connectTimeout, Duration responseTimeout) {}
  public record Asset(String contentType, byte[] body, String etag) {}
  record Resolution(String moduleKey, String version, String url, String integrity, String format, long revision, long expiresAt) {}

  private static final Pattern MODULE = Pattern.compile("[a-z][a-z0-9-]{1,79}");
  private static final Pattern VERSION = Pattern.compile("[0-9A-Za-z.+-]{1,64}");
  private static final Pattern ASSET = Pattern.compile("[A-Za-z0-9._~@/+-]{1,512}");

  private final ControlPlaneClient control;
  private final ObjectMapper json;
  private final UiArtifactUriPolicy policy;
  private final Settings settings;
  private final HttpClient http;
  private final Map<String, Resolution> resolutions = new ConcurrentHashMap<>();
  private final AssetCache cache;

  public ArtifactGateway(ControlPlaneClient control, ObjectMapper json, UiArtifactUriPolicy policy, Settings settings) {
    this.control = control;
    this.json = json;
    this.policy = policy;
    this.settings = settings;
    this.cache = new AssetCache(settings.cacheBudgetBytes());
    this.http = HttpClient.newBuilder().connectTimeout(settings.connectTimeout()).followRedirects(HttpClient.Redirect.NEVER).version(HttpClient.Version.HTTP_1_1).build();
  }

  public Asset serve(String moduleKey, String version, String assetPath, UUID userId) {
    if (!MODULE.matcher(moduleKey).matches() || !VERSION.matcher(version).matches()) throw notFound();
    if (assetPath == null || !ASSET.matcher(assetPath).matches() || assetPath.startsWith("/") || assetPath.contains("//")
        || java.util.Arrays.stream(assetPath.split("/")).anyMatch(s -> s.equals(".") || s.equals("..")))
      throw new HiveException(HttpStatus.BAD_REQUEST, "MFE_ASSET_PATH_INVALID", "The asset path is not acceptable");
    Resolution resolution = resolve(moduleKey, userId);
    if (!resolution.version().equals(version))
      throw new HiveException(HttpStatus.NOT_FOUND, "MFE_VERSION_NOT_ACTIVE", "Version " + version + " of " + moduleKey + " is not the active version; reload the context");
    URI target;
    try {
      target = policy.prepareAssetForFetch(resolution.url(), assetPath);
    } catch (IllegalArgumentException rejected) {
      String message = rejected.getMessage() == null ? "" : rejected.getMessage();
      if (message.contains("asset")) throw new HiveException(HttpStatus.BAD_REQUEST, "MFE_ASSET_PATH_INVALID", message);
      throw new HiveException(HttpStatus.BAD_GATEWAY, "MFE_TARGET_BLOCKED", message);
    }
    String key = resolution.revision() + "|" + target;
    Asset cached = cache.get(key, System.currentTimeMillis());
    if (cached != null) return cached;
    Asset asset = fetch(target, assetPath);
    if (isEntry(resolution.url(), target)) verify(asset.body(), resolution.integrity(), moduleKey);
    cache.put(key, asset, System.currentTimeMillis() + settings.cacheTtl().toMillis());
    return asset;
  }

  private Resolution resolve(String moduleKey, UUID userId) {
    String key = (userId == null ? "anonymous" : userId.toString()) + "|" + moduleKey;
    long now = System.currentTimeMillis();
    Resolution cached = resolutions.get(key);
    if (cached != null && cached.expiresAt() > now) return cached;
    var raw = control.exchange("GET", "/internal/runtime/artifacts/" + moduleKey + (userId == null ? "" : "?userId=" + userId), null, null, Map.of());
    if (raw.status() == 404) {
      resolutions.remove(key);
      throw notFound();
    }
    if (raw.status() / 100 != 2) throw new HiveException(HttpStatus.SERVICE_UNAVAILABLE, "CONTROL_PLANE_UNAVAILABLE", "The artifact registry is unavailable");
    JsonNode body;
    try {
      body = json.readTree(raw.body());
    } catch (IOException e) {
      throw new HiveException(HttpStatus.BAD_GATEWAY, "CONTROL_PLANE_RESPONSE_INVALID", "Control plane returned malformed JSON");
    }
    String url = body.path("url").asText("");
    if (!url.startsWith("http://") && !url.startsWith("https://")) throw notFound();
    if (resolutions.size() > 10_000) resolutions.clear();
    Resolution resolution = new Resolution(moduleKey, body.path("manifestVersion").asText(), url, body.path("integrity").asText(""), body.path("format").asText("ES_MODULE"),
        body.path("revision").asLong(), now + settings.resolveTtl().toMillis());
    resolutions.put(key, resolution);
    return resolution;
  }

  private Asset fetch(URI target, String assetPath) {
    HttpResponse<InputStream> response;
    try {
      var request = HttpRequest.newBuilder(target).timeout(settings.responseTimeout()).header("Accept", "*/*").GET().build();
      response = http.send(request, HttpResponse.BodyHandlers.ofInputStream());
    } catch (HttpConnectTimeoutException timeout) {
      throw new HiveException(HttpStatus.GATEWAY_TIMEOUT, "MFE_UPSTREAM_TIMEOUT", "Connecting to the micro-frontend host timed out");
    } catch (HttpTimeoutException timeout) {
      throw new HiveException(HttpStatus.GATEWAY_TIMEOUT, "MFE_UPSTREAM_TIMEOUT", "The micro-frontend host did not answer in time");
    } catch (ConnectException refused) {
      throw new HiveException(HttpStatus.BAD_GATEWAY, "MFE_UPSTREAM_UNREACHABLE", "The micro-frontend host refused the connection or is unreachable");
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      throw new HiveException(HttpStatus.BAD_GATEWAY, "MFE_UPSTREAM_UNREACHABLE", "The micro-frontend request was interrupted");
    } catch (IOException failure) {
      throw new HiveException(HttpStatus.BAD_GATEWAY, "MFE_UPSTREAM_UNREACHABLE", "The micro-frontend host is unavailable");
    }
    try (InputStream in = response.body()) {
      int status = response.statusCode();
      if (status / 100 == 3) throw new HiveException(HttpStatus.BAD_GATEWAY, "MFE_REDIRECT_REFUSED", "The micro-frontend host redirected; redirects are not followed");
      if (status == 404) throw new HiveException(HttpStatus.NOT_FOUND, "MFE_ASSET_NOT_FOUND", "The micro-frontend host has no file " + assetPath);
      if (status / 100 != 2) throw new HiveException(HttpStatus.BAD_GATEWAY, "MFE_UPSTREAM_HTTP_ERROR", "The micro-frontend host returned HTTP " + status);
      byte[] body = in.readNBytes(settings.maxAssetBytes() + 1);
      if (body.length > settings.maxAssetBytes()) throw new HiveException(HttpStatus.BAD_GATEWAY, "MFE_ASSET_TOO_LARGE", "The asset exceeds the configured size limit");
      String type = response.headers().firstValue("Content-Type").orElse("application/octet-stream");
      checkType(assetPath, type);
      return new Asset(type, body, "\"" + HexFormat.of().formatHex(digest("SHA-256", body)) + "\"");
    } catch (IOException failure) {
      throw new HiveException(HttpStatus.BAD_GATEWAY, "MFE_UPSTREAM_UNREACHABLE", "The micro-frontend response could not be read");
    }
  }

  /** Executable and style assets must carry the matching type, so the gateway never turns data into script. */
  static void checkType(String assetPath, String contentType) {
    String path = assetPath.toLowerCase(Locale.ROOT), type = contentType.toLowerCase(Locale.ROOT);
    boolean script = path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs");
    boolean valid = (!script || type.contains("javascript") || type.contains("ecmascript"))
        && (!path.endsWith(".css") || type.startsWith("text/css"))
        && (!path.endsWith(".json") && !path.endsWith(".map") || type.contains("json"))
        && (script || !(type.contains("javascript") || type.contains("ecmascript") || type.contains("html")));
    if (!valid) throw new HiveException(HttpStatus.BAD_GATEWAY, "MFE_CONTENT_TYPE", "The micro-frontend host served " + assetPath + " as '" + contentType + "'");
  }

  private static void verify(byte[] body, String integrity, String moduleKey) {
    if (integrity == null || integrity.isBlank()) return;
    for (String candidate : integrity.trim().split("\\s+")) {
      int dash = candidate.indexOf('-');
      if (dash < 0) continue;
      String algorithm = switch (candidate.substring(0, dash)) { case "sha256" -> "SHA-256"; case "sha384" -> "SHA-384"; case "sha512" -> "SHA-512"; default -> null; };
      if (algorithm != null && (candidate.substring(0, dash) + "-" + Base64.getEncoder().encodeToString(digest(algorithm, body))).equals(candidate)) return;
    }
    throw new HiveException(HttpStatus.BAD_GATEWAY, "ARTIFACT_INTEGRITY_MISMATCH",
        "The entry served for " + moduleKey + " does not match its registered integrity; refusing to serve it");
  }

  private static boolean isEntry(String entryUrl, URI target) {
    return URI.create(entryUrl).normalize().getRawPath().equals(target.getRawPath());
  }

  private static HiveException notFound() {
    return new HiveException(HttpStatus.NOT_FOUND, "MFE_MODULE_UNAVAILABLE", "The micro-frontend is not available in this context");
  }

  private static byte[] digest(String algorithm, byte[] bytes) {
    try {
      return MessageDigest.getInstance(algorithm).digest(bytes);
    } catch (java.security.NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  /** Byte-budgeted LRU of fetched assets. */
  static final class AssetCache {
    private record Entry(Asset asset, long expiresAt) {}
    private final long budget;
    private long used;
    private final LinkedHashMap<String, Entry> entries = new LinkedHashMap<>(64, 0.75f, true);

    AssetCache(long budget) { this.budget = budget; }

    synchronized Asset get(String key, long now) {
      Entry entry = entries.get(key);
      if (entry == null) return null;
      if (entry.expiresAt() <= now) {
        remove(key);
        return null;
      }
      return entry.asset();
    }

    synchronized void put(String key, Asset asset, long expiresAt) {
      long size = asset.body().length;
      if (budget <= 0 || size > budget / 4) return;
      remove(key);
      entries.put(key, new Entry(asset, expiresAt));
      used += size;
      var iterator = entries.entrySet().iterator();
      while (used > budget && iterator.hasNext()) {
        used -= iterator.next().getValue().asset().body().length;
        iterator.remove();
      }
    }

    private void remove(String key) {
      Entry removed = entries.remove(key);
      if (removed != null) used -= removed.asset().body().length;
    }
  }
}
