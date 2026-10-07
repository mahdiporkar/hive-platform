package io.hiveplatform.authorization.manifest;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import io.hiveplatform.artifacts.security.UiArtifactUriPolicy;
import io.hiveplatform.authorization.catalog.ResourceCatalog;
import io.hiveplatform.spring.HiveException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;

/**
 * Parses and validates the two separate manifest contracts. A resource manifest describes authorization vocabulary
 * only; a micro-frontend manifest describes an executable artifact and its routes. Neither may carry the other's fields.
 */
public final class ManifestDocuments {
  public record ResourceManifest(String schemaVersion, String manifestVersion, String applicationKey, String moduleKey,
      List<ResourceCatalog.ResourceNode> resources, String checksum, JsonNode document) {}

  public record Navigation(String label, Integer order, String icon) {}
  public record Route(String key, String path, String access, String resource, String action, Navigation navigation) {}
  public record Artifact(String url, String integrity, String format) {}
  public record MicroFrontendManifest(String schemaVersion, String manifestVersion, String contractVersion, String runtimeVersion,
      String applicationKey, String moduleKey, String displayName, String resourceManifestVersion, Artifact artifact,
      List<Route> routes, String styleIsolation, List<Compatibility.Diagnostic> warnings, String checksum, JsonNode document) {}

  static final Set<String> FRONTEND_FIELDS = Set.of("routes", "route", "path", "artifact", "remoteEntry", "remoteEntryUrl", "component",
      "navigation", "menu", "menus", "icon", "url", "integrity", "exposedModule", "contractVersion", "runtimeVersion");
  static final Set<String> AUTHORIZATION_FIELDS = Set.of("resources", "grants", "permissions", "roles");
  private static final Pattern ROUTE_KEY = Pattern.compile("[a-z][a-z0-9-]{0,79}");
  private static final Pattern ROUTE_PATH = Pattern.compile("/(?:[A-Za-z0-9._~-]+|:[a-zA-Z][a-zA-Z0-9]*)(?:/(?:[A-Za-z0-9._~-]+|:[a-zA-Z][a-zA-Z0-9]*))*(?:/\\*)?|/");
  private static final Pattern SRI = Pattern.compile("sha(256|384|512)-[A-Za-z0-9+/]+={0,2}");
  private static final Set<String> ACCESS = Set.of("PUBLIC", "HYBRID", "AUTHENTICATED");
  private static final ObjectMapper CANONICAL = JsonMapper.builder()
      .enable(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS).build();

  private final UiArtifactUriPolicy artifactPolicy;
  private final boolean requireIntegrity;

  public ManifestDocuments(UiArtifactUriPolicy artifactPolicy, boolean requireIntegrity) {
    this.artifactPolicy = artifactPolicy;
    this.requireIntegrity = requireIntegrity;
  }

  @SuppressWarnings("unchecked")
  public ResourceManifest resourceManifest(JsonNode document) {
    requireObject(document, "Resource manifest");
    for (String field : FRONTEND_FIELDS) if (document.has(field)) throw invalid("Resource manifest must not contain frontend field '" + field + "'; use the micro-frontend manifest");
    Compatibility.checkResourceManifest(CANONICAL.convertValue(document, Map.class));
    String application = text(document, "applicationKey", true), module = text(document, "moduleKey", true);
    JsonNode resources = document.path("resources");
    if (!resources.isArray() || resources.isEmpty() || resources.size() > 2000) throw invalid("resources must be a non-empty array of at most 2000 entries");
    List<ResourceCatalog.ResourceNode> nodes = new ArrayList<>();
    Set<String> keys = new HashSet<>();
    for (JsonNode resource : resources) {
      requireObject(resource, "resource");
      for (String field : FRONTEND_FIELDS) if (resource.has(field)) throw invalid("Resource " + resource.path("key").asText() + " must not contain frontend field '" + field + "'");
      String key = text(resource, "key", true);
      if (!keys.add(key)) throw invalid("Duplicate resource " + key);
      List<ResourceCatalog.ActionSpec> actions = new ArrayList<>();
      for (JsonNode action : resource.path("actions")) {
        if (action.isTextual()) actions.add(new ResourceCatalog.ActionSpec(action.asText(), null));
        else actions.add(new ResourceCatalog.ActionSpec(text(action, "key", true), text(action, "description", false)));
      }
      nodes.add(new ResourceCatalog.ResourceNode(key, text(resource, "type", true), text(resource, "parentKey", false), text(resource, "name", true), actions));
    }
    return new ResourceManifest(text(document, "schemaVersion", true), text(document, "manifestVersion", true), application, module, nodes, checksum(document), document);
  }

  @SuppressWarnings("unchecked")
  public MicroFrontendManifest microFrontendManifest(JsonNode document) {
    requireObject(document, "Micro-frontend manifest");
    for (String field : AUTHORIZATION_FIELDS) if (document.has(field)) throw invalid("Micro-frontend manifest must not contain authorization field '" + field + "'; use the resource manifest");
    var warnings = Compatibility.check(CANONICAL.convertValue(document, Map.class));
    JsonNode artifactNode = document.path("artifact");
    requireObject(artifactNode, "artifact");
    String format = text(artifactNode, "format", true);
    if (!"ES_MODULE".equals(format)) throw new HiveException(HttpStatus.UNPROCESSABLE_ENTITY, "MODULE_FORMAT_UNSUPPORTED", "artifact.format must be ES_MODULE, received " + format);
    String url = validateArtifactUrl(text(artifactNode, "url", true));
    String integrity = text(artifactNode, "integrity", false);
    if (integrity == null && requireIntegrity) throw new HiveException(HttpStatus.UNPROCESSABLE_ENTITY, "INTEGRITY_REQUIRED", "artifact.integrity (SRI) is required");
    if (integrity != null && !SRI.matcher(integrity).matches()) throw invalid("artifact.integrity must be a sha256/384/512 SRI value");
    JsonNode routesNode = document.path("routes");
    if (!routesNode.isArray() || routesNode.size() > 200) throw invalid("routes must be an array of at most 200 entries");
    List<Route> routes = new ArrayList<>();
    Set<String> keys = new HashSet<>(), paths = new HashSet<>();
    for (JsonNode route : routesNode) {
      requireObject(route, "route");
      String key = text(route, "key", true), path = text(route, "path", true), access = text(route, "access", true);
      if (!ROUTE_KEY.matcher(key).matches()) throw invalid("Route key " + key + " must match " + ROUTE_KEY.pattern());
      if (!ROUTE_PATH.matcher(path).matches() || path.length() > 512) throw invalid("Route " + key + " path must be an absolute path of literal, :param segments and an optional trailing /*");
      if (!ACCESS.contains(access)) throw invalid("Route " + key + " access must be PUBLIC, HYBRID or AUTHENTICATED");
      if (!keys.add(key)) throw invalid("Duplicate route key " + key);
      if (!paths.add(path)) throw invalid("Duplicate route path " + path);
      String resource = text(route, "resource", false), action = text(route, "action", false);
      if ((resource == null) != (action == null)) throw invalid("Route " + key + " must declare both resource and action or neither");
      if ("PUBLIC".equals(access) && resource != null) throw invalid("PUBLIC route " + key + " cannot require a resource permission; use HYBRID or AUTHENTICATED");
      JsonNode nav = route.path("navigation");
      Navigation navigation = nav.isObject() ? new Navigation(text(nav, "label", true), nav.has("order") ? nav.path("order").asInt() : null, text(nav, "icon", false)) : null;
      routes.add(new Route(key, path, access, resource, action, navigation));
    }
    String isolation = text(document, "styleIsolation", false);
    if (isolation != null && !Set.of("SCOPED", "SHADOW_DOM").contains(isolation)) throw invalid("styleIsolation must be SCOPED or SHADOW_DOM");
    String display = text(document, "displayName", true);
    return new MicroFrontendManifest(text(document, "schemaVersion", true), text(document, "manifestVersion", true), text(document, "contractVersion", true),
        text(document, "runtimeVersion", true), text(document, "applicationKey", true), text(document, "moduleKey", true), display,
        text(document, "resourceManifestVersion", false), new Artifact(url, integrity, format), routes, isolation == null ? "SCOPED" : isolation, warnings,
        checksum(document), document);
  }

  /** Same-origin absolute paths (served by the deployment) or absolute URLs accepted by the artifact network policy. */
  String validateArtifactUrl(String url) {
    if (url.startsWith("/") && !url.startsWith("//")) {
      String lower = url.toLowerCase();
      if (url.length() > 1024 || !lower.endsWith(".js") || url.contains("\\") || url.contains("?") || url.contains("#") || url.contains("/../")
          || url.contains("/./") || lower.contains("%2e") || lower.contains("%2f") || lower.contains("%5c"))
        throw invalid("artifact.url path must be a normalized same-origin .js path");
      return url;
    }
    try {
      return artifactPolicy.validateConfigured(url, UiArtifactUriPolicy.ArtifactType.REMOTE_ENTRY, "artifact.url").toString();
    } catch (IllegalArgumentException rejected) {
      throw new HiveException(HttpStatus.UNPROCESSABLE_ENTITY, "ARTIFACT_LOCATION_REJECTED", rejected.getMessage());
    }
  }

  public static String checksum(JsonNode document) {
    try {
      Object canonical = CANONICAL.convertValue(document, Object.class);
      byte[] bytes = CANONICAL.writeValueAsString(canonical).getBytes(StandardCharsets.UTF_8);
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    } catch (Exception e) {
      throw new IllegalStateException("Unable to checksum manifest", e);
    }
  }

  private static void requireObject(JsonNode node, String label) {
    if (node == null || !node.isObject()) throw invalid(label + " must be a JSON object");
  }

  private static String text(JsonNode node, String field, boolean required) {
    JsonNode value = node.get(field);
    if (value == null || value.isNull()) {
      if (required) throw invalid("Field '" + field + "' is required");
      return null;
    }
    if (!value.isTextual() || value.asText().isBlank() || value.asText().length() > 2048) throw invalid("Field '" + field + "' must be a non-empty string");
    return value.asText();
  }

  private static HiveException invalid(String message) {
    return new HiveException(HttpStatus.UNPROCESSABLE_ENTITY, "MANIFEST_INVALID", message);
  }
}
