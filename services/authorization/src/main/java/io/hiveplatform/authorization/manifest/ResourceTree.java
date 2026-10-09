package io.hiveplatform.authorization.manifest;

import io.hiveplatform.authorization.catalog.ResourceCatalog;
import io.hiveplatform.authorization.catalog.ResourceType;
import io.hiveplatform.authorization.graph.Graph;
import io.hiveplatform.spring.HiveException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * Administrative read model of an application's resource hierarchy: persisted catalog nodes enriched with their owning
 * module and its definition mode, the active manifest revision, grant counts, editability under the governance rules
 * and the runtime routes that reference each node. It reads the catalog, it never keeps a second registry.
 */
@Service
public class ResourceTree {
  public record RouteRef(String moduleKey, String artifactVersion, String routeKey, String path, String access, String resourceKey, String action,
      boolean navigation, String navigationLabel, String status) {}
  public record Node(UUID id, String key, String type, String parentKey, String displayName, String origin, String ownerModuleKey, String ownerDefinitionMode,
      String manifestVersion, boolean archived, long revision, List<ResourceCatalog.ActionView> actions, long grantCount, String editability,
      List<String> allowedChildTypes, List<RouteRef> routes) {}
  public record ModuleSummary(String moduleKey, String displayName, String definitionMode, String activeArtifactVersion, String activeResourceVersion,
      boolean archived, String entryUrl) {}
  public record Tree(String applicationKey, List<ModuleSummary> modules, List<Node> resources, List<RouteRef> routes, List<String> unreferencedPages) {}

  private final JdbcClient db;
  private final ResourceCatalog catalog;
  private final ModuleRegistry registry;
  private final ManifestDocuments documents;

  public ResourceTree(JdbcClient db, ResourceCatalog catalog, ModuleRegistry registry, ManifestDocuments documents) {
    this.db = db;
    this.catalog = catalog;
    this.registry = registry;
    this.documents = documents;
  }

  public Tree tree(String applicationKey, boolean includeArchived) {
    UUID app = catalog.applicationId(applicationKey);
    var modules = registry.modules(applicationKey);
    Map<String, ModuleRegistry.Module> byKey = new HashMap<>();
    modules.forEach(m -> byKey.put(m.moduleKey(), m));
    var resources = catalog.list(applicationKey, true);
    Map<String, ResourceCatalog.ResourceView> active = new HashMap<>();
    resources.stream().filter(r -> !r.archived()).forEach(r -> active.put(r.key(), r));
    List<RouteRef> routes = new ArrayList<>();
    for (var module : modules) if (!module.archived() && module.activeArtifactVersion() != null) routes.addAll(routes(module, module.activeArtifactVersion(), active));
    Map<UUID, Long> grants = new HashMap<>();
    db.sql("select g.resource_id, count(*) as n from permission_grant g join resource r on r.id = g.resource_id where r.application_id = ? and g.revoked_at is null group by g.resource_id")
        .param(app).query((rs, n) -> grants.put(rs.getObject("resource_id", UUID.class), rs.getLong("n"))).list();
    List<Node> nodes = new ArrayList<>();
    Set<String> referenced = new HashSet<>();
    routes.forEach(r -> { if (r.resourceKey() != null) referenced.add(r.resourceKey()); });
    for (var resource : resources) {
      if (resource.archived() && !includeArchived) continue;
      var owner = resource.ownerModuleKey() == null ? null : byKey.get(resource.ownerModuleKey());
      ResourceType type = ResourceType.parse(resource.type());
      List<String> childTypes = Arrays.stream(ResourceType.values()).filter(t -> t != ResourceType.APPLICATION && t.acceptsParent(type)).map(Enum::name).toList();
      nodes.add(new Node(resource.id(), resource.key(), resource.type(), resource.parentKey(), resource.displayName(), resource.origin(), resource.ownerModuleKey(),
          owner == null ? null : owner.definitionMode(), "MANIFEST".equals(resource.origin()) && owner != null ? owner.activeResourceVersion() : null,
          resource.archived(), resource.revision(), resource.actions(), grants.getOrDefault(resource.id(), 0L), editability(resource, owner), childTypes,
          routes.stream().filter(r -> resource.key().equals(r.resourceKey())).toList()));
    }
    List<String> unreferenced = resources.stream().filter(r -> !r.archived() && "PAGE".equals(r.type()) && !referenced.contains(r.key())).map(ResourceCatalog.ResourceView::key).toList();
    return new Tree(applicationKey, modules.stream().map(m -> new ModuleSummary(m.moduleKey(), m.displayName(), m.definitionMode(), m.activeArtifactVersion(),
        m.activeResourceVersion(), m.archived(), m.entryUrl())).toList(), nodes, routes, unreferenced);
  }

  /** Routes of one artifact version (default: the active one) with the status of their resource reference. */
  public List<RouteRef> moduleRoutes(String moduleKey, String version) {
    var module = registry.module(moduleKey);
    String selected = version == null || version.isBlank() ? module.activeArtifactVersion() : version;
    if (selected == null) return List.of();
    Map<String, ResourceCatalog.ResourceView> active = new HashMap<>();
    catalog.list(module.applicationKey(), false).forEach(r -> active.put(r.key(), r));
    return routes(module, selected, active);
  }

  private List<RouteRef> routes(ModuleRegistry.Module module, String version, Map<String, ResourceCatalog.ResourceView> resources) {
    var artifact = registry.artifacts(module.moduleKey()).stream().filter(a -> a.manifestVersion().equals(version)).findFirst()
        .orElseThrow(() -> HiveException.notFound("Unknown artifact version " + version));
    List<RouteRef> result = new ArrayList<>();
    for (var route : documents.microFrontendManifest(artifact.document()).routes()) {
      String status;
      if (route.resource() == null) status = "PUBLIC".equals(route.access()) ? "OK" : "NO_RESOURCE";
      else {
        var resource = resources.get(route.resource());
        status = resource == null ? "RESOURCE_MISSING"
            : Graph.MANAGE.equals(route.action()) || resource.actions().stream().anyMatch(a -> !a.archived() && a.key().equals(route.action())) ? "OK" : "ACTION_UNDECLARED";
      }
      result.add(new RouteRef(module.moduleKey(), version, route.key(), route.path(), route.access(), route.resource(), route.action(), route.navigation() != null,
          route.navigation() == null ? null : route.navigation().label(), status));
    }
    return result;
  }

  /**
   * MANUAL: editable. SYSTEM: the application root (children only). Manifest-owned nodes change only through a new
   * manifest revision; unless the owning module is MANIFEST-defined they still accept manual children (the same rule
   * {@link ResourceCatalog#createManual} enforces).
   */
  private static String editability(ResourceCatalog.ResourceView resource, ModuleRegistry.Module owner) {
    return switch (resource.origin()) {
      case "MANUAL" -> "MANUAL";
      case "SYSTEM" -> "SYSTEM";
      default -> owner != null && "MANIFEST".equals(owner.definitionMode()) ? "MANIFEST_LOCKED" : "MANIFEST_EXTENSIBLE";
    };
  }
}
