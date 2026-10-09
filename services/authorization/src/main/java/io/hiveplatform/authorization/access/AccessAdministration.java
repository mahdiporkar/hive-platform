package io.hiveplatform.authorization.access;

import io.hiveplatform.authorization.audit.AuditLog;
import io.hiveplatform.authorization.catalog.ResourceCatalog;
import io.hiveplatform.authorization.graph.AuthorizationEngine;
import io.hiveplatform.authorization.graph.Graph;
import io.hiveplatform.authorization.graph.Graph.PlatformRole;
import io.hiveplatform.authorization.graph.Graph.SubjectType;
import io.hiveplatform.authorization.graph.GraphOutbox;
import io.hiveplatform.authorization.graph.OpenFgaClient.Tuple;
import io.hiveplatform.spring.HiveException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Users, groups, roles, role assignments, permission grants and platform role assignments. PostgreSQL rows are the
 * source of truth; each change enqueues its OpenFGA projection in the same transaction. Revocations keep history.
 */
@Service
public class AccessAdministration {
  public record User(UUID id, String tenantId, String displayName, boolean active, Instant createdAt, Instant lastLoginAt, List<Identity> identities) {}
  public record Identity(String issuer, String subject) {}
  public record NewUser(String tenantId, String displayName, List<Identity> identities) {}
  public record Group(UUID id, String key, String displayName, boolean archived, long revision, List<UUID> members) {}
  public record Role(UUID id, String key, String displayName, String description, boolean archived, long revision) {}
  public record Assignment(UUID id, String role, String subject, Instant createdAt, Instant revokedAt) {}
  public record Grant(UUID id, String subject, String applicationKey, String resourceKey, String action, String createdBy, Instant createdAt, Instant revokedAt) {}
  public record NewGrant(String subject, String applicationKey, String resourceKey, String action) {}
  public record PlatformAssignment(UUID id, String role, String subject, Instant createdAt, Instant revokedAt) {}

  /** Resolved subject reference ({@code user:<uuid>}, {@code group:<key>} or {@code role:<key>}). */
  record Subject(SubjectType type, UUID id, String reference) {}

  private static final Pattern KEY = Pattern.compile("[a-z][a-z0-9._-]{0,159}");
  private final JdbcClient db;
  private final GraphOutbox graph;
  private final ResourceCatalog catalog;
  private final AuditLog audit;
  private final AuthorizationEngine engine;

  public AccessAdministration(JdbcClient db, GraphOutbox graph, ResourceCatalog catalog, AuditLog audit, AuthorizationEngine engine) {
    this.db = db;
    this.graph = graph;
    this.catalog = catalog;
    this.audit = audit;
    this.engine = engine;
  }

  // ---- users -------------------------------------------------------------------------------------------------

  public List<User> users(String query, int limit) {
    String pattern = query == null || query.isBlank() ? "%" : "%" + query.toLowerCase(Locale.ROOT).replace("%", "") + "%";
    var users = db.sql("""
        select u.id, u.tenant_id, u.display_name, u.active, u.created_at, u.last_login_at from hive_user u
        where lower(u.display_name) like :q or u.id::text like :q or exists (select 1 from external_identity e where e.user_id = u.id and lower(e.subject) like :q)
        order by u.display_name, u.id limit :limit""")
        .param("q", pattern).param("limit", Math.max(1, Math.min(limit, 500)))
        .query((rs, n) -> new User(rs.getObject("id", UUID.class), rs.getString("tenant_id"), rs.getString("display_name"), rs.getBoolean("active"),
            rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("last_login_at") == null ? null : rs.getTimestamp("last_login_at").toInstant(), List.of()))
        .list();
    return users.stream().map(u -> new User(u.id(), u.tenantId(), u.displayName(), u.active(), u.createdAt(), u.lastLoginAt(), identities(u.id()))).toList();
  }

  public User user(UUID id) {
    return users(id.toString(), 1).stream().filter(u -> u.id().equals(id)).findFirst().orElseThrow(() -> HiveException.notFound("Unknown user " + id));
  }

  /** Pre-provisions a canonical user, optionally bound to external identities so the first login resolves to it. */
  @Transactional
  public User createUser(NewUser request) {
    if (request == null || request.displayName() == null || request.displayName().isBlank() || request.displayName().length() > 255)
      throw HiveException.invalid("displayName is required (max 255 characters)");
    String tenant = request.tenantId() == null || request.tenantId().isBlank() ? "default" : request.tenantId();
    if (tenant.length() > 160) throw HiveException.invalid("tenantId too long");
    UUID id = UUID.randomUUID();
    db.sql("insert into hive_user(id, tenant_id, display_name) values (?, ?, ?)").params(id, tenant, request.displayName()).update();
    for (var identity : request.identities() == null ? List.<Identity>of() : request.identities()) bind(id, identity);
    audit.success("user.created", Map.of("user", id.toString(), "identities", request.identities() == null ? 0 : request.identities().size()));
    return user(id);
  }

  @Transactional
  public User updateUser(UUID id, String displayName, Boolean active) {
    user(id);
    if (displayName != null && (displayName.isBlank() || displayName.length() > 255)) throw HiveException.invalid("Invalid displayName");
    db.sql("update hive_user set display_name = coalesce(?, display_name), active = coalesce(?, active) where id = ?").params(displayName, active, id).update();
    audit.success(Boolean.FALSE.equals(active) ? "user.deactivated" : "user.updated", Map.of("user", id.toString()));
    return user(id);
  }

  @Transactional
  public User bindIdentity(UUID id, Identity identity) {
    user(id);
    bind(id, identity);
    audit.success("user.identity.bound", Map.of("user", id.toString(), "issuer", identity.issuer()));
    return user(id);
  }

  private void bind(UUID user, Identity identity) {
    if (identity == null || identity.issuer() == null || identity.issuer().isBlank() || identity.issuer().length() > 2048
        || identity.subject() == null || identity.subject().isBlank() || identity.subject().length() > 255) throw HiveException.invalid("identity requires issuer and subject");
    if (db.sql("insert into external_identity(issuer, subject, user_id) values (?, ?, ?) on conflict do nothing").params(identity.issuer(), identity.subject(), user).update() != 1)
      throw HiveException.conflict("External identity is already bound");
  }

  private List<Identity> identities(UUID user) {
    return db.sql("select issuer, subject from external_identity where user_id = ? order by created_at").param(user)
        .query((rs, n) -> new Identity(rs.getString("issuer"), rs.getString("subject"))).list();
  }

  // ---- groups ------------------------------------------------------------------------------------------------

  public List<Group> groups() {
    return db.sql("select id, group_key, display_name, archived, revision from hive_group order by group_key").query((rs, n) -> {
      UUID id = rs.getObject("id", UUID.class);
      return new Group(id, rs.getString("group_key"), rs.getString("display_name"), rs.getBoolean("archived"), rs.getLong("revision"),
          db.sql("select user_id from group_member where group_id = ? order by user_id").param(id).query(UUID.class).list());
    }).list();
  }

  @Transactional
  public Group createGroup(String key, String displayName) {
    requireKey(key);
    requireName(displayName);
    if (db.sql("insert into hive_group(id, group_key, display_name) values (?, ?, ?) on conflict (group_key) do nothing").params(UUID.randomUUID(), key, displayName).update() != 1)
      throw HiveException.conflict("Group " + key + " already exists");
    audit.success("group.created", Map.of("group", key));
    return group(key);
  }

  @Transactional
  public Group addMember(String groupKey, UUID userId) {
    Group group = activeGroup(groupKey);
    user(userId);
    if (db.sql("insert into group_member(group_id, user_id) values (?, ?) on conflict do nothing").params(group.id(), userId).update() == 1) {
      graph.write(new Tuple(Graph.user(userId), "member", "group:" + group.id()));
      audit.success("group.member.added", Map.of("group", groupKey, "user", userId.toString()));
    }
    return group(groupKey);
  }

  @Transactional
  public Group removeMember(String groupKey, UUID userId) {
    Group group = group(groupKey);
    if (db.sql("delete from group_member where group_id = ? and user_id = ?").params(group.id(), userId).update() == 1) {
      graph.delete(new Tuple(Graph.user(userId), "member", "group:" + group.id()));
      audit.success("group.member.removed", Map.of("group", groupKey, "user", userId.toString()));
    }
    return group(groupKey);
  }

  private Group group(String key) {
    return groups().stream().filter(g -> g.key().equals(key)).findFirst().orElseThrow(() -> HiveException.notFound("Unknown group " + key));
  }

  private Group activeGroup(String key) {
    Group group = group(key);
    if (group.archived()) throw HiveException.conflict("Group " + key + " is archived");
    return group;
  }

  // ---- roles -------------------------------------------------------------------------------------------------

  public List<Role> roles() {
    return db.sql("select id, role_key, display_name, description, archived, revision from hive_role order by role_key")
        .query((rs, n) -> new Role(rs.getObject("id", UUID.class), rs.getString("role_key"), rs.getString("display_name"), rs.getString("description"),
            rs.getBoolean("archived"), rs.getLong("revision"))).list();
  }

  @Transactional
  public Role createRole(String key, String displayName, String description) {
    requireKey(key);
    requireName(displayName);
    if (description != null && description.length() > 1000) throw HiveException.invalid("description too long");
    if (db.sql("insert into hive_role(id, role_key, display_name, description) values (?, ?, ?, ?) on conflict (role_key) do nothing")
        .params(UUID.randomUUID(), key, displayName, description).update() != 1) throw HiveException.conflict("Role " + key + " already exists");
    audit.success("role.created", Map.of("role", key));
    return role(key);
  }

  /** Archiving a role revokes its assignments and grants (history retained) so it can no longer confer access. */
  @Transactional
  public Role archiveRole(String key, long revision) {
    Role role = role(key);
    if (db.sql("update hive_role set archived = true, revision = revision + 1 where id = ? and revision = ? and not archived").params(role.id(), revision).update() != 1)
      throw HiveException.stale();
    for (var assignment : assignments(key)) if (assignment.revokedAt() == null) revokeAssignment(key, assignment.id());
    for (var grant : grants(Map.of("subject", "role:" + key))) if (grant.revokedAt() == null) revokeGrant(grant.id());
    audit.success("role.archived", Map.of("role", key));
    return role(key);
  }

  public List<Assignment> assignments(String roleKey) {
    Role role = role(roleKey);
    return db.sql("select id, subject_type, subject_id, created_at, revoked_at from role_assignment where role_id = ? order by created_at").param(role.id())
        .query((rs, n) -> new Assignment(rs.getObject("id", UUID.class), roleKey, reference(SubjectType.valueOf(rs.getString("subject_type")), rs.getObject("subject_id", UUID.class)),
            rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("revoked_at") == null ? null : rs.getTimestamp("revoked_at").toInstant())).list();
  }

  @Transactional
  public Assignment assign(String roleKey, String subjectReference) {
    Role role = role(roleKey);
    if (role.archived()) throw HiveException.conflict("Role " + roleKey + " is archived");
    Subject subject = resolve(subjectReference);
    if (subject.type() == SubjectType.ROLE) throw HiveException.invalid("Roles are assigned to users or groups");
    UUID id = UUID.randomUUID();
    if (db.sql("insert into role_assignment(id, role_id, subject_type, subject_id, created_by) values (?, ?, ?, ?, ?) on conflict do nothing")
        .params(id, role.id(), subject.type().name(), subject.id(), io.hiveplatform.authorization.admin.Actor.currentId()).update() != 1)
      throw HiveException.conflict("Assignment already active");
    graph.write(new Tuple(Graph.subject(subject.type(), subject.id()), "assignee", "role:" + role.id()));
    audit.success("role.assigned", Map.of("role", roleKey, "subject", subject.reference()));
    return assignments(roleKey).stream().filter(a -> a.id().equals(id)).findFirst().orElseThrow();
  }

  @Transactional
  public void revokeAssignment(String roleKey, UUID assignmentId) {
    Role role = role(roleKey);
    var row = db.sql("select subject_type, subject_id from role_assignment where id = ? and role_id = ? and revoked_at is null for update")
        .params(assignmentId, role.id()).query((rs, n) -> new Subject(SubjectType.valueOf(rs.getString("subject_type")), rs.getObject("subject_id", UUID.class), null))
        .optional().orElseThrow(() -> HiveException.notFound("No active assignment " + assignmentId));
    db.sql("update role_assignment set revoked_at = now(), revoked_by = ? where id = ?").params(io.hiveplatform.authorization.admin.Actor.currentId(), assignmentId).update();
    graph.delete(new Tuple(Graph.subject(row.type(), row.id()), "assignee", "role:" + role.id()));
    audit.success("role.unassigned", Map.of("role", roleKey, "assignment", assignmentId.toString()));
  }

  private Role role(String key) {
    return roles().stream().filter(r -> r.key().equals(key)).findFirst().orElseThrow(() -> HiveException.notFound("Unknown role " + key));
  }

  // ---- grants ------------------------------------------------------------------------------------------------

  public List<Grant> grants(Map<String, String> filter) {
    String subject = filter.getOrDefault("subject", "");
    Subject resolved = subject.isBlank() ? null : resolve(subject);
    String application = filter.getOrDefault("applicationKey", "");
    String resource = filter.getOrDefault("resourceKey", "");
    boolean includeRevoked = Boolean.parseBoolean(filter.getOrDefault("includeRevoked", "false"));
    return db.sql("""
        select g.id, g.subject_type, g.subject_id, a.application_key, r.resource_key, g.action_key, g.created_by, g.created_at, g.revoked_at
        from permission_grant g join resource r on r.id = g.resource_id join application a on a.id = r.application_id
        where (:type = '' or (g.subject_type = :type and g.subject_id = cast(:id as uuid))) and (:app = '' or a.application_key = :app)
          and (:resource = '' or r.resource_key = :resource) and (:revoked or g.revoked_at is null)
        order by g.created_at limit 1000""")
        .param("type", resolved == null ? "" : resolved.type().name()).param("id", resolved == null ? UUID.randomUUID().toString() : resolved.id().toString())
        .param("app", application).param("resource", resource).param("revoked", includeRevoked)
        .query((rs, n) -> new Grant(rs.getObject("id", UUID.class), reference(SubjectType.valueOf(rs.getString("subject_type")), rs.getObject("subject_id", UUID.class)),
            rs.getString("application_key"), rs.getString("resource_key"), rs.getString("action_key"), rs.getString("created_by"),
            rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("revoked_at") == null ? null : rs.getTimestamp("revoked_at").toInstant())).list();
  }

  @Transactional
  public Grant grant(NewGrant request) {
    if (request == null) throw HiveException.invalid("Grant body required");
    Subject subject = resolve(request.subject());
    var resource = catalog.get(request.applicationKey(), request.resourceKey());
    if (resource.archived()) throw HiveException.conflict("Resource is archived");
    String action = request.action();
    if (action == null || !(Graph.MANAGE.equals(action) || resource.actions().stream().anyMatch(a -> a.key().equals(action) && !a.archived())))
      throw HiveException.invalid("Action " + action + " is not declared on " + request.applicationKey() + ":" + request.resourceKey());
    UUID id = UUID.randomUUID();
    if (db.sql("insert into permission_grant(id, subject_type, subject_id, resource_id, action_key, created_by) values (?, ?, ?, ?, ?, ?) on conflict do nothing")
        .params(id, subject.type().name(), subject.id(), resource.id(), action, io.hiveplatform.authorization.admin.Actor.currentId()).update() != 1)
      throw HiveException.conflict("Grant already active");
    graph.write(Graph.grant(Graph.subject(subject.type(), subject.id()), resource.id(), action));
    audit.success("grant.created", Map.of("grant", id.toString(), "subject", subject.reference(), "resource", request.applicationKey() + ":" + request.resourceKey(), "action", action));
    return grants(Map.of("includeRevoked", "true")).stream().filter(g -> g.id().equals(id)).findFirst().orElseThrow();
  }

  @Transactional
  public void revokeGrant(UUID id) {
    var row = db.sql("select subject_type, subject_id, resource_id, action_key from permission_grant where id = ? and revoked_at is null for update").param(id)
        .query((rs, n) -> new Object[] {SubjectType.valueOf(rs.getString("subject_type")), rs.getObject("subject_id", UUID.class), rs.getObject("resource_id", UUID.class), rs.getString("action_key")})
        .optional().orElseThrow(() -> HiveException.notFound("No active grant " + id));
    db.sql("update permission_grant set revoked_at = now(), revoked_by = ? where id = ?").params(io.hiveplatform.authorization.admin.Actor.currentId(), id).update();
    graph.delete(Graph.grant(Graph.subject((SubjectType) row[0], (UUID) row[1]), (UUID) row[2], (String) row[3]));
    audit.success("grant.revoked", Map.of("grant", id.toString()));
  }

  // ---- resource-centric views ---------------------------------------------------------------------------------

  /** A grant seen from a resource: who holds which action, directly on the node or as {@code manage} on an ancestor. */
  public record ResourceGrant(UUID grantId, String subject, String subjectType, String subjectName, String resourceKey, String action, boolean inherited, Instant createdAt) {}
  public record ResourceAccess(String applicationKey, String resourceKey, List<String> actions, List<String> ancestry, List<ResourceGrant> direct, List<ResourceGrant> inheritedManage) {}
  /** One way the graph can allow an action: a direct grant to the user, to one of the user's groups or roles, or inherited {@code manage}. */
  public record AccessPath(String action, String kind, String via, String grantSubject, String grantResourceKey, UUID grantId) {}
  public record Inspection(UUID userId, String userName, boolean active, String applicationKey, String resourceKey, List<String> groups, List<String> roles,
      List<AuthorizationEngine.Decision> decisions, List<AccessPath> paths) {}

  /**
   * Direct grants on a resource and {@code manage} grants on its ancestors. Only {@code manage} is inherited down the
   * tree by the authorization model (resource#manager from parent); action grants are never inherited.
   */
  public ResourceAccess resourceAccess(String applicationKey, String resourceKey) {
    var resource = catalog.get(applicationKey, resourceKey);
    List<String> ancestry = ancestry(applicationKey, resourceKey);
    List<String> actions = new ArrayList<>(List.of(Graph.MANAGE));
    resource.actions().stream().filter(a -> !a.archived()).forEach(a -> actions.add(a.key()));
    var grants = resourceGrants(applicationKey, ancestry);
    return new ResourceAccess(applicationKey, resourceKey, actions, ancestry,
        grants.stream().filter(g -> g.resourceKey().equals(resourceKey)).toList(),
        grants.stream().filter(g -> !g.resourceKey().equals(resourceKey) && Graph.MANAGE.equals(g.action()))
            .map(g -> new ResourceGrant(g.grantId(), g.subject(), g.subjectType(), g.subjectName(), g.resourceKey(), g.action(), true, g.createdAt())).toList());
  }

  /**
   * Explains a user's access to one resource: the authoritative decisions come from the authorization engine (OpenFGA),
   * the paths from the relational source of truth the graph is projected from.
   */
  public Inspection inspect(UUID userId, String applicationKey, String resourceKey) {
    if (userId == null) throw HiveException.invalid("userId is required");
    var user = user(userId);
    var resource = catalog.get(applicationKey, resourceKey);
    List<String> ancestry = ancestry(applicationKey, resourceKey);
    record Membership(SubjectType type, UUID id, String reference, String via) {}
    List<Membership> memberships = new ArrayList<>(List.of(new Membership(SubjectType.USER, userId, "user:" + userId, null)));
    db.sql("select g.id, g.group_key from group_member m join hive_group g on g.id = m.group_id where m.user_id = ? and not g.archived order by g.group_key").param(userId)
        .query((rs, n) -> memberships.add(new Membership(SubjectType.GROUP, rs.getObject("id", UUID.class), "group:" + rs.getString("group_key"), null))).list();
    List<UUID> groupIds = memberships.stream().filter(m -> m.type() == SubjectType.GROUP).map(Membership::id).toList();
    db.sql("""
        select r.id, r.role_key, a.subject_type, coalesce(g.group_key, '') as group_key from role_assignment a join hive_role r on r.id = a.role_id
        left join hive_group g on a.subject_type = 'GROUP' and g.id = a.subject_id
        where a.revoked_at is null and not r.archived and ((a.subject_type = 'USER' and a.subject_id = :u) or (a.subject_type = 'GROUP' and a.subject_id = any(:groups)))
        order by r.role_key""").param("u", userId).param("groups", groupIds.toArray(UUID[]::new))
        .query((rs, n) -> memberships.add(new Membership(SubjectType.ROLE, rs.getObject("id", UUID.class), "role:" + rs.getString("role_key"),
            "GROUP".equals(rs.getString("subject_type")) ? "group:" + rs.getString("group_key") : "user"))).list();
    List<String> checked = new ArrayList<>(List.of(Graph.MANAGE));
    resource.actions().stream().filter(a -> !a.archived()).forEach(a -> checked.add(a.key()));
    var decisions = engine.check(userId, checked.stream().map(a -> new AuthorizationEngine.Check(applicationKey, resourceKey, a)).toList());
    List<AccessPath> paths = new ArrayList<>();
    for (var grant : resourceGrants(applicationKey, ancestry)) {
      var holder = memberships.stream().filter(m -> m.reference().equals(grant.subject())).findFirst().orElse(null);
      if (holder == null) continue;
      boolean onResource = grant.resourceKey().equals(resourceKey);
      String kind = switch (holder.type()) { case USER -> "DIRECT_USER"; case GROUP -> "GROUP"; case ROLE -> "user".equals(holder.via()) ? "ROLE" : "ROLE_VIA_GROUP"; };
      if (onResource && !Graph.MANAGE.equals(grant.action())) paths.add(new AccessPath(grant.action(), kind, holder.via(), grant.subject(), grant.resourceKey(), grant.grantId()));
      if (Graph.MANAGE.equals(grant.action())) for (String action : checked)
        paths.add(new AccessPath(action, onResource ? kind + "+MANAGE" : kind + "+MANAGE_INHERITED", holder.via(), grant.subject(), grant.resourceKey(), grant.grantId()));
    }
    return new Inspection(userId, user.displayName(), user.active(), applicationKey, resourceKey,
        memberships.stream().filter(m -> m.type() == SubjectType.GROUP).map(Membership::reference).toList(),
        memberships.stream().filter(m -> m.type() == SubjectType.ROLE).map(m -> m.reference() + ("user".equals(m.via()) ? "" : " (via " + m.via() + ")")).toList(),
        decisions, paths);
  }

  /** The resource itself followed by its ancestors up to the application root. */
  private List<String> ancestry(String applicationKey, String resourceKey) {
    Map<String, String> parents = new java.util.HashMap<>();
    catalog.list(applicationKey, true).forEach(r -> parents.put(r.key(), r.parentKey()));
    List<String> chain = new ArrayList<>();
    for (String cursor = resourceKey; cursor != null && !chain.contains(cursor) && chain.size() < 200; cursor = parents.get(cursor)) chain.add(cursor);
    return chain;
  }

  private List<ResourceGrant> resourceGrants(String applicationKey, List<String> resourceKeys) {
    return db.sql("""
        select g.id, g.subject_type, g.subject_id, r.resource_key, g.action_key, g.created_at,
          coalesce(u.display_name, ro.display_name, gr.display_name, g.subject_id::text) as subject_name, coalesce(ro.role_key, gr.group_key, g.subject_id::text) as subject_key
        from permission_grant g join resource r on r.id = g.resource_id join application a on a.id = r.application_id
        left join hive_user u on g.subject_type = 'USER' and u.id = g.subject_id
        left join hive_role ro on g.subject_type = 'ROLE' and ro.id = g.subject_id
        left join hive_group gr on g.subject_type = 'GROUP' and gr.id = g.subject_id
        where g.revoked_at is null and a.application_key = :app and r.resource_key = any(:keys)
        order by r.resource_key, g.action_key, g.created_at""").param("app", applicationKey).param("keys", resourceKeys.toArray(String[]::new))
        .query((rs, n) -> new ResourceGrant(rs.getObject("id", UUID.class), rs.getString("subject_type").toLowerCase(Locale.ROOT) + ":" + rs.getString("subject_key"),
            rs.getString("subject_type"), rs.getString("subject_name"), rs.getString("resource_key"), rs.getString("action_key"), false, rs.getTimestamp("created_at").toInstant()))
        .list();
  }

  // ---- platform roles ----------------------------------------------------------------------------------------

  public List<PlatformAssignment> platformAssignments() {
    return db.sql("select id, platform_role, subject_type, subject_id, created_at, revoked_at from platform_role_assignment where revoked_at is null order by created_at")
        .query((rs, n) -> new PlatformAssignment(rs.getObject("id", UUID.class), rs.getString("platform_role"),
            reference(SubjectType.valueOf(rs.getString("subject_type")), rs.getObject("subject_id", UUID.class)),
            rs.getTimestamp("created_at").toInstant(), null)).list();
  }

  @Transactional
  public PlatformAssignment assignPlatformRole(String role, String subjectReference) {
    PlatformRole platformRole = platformRole(role);
    Subject subject = resolve(subjectReference);
    UUID id = UUID.randomUUID();
    if (db.sql("insert into platform_role_assignment(id, platform_role, subject_type, subject_id, created_by) values (?, ?, ?, ?, ?) on conflict do nothing")
        .params(id, platformRole.name(), subject.type().name(), subject.id(), io.hiveplatform.authorization.admin.Actor.currentId()).update() != 1)
      throw HiveException.conflict("Platform role already assigned");
    graph.write(new Tuple(Graph.subject(subject.type(), subject.id()), platformRole.relation, Graph.PLATFORM));
    audit.success("platform-role.assigned", Map.of("role", platformRole.name(), "subject", subject.reference()));
    return platformAssignments().stream().filter(a -> a.id().equals(id)).findFirst().orElseThrow();
  }

  @Transactional
  public void revokePlatformRole(UUID id) {
    var row = db.sql("select platform_role, subject_type, subject_id from platform_role_assignment where id = ? and revoked_at is null for update").param(id)
        .query((rs, n) -> new Object[] {PlatformRole.valueOf(rs.getString("platform_role")), SubjectType.valueOf(rs.getString("subject_type")), rs.getObject("subject_id", UUID.class)})
        .optional().orElseThrow(() -> HiveException.notFound("No active platform role assignment " + id));
    PlatformRole role = (PlatformRole) row[0];
    if (role == PlatformRole.SUPER_ADMIN && db.sql("select count(*) from platform_role_assignment where platform_role = 'SUPER_ADMIN' and revoked_at is null").query(Long.class).single() <= 1)
      throw HiveException.conflict("The last super administrator assignment cannot be revoked");
    db.sql("update platform_role_assignment set revoked_at = now(), revoked_by = ? where id = ?").params(io.hiveplatform.authorization.admin.Actor.currentId(), id).update();
    graph.delete(new Tuple(Graph.subject((SubjectType) row[1], (UUID) row[2]), role.relation, Graph.PLATFORM));
    audit.success("platform-role.revoked", Map.of("assignment", id.toString(), "role", role.name()));
  }

  public List<String> platformRolesOf(UUID user) {
    // Informational projection for UIs; enforcement always goes through the graph.
    return db.sql("""
        select distinct p.platform_role from platform_role_assignment p where p.revoked_at is null and (
          (p.subject_type = 'USER' and p.subject_id = :u)
          or (p.subject_type = 'GROUP' and exists (select 1 from group_member m where m.group_id = p.subject_id and m.user_id = :u))
          or (p.subject_type = 'ROLE' and exists (select 1 from role_assignment r where r.role_id = p.subject_id and r.revoked_at is null and (
                (r.subject_type = 'USER' and r.subject_id = :u) or (r.subject_type = 'GROUP' and exists (select 1 from group_member m where m.group_id = r.subject_id and m.user_id = :u))))))
        order by 1""").param("u", user).query(String.class).list();
  }

  /** Every relationship implied by access administration, for full graph replay. */
  public List<Tuple> projection() {
    List<Tuple> tuples = new ArrayList<>();
    db.sql("select group_id, user_id from group_member").query((rs, n) ->
        tuples.add(new Tuple(Graph.user(rs.getObject("user_id", UUID.class)), "member", "group:" + rs.getObject("group_id", UUID.class)))).list();
    db.sql("select role_id, subject_type, subject_id from role_assignment where revoked_at is null").query((rs, n) ->
        tuples.add(new Tuple(Graph.subject(SubjectType.valueOf(rs.getString("subject_type")), rs.getObject("subject_id", UUID.class)), "assignee", "role:" + rs.getObject("role_id", UUID.class)))).list();
    db.sql("select subject_type, subject_id, resource_id, action_key from permission_grant where revoked_at is null").query((rs, n) ->
        tuples.add(Graph.grant(Graph.subject(SubjectType.valueOf(rs.getString("subject_type")), rs.getObject("subject_id", UUID.class)), rs.getObject("resource_id", UUID.class), rs.getString("action_key")))).list();
    db.sql("select platform_role, subject_type, subject_id from platform_role_assignment where revoked_at is null").query((rs, n) ->
        tuples.add(new Tuple(Graph.subject(SubjectType.valueOf(rs.getString("subject_type")), rs.getObject("subject_id", UUID.class)), PlatformRole.valueOf(rs.getString("platform_role")).relation, Graph.PLATFORM))).list();
    return tuples;
  }

  // ---- helpers -----------------------------------------------------------------------------------------------

  Subject resolve(String reference) {
    if (reference == null || !reference.contains(":")) throw HiveException.invalid("subject must be user:<id>, group:<key> or role:<key>");
    String kind = reference.substring(0, reference.indexOf(':')), value = reference.substring(reference.indexOf(':') + 1);
    SubjectType type = Graph.subjectType(kind);
    UUID id = switch (type) {
      case USER -> {
        UUID user;
        try { user = UUID.fromString(value); } catch (IllegalArgumentException e) { throw HiveException.invalid("user subject requires a canonical id"); }
        if (db.sql("select count(*) from hive_user where id = ?").param(user).query(Long.class).single() != 1) throw HiveException.notFound("Unknown user " + value);
        yield user;
      }
      case GROUP -> db.sql("select id from hive_group where group_key = ? and not archived").param(value).query(UUID.class).optional().orElseThrow(() -> HiveException.notFound("Unknown group " + value));
      case ROLE -> db.sql("select id from hive_role where role_key = ? and not archived").param(value).query(UUID.class).optional().orElseThrow(() -> HiveException.notFound("Unknown role " + value));
    };
    return new Subject(type, id, type.name().toLowerCase(Locale.ROOT) + ":" + value);
  }

  private String reference(SubjectType type, UUID id) {
    return switch (type) {
      case USER -> "user:" + id;
      case GROUP -> "group:" + db.sql("select group_key from hive_group where id = ?").param(id).query(String.class).optional().orElse(id.toString());
      case ROLE -> "role:" + db.sql("select role_key from hive_role where id = ?").param(id).query(String.class).optional().orElse(id.toString());
    };
  }

  private static PlatformRole platformRole(String value) {
    try { return PlatformRole.valueOf(String.valueOf(value).toUpperCase(Locale.ROOT)); }
    catch (IllegalArgumentException e) { throw HiveException.invalid("Unknown platform role " + value); }
  }

  private static void requireKey(String key) {
    if (key == null || !KEY.matcher(key).matches()) throw HiveException.invalid("key must match " + KEY.pattern());
  }

  private static void requireName(String name) {
    if (name == null || name.isBlank() || name.length() > 255) throw HiveException.invalid("displayName is required (max 255 characters)");
  }
}
