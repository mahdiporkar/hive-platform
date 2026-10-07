package io.hiveplatform.authorization.graph;

import io.hiveplatform.authorization.access.AccessAdministration;
import io.hiveplatform.authorization.admin.PlatformAccess;
import io.hiveplatform.authorization.admin.PlatformAccess.Relation;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Runtime decision API (BFF only) and administrative diagnostics. */
@RestController
class AuthorizationController {
  record CheckRequest(UUID userId, List<AuthorizationEngine.Check> checks) {}
  record GraphStatus(boolean ready, long pending, long deadLettered, boolean cacheEnabled) {}

  private final AuthorizationEngine engine;
  private final AccessAdministration access;
  private final GraphOutbox outbox;
  private final GraphStore store;
  private final DecisionCache cache;
  private final GraphReplay replay;

  AuthorizationController(AuthorizationEngine engine, AccessAdministration access, GraphOutbox outbox, GraphStore store, DecisionCache cache, GraphReplay replay) {
    this.engine = engine;
    this.access = access;
    this.outbox = outbox;
    this.store = store;
    this.cache = cache;
    this.replay = replay;
  }

  @PostMapping("/internal/authorization/check")
  List<AuthorizationEngine.Decision> check(@RequestBody CheckRequest request) {
    return engine.check(request.userId(), request.checks() == null ? List.of() : request.checks());
  }

  @GetMapping("/internal/authorization/platform-roles")
  List<String> platformRoles(@RequestParam UUID userId) {
    // Enforced view: only roles the graph confirms.
    return java.util.Arrays.stream(Graph.PlatformRole.values()).filter(role -> engine.platform(userId, role)).map(Enum::name).toList();
  }

  @PostMapping("/admin/diagnostics/authorization/check")
  @PlatformAccess(Relation.AUDITOR)
  Map<String, Object> explain(@RequestBody CheckRequest request) {
    return Map.of("decisions", engine.check(request.userId(), request.checks()), "platformRoles", access.platformRolesOf(request.userId()));
  }

  @GetMapping("/admin/diagnostics/graph")
  @PlatformAccess(Relation.READER)
  GraphStatus status() {
    boolean ready;
    try { store.coordinates(); ready = true; } catch (RuntimeException e) { ready = false; }
    return new GraphStatus(ready, outbox.pending(), outbox.deadLettered(), cache.enabled());
  }

  @PostMapping("/admin/diagnostics/graph/replay")
  @PlatformAccess(Relation.SUPER_ADMIN)
  Map<String, Object> replay() { return Map.of("enqueued", replay.replay("OPERATOR_REQUEST")); }
}
