package io.hiveplatform.authorization.manifest;

import com.fasterxml.jackson.databind.JsonNode;
import io.hiveplatform.artifacts.security.UiArtifactUriPolicy;
import io.hiveplatform.spring.HiveException;
import java.io.InputStream;
import java.net.ConnectException;
import java.net.URI;
import java.net.UnknownHostException;
import java.net.http.HttpClient;
import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;

/**
 * Inspects a micro-frontend entry at a network address before registration: address and network-policy validation,
 * reachability, HTTP status, content type, runtime format detection, SRI computation and manifest discovery next to the
 * entry. Every step reports its own diagnostic, so an operator can tell a wrong port from a blocked address or an
 * incompatible bundle. The same fetch path verifies availability and integrity when an artifact is activated.
 */
public final class ArtifactInspector {
  public record ProbeRequest(String url, String protocol, String host, Integer port, String entryPath, String basePath,
      String mfManifestPath, String resourceManifestPath, Boolean fetchManifests, Boolean validateOnly) {}
  public record Check(String key, String status, String code, String message) {}
  public record ProbeResult(boolean ok, String url, String origin, String baseUrl, List<Check> checks, String detectedFormat, String remoteName,
      List<String> exposedModules, String integrity, Integer size, String contentType, String mfManifestUrl, JsonNode mfManifest,
      String resourceManifestUrl, JsonNode resourceManifest) {}

  static final int MAX_ENTRY_BYTES = 10 * 1024 * 1024;
  private static final Pattern HOST = Pattern.compile("[A-Za-z0-9.-]{1,253}|\\[[0-9A-Fa-f:.]+]|[0-9A-Fa-f:]+:[0-9A-Fa-f:.]*");
  private static final Pattern WEBPACK_VAR = Pattern.compile("^(?:\\s|/\\*[\\s\\S]*?\\*/|//[^\\n]*\\n)*var\\s+([A-Za-z_$][\\w$]*)\\s*;");
  private static final Pattern GLOBAL_ASSIGN = Pattern.compile("(?:self|window|globalThis)\\[\"([A-Za-z_$][\\w$]*)\"]\\s*=|(?:self|window|globalThis)\\.([A-Za-z_$][\\w$]*)\\s*=\\s*");
  private static final Pattern EXPOSED = Pattern.compile("[\"'](\\./[A-Za-z0-9._/-]{1,200})[\"']\\s*:\\s*(?:\\(\\)|function|async)");
  private static final Pattern ES_EXPORT = Pattern.compile("(?:^|[;}\\s])export\\s*(?:default\\b|\\{|const\\s|let\\s|var\\s|function[\\s*]|async\\s|class\\s|\\*)");
  private static final Pattern DEFAULT_EXPORT = Pattern.compile("(?:^|[;}\\s])export\\s+default\\b|\\bas\\s+default\\b");
  private static final Pattern EXPORT_LIST = Pattern.compile("export\\s*\\{([^}]*)}");

  private final UiArtifactUriPolicy policy;
  private final ManifestFetcher fetcher;
  private final ManifestDocuments documents;
  private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(4)).followRedirects(HttpClient.Redirect.NEVER).build();

  public ArtifactInspector(UiArtifactUriPolicy policy, ManifestFetcher fetcher, ManifestDocuments documents) {
    this.policy = policy;
    this.fetcher = fetcher;
    this.documents = documents;
  }

  public ProbeResult probe(ProbeRequest request) {
    List<Check> checks = new ArrayList<>();
    String url;
    try {
      url = compose(request);
      checks.add(new Check("address", "PASS", null, "Address is well-formed: " + url));
    } catch (IllegalArgumentException invalid) {
      checks.add(new Check("address", "FAIL", "ADDRESS_INVALID", invalid.getMessage()));
      return failed(null, checks);
    }
    URI configured;
    try {
      configured = policy.validateConfigured(url, UiArtifactUriPolicy.ArtifactType.REMOTE_ENTRY, "Remote entry");
    } catch (IllegalArgumentException rejected) {
      checks.add(new Check("policy", "FAIL", rejected.getMessage().contains("blocked") || rejected.getMessage().contains("outside") ? "ADDRESS_BLOCKED" : "ADDRESS_INVALID",
          rejected.getMessage()));
      return failed(url, checks);
    }
    try {
      policy.prepareForFetch(url, UiArtifactUriPolicy.ArtifactType.REMOTE_ENTRY, "Remote entry");
      checks.add(new Check("policy", "PASS", null, "Allowed by the artifact network policy (" + policy.networkMode() + ")"));
    } catch (IllegalArgumentException rejected) {
      String code = rejected.getMessage().contains("cannot be resolved") ? "DNS_UNRESOLVED" : "ADDRESS_BLOCKED";
      checks.add(new Check("policy", "FAIL", code, rejected.getMessage()));
      return failed(url, checks);
    }
    String origin = configured.getScheme() + "://" + configured.getRawAuthority();
    String baseUrl = configured.resolve(".").toString();
    if (Boolean.TRUE.equals(request.validateOnly())) return new ProbeResult(true, url, origin, baseUrl, checks, null, null, List.of(), null, null, null, null, null, null, null);

    Fetched entry;
    try {
      entry = fetch(url, MAX_ENTRY_BYTES);
    } catch (HiveException failure) {
      checks.add(new Check("reachability", "FAIL", failure.code(), failure.getMessage()));
      return new ProbeResult(false, url, origin, baseUrl, checks, null, null, List.of(), null, null, null, null, null, null, null);
    }
    checks.add(new Check("reachability", "PASS", null, "Connected to " + origin));
    if (entry.status() / 100 != 2) {
      checks.add(new Check("http", "FAIL", entry.status() == 404 ? "ENTRY_NOT_FOUND" : "ENTRY_HTTP_ERROR",
          "The entry returned HTTP " + entry.status() + (entry.status() == 404 ? "; check the entry file path" : "")));
      return new ProbeResult(false, url, origin, baseUrl, checks, null, null, List.of(), null, null, entry.contentType(), null, null, null, null);
    }
    checks.add(new Check("http", "PASS", null, "HTTP " + entry.status() + ", " + entry.body().length + " bytes"));
    String type = entry.contentType().toLowerCase(Locale.ROOT);
    checks.add(type.contains("javascript") || type.contains("ecmascript")
        ? new Check("contentType", "PASS", null, entry.contentType())
        : new Check("contentType", "WARN", "ENTRY_CONTENT_TYPE", "Expected a JavaScript content type, received '" + entry.contentType() + "'; the artifact gateway will refuse it"));

    String source = new String(entry.body(), StandardCharsets.UTF_8);
    Detection detection = detect(source);
    if (detection.format() == null) {
      checks.add(new Check("format", "FAIL", "FORMAT_UNRECOGNIZED",
          "The entry is neither a Hive ES module (export default {contractVersion, create}) nor a webpack or Vite Module Federation container"));
    } else {
      checks.add(new Check("format", "PASS", null, "Detected " + detection.format()
          + (detection.remoteName() == null ? "" : " (container global '" + detection.remoteName() + "')")
          + (detection.exposed().isEmpty() ? "" : "; exposes " + String.join(", ", detection.exposed()))));
      if ("WEBPACK_FEDERATION".equals(detection.format()) && detection.remoteName() == null)
        checks.add(new Check("remoteName", "WARN", "REMOTE_NAME_UNKNOWN", "The container global could not be detected; enter the webpack 'name' of the remote"));
    }
    String integrity = sri(entry.body(), "SHA-384", "sha384");
    checks.add(new Check("integrity", "PASS", null, "Computed " + integrity.substring(0, 18) + "… from the served bytes"));

    String mfUrl = null, resourceUrl = null;
    JsonNode mf = null, resources = null;
    if (!Boolean.FALSE.equals(request.fetchManifests())) {
      mfUrl = sibling(configured, request.mfManifestPath(), "mf-manifest.json");
      resourceUrl = sibling(configured, request.resourceManifestPath(), "resource-manifest.json");
      mf = discover(mfUrl, "mfManifest", checks, true);
      resources = discover(resourceUrl, "resourceManifest", checks, false);
    }
    boolean ok = checks.stream().noneMatch(c -> "FAIL".equals(c.status()));
    return new ProbeResult(ok, url, origin, baseUrl, checks, detection.format(), detection.remoteName(), detection.exposed(), integrity, entry.body().length,
        entry.contentType(), mfUrl, mf, resourceUrl, resources);
  }

  /** Computes the SRI value of the bytes currently served at a registered absolute artifact URL. */
  public String pin(String url) {
    Fetched entry = fetchVerified(url);
    return sri(entry.body(), "SHA-384", "sha384");
  }

  /** Confirms the artifact is served and matches its registered integrity; used before activation. */
  public void verify(String url, String integrity) {
    Fetched entry = fetchVerified(url);
    if (integrity == null || integrity.isBlank()) return;
    for (String candidate : integrity.trim().split("\\s+")) {
      int dash = candidate.indexOf('-');
      if (dash < 0) continue;
      String algorithm = switch (candidate.substring(0, dash)) { case "sha256" -> "SHA-256"; case "sha384" -> "SHA-384"; case "sha512" -> "SHA-512"; default -> null; };
      if (algorithm != null && sri(entry.body(), algorithm, candidate.substring(0, dash)).equals(candidate)) return;
    }
    throw new HiveException(HttpStatus.CONFLICT, "ARTIFACT_INTEGRITY_MISMATCH",
        "The bytes served at the registered artifact URL do not match the registered integrity; register a new artifact version for the changed bundle");
  }

  private Fetched fetchVerified(String url) {
    try {
      policy.prepareForFetch(url, UiArtifactUriPolicy.ArtifactType.REMOTE_ENTRY, "artifact.url");
    } catch (IllegalArgumentException rejected) {
      throw new HiveException(HttpStatus.UNPROCESSABLE_ENTITY, "ARTIFACT_LOCATION_REJECTED", rejected.getMessage());
    }
    Fetched entry = fetch(url, MAX_ENTRY_BYTES);
    if (entry.status() / 100 != 2)
      throw new HiveException(HttpStatus.BAD_GATEWAY, "ARTIFACT_UNAVAILABLE", "The artifact URL returned HTTP " + entry.status());
    return entry;
  }

  // ---- helpers -----------------------------------------------------------------------------------------------

  record Detection(String format, String remoteName, List<String> exposed) {}
  private record Fetched(int status, String contentType, byte[] body) {}

  static Detection detect(String source) {
    var exposed = new LinkedHashSet<String>();
    Matcher keys = EXPOSED.matcher(source);
    while (keys.find() && exposed.size() < 50) exposed.add(keys.group(1));
    boolean esModule = ES_EXPORT.matcher(source).find();
    boolean webpack = source.contains("__webpack_require__") || source.contains("webpackChunk") || source.contains("__webpack_modules__");
    if (esModule && exportsGetAndInit(source)) return new Detection("VITE_FEDERATION", null, List.copyOf(exposed));
    if (esModule && DEFAULT_EXPORT.matcher(source).find()) return new Detection("ES_MODULE", null, List.of());
    if (webpack && !esModule) {
      Matcher var = WEBPACK_VAR.matcher(source);
      String name = var.find() ? var.group(1) : null;
      if (name == null) {
        Matcher assign = GLOBAL_ASSIGN.matcher(source);
        if (assign.find()) name = assign.group(1) != null ? assign.group(1) : assign.group(2);
      }
      return new Detection("WEBPACK_FEDERATION", name, List.copyOf(exposed));
    }
    return new Detection(null, null, List.copyOf(exposed));
  }

  private static boolean exportsGetAndInit(String source) {
    boolean get = Pattern.compile("export\\s+(?:const|let|var|function|async\\s+function)\\s+get\\b").matcher(source).find();
    boolean init = Pattern.compile("export\\s+(?:const|let|var|function|async\\s+function)\\s+init\\b").matcher(source).find();
    Matcher list = EXPORT_LIST.matcher(source);
    while (list.find()) {
      for (String part : list.group(1).split(",")) {
        String[] names = part.trim().split("\\s+as\\s+");
        String exported = names[names.length - 1].trim();
        if ("get".equals(exported)) get = true;
        if ("init".equals(exported)) init = true;
      }
    }
    return get && init;
  }

  private JsonNode discover(String url, String key, List<Check> checks, boolean frontend) {
    try {
      JsonNode document = fetcher.fetch(url);
      try {
        if (frontend) documents.microFrontendManifest(document); else documents.resourceManifest(document);
        checks.add(new Check(key, "PASS", null, "Found a valid " + (frontend ? "micro-frontend" : "resource") + " manifest at " + url));
      } catch (HiveException invalid) {
        checks.add(new Check(key, "WARN", invalid.code(), "Manifest at " + url + " is not valid: " + invalid.getMessage()));
      }
      return document;
    } catch (HiveException missing) {
      boolean absent = "MANIFEST_HTTP_ERROR".equals(missing.code()) && missing.getMessage().contains("404");
      checks.add(new Check(key, absent ? "SKIP" : "WARN", absent ? "MANIFEST_NOT_PROVIDED" : missing.code(),
          absent ? "No " + (frontend ? "micro-frontend" : "resource") + " manifest at " + url + (frontend ? "; routes can be defined in the wizard" : "; resources can be defined manually")
              : missing.getMessage()));
      return null;
    }
  }

  private static String sibling(URI entry, String path, String fallback) {
    String relative = path == null || path.isBlank() ? fallback : path.trim();
    if (relative.startsWith("http://") || relative.startsWith("https://")) return relative;
    URI base = entry.resolve(relative.startsWith("/") ? relative : "./" + relative);
    return base.normalize().toString();
  }

  static String compose(ProbeRequest request) {
    if (request == null) throw new IllegalArgumentException("A URL or host and port are required");
    if (request.url() != null && !request.url().isBlank()) {
      String url = request.url().trim();
      if (!url.matches("(?i)https?://.+")) throw new IllegalArgumentException("The URL must start with http:// or https://");
      return url;
    }
    String protocol = request.protocol() == null ? "http" : request.protocol().trim().toLowerCase(Locale.ROOT);
    if (!protocol.equals("http") && !protocol.equals("https")) throw new IllegalArgumentException("Protocol must be HTTP or HTTPS");
    String host = request.host() == null ? "" : request.host().trim();
    if (host.isEmpty() || !HOST.matcher(host).matches()) throw new IllegalArgumentException("Enter a hostname or IP address (for example 10.0.0.15)");
    if (host.contains(":") && !host.startsWith("[")) host = "[" + host + "]";
    if (request.port() != null && (request.port() < 1 || request.port() > 65535)) throw new IllegalArgumentException("Port must be between 1 and 65535");
    String base = normalizePath(request.basePath());
    String entry = request.entryPath() == null || request.entryPath().isBlank() ? "remoteEntry.js" : request.entryPath().trim().replaceFirst("^/+", "");
    if (entry.contains("?") || entry.contains("#") || entry.contains("..")) throw new IllegalArgumentException("The entry file path must be a plain path such as /remoteEntry.js");
    return protocol + "://" + host + (request.port() == null ? "" : ":" + request.port()) + base + entry;
  }

  private static String normalizePath(String basePath) {
    if (basePath == null || basePath.isBlank() || basePath.trim().equals("/")) return "/";
    String path = basePath.trim();
    if (path.contains("?") || path.contains("#") || path.contains("..")) throw new IllegalArgumentException("The base path must be a plain path such as /reports/");
    if (!path.startsWith("/")) path = "/" + path;
    return path.endsWith("/") ? path : path + "/";
  }

  private Fetched fetch(String url, int limit) {
    URI target;
    try {
      target = policy.prepareForFetch(url, UiArtifactUriPolicy.ArtifactType.REMOTE_ENTRY, "Remote entry");
    } catch (IllegalArgumentException rejected) {
      throw new HiveException(HttpStatus.UNPROCESSABLE_ENTITY, "ADDRESS_BLOCKED", rejected.getMessage());
    }
    try {
      var request = HttpRequest.newBuilder(target).timeout(Duration.ofSeconds(10)).header("Accept", "text/javascript, application/javascript, */*").GET().build();
      HttpResponse<InputStream> response = client.send(request, HttpResponse.BodyHandlers.ofInputStream());
      try (InputStream body = response.body()) {
        if (response.statusCode() / 100 == 3) throw new HiveException(HttpStatus.BAD_GATEWAY, "ENTRY_REDIRECT_REFUSED", "The entry redirected; redirects are not followed — register the final URL");
        byte[] bytes = body.readNBytes(limit + 1);
        if (bytes.length > limit) throw new HiveException(HttpStatus.BAD_GATEWAY, "ENTRY_TOO_LARGE", "The entry exceeds " + (limit / 1024 / 1024) + " MiB");
        return new Fetched(response.statusCode(), response.headers().firstValue("Content-Type").orElse(""), bytes);
      }
    } catch (HiveException known) {
      throw known;
    } catch (HttpConnectTimeoutException timeout) {
      throw new HiveException(HttpStatus.GATEWAY_TIMEOUT, "HOST_UNREACHABLE", "Connecting to " + target.getHost() + " timed out; the IP address is unreachable from Hive");
    } catch (HttpTimeoutException timeout) {
      throw new HiveException(HttpStatus.GATEWAY_TIMEOUT, "ENTRY_TIMEOUT", "The server accepted the connection but did not answer in time");
    } catch (UnknownHostException dns) {
      throw new HiveException(HttpStatus.BAD_GATEWAY, "DNS_UNRESOLVED", "The hostname could not be resolved");
    } catch (ConnectException refused) {
      throw new HiveException(HttpStatus.BAD_GATEWAY, "CONNECTION_REFUSED",
          "Nothing accepted the connection at " + target.getHost() + (target.getPort() < 0 ? "" : ":" + target.getPort()) + "; the server is offline or the port is wrong");
    } catch (javax.net.ssl.SSLException tls) {
      throw new HiveException(HttpStatus.BAD_GATEWAY, "TLS_FAILED", "TLS handshake failed; check HTTPS versus HTTP and the certificate");
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      throw new HiveException(HttpStatus.BAD_GATEWAY, "ENTRY_FETCH_FAILED", "The fetch was interrupted");
    } catch (Exception other) {
      throw new HiveException(HttpStatus.BAD_GATEWAY, "ENTRY_FETCH_FAILED", "Unable to fetch the entry: " + other.getClass().getSimpleName());
    }
  }

  private static ProbeResult failed(String url, List<Check> checks) {
    return new ProbeResult(false, url, null, null, checks, null, null, List.of(), null, null, null, null, null, null, null);
  }

  static String sri(byte[] bytes, String algorithm, String prefix) {
    try {
      return prefix + "-" + Base64.getEncoder().encodeToString(MessageDigest.getInstance(algorithm).digest(bytes));
    } catch (java.security.NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }
}
