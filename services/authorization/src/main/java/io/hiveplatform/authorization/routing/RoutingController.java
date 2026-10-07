package io.hiveplatform.authorization.routing;

import io.hiveplatform.authorization.admin.PlatformAccess;
import io.hiveplatform.authorization.admin.PlatformAccess.Relation;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@PlatformAccess(Relation.INTEGRATION_ADMIN)
class RoutingController {
  record ResolveRequest(String method, String path, UUID userId) {}

  private final RoutingAdministration routing;
  private final RouteResolver resolver;
  private final ApiLog apiLog;

  RoutingController(RoutingAdministration routing, RouteResolver resolver, ApiLog apiLog) {
    this.routing = routing;
    this.resolver = resolver;
    this.apiLog = apiLog;
  }

  @GetMapping("/admin/service-targets") List<RoutingAdministration.Target> targets() { return routing.targets(); }
  @PostMapping("/admin/service-targets") RoutingAdministration.Target createTarget(@RequestBody RoutingAdministration.TargetRequest r) { return routing.saveTarget(r, true); }
  @GetMapping("/admin/service-targets/{key}") RoutingAdministration.Target target(@PathVariable String key) { return routing.target(key); }

  @PutMapping("/admin/service-targets/{key}")
  RoutingAdministration.Target updateTarget(@PathVariable String key, @RequestBody RoutingAdministration.TargetRequest r) {
    return routing.saveTarget(new RoutingAdministration.TargetRequest(key, r.displayName(), r.baseUrl(), r.connectTimeoutMs(), r.responseTimeoutMs(), r.maxRequestBytes(),
        r.maxResponseBytes(), r.archived(), r.revision()), false);
  }

  @GetMapping("/admin/legacy-auth-profiles") List<RoutingAdministration.LegacyProfile> profiles() { return routing.legacyProfiles(); }
  @PostMapping("/admin/legacy-auth-profiles") RoutingAdministration.LegacyProfile createProfile(@RequestBody RoutingAdministration.LegacyProfileRequest r) { return routing.saveLegacyProfile(r, true); }

  @PutMapping("/admin/legacy-auth-profiles/{key}")
  RoutingAdministration.LegacyProfile updateProfile(@PathVariable String key, @RequestBody RoutingAdministration.LegacyProfileRequest r) {
    return routing.saveLegacyProfile(new RoutingAdministration.LegacyProfileRequest(key, r.targetKey(), r.tokenEndpointPath(), r.requestFormat(), r.credentialReference(),
        r.tokenPointer(), r.expiresInPointer(), r.tokenTypePointer(), r.scheme(), r.scope(), r.audience(), r.expirySkewSeconds(), r.maxResponseBytes(), r.archived(), r.revision()), false);
  }

  @GetMapping("/admin/proxy-routes") List<RoutingAdministration.Route> routes() { return routing.routes(); }
  @PostMapping("/admin/proxy-routes") RoutingAdministration.Route createRoute(@RequestBody RoutingAdministration.RouteRequest r) { return routing.saveRoute(r, true); }
  @GetMapping("/admin/proxy-routes/{key}") RoutingAdministration.Route route(@PathVariable String key) { return routing.route(key); }

  @PutMapping("/admin/proxy-routes/{key}")
  RoutingAdministration.Route updateRoute(@PathVariable String key, @RequestBody RoutingAdministration.RouteRequest r) {
    return routing.saveRoute(new RoutingAdministration.RouteRequest(key, r.applicationKey(), r.moduleKey(), r.pathPrefix(), r.targetKey(), r.authentication(),
        r.legacyProfileKey(), r.upstreamBasePath(), r.stripPrefix(), r.priority(), r.archived(), r.revision()), false);
  }

  @GetMapping("/admin/proxy-routes/{key}/operations") List<RoutingAdministration.Operation> operations(@PathVariable String key) { return routing.operations(key); }
  @PostMapping("/admin/proxy-routes/{key}/operations") RoutingAdministration.Operation createOperation(@PathVariable String key, @RequestBody RoutingAdministration.OperationRequest r) { return routing.saveOperation(key, r, true); }

  @PutMapping("/admin/proxy-routes/{key}/operations/{operation}")
  RoutingAdministration.Operation updateOperation(@PathVariable String key, @PathVariable String operation, @RequestBody RoutingAdministration.OperationRequest r) {
    return routing.saveOperation(key, new RoutingAdministration.OperationRequest(operation, r.method(), r.pathPattern(), r.access(), r.resourceKey(), r.action(), r.archived(), r.revision()), false);
  }

  @GetMapping("/admin/routing/preview") Map<String, Object> preview(@RequestParam String method, @RequestParam String path) { return resolver.preview(method, path); }

  @GetMapping("/admin/api-logs")
  @PlatformAccess(value = Relation.AUDITOR, read = Relation.AUDITOR)
  List<ApiLog.Row> apiLogs(@RequestParam(required = false) String routeKey, @RequestParam(required = false) String outcome, @RequestParam(required = false) String correlationId,
      @RequestParam(required = false) Instant before, @RequestParam(defaultValue = "100") int limit) {
    return apiLog.search(routeKey, outcome, correlationId, before, limit);
  }

  @PostMapping("/internal/routing/resolve") RouteResolver.Resolved resolve(@RequestBody ResolveRequest request) { return resolver.resolve(request.method(), request.path(), request.userId()); }
  @PostMapping("/internal/observability/audit") Map<String, Integer> events(@RequestBody List<ApiLog.BffEvent> events) { return Map.of("recorded", apiLog.recordEvents(events)); }
  @PostMapping("/internal/observability/api-logs") Map<String, Integer> record(@RequestBody List<ApiLog.Entry> entries) { return Map.of("recorded", apiLog.record(entries)); }
}
