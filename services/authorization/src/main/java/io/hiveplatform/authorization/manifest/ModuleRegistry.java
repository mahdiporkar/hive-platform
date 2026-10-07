package io.hiveplatform.authorization.manifest;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.hiveplatform.artifacts.security.UiArtifactUriPolicy;
import io.hiveplatform.authorization.admin.Actor;
import io.hiveplatform.authorization.audit.AuditLog;
import io.hiveplatform.authorization.catalog.ResourceCatalog;
import io.hiveplatform.spring.HiveException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Module (Micro App) registry and manifest governance: fetch, import, validate, draft, diff, publish, version,
 * history and rollback of resource manifests, plus immutable artifact revisions and coordinated activation.
 */
@Service
public class ModuleRegistry {
  public record Module(UUID id, String applicationKey, String moduleKey, String displayName, String definitionMode, String mfManifestUrl,
      String resourceManifestUrl, String activeArtifactVersion, String activeResourceVersion, boolean archived, long revision, Instant createdAt) {}
  public record NewModule(String applicationKey, String moduleKey, String displayName, String definitionMode, String mfManifestUrl, String resourceManifestUrl) {}
  public record ModuleUpdate(String displayName, String definitionMode, String mfManifestUrl, String resourceManifestUrl, Boolean archived, long revision) {}
  public record ResourceRevision(UUID id, String moduleKey, String manifestVersion, String schemaVersion, String checksum, String status, String source,
      String sourceUrl, String createdBy, Instant createdAt, String publishedBy, Instant publishedAt, boolean active, JsonNode document) {}
  public record ArtifactRevision(UUID id, String moduleKey, String manifestVersion, String contractVersion, String runtimeVersion, String schemaVersion,
      String resourceManifestVersion, String artifactUrl, String integrity, String checksum, String createdBy, Instant createdAt, boolean active, JsonNode document) {}
  public record Change(String kind, String resourceKey, String detail) {}
  public record Diff(String moduleKey, String fromVersion, String toVersion, List<Change> changes, boolean conflicts) {}
  public record Release(UUID id, String action, String resourceVersion, String artifactVersion, JsonNode summary, String actor, Instant occurredAt) {}
  public record Overlay(String routeKey, String label, Integer order, boolean hidden, long revision) {}
  public record ImportResult<T>(T revision, boolean created, List<Compatibility.Diagnostic> warnings) {}

  private static final Pattern MODULE_KEY = Pattern.compile("[a-z][a-z0-9-]{1,79}");
  private static final Set<String> MODES = Set.of("MANIFEST", "MANUAL", "HYBRID");

  private final JdbcClient db;
  private final ObjectMapper json;
  private final ResourceCatalog catalog;
  private final ManifestDocuments documents;
  private final ManifestFetcher fetcher;
  private final UiArtifactUriPolicy policy;
  private final AuditLog audit;
  private final TransactionTemplate tx;

  public ModuleRegistry(JdbcClient db, ObjectMapper json, ResourceCatalog catalog, ManifestDocuments documents, ManifestFetcher fetcher,
      UiArtifactUriPolicy policy, AuditLog audit, TransactionTemplate tx) {
    this.db = db;
    this.json = json;
    this.catalog = catalog;
    this.documents = documents;
    this.fetcher = fetcher;
    this.policy = policy;
    this.audit = audit;
    this.tx = tx;
  }

  // ---- modules -----------------------------------------------------------------------------------------------

  public List<Module> modules(String applicationKey) {
    return db.sql("""
        select m.id, a.application_key, m.module_key, m.display_name, m.definition_mode, m.mf_manifest_url, m.resource_manifest_url,
               ar.manifest_version as artifact_version, rr.manifest_version as resource_version, m.archived, m.revision, m.created_at
        from micro_app m join application a on a.id = m.application_id
        left join artifact_revision ar on ar.id = m.active_artifact_id
        left join resource_manifest_revision rr on rr.id = m.active_resource_revision_id
        where (:app = '' or a.application_key = :app) order by a.application_key, m.module_key""")
        .param("app", applicationKey == null ? "" : applicationKey)
        .query((rs, n) -> new Module(rs.getObject("id", UUID.class), rs.getString("application_key"), rs.getString("module_key"), rs.getString("display_name"),
            rs.getString("definition_mode"), rs.getString("mf_manifest_url"), rs.getString("resource_manifest_url"), rs.getString("artifact_version"),
            rs.getString("resource_version"), rs.getBoolean("archived"), rs.getLong("revision"), rs.getTimestamp("created_at").toInstant()))
        .list();
  }

  public Module module(String moduleKey) {
    return modules(null).stream().filter(m -> m.moduleKey().equals(moduleKey)).findFirst().orElseThrow(() -> HiveException.notFound("Unknown module " + moduleKey));
  }

  @Transactional
  public Module create(NewModule request) {
    if (request == null || request.moduleKey() == null || !MODULE_KEY.matcher(request.moduleKey()).matches()) throw HiveException.invalid("moduleKey must match " + MODULE_KEY.pattern());
    if (request.displayName() == null || request.displayName().isBlank() || request.displayName().length() > 255) throw HiveException.invalid("displayName is required");
    String mode = request.definitionMode() == null ? "MANIFEST" : request.definitionMode();
    if (!MODES.contains(mode)) throw HiveException.invalid("definitionMode must be MANIFEST, MANUAL or HYBRID");
    UUID app = catalog.applicationId(request.applicationKey());
    if (db.sql("select archived from application where id = ?").param(app).query(Boolean.class).single()) throw HiveException.conflict("Application is archived");
    UUID id = UUID.randomUUID();
    if (db.sql("insert into micro_app(id, application_id, module_key, display_name, definition_mode, mf_manifest_url, resource_manifest_url) values (?, ?, ?, ?, ?, ?, ?) on conflict (module_key) do nothing")
        .params(id, app, request.moduleKey(), request.displayName(), mode, manifestUrl(request.mfManifestUrl()), manifestUrl(request.resourceManifestUrl())).update() != 1)
      throw HiveException.conflict("Module " + request.moduleKey() + " already exists");
    audit.success("module.registered", Map.of("application", request.applicationKey(), "module", request.moduleKey(), "definitionMode", mode));
    bumpRuntime();
    return module(request.moduleKey());
  }

  @Transactional
  public Module update(String moduleKey, ModuleUpdate update) {
    Module current = module(moduleKey);
    String mode = update.definitionMode() == null ? current.definitionMode() : update.definitionMode();
    if (!MODES.contains(mode)) throw HiveException.invalid("definitionMode must be MANIFEST, MANUAL or HYBRID");
    if (update.displayName() != null && (update.displayName().isBlank() || update.displayName().length() > 255)) throw HiveException.invalid("Invalid displayName");
    if (db.sql("""
        update micro_app set display_name = coalesce(?, display_name), definition_mode = ?, mf_manifest_url = ?, resource_manifest_url = ?,
          archived = coalesce(?, archived), revision = revision + 1, updated_at = now() where id = ? and revision = ?""")
        .params(update.displayName(), mode, manifestUrl(update.mfManifestUrl()), manifestUrl(update.resourceManifestUrl()), update.archived(), current.id(), update.revision())
        .update() != 1) throw HiveException.stale();
    audit.success(Boolean.TRUE.equals(update.archived()) ? "module.archived" : "module.updated", Map.of("module", moduleKey));
    bumpRuntime();
    return module(moduleKey);
  }

  private String manifestUrl(String url) {
    if (url == null || url.isBlank()) return null;
    try {
      return policy.validateConfigured(url, UiArtifactUriPolicy.ArtifactType.JSON_MANIFEST, "Manifest URL").toString();
    } catch (IllegalArgumentException rejected) {
      throw new HiveException(HttpStatus.UNPROCESSABLE_ENTITY, "MANIFEST_LOCATION_REJECTED", rejected.getMessage());
    }
  }

  // ---- resource manifests ------------------------------------------------------------------------------------

  public ImportResult<ResourceRevision> fetchResourceManifest(String moduleKey, String url) {
    Module module = module(moduleKey);
    String location = url == null || url.isBlank() ? module.resourceManifestUrl() : manifestUrl(url);
    if (location == null) throw HiveException.invalid("No resource manifest URL registered for " + moduleKey);
    return importResourceManifest(moduleKey, fetcher.fetch(location), "FETCH", location);
  }

  /** Validates and stores a DRAFT. Re-importing identical content is idempotent; a version never changes content. */
  public ImportResult<ResourceRevision> importResourceManifest(String moduleKey, JsonNode document, String source, String sourceUrl) {
    Module module = module(moduleKey);
    if ("MANUAL".equals(module.definitionMode())) throw new HiveException(HttpStatus.CONFLICT, "DEFINITION_MODE", "Module " + moduleKey + " is MANUAL; resources are managed through the resource catalog");
    var manifest = documents.resourceManifest(document);
    requireIdentity(module, manifest.applicationKey(), manifest.moduleKey());
    var existing = resourceRevisionRow(module.id(), manifest.manifestVersion());
    if (existing != null) {
      if (existing.checksum().equals(manifest.checksum())) return new ImportResult<>(existing, false, List.of());
      throw new HiveException(HttpStatus.CONFLICT, "MANIFEST_VERSION_IMMUTABLE", "Resource manifest version " + manifest.manifestVersion()
          + " already exists with different content (" + existing.status() + "); publish a new version" + ("DRAFT".equals(existing.status()) ? " or discard the draft" : ""));
    }
    dryRun(module, manifest);
    return tx.execute(status -> {
      UUID id = UUID.randomUUID();
      db.sql("insert into resource_manifest_revision(id, micro_app_id, manifest_version, schema_version, checksum, document, status, source, source_url, created_by) values (?, ?, ?, ?, ?, cast(? as jsonb), 'DRAFT', ?, ?, ?)")
          .params(id, module.id(), manifest.manifestVersion(), manifest.schemaVersion(), manifest.checksum(), document.toString(), source, sourceUrl, Actor.currentId()).update();
      audit.success("manifest.resources.imported", Map.of("module", moduleKey, "version", manifest.manifestVersion(), "checksum", manifest.checksum(), "source", source));
      return new ImportResult<>(resourceRevisionRow(module.id(), manifest.manifestVersion()), true, List.of());
    });
  }

  /** Runs the full catalog application inside a transaction that is always rolled back: exact validation, no side effects. */
  private void dryRun(Module module, ManifestDocuments.ResourceManifest manifest) {
    tx.executeWithoutResult(status -> {
      status.setRollbackOnly();
      catalog.applyModule(applicationId(module), module.moduleKey(), manifest.resources());
    });
  }

  public List<ResourceRevision> resourceRevisions(String moduleKey) {
    Module module = module(moduleKey);
    return db.sql("select * from resource_manifest_revision where micro_app_id = ? order by created_at").param(module.id())
        .query((rs, n) -> resourceRevision(rs, moduleKey, module)).list();
  }

  public ResourceRevision resourceRevision(String moduleKey, String version) {
    Module module = module(moduleKey);
    var row = resourceRevisionRow(module.id(), version);
    if (row == null) throw HiveException.notFound("Unknown resource manifest version " + version);
    return row;
  }

  @Transactional
  public void discard(String moduleKey, String version) {
    var revision = resourceRevision(moduleKey, version);
    if (!"DRAFT".equals(revision.status())) throw new HiveException(HttpStatus.CONFLICT, "MANIFEST_VERSION_IMMUTABLE", "Published revisions cannot be discarded");
    db.sql("delete from resource_manifest_revision where id = ?").param(revision.id()).update();
    audit.success("manifest.resources.discarded", Map.of("module", moduleKey, "version", version));
  }

  /** Difference between a revision and the module's currently materialized resources. */
  public Diff diff(String moduleKey, String version) {
    Module module = module(moduleKey);
    var revision = resourceRevision(moduleKey, version);
    var manifest = documents.resourceManifest(revision.document());
    Map<String, ResourceCatalog.ResourceView> current = new LinkedHashMap<>();
    catalog.list(module.applicationKey(), true).forEach(r -> current.put(r.key(), r));
    List<Change> changes = new ArrayList<>();
    boolean conflicts = false;
    for (var node : manifest.resources()) {
      var existing = current.get(node.key());
      if (existing == null) { changes.add(new Change("ADDED", node.key(), node.type())); continue; }
      if (!"MANIFEST".equals(existing.origin()) || !moduleKey.equals(existing.ownerModuleKey())) {
        conflicts = true;
        changes.add(new Change("CONFLICT", node.key(), "owned by " + (existing.ownerModuleKey() == null ? existing.origin() : existing.ownerModuleKey())));
        continue;
      }
      if (!existing.type().equals(node.type())) { conflicts = true; changes.add(new Change("CONFLICT", node.key(), "type " + existing.type() + " -> " + node.type())); }
      if (existing.archived()) changes.add(new Change("RESTORED", node.key(), null));
      if (!Objects.equals(existing.parentKey(), node.parentKey())) changes.add(new Change("MOVED", node.key(), existing.parentKey() + " -> " + node.parentKey()));
      if (!existing.displayName().equals(node.displayName())) changes.add(new Change("RENAMED", node.key(), existing.displayName() + " -> " + node.displayName()));
      var before = existing.actions().stream().filter(a -> !a.archived()).map(ResourceCatalog.ActionView::key).toList();
      var after = node.actions().stream().map(ResourceCatalog.ActionSpec::key).toList();
      after.stream().filter(a -> !before.contains(a)).forEach(a -> changes.add(new Change("ACTION_ADDED", node.key(), a)));
      before.stream().filter(a -> !after.contains(a)).forEach(a -> changes.add(new Change("ACTION_ARCHIVED", node.key(), a)));
    }
    var declared = manifest.resources().stream().map(ResourceCatalog.ResourceNode::key).toList();
    current.values().stream().filter(r -> "MANIFEST".equals(r.origin()) && moduleKey.equals(r.ownerModuleKey()) && !r.archived() && !declared.contains(r.key()))
        .forEach(r -> changes.add(new Change("ARCHIVED", r.key(), r.type())));
    return new Diff(moduleKey, module.activeResourceVersion(), version, changes, conflicts);
  }

  @Transactional
  public ResourceRevision publish(String moduleKey, String version) {
    Module module = lock(moduleKey);
    var revision = resourceRevision(moduleKey, version);
    if (!"DRAFT".equals(revision.status())) throw new HiveException(HttpStatus.CONFLICT, "MANIFEST_ALREADY_PUBLISHED", "Version " + version + " is already published; activate it instead");
    var archived = materialize(module, revision);
    db.sql("update resource_manifest_revision set status = 'PUBLISHED', published_by = ?, published_at = now() where id = ? and status = 'DRAFT'")
        .params(Actor.currentId(), revision.id()).update();
    db.sql("update micro_app set active_resource_revision_id = ?, updated_at = now() where id = ?").params(revision.id(), module.id()).update();
    release(module, "RESOURCES_PUBLISHED", revision.id(), null, Map.of("version", version, "archived", archived));
    audit.success("manifest.resources.published", Map.of("module", moduleKey, "version", version, "archived", archived));
    return resourceRevision(moduleKey, version);
  }

  /** Re-materializes an earlier (rollback) or later published revision. Published content is never modified. */
  @Transactional
  public ResourceRevision activate(String moduleKey, String version) {
    Module module = lock(moduleKey);
    var revision = resourceRevision(moduleKey, version);
    if (!"PUBLISHED".equals(revision.status())) throw new HiveException(HttpStatus.CONFLICT, "MANIFEST_NOT_PUBLISHED", "Only published revisions can be activated; publish the draft first");
    var archived = materialize(module, revision);
    db.sql("update micro_app set active_resource_revision_id = ?, updated_at = now() where id = ?").params(revision.id(), module.id()).update();
    var active = activeArtifact(module.id());
    if (active != null) validateRoutes(module, documents.microFrontendManifest(active.document()), revision.manifestVersion());
    release(module, "RESOURCES_ACTIVATED", revision.id(), null, Map.of("version", version, "previous", String.valueOf(module.activeResourceVersion()), "archived", archived));
    audit.success("manifest.resources.activated", Map.of("module", moduleKey, "version", version, "previous", String.valueOf(module.activeResourceVersion())));
    return resourceRevision(moduleKey, version);
  }

  private List<String> materialize(Module module, ResourceRevision revision) {
    if ("MANUAL".equals(module.definitionMode())) throw new HiveException(HttpStatus.CONFLICT, "DEFINITION_MODE", "Module is MANUAL");
    var manifest = documents.resourceManifest(revision.document());
    if (!manifest.checksum().equals(revision.checksum())) throw new IllegalStateException("Stored manifest checksum mismatch");
    var archived = catalog.applyModule(applicationId(module), module.moduleKey(), manifest.resources());
    bumpRuntime();
    return archived;
  }

  // ---- artifacts (micro-frontend manifests) ------------------------------------------------------------------

  public ImportResult<ArtifactRevision> fetchArtifact(String moduleKey, String url) {
    Module module = module(moduleKey);
    String location = url == null || url.isBlank() ? module.mfManifestUrl() : manifestUrl(url);
    if (location == null) throw HiveException.invalid("No micro-frontend manifest URL registered for " + moduleKey);
    return registerArtifact(moduleKey, fetcher.fetch(location), "FETCH", location);
  }

  @Transactional
  public ImportResult<ArtifactRevision> registerArtifact(String moduleKey, JsonNode document, String source, String sourceUrl) {
    Module module = module(moduleKey);
    var manifest = documents.microFrontendManifest(document);
    requireIdentity(module, manifest.applicationKey(), manifest.moduleKey());
    var existing = artifactRow(module.id(), manifest.manifestVersion());
    if (existing != null) {
      if (existing.checksum().equals(manifest.checksum())) return new ImportResult<>(existing, false, manifest.warnings());
      throw new HiveException(HttpStatus.CONFLICT, "MANIFEST_VERSION_IMMUTABLE", "Artifact version " + manifest.manifestVersion() + " already exists with different content; publish a new version");
    }
    db.sql("""
        insert into artifact_revision(id, micro_app_id, manifest_version, schema_version, contract_version, runtime_version, resource_manifest_version,
          artifact_url, integrity, checksum, document, source, source_url, created_by) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, cast(? as jsonb), ?, ?, ?)""")
        .params(UUID.randomUUID(), module.id(), manifest.manifestVersion(), manifest.schemaVersion(), manifest.contractVersion(), manifest.runtimeVersion(),
            manifest.resourceManifestVersion(), manifest.artifact().url(), manifest.artifact().integrity() == null ? "" : manifest.artifact().integrity(),
            manifest.checksum(), document.toString(), source, sourceUrl, Actor.currentId()).update();
    audit.success("manifest.artifact.registered", Map.of("module", moduleKey, "version", manifest.manifestVersion(), "contractVersion", manifest.contractVersion()));
    return new ImportResult<>(artifactRow(module.id(), manifest.manifestVersion()), true, manifest.warnings());
  }

  public List<ArtifactRevision> artifacts(String moduleKey) {
    Module module = module(moduleKey);
    return db.sql("select * from artifact_revision where micro_app_id = ? order by created_at").param(module.id())
        .query((rs, n) -> artifact(rs, moduleKey, module)).list();
  }

  /**
   * Activates an artifact version. When it names a resource manifest version, that published revision is activated in
   * the same transaction, so routes and the authorization vocabulary they reference always change together.
   */
  @Transactional
  public Module activateArtifact(String moduleKey, String version) {
    Module module = lock(moduleKey);
    if (module.archived()) throw HiveException.conflict("Module is archived");
    var artifact = artifactRow(module.id(), version);
    if (artifact == null) throw HiveException.notFound("Unknown artifact version " + version);
    var manifest = documents.microFrontendManifest(artifact.document());
    String resourceVersion = manifest.resourceManifestVersion();
    if (resourceVersion != null && !"MANUAL".equals(module.definitionMode())) {
      var revision = resourceRevisionRow(module.id(), resourceVersion);
      if (revision == null || !"PUBLISHED".equals(revision.status()))
        throw new HiveException(HttpStatus.CONFLICT, "RESOURCE_MANIFEST_NOT_PUBLISHED", "Artifact " + version + " requires published resource manifest " + resourceVersion);
      if (!revision.active()) {
        materialize(module, revision);
        db.sql("update micro_app set active_resource_revision_id = ? where id = ?").params(revision.id(), module.id()).update();
        release(module, "RESOURCES_ACTIVATED", revision.id(), artifact.id(), Map.of("version", resourceVersion, "reason", "artifact " + version));
      }
    }
    validateRoutes(module, manifest, resourceVersion);
    db.sql("update micro_app set active_artifact_id = ?, updated_at = now() where id = ?").params(artifact.id(), module.id()).update();
    release(module, "ARTIFACT_ACTIVATED", null, artifact.id(), Map.of("version", version, "previous", String.valueOf(module.activeArtifactVersion())));
    audit.success("manifest.artifact.activated", Map.of("module", moduleKey, "version", version, "previous", String.valueOf(module.activeArtifactVersion())));
    bumpRuntime();
    return module(moduleKey);
  }

  @Transactional
  public Module deactivate(String moduleKey) {
    Module module = lock(moduleKey);
    db.sql("update micro_app set active_artifact_id = null, updated_at = now() where id = ?").param(module.id()).update();
    release(module, "DEACTIVATED", null, null, Map.of("previous", String.valueOf(module.activeArtifactVersion())));
    audit.success("module.deactivated", Map.of("module", moduleKey));
    bumpRuntime();
    return module(moduleKey);
  }

  /** Routes may only reference active, declared actions of their application and may not collide with other active modules. */
  private void validateRoutes(Module module, ManifestDocuments.MicroFrontendManifest manifest, String resourceVersion) {
    Map<String, ResourceCatalog.ResourceView> resources = new LinkedHashMap<>();
    catalog.list(module.applicationKey(), false).forEach(r -> resources.put(r.key(), r));
    for (var route : manifest.routes()) {
      if (route.resource() == null) continue;
      var resource = resources.get(route.resource());
      boolean declared = resource != null && ("manage".equals(route.action()) || resource.actions().stream().anyMatch(a -> !a.archived() && a.key().equals(route.action())));
      if (!declared) throw new HiveException(HttpStatus.CONFLICT, "ROUTE_RESOURCE_UNDECLARED", "Route " + route.key() + " references " + route.resource() + "/" + route.action()
          + " which is not declared" + (resourceVersion == null ? "" : " by resource manifest " + resourceVersion));
    }
    var paths = manifest.routes().stream().map(ManifestDocuments.Route::path).toList();
    for (var other : db.sql("select m.module_key, ar.document from micro_app m join artifact_revision ar on ar.id = m.active_artifact_id where m.id <> ? and not m.archived")
        .param(module.id()).query((rs, n) -> Map.entry(rs.getString("module_key"), rs.getString("document"))).list()) {
      try {
        for (JsonNode route : json.readTree(other.getValue()).path("routes"))
          if (paths.contains(route.path("path").asText())) throw new HiveException(HttpStatus.CONFLICT, "ROUTE_CONFLICT", "Route path " + route.path("path").asText() + " is already served by module " + other.getKey());
      } catch (java.io.IOException e) {
        throw new IllegalStateException(e);
      }
    }
  }

  // ---- navigation overlays and history -----------------------------------------------------------------------

  public List<Overlay> overlays(String moduleKey) {
    Module module = module(moduleKey);
    return db.sql("select route_key, label, sort_order, hidden, revision from navigation_overlay where micro_app_id = ? order by route_key").param(module.id())
        .query((rs, n) -> new Overlay(rs.getString("route_key"), rs.getString("label"), (Integer) rs.getObject("sort_order"), rs.getBoolean("hidden"), rs.getLong("revision"))).list();
  }

  @Transactional
  public Overlay overlay(String moduleKey, String routeKey, Overlay overlay) {
    Module module = module(moduleKey);
    if (routeKey == null || !routeKey.matches("[a-z][a-z0-9-]{0,79}")) throw HiveException.invalid("Invalid route key");
    if (overlay.label() != null && (overlay.label().isBlank() || overlay.label().length() > 255)) throw HiveException.invalid("Invalid label");
    int updated = db.sql("""
        insert into navigation_overlay(micro_app_id, route_key, label, sort_order, hidden) values (?, ?, ?, ?, ?)
        on conflict (micro_app_id, route_key) do update set label = excluded.label, sort_order = excluded.sort_order, hidden = excluded.hidden,
          revision = navigation_overlay.revision + 1, updated_at = now() where navigation_overlay.revision = ?""")
        .params(module.id(), routeKey, overlay.label(), overlay.order(), overlay.hidden(), overlay.revision()).update();
    if (updated != 1) throw HiveException.stale();
    audit.success("navigation.overlay.updated", Map.of("module", moduleKey, "route", routeKey, "hidden", overlay.hidden()));
    bumpRuntime();
    return overlays(moduleKey).stream().filter(o -> o.routeKey().equals(routeKey)).findFirst().orElseThrow();
  }

  public List<Release> releases(String moduleKey) {
    Module module = module(moduleKey);
    return db.sql("""
        select r.id, r.action, rr.manifest_version as resource_version, ar.manifest_version as artifact_version, r.summary::text as summary, r.actor, r.occurred_at
        from module_release r left join resource_manifest_revision rr on rr.id = r.resource_revision_id left join artifact_revision ar on ar.id = r.artifact_revision_id
        where r.micro_app_id = ? order by r.sequence""").param(module.id())
        .query((rs, n) -> new Release(rs.getObject("id", UUID.class), rs.getString("action"), rs.getString("resource_version"), rs.getString("artifact_version"),
            readTree(rs.getString("summary")), rs.getString("actor"), rs.getTimestamp("occurred_at").toInstant())).list();
  }

  public long runtimeRevision() {
    return db.sql("select case when is_called then last_value else 0 end from runtime_catalog_revision").query(Long.class).single();
  }

  // ---- helpers -----------------------------------------------------------------------------------------------

  private void release(Module module, String action, UUID resourceRevision, UUID artifactRevision, Map<String, Object> summary) {
    try {
      db.sql("insert into module_release(id, micro_app_id, action, resource_revision_id, artifact_revision_id, summary, actor) values (?, ?, ?, ?, ?, cast(? as jsonb), ?)")
          .params(UUID.randomUUID(), module.id(), action, resourceRevision, artifactRevision, json.writeValueAsString(summary), Actor.currentId()).update();
    } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
      throw new IllegalStateException(e);
    }
  }

  private void bumpRuntime() { db.sql("select nextval('runtime_catalog_revision')").query(Long.class).single(); }

  private Module lock(String moduleKey) {
    Module module = module(moduleKey);
    db.sql("select id from micro_app where id = ? for update").param(module.id()).query(UUID.class).single();
    return module(moduleKey);
  }

  private UUID applicationId(Module module) { return catalog.applicationId(module.applicationKey()); }

  private static void requireIdentity(Module module, String applicationKey, String moduleKey) {
    if (!module.applicationKey().equals(applicationKey) || !module.moduleKey().equals(moduleKey))
      throw new HiveException(HttpStatus.UNPROCESSABLE_ENTITY, "MANIFEST_IDENTITY_MISMATCH", "Manifest declares " + applicationKey + "/" + moduleKey
          + " but was submitted for " + module.applicationKey() + "/" + module.moduleKey());
  }

  private ResourceRevision resourceRevisionRow(UUID module, String version) {
    Module owner = modules(null).stream().filter(m -> m.id().equals(module)).findFirst().orElseThrow();
    return db.sql("select * from resource_manifest_revision where micro_app_id = ? and manifest_version = ?").params(module, version)
        .query((rs, n) -> resourceRevision(rs, owner.moduleKey(), owner)).optional().orElse(null);
  }

  private ArtifactRevision artifactRow(UUID module, String version) {
    Module owner = modules(null).stream().filter(m -> m.id().equals(module)).findFirst().orElseThrow();
    return db.sql("select * from artifact_revision where micro_app_id = ? and manifest_version = ?").params(module, version)
        .query((rs, n) -> artifact(rs, owner.moduleKey(), owner)).optional().orElse(null);
  }

  private ArtifactRevision activeArtifact(UUID module) {
    return db.sql("select ar.manifest_version from artifact_revision ar join micro_app m on m.active_artifact_id = ar.id where m.id = ?").param(module)
        .query(String.class).optional().map(v -> artifactRow(module, v)).orElse(null);
  }

  private ResourceRevision resourceRevision(java.sql.ResultSet rs, String moduleKey, Module module) throws java.sql.SQLException {
    UUID id = rs.getObject("id", UUID.class);
    UUID active = db.sql("select active_resource_revision_id from micro_app where id = ?").param(module.id()).query(UUID.class).optional().orElse(null);
    return new ResourceRevision(id, moduleKey, rs.getString("manifest_version"), rs.getString("schema_version"), rs.getString("checksum"), rs.getString("status"),
        rs.getString("source"), rs.getString("source_url"), rs.getString("created_by"), rs.getTimestamp("created_at").toInstant(), rs.getString("published_by"),
        rs.getTimestamp("published_at") == null ? null : rs.getTimestamp("published_at").toInstant(), id.equals(active), readTree(rs.getString("document")));
  }

  private ArtifactRevision artifact(java.sql.ResultSet rs, String moduleKey, Module module) throws java.sql.SQLException {
    UUID id = rs.getObject("id", UUID.class);
    UUID active = db.sql("select active_artifact_id from micro_app where id = ?").param(module.id()).query(UUID.class).optional().orElse(null);
    return new ArtifactRevision(id, moduleKey, rs.getString("manifest_version"), rs.getString("contract_version"), rs.getString("runtime_version"),
        rs.getString("schema_version"), rs.getString("resource_manifest_version"), rs.getString("artifact_url"), rs.getString("integrity"), rs.getString("checksum"),
        rs.getString("created_by"), rs.getTimestamp("created_at").toInstant(), id.equals(active), readTree(rs.getString("document")));
  }

  private JsonNode readTree(String value) {
    try {
      return json.readTree(value);
    } catch (java.io.IOException e) {
      throw new IllegalStateException(e);
    }
  }
}
