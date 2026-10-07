package io.hiveplatform.authorization.manifest;

import io.hiveplatform.authorization.catalog.ResourceCatalog;
import io.hiveplatform.authorization.graph.AuthorizationEngine;
import io.hiveplatform.authorization.graph.Graph;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Runtime-plane context projections. The public projection contains only modules with anonymous-capable routes and
 * never identities, permissions, targets or secrets. The authenticated projection filters routes by server-side
 * decisions and adds the user's effective permissions for the resources of the applications it can use.
 */
@Service
public class RuntimeContexts {
  public record PublicContext(long revision, List<RuntimeCatalog.RuntimeApplication> applications, List<RuntimeCatalog.RuntimeModule> modules) {}
  public record UserContext(long revision, List<RuntimeCatalog.RuntimeApplication> applications, List<RuntimeCatalog.RuntimeModule> modules,
      Map<String, List<String>> permissions, List<String> platformRoles) {}

  private static final int MAX_PERMISSION_CHECKS = 2000;
  private final RuntimeCatalog catalog;
  private final ResourceCatalog resources;
  private final AuthorizationEngine engine;

  public RuntimeContexts(RuntimeCatalog catalog, ResourceCatalog resources, AuthorizationEngine engine) {
    this.catalog = catalog;
    this.resources = resources;
    this.engine = engine;
  }

  public PublicContext publicContext() {
    var snapshot = catalog.snapshot();
    List<RuntimeCatalog.RuntimeModule> modules = new ArrayList<>();
    for (var module : snapshot.modules()) {
      var routes = module.routes().stream().filter(r -> !"AUTHENTICATED".equals(r.access())).toList();
      if (!routes.isEmpty()) modules.add(withRoutes(module, routes));
    }
    var keys = modules.stream().map(RuntimeCatalog.RuntimeModule::applicationKey).collect(java.util.stream.Collectors.toSet());
    return new PublicContext(snapshot.revision(), snapshot.applications().stream().filter(a -> keys.contains(a.key())).toList(), modules);
  }

  public UserContext userContext(UUID userId) {
    var snapshot = catalog.snapshot();
    // Candidate permissions: every active declared action of applications that have active modules.
    List<AuthorizationEngine.Check> checks = new ArrayList<>();
    Set<String> applications = new LinkedHashSet<>();
    snapshot.modules().forEach(m -> applications.add(m.applicationKey()));
    for (String application : applications) {
      for (var resource : resources.list(application, false)) {
        checks.add(new AuthorizationEngine.Check(application, resource.key(), Graph.MANAGE));
        for (var action : resource.actions()) if (!action.archived()) checks.add(new AuthorizationEngine.Check(application, resource.key(), action.key()));
        if (checks.size() >= MAX_PERMISSION_CHECKS) break;
      }
    }
    Map<String, List<String>> permissions = new LinkedHashMap<>();
    for (var decision : engine.check(userId, checks.subList(0, Math.min(checks.size(), MAX_PERMISSION_CHECKS))))
      if (decision.allowed()) permissions.computeIfAbsent(decision.applicationKey() + ":" + decision.resourceKey(), k -> new ArrayList<>()).add(decision.action());
    List<RuntimeCatalog.RuntimeModule> modules = new ArrayList<>();
    for (var module : snapshot.modules()) {
      var routes = module.routes().stream().filter(route -> route.resource() == null || allowed(permissions, module.applicationKey(), route.resource(), route.action())).toList();
      // Signed-in users keep everything anonymous visitors can open, plus the protected routes they are allowed.
      if (!routes.isEmpty()) modules.add(withRoutes(module, routes));
    }
    var keys = modules.stream().map(RuntimeCatalog.RuntimeModule::applicationKey).collect(java.util.stream.Collectors.toSet());
    List<String> platformRoles = java.util.Arrays.stream(Graph.PlatformRole.values()).filter(role -> engine.platform(userId, role)).map(Enum::name).toList();
    return new UserContext(snapshot.revision(), snapshot.applications().stream().filter(a -> keys.contains(a.key())).toList(), modules, permissions, platformRoles);
  }

  private static boolean allowed(Map<String, List<String>> permissions, String application, String resource, String action) {
    var actions = permissions.getOrDefault(application + ":" + resource, List.of());
    return actions.contains(action) || actions.contains(Graph.MANAGE);
  }

  private static RuntimeCatalog.RuntimeModule withRoutes(RuntimeCatalog.RuntimeModule module, List<RuntimeCatalog.RuntimeRoute> routes) {
    return new RuntimeCatalog.RuntimeModule(module.applicationKey(), module.moduleKey(), module.displayName(), module.schemaVersion(), module.manifestVersion(),
        module.contractVersion(), module.runtimeVersion(), module.artifact(), module.styleIsolation(), routes);
  }
}
