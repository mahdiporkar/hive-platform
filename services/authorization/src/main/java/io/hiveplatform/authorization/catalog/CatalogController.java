package io.hiveplatform.authorization.catalog;

import io.hiveplatform.authorization.admin.PlatformAccess;
import io.hiveplatform.authorization.admin.PlatformAccess.Relation;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/admin/applications")
@PlatformAccess(Relation.OPERATOR)
public class CatalogController {
  record ApplicationUpdate(String displayName, Boolean archived, long revision) {}
  record ResourceUpdate(String type, String parentKey, String displayName, List<ResourceCatalog.ActionSpec> actions, long revision) {}
  record Archive(boolean archived, long revision) {}

  private final Applications applications;
  private final ResourceCatalog catalog;

  CatalogController(Applications applications, ResourceCatalog catalog) {
    this.applications = applications;
    this.catalog = catalog;
  }

  @GetMapping List<Applications.Application> list() { return applications.list(); }
  @PostMapping Applications.Application create(@RequestBody Applications.Definition definition) { return applications.create(definition); }
  @GetMapping("/{key}") Applications.Application get(@PathVariable String key) { return applications.get(key); }

  @PutMapping("/{key}")
  Applications.Application update(@PathVariable String key, @RequestBody ApplicationUpdate update) {
    return applications.update(key, update.displayName(), update.archived(), update.revision());
  }

  @GetMapping("/{key}/resources")
  List<ResourceCatalog.ResourceView> resources(@PathVariable String key, @RequestParam(defaultValue = "false") boolean includeArchived) {
    return catalog.list(key, includeArchived);
  }

  @PostMapping("/{key}/resources")
  ResourceCatalog.ResourceView createResource(@PathVariable String key, @RequestBody ResourceCatalog.ResourceNode node) {
    return catalog.createManual(key, node);
  }

  @PutMapping("/{key}/resources/{resource}")
  ResourceCatalog.ResourceView updateResource(@PathVariable String key, @PathVariable String resource, @RequestBody ResourceUpdate update) {
    return catalog.updateManual(key, resource, new ResourceCatalog.ResourceNode(resource, update.type(), update.parentKey(), update.displayName(), update.actions()), update.revision());
  }

  @PostMapping("/{key}/resources/{resource}/archive")
  ResourceCatalog.ResourceView archive(@PathVariable String key, @PathVariable String resource, @RequestBody Archive archive) {
    catalog.setArchived(key, resource, archive.archived(), archive.revision());
    return catalog.get(key, resource);
  }
}
