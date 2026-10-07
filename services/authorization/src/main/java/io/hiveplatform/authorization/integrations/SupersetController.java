package io.hiveplatform.authorization.integrations;

import io.hiveplatform.authorization.admin.PlatformAccess;
import io.hiveplatform.authorization.admin.PlatformAccess.Relation;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
@PlatformAccess(Relation.INTEGRATION_ADMIN)
class SupersetController {
  record ResolveRequest(String integration, String method, String path, String hintType, String hintId, UUID userId) {}
  record Health(String status) {}

  private final SupersetIntegrations integrations;

  SupersetController(SupersetIntegrations integrations) { this.integrations = integrations; }

  @GetMapping("/admin/integrations/superset") List<SupersetIntegrations.Integration> list() { return integrations.integrations(); }
  @PostMapping("/admin/integrations/superset") SupersetIntegrations.Integration create(@RequestBody SupersetIntegrations.IntegrationRequest r) { return integrations.create(r); }
  @PutMapping("/admin/integrations/superset/{key}") SupersetIntegrations.Integration update(@PathVariable String key, @RequestBody SupersetIntegrations.IntegrationRequest r) { return integrations.update(key, r); }
  @GetMapping("/admin/integrations/superset/{key}/assets") List<SupersetIntegrations.Asset> assets(@PathVariable String key) { return integrations.assets(key); }
  @PostMapping("/admin/integrations/superset/{key}/assets") SupersetIntegrations.Asset register(@PathVariable String key, @RequestBody SupersetIntegrations.AssetRequest r) { return integrations.registerAsset(key, r); }

  @PostMapping("/internal/integrations/superset/resolve")
  SupersetIntegrations.Resolution resolve(@RequestBody ResolveRequest r) { return integrations.resolve(r.integration(), r.method(), r.path(), r.hintType(), r.hintId(), r.userId()); }

  @PostMapping("/internal/integrations/superset/{key}/health")
  ResponseEntity<Map<String, String>> health(@PathVariable String key, @RequestBody Health health) {
    integrations.recordHealth(key, health.status());
    return ResponseEntity.ok(Map.of("status", health.status()));
  }
}
