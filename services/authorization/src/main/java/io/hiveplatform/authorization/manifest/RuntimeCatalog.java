package io.hiveplatform.authorization.manifest;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * Runtime-plane projection of the control plane: active modules of active applications with their published
 * micro-frontend manifest and navigation overlays applied. The runtime never reads administrative tables directly;
 * it consumes this versioned representation ({@code revision} increases on every relevant change).
 */
@Component
public class RuntimeCatalog {
  public record NavigationEntry(String label, Integer order, String icon) {}
  public record RuntimeRoute(String key, String path, String access, String resource, String action, NavigationEntry navigation) {}
  public record RuntimeModule(String applicationKey, String moduleKey, String displayName, String schemaVersion, String manifestVersion, String contractVersion,
      String runtimeVersion, Map<String, String> artifact, String styleIsolation, List<RuntimeRoute> routes) {}
  public record RuntimeApplication(String key, String displayName) {}
  public record Snapshot(long revision, List<RuntimeApplication> applications, List<RuntimeModule> modules) {}

  private final JdbcClient db;
  private final ObjectMapper json;
  private final ManifestDocuments documents;
  private final ModuleRegistry registry;

  public RuntimeCatalog(JdbcClient db, ObjectMapper json, ManifestDocuments documents, ModuleRegistry registry) {
    this.db = db;
    this.json = json;
    this.documents = documents;
    this.registry = registry;
  }

  public Snapshot snapshot() {
    long revision = registry.runtimeRevision();
    var applications = db.sql("select application_key, display_name from application where not archived order by application_key")
        .query((rs, n) -> new RuntimeApplication(rs.getString("application_key"), rs.getString("display_name"))).list();
    record Row(String app, String module, String name, String document, String overlays) {}
    var rows = db.sql("""
        select a.application_key, m.module_key, m.display_name, ar.document::text as document,
          coalesce((select json_agg(json_build_object('routeKey', o.route_key, 'label', o.label, 'order', o.sort_order, 'hidden', o.hidden))
                    from navigation_overlay o where o.micro_app_id = m.id)::text, '[]') as overlays
        from micro_app m join application a on a.id = m.application_id join artifact_revision ar on ar.id = m.active_artifact_id
        where not m.archived and not a.archived order by a.application_key, m.module_key""")
        .query((rs, n) -> new Row(rs.getString("application_key"), rs.getString("module_key"), rs.getString("display_name"), rs.getString("document"), rs.getString("overlays")))
        .list();
    List<RuntimeModule> modules = new ArrayList<>();
    for (var row : rows) {
      var manifest = documents.microFrontendManifest(read(row.document()));
      Map<String, JsonNode> overlays = new HashMap<>();
      read(row.overlays()).forEach(o -> overlays.put(o.path("routeKey").asText(), o));
      List<RuntimeRoute> routes = new ArrayList<>();
      for (var route : manifest.routes()) {
        JsonNode overlay = overlays.get(route.key());
        NavigationEntry navigation = null;
        if (route.navigation() != null || (overlay != null && overlay.hasNonNull("label"))) {
          String label = overlay != null && overlay.hasNonNull("label") ? overlay.get("label").asText() : route.navigation() == null ? route.key() : route.navigation().label();
          Integer order = overlay != null && overlay.hasNonNull("order") ? Integer.valueOf(overlay.get("order").asInt()) : route.navigation() == null ? null : route.navigation().order();
          navigation = new NavigationEntry(label, order, route.navigation() == null ? null : route.navigation().icon());
        }
        if (overlay != null && overlay.path("hidden").asBoolean(false)) navigation = null;
        routes.add(new RuntimeRoute(route.key(), route.path(), route.access(), route.resource(), route.action(), navigation));
      }
      routes.sort(Comparator.comparing((RuntimeRoute r) -> r.navigation() == null || r.navigation().order() == null ? Integer.MAX_VALUE : r.navigation().order()).thenComparing(RuntimeRoute::key));
      var artifact = new HashMap<String, String>();
      artifact.put("url", browserUrl(row.module(), manifest.manifestVersion(), manifest.artifact().url()));
      artifact.put("integrity", manifest.artifact().integrity());
      artifact.put("format", manifest.artifact().format());
      if (manifest.artifact().remoteName() != null) artifact.put("remoteName", manifest.artifact().remoteName());
      if (manifest.artifact().exposedModule() != null) artifact.put("exposedModule", manifest.artifact().exposedModule());
      modules.add(new RuntimeModule(row.app(), row.module(), row.name(), manifest.schemaVersion(), manifest.manifestVersion(), manifest.contractVersion(),
          manifest.runtimeVersion(), artifact, manifest.styleIsolation(), routes));
    }
    return new Snapshot(revision, applications, modules);
  }

  /**
   * Browsers load upstream (absolute) artifacts only through the BFF artifact gateway, from a stable same-origin and
   * version-scoped path; the registered network address never leaves the platform. Same-origin paths are unchanged.
   * Chunks and stylesheets the entry loads relative to itself resolve below the same gateway path.
   */
  static String browserUrl(String moduleKey, String version, String url) {
    if (!url.startsWith("http://") && !url.startsWith("https://")) return url;
    String path = java.net.URI.create(url).getRawPath();
    return GATEWAY_PREFIX + moduleKey + "/" + version + "/" + path.substring(path.lastIndexOf('/') + 1);
  }

  public static final String GATEWAY_PREFIX = "/api/mfe/";

  private JsonNode read(String value) {
    try {
      return json.readTree(value);
    } catch (java.io.IOException e) {
      throw new IllegalStateException(e);
    }
  }
}
