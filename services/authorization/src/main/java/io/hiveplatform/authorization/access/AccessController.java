package io.hiveplatform.authorization.access;

import io.hiveplatform.authorization.admin.PlatformAccess;
import io.hiveplatform.authorization.admin.PlatformAccess.Relation;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/admin")
@PlatformAccess(Relation.SECURITY_ADMIN)
class AccessController {
  record UserUpdate(String displayName, Boolean active) {}
  record GroupDefinition(String key, String displayName) {}
  record Member(UUID userId) {}
  record RoleDefinition(String key, String displayName, String description) {}
  record Revision(long revision) {}
  record SubjectReference(String subject) {}
  record PlatformRoleRequest(String role, String subject) {}
  record InspectRequest(UUID userId, String applicationKey, String resourceKey) {}

  private final AccessAdministration access;

  AccessController(AccessAdministration access) { this.access = access; }

  @GetMapping("/users") List<AccessAdministration.User> users(@RequestParam(required = false) String query, @RequestParam(defaultValue = "100") int limit) { return access.users(query, limit); }
  @PostMapping("/users") AccessAdministration.User createUser(@RequestBody AccessAdministration.NewUser user) { return access.createUser(user); }
  @GetMapping("/users/{id}") AccessAdministration.User user(@PathVariable UUID id) { return access.user(id); }
  @PutMapping("/users/{id}") AccessAdministration.User updateUser(@PathVariable UUID id, @RequestBody UserUpdate update) { return access.updateUser(id, update.displayName(), update.active()); }
  @PostMapping("/users/{id}/identities") AccessAdministration.User bind(@PathVariable UUID id, @RequestBody AccessAdministration.Identity identity) { return access.bindIdentity(id, identity); }
  @GetMapping("/users/{id}/platform-roles") List<String> platformRoles(@PathVariable UUID id) { return access.platformRolesOf(id); }

  @GetMapping("/groups") List<AccessAdministration.Group> groups() { return access.groups(); }
  @PostMapping("/groups") AccessAdministration.Group createGroup(@RequestBody GroupDefinition group) { return access.createGroup(group.key(), group.displayName()); }
  @PostMapping("/groups/{key}/members") AccessAdministration.Group addMember(@PathVariable String key, @RequestBody Member member) { return access.addMember(key, member.userId()); }
  @DeleteMapping("/groups/{key}/members/{userId}") AccessAdministration.Group removeMember(@PathVariable String key, @PathVariable UUID userId) { return access.removeMember(key, userId); }

  @GetMapping("/roles") List<AccessAdministration.Role> roles() { return access.roles(); }
  @PostMapping("/roles") AccessAdministration.Role createRole(@RequestBody RoleDefinition role) { return access.createRole(role.key(), role.displayName(), role.description()); }
  @PostMapping("/roles/{key}/archive") AccessAdministration.Role archiveRole(@PathVariable String key, @RequestBody Revision revision) { return access.archiveRole(key, revision.revision()); }
  @GetMapping("/roles/{key}/assignments") List<AccessAdministration.Assignment> assignments(@PathVariable String key) { return access.assignments(key); }
  @PostMapping("/roles/{key}/assignments") AccessAdministration.Assignment assign(@PathVariable String key, @RequestBody SubjectReference subject) { return access.assign(key, subject.subject()); }

  @DeleteMapping("/roles/{key}/assignments/{id}")
  ResponseEntity<Void> unassign(@PathVariable String key, @PathVariable UUID id) {
    access.revokeAssignment(key, id);
    return ResponseEntity.noContent().build();
  }

  @GetMapping("/grants") List<AccessAdministration.Grant> grants(@RequestParam Map<String, String> filter) { return access.grants(filter); }

  @GetMapping("/applications/{application}/resources/{resource}/access")
  AccessAdministration.ResourceAccess resourceAccess(@PathVariable String application, @PathVariable String resource) { return access.resourceAccess(application, resource); }

  /** Read-only inspection (POST for its body): authoritative decisions plus the relational paths that explain them. */
  @PostMapping("/access/inspect")
  @PlatformAccess(Relation.READER)
  AccessAdministration.Inspection inspect(@RequestBody InspectRequest request) {
    return access.inspect(request.userId(), request.applicationKey(), request.resourceKey());
  }
  @PostMapping("/grants") AccessAdministration.Grant grant(@RequestBody AccessAdministration.NewGrant grant) { return access.grant(grant); }

  @DeleteMapping("/grants/{id}")
  ResponseEntity<Void> revoke(@PathVariable UUID id) {
    access.revokeGrant(id);
    return ResponseEntity.noContent().build();
  }

  @GetMapping("/platform-roles") List<AccessAdministration.PlatformAssignment> platformAssignments() { return access.platformAssignments(); }

  @PostMapping("/platform-roles")
  @PlatformAccess(Relation.SUPER_ADMIN)
  AccessAdministration.PlatformAssignment assignPlatformRole(@RequestBody PlatformRoleRequest request) { return access.assignPlatformRole(request.role(), request.subject()); }

  @DeleteMapping("/platform-roles/{id}")
  @PlatformAccess(Relation.SUPER_ADMIN)
  ResponseEntity<Void> revokePlatformRole(@PathVariable UUID id) {
    access.revokePlatformRole(id);
    return ResponseEntity.noContent().build();
  }
}
