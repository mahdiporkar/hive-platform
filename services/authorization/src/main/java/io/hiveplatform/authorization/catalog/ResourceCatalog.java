package io.hiveplatform.authorization.catalog;

import io.hiveplatform.authorization.audit.AuditLog;
import io.hiveplatform.authorization.graph.Graph;
import io.hiveplatform.authorization.graph.GraphOutbox;
import io.hiveplatform.authorization.graph.OpenFgaClient.Tuple;
import io.hiveplatform.spring.HiveException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Resource catalog: the authorization vocabulary of every application. Enforces parent-type validity, acyclicity,
 * same-application parents, module ownership and history preservation (nodes and actions are archived, never deleted).
 */
@Service
public class ResourceCatalog {
  public record ActionSpec(String key, String description) {}
  public record ResourceNode(String key, String type, String parentKey, String displayName, List<ActionSpec> actions) {}
  public record ActionView(String key, String description, boolean archived) {}
  public record ResourceView(UUID id, String applicationKey, String key, String type, String parentKey, String displayName,
      String ownerModuleKey, String origin, boolean archived, long revision, List<ActionView> actions) {}

  static final Pattern KEY = Pattern.compile("[a-z][a-z0-9._-]{0,159}");
  static final Pattern ACTION = Pattern.compile("[a-z][a-z0-9_-]{0,79}");

  private record Row(UUID id, String key, ResourceType type, UUID parentId, String displayName, String ownerModule, String origin, boolean archived, long revision) {}

  private final JdbcClient db;
  private final GraphOutbox graph;
  private final AuditLog audit;

  public ResourceCatalog(JdbcClient db, GraphOutbox graph, AuditLog audit) {
    this.db = db;
    this.graph = graph;
    this.audit = audit;
  }

  public UUID applicationId(String applicationKey) {
    return db.sql("select id from application where application_key = ?").param(applicationKey).query(UUID.class).optional()
        .orElseThrow(() -> HiveException.notFound("Unknown application " + applicationKey));
  }

  /** Creates the immutable APPLICATION root node for a new application. */
  @Transactional
  public void createRoot(UUID applicationId, String applicationKey, String displayName) {
    db.sql("insert into resource(id, application_id, resource_key, resource_type, display_name, origin) values (?, ?, ?, 'APPLICATION', ?, 'SYSTEM')")
        .params(UUID.randomUUID(), applicationId, applicationKey, displayName).update();
  }

  public List<ResourceView> list(String applicationKey, boolean includeArchived) {
    UUID app = applicationId(applicationKey);
    Map<UUID, String> keys = new HashMap<>();
    var rows = rows(app);
    rows.values().forEach(r -> keys.put(r.id(), r.key()));
    Map<UUID, List<ActionView>> actions = new HashMap<>();
    db.sql("select ra.resource_id, ra.action_key, ra.description, ra.archived from resource_action ra join resource r on r.id = ra.resource_id where r.application_id = ? order by ra.action_key")
        .param(app).query((rs, n) -> actions.computeIfAbsent(rs.getObject("resource_id", UUID.class), k -> new ArrayList<>())
            .add(new ActionView(rs.getString("action_key"), rs.getString("description"), rs.getBoolean("archived")))).list();
    List<ResourceView> result = new ArrayList<>();
    for (var row : rows.values()) {
      if (row.archived() && !includeArchived) continue;
      result.add(new ResourceView(row.id(), applicationKey, row.key(), row.type().name(), row.parentId() == null ? null : keys.get(row.parentId()),
          row.displayName(), row.ownerModule(), row.origin(), row.archived(), row.revision(), actions.getOrDefault(row.id(), List.of())));
    }
    return result;
  }

  /** Manual creation by an operator. Manual nodes may hang under any active node of the same application. */
  @Transactional
  public ResourceView createManual(String applicationKey, ResourceNode node) {
    UUID app = applicationId(applicationKey);
    lockApplication(app);
    var rows = rows(app);
    if (rows.containsKey(node.key())) throw HiveException.conflict("Resource " + node.key() + " already exists");
    validateNode(node);
    ResourceType type = ResourceType.parse(node.type());
    if (type == ResourceType.APPLICATION) throw HiveException.invalid("APPLICATION nodes are created with the application");
    Row parent = requireParent(rows, node.parentKey(), type);
    UUID id = UUID.randomUUID();
    db.sql("insert into resource(id, application_id, resource_key, resource_type, parent_id, display_name, origin) values (?, ?, ?, ?, ?, ?, 'MANUAL')")
        .params(id, app, node.key(), type.name(), parent.id(), node.displayName()).update();
    graph.write(parentTuple(id, parent.id()));
    syncActions(id, node.actions());
    audit.success("resource.created", Map.of("application", applicationKey, "resource", node.key(), "origin", "MANUAL"));
    return get(applicationKey, node.key());
  }

  /** Manual update. Manifest-owned nodes are changed only by publishing a manifest. */
  @Transactional
  public ResourceView updateManual(String applicationKey, String key, ResourceNode node, long revision) {
    UUID app = applicationId(applicationKey);
    lockApplication(app);
    var rows = rows(app);
    Row current = rows.get(key);
    if (current == null) throw HiveException.notFound("Unknown resource " + key);
    if (!"MANUAL".equals(current.origin())) throw new HiveException(org.springframework.http.HttpStatus.CONFLICT, "RESOURCE_OWNED",
        "Resource " + key + " is owned by " + (current.ownerModule() == null ? "the platform" : "module " + current.ownerModule()) + " and cannot be edited manually");
    if (!key.equals(node.key()) || !current.type().name().equals(ResourceType.parse(node.type()).name()))
      throw HiveException.invalid("Resource key and type are immutable");
    validateNode(node);
    Row parent = requireParent(rows, node.parentKey(), current.type());
    rejectCycle(rows, current.id(), parent.id());
    if (db.sql("update resource set display_name = ?, parent_id = ?, revision = revision + 1, updated_at = now() where id = ? and revision = ?")
        .params(node.displayName(), parent.id(), current.id(), revision).update() != 1) throw HiveException.stale();
    if (!Objects.equals(current.parentId(), parent.id())) {
      graph.delete(parentTuple(current.id(), current.parentId()));
      graph.write(parentTuple(current.id(), parent.id()));
    }
    syncActions(current.id(), node.actions());
    audit.success("resource.updated", Map.of("application", applicationKey, "resource", key));
    return get(applicationKey, key);
  }

  @Transactional
  public void setArchived(String applicationKey, String key, boolean archived, long revision) {
    UUID app = applicationId(applicationKey);
    lockApplication(app);
    var rows = rows(app);
    Row current = rows.get(key);
    if (current == null) throw HiveException.notFound("Unknown resource " + key);
    if (current.type() == ResourceType.APPLICATION) throw HiveException.invalid("Archive the application instead of its root node");
    if (!"MANUAL".equals(current.origin())) throw new HiveException(org.springframework.http.HttpStatus.CONFLICT, "RESOURCE_OWNED", "Manifest-owned resources are archived by publishing a manifest without them");
    if (archived && rows.values().stream().anyMatch(r -> current.id().equals(r.parentId()) && !r.archived()))
      throw HiveException.conflict("Archive child resources first");
    if (!archived && current.parentId() != null && rows.values().stream().anyMatch(r -> r.id().equals(current.parentId()) && r.archived()))
      throw HiveException.conflict("Restore the parent resource first");
    if (db.sql("update resource set archived = ?, revision = revision + 1, updated_at = now() where id = ? and revision = ?")
        .params(archived, current.id(), revision).update() != 1) throw HiveException.stale();
    audit.success(archived ? "resource.archived" : "resource.restored", Map.of("application", applicationKey, "resource", key));
  }

  public ResourceView get(String applicationKey, String key) {
    return list(applicationKey, true).stream().filter(r -> r.key().equals(key)).findFirst()
        .orElseThrow(() -> HiveException.notFound("Unknown resource " + key));
  }

  /**
   * Applies the complete resource set owned by one module (manifest publication). Nodes are created or updated in
   * dependency order; owned nodes absent from the set are archived. Returns the keys archived.
   */
  @Transactional
  public List<String> applyModule(UUID app, String moduleKey, List<ResourceNode> nodes) {
    lockApplication(app);
    var rows = rows(app);
    Map<String, ResourceNode> declared = new LinkedHashMap<>();
    for (var node : nodes) {
      validateNode(node);
      if (declared.put(node.key(), node) != null) throw HiveException.invalid("Duplicate resource " + node.key());
      ResourceType type = ResourceType.parse(node.type());
      if (type == ResourceType.APPLICATION) throw HiveException.invalid("Manifests cannot declare APPLICATION nodes");
      Row existing = rows.get(node.key());
      if (existing != null && !("MANIFEST".equals(existing.origin()) && moduleKey.equals(existing.ownerModule())))
        throw new HiveException(org.springframework.http.HttpStatus.CONFLICT, "RESOURCE_OWNED",
            "Resource " + node.key() + " is owned by " + (existing.ownerModule() == null ? existing.origin().toLowerCase() + " configuration" : "module " + existing.ownerModule()));
      if (existing != null && existing.type() != type) throw HiveException.invalid("Resource " + node.key() + " cannot change type");
    }
    for (var node : declared.values()) {
      String parentKey = node.parentKey();
      if (parentKey == null) throw HiveException.invalid("Resource " + node.key() + " requires a parent");
      ResourceType type = ResourceType.parse(node.type());
      ResourceType parentType;
      if (declared.containsKey(parentKey)) parentType = ResourceType.parse(declared.get(parentKey).type());
      else {
        Row parent = rows.get(parentKey);
        if (parent == null || parent.archived()) throw HiveException.invalid("Resource " + node.key() + " references unknown parent " + parentKey);
        if (parent.type() != ResourceType.APPLICATION && !("MANIFEST".equals(parent.origin()) && moduleKey.equals(parent.ownerModule())))
          throw HiveException.invalid("Resource " + node.key() + " may only attach to the application root or resources of module " + moduleKey);
        parentType = parent.type();
      }
      if (!type.acceptsParent(parentType)) throw HiveException.invalid("Resource " + node.key() + " of type " + type + " cannot have a " + parentType + " parent; allowed: " + type.allowedParents());
    }
    List<ResourceNode> ordered = topological(declared);
    for (var node : ordered) {
      ResourceType type = ResourceType.parse(node.type());
      UUID parentId = rows.get(node.parentKey()).id();
      Row existing = rows.get(node.key());
      if (existing == null) {
        UUID id = UUID.randomUUID();
        db.sql("insert into resource(id, application_id, resource_key, resource_type, parent_id, display_name, owner_module_key, origin) values (?, ?, ?, ?, ?, ?, ?, 'MANIFEST')")
            .params(id, app, node.key(), type.name(), parentId, node.displayName(), moduleKey).update();
        graph.write(parentTuple(id, parentId));
        rows.put(node.key(), new Row(id, node.key(), type, parentId, node.displayName(), moduleKey, "MANIFEST", false, 0));
        syncActions(id, node.actions());
      } else {
        db.sql("update resource set display_name = ?, parent_id = ?, archived = false, revision = revision + 1, updated_at = now() where id = ?")
            .params(node.displayName(), parentId, existing.id()).update();
        if (!Objects.equals(existing.parentId(), parentId)) {
          graph.delete(parentTuple(existing.id(), existing.parentId()));
          graph.write(parentTuple(existing.id(), parentId));
        }
        rows.put(node.key(), new Row(existing.id(), node.key(), type, parentId, node.displayName(), moduleKey, "MANIFEST", false, existing.revision() + 1));
        syncActions(existing.id(), node.actions());
      }
    }
    // Acyclicity across the whole tree after re-parenting.
    for (var node : ordered) rejectCycle(rows, rows.get(node.key()).id(), rows.get(node.key()).parentId());
    List<String> archived = new ArrayList<>();
    for (var row : rows.values()) {
      if ("MANIFEST".equals(row.origin()) && moduleKey.equals(row.ownerModule()) && !row.archived() && !declared.containsKey(row.key())) {
        if (rows.values().stream().anyMatch(child -> row.id().equals(child.parentId()) && !child.archived() && !declared.containsKey(child.key()) && !"MANIFEST".equals(child.origin())))
          throw HiveException.conflict("Resource " + row.key() + " still has manual children; archive them first");
        db.sql("update resource set archived = true, revision = revision + 1, updated_at = now() where id = ?").param(row.id()).update();
        archived.add(row.key());
      }
    }
    return archived;
  }

  /** Every relationship implied by the catalog, for full graph replay. */
  public List<Tuple> projection() {
    List<Tuple> tuples = new ArrayList<>();
    db.sql("select id, parent_id from resource where parent_id is not null").query((rs, n) ->
        tuples.add(parentTuple(rs.getObject("id", UUID.class), rs.getObject("parent_id", UUID.class)))).list();
    db.sql("select resource_id, action_key from resource_action").query((rs, n) ->
        tuples.add(actionTuple(rs.getObject("resource_id", UUID.class), rs.getString("action_key")))).list();
    return tuples;
  }

  private void syncActions(UUID resourceId, List<ActionSpec> actions) {
    Map<String, ActionSpec> wanted = new LinkedHashMap<>();
    for (var action : actions == null ? List.<ActionSpec>of() : actions) {
      if (action == null || action.key() == null || !ACTION.matcher(action.key()).matches()) throw HiveException.invalid("Invalid action key " + (action == null ? null : action.key()));
      if (Graph.MANAGE.equals(action.key())) throw HiveException.invalid("'manage' is implicit on every resource and cannot be declared");
      if (action.description() != null && action.description().length() > 500) throw HiveException.invalid("Action description too long");
      if (wanted.put(action.key(), action) != null) throw HiveException.invalid("Duplicate action " + action.key());
    }
    Set<String> existing = new HashSet<>(db.sql("select action_key from resource_action where resource_id = ?").param(resourceId).query(String.class).list());
    for (var action : wanted.values()) {
      if (existing.contains(action.key())) {
        db.sql("update resource_action set description = ?, archived = false where resource_id = ? and action_key = ?").params(action.description(), resourceId, action.key()).update();
      } else {
        db.sql("insert into resource_action(resource_id, action_key, description) values (?, ?, ?)").params(resourceId, action.key(), action.description()).update();
        graph.write(actionTuple(resourceId, action.key()));
      }
    }
    for (String key : existing) if (!wanted.containsKey(key))
      db.sql("update resource_action set archived = true where resource_id = ? and action_key = ?").params(resourceId, key).update();
  }

  private static void validateNode(ResourceNode node) {
    if (node == null || node.key() == null || !KEY.matcher(node.key()).matches()) throw HiveException.invalid("Resource key must match " + KEY.pattern());
    if (node.displayName() == null || node.displayName().isBlank() || node.displayName().length() > 255) throw HiveException.invalid("Resource " + node.key() + " requires a display name of at most 255 characters");
    ResourceType.parse(node.type());
    if (node.actions() != null && node.actions().size() > 50) throw HiveException.invalid("At most 50 actions per resource");
  }

  private Row requireParent(Map<String, Row> rows, String parentKey, ResourceType type) {
    if (parentKey == null) throw HiveException.invalid("A parent resource is required");
    Row parent = rows.get(parentKey);
    if (parent == null || parent.archived()) throw HiveException.invalid("Unknown or archived parent " + parentKey);
    if (!type.acceptsParent(parent.type())) throw HiveException.invalid(type + " cannot have a " + parent.type() + " parent; allowed: " + type.allowedParents());
    return parent;
  }

  private static void rejectCycle(Map<String, Row> rows, UUID self, UUID parentId) {
    Map<UUID, Row> byId = new HashMap<>();
    rows.values().forEach(r -> byId.put(r.id(), r));
    Set<UUID> seen = new HashSet<>();
    for (UUID cursor = parentId; cursor != null; cursor = byId.get(cursor) == null ? null : byId.get(cursor).parentId()) {
      if (cursor.equals(self) || !seen.add(cursor)) throw HiveException.invalid("Parent assignment would create a cycle");
    }
  }

  private static List<ResourceNode> topological(Map<String, ResourceNode> declared) {
    List<ResourceNode> ordered = new ArrayList<>();
    Set<String> done = new HashSet<>(), visiting = new HashSet<>();
    for (String key : declared.keySet()) visit(key, declared, done, visiting, ordered);
    return ordered;
  }

  private static void visit(String key, Map<String, ResourceNode> declared, Set<String> done, Set<String> visiting, List<ResourceNode> ordered) {
    if (done.contains(key) || !declared.containsKey(key)) return;
    if (!visiting.add(key)) throw HiveException.invalid("Resource hierarchy contains a cycle at " + key);
    visit(declared.get(key).parentKey(), declared, done, visiting, ordered);
    visiting.remove(key);
    done.add(key);
    ordered.add(declared.get(key));
  }

  private Map<String, Row> rows(UUID app) {
    Map<String, Row> rows = new LinkedHashMap<>();
    db.sql("select id, resource_key, resource_type, parent_id, display_name, owner_module_key, origin, archived, revision from resource where application_id = ? order by created_at, resource_key")
        .param(app).query((rs, n) -> rows.put(rs.getString("resource_key"), new Row(rs.getObject("id", UUID.class), rs.getString("resource_key"),
            ResourceType.valueOf(rs.getString("resource_type")), rs.getObject("parent_id", UUID.class), rs.getString("display_name"), rs.getString("owner_module_key"),
            rs.getString("origin"), rs.getBoolean("archived"), rs.getLong("revision")))).list();
    return rows;
  }

  private void lockApplication(UUID app) {
    db.sql("select id from application where id = ? for update").param(app).query(UUID.class).single();
  }

  static Tuple parentTuple(UUID child, UUID parent) { return new Tuple(Graph.resource(parent), "parent", Graph.resource(child)); }
  static Tuple actionTuple(UUID resource, String action) { return new Tuple(Graph.resource(resource), "resource", Graph.action(resource, action)); }
}
