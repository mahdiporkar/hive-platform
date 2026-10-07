package io.hiveplatform.authorization.manifest;

import com.fasterxml.jackson.databind.JsonNode;
import io.hiveplatform.authorization.admin.PlatformAccess;
import io.hiveplatform.authorization.admin.PlatformAccess.Relation;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@PlatformAccess(Relation.OPERATOR)
class ModuleController {
  record FetchRequest(String url) {}
  record ValidateRequest(String kind, JsonNode document) {}

  private final ModuleRegistry registry;
  private final ManifestDocuments documents;
  private final RuntimeCatalog runtime;

  ModuleController(ModuleRegistry registry, ManifestDocuments documents, RuntimeCatalog runtime) {
    this.registry = registry;
    this.documents = documents;
    this.runtime = runtime;
  }

  @GetMapping("/admin/modules") List<ModuleRegistry.Module> modules(@RequestParam(required = false) String applicationKey) { return registry.modules(applicationKey); }
  @PostMapping("/admin/modules") ModuleRegistry.Module create(@RequestBody ModuleRegistry.NewModule module) { return registry.create(module); }
  @GetMapping("/admin/modules/{module}") ModuleRegistry.Module module(@PathVariable String module) { return registry.module(module); }
  @PutMapping("/admin/modules/{module}") ModuleRegistry.Module update(@PathVariable String module, @RequestBody ModuleRegistry.ModuleUpdate update) { return registry.update(module, update); }

  @GetMapping("/admin/modules/{module}/resource-manifests") List<ModuleRegistry.ResourceRevision> resourceRevisions(@PathVariable String module) { return registry.resourceRevisions(module); }

  @PostMapping("/admin/modules/{module}/resource-manifests")
  ResponseEntity<ModuleRegistry.ImportResult<ModuleRegistry.ResourceRevision>> importResources(@PathVariable String module, @RequestBody JsonNode document) {
    var result = registry.importResourceManifest(module, document, "UPLOAD", null);
    return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK).body(result);
  }

  @PostMapping("/admin/modules/{module}/resource-manifests/fetch")
  ResponseEntity<ModuleRegistry.ImportResult<ModuleRegistry.ResourceRevision>> fetchResources(@PathVariable String module, @RequestBody(required = false) FetchRequest request) {
    var result = registry.fetchResourceManifest(module, request == null ? null : request.url());
    return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK).body(result);
  }

  @GetMapping("/admin/modules/{module}/resource-manifests/{version}") ModuleRegistry.ResourceRevision resourceRevision(@PathVariable String module, @PathVariable String version) { return registry.resourceRevision(module, version); }
  @GetMapping("/admin/modules/{module}/resource-manifests/{version}/diff") ModuleRegistry.Diff diff(@PathVariable String module, @PathVariable String version) { return registry.diff(module, version); }
  @PostMapping("/admin/modules/{module}/resource-manifests/{version}/publish") ModuleRegistry.ResourceRevision publish(@PathVariable String module, @PathVariable String version) { return registry.publish(module, version); }
  @PostMapping("/admin/modules/{module}/resource-manifests/{version}/activate") ModuleRegistry.ResourceRevision activate(@PathVariable String module, @PathVariable String version) { return registry.activate(module, version); }

  @DeleteMapping("/admin/modules/{module}/resource-manifests/{version}")
  ResponseEntity<Void> discard(@PathVariable String module, @PathVariable String version) {
    registry.discard(module, version);
    return ResponseEntity.noContent().build();
  }

  @GetMapping("/admin/modules/{module}/artifacts") List<ModuleRegistry.ArtifactRevision> artifacts(@PathVariable String module) { return registry.artifacts(module); }

  @PostMapping("/admin/modules/{module}/artifacts")
  ResponseEntity<ModuleRegistry.ImportResult<ModuleRegistry.ArtifactRevision>> registerArtifact(@PathVariable String module, @RequestBody JsonNode document) {
    var result = registry.registerArtifact(module, document, "UPLOAD", null);
    return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK).body(result);
  }

  @PostMapping("/admin/modules/{module}/artifacts/fetch")
  ResponseEntity<ModuleRegistry.ImportResult<ModuleRegistry.ArtifactRevision>> fetchArtifact(@PathVariable String module, @RequestBody(required = false) FetchRequest request) {
    var result = registry.fetchArtifact(module, request == null ? null : request.url());
    return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK).body(result);
  }

  @PostMapping("/admin/modules/{module}/artifacts/{version}/activate") ModuleRegistry.Module activateArtifact(@PathVariable String module, @PathVariable String version) { return registry.activateArtifact(module, version); }
  @PostMapping("/admin/modules/{module}/deactivate") ModuleRegistry.Module deactivate(@PathVariable String module) { return registry.deactivate(module); }
  @GetMapping("/admin/modules/{module}/releases") List<ModuleRegistry.Release> releases(@PathVariable String module) { return registry.releases(module); }
  @GetMapping("/admin/modules/{module}/navigation") List<ModuleRegistry.Overlay> overlays(@PathVariable String module) { return registry.overlays(module); }

  @PutMapping("/admin/modules/{module}/navigation/{route}")
  ModuleRegistry.Overlay overlay(@PathVariable String module, @PathVariable String route, @RequestBody ModuleRegistry.Overlay overlay) { return registry.overlay(module, route, overlay); }

  /** Validation without side effects, e.g. for CI pipelines of solution teams. */
  @PostMapping("/admin/manifests/validate")
  @PlatformAccess(Relation.READER)
  Map<String, Object> validate(@RequestBody ValidateRequest request) {
    if ("RESOURCE".equals(request.kind())) {
      var manifest = documents.resourceManifest(request.document());
      return Map.of("valid", true, "checksum", manifest.checksum(), "resources", manifest.resources().size());
    }
    var manifest = documents.microFrontendManifest(request.document());
    return Map.of("valid", true, "checksum", manifest.checksum(), "routes", manifest.routes().size(), "warnings", manifest.warnings());
  }

  @GetMapping("/admin/runtime/catalog")
  @PlatformAccess(value = Relation.READER, read = Relation.READER)
  RuntimeCatalog.Snapshot adminSnapshot() { return runtime.snapshot(); }

  @GetMapping("/internal/runtime/catalog") RuntimeCatalog.Snapshot snapshot() { return runtime.snapshot(); }
}
