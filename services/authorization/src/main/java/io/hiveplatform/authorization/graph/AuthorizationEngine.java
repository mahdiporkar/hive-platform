package io.hiveplatform.authorization.graph;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * Runtime authorization decisions. Default is DENY: unknown users, inactive users, unknown or archived resources,
 * undeclared actions and graph failures all deny with an explicit reason. Only the relationship graph can allow.
 */
@Service
public class AuthorizationEngine {
  public record Check(String applicationKey, String resourceKey, String action) {}
  public record Decision(String applicationKey, String resourceKey, String action, boolean allowed, String reason) {}

  private record CatalogEntry(UUID resourceId, boolean archived, Set<String> actions) {}

  private final JdbcClient db;
  private final OpenFgaClient client;
  private final GraphStore store;
  private final DecisionCache cache;

  public AuthorizationEngine(JdbcClient db, OpenFgaClient client, GraphStore store, DecisionCache cache) {
    this.db = db;
    this.client = client;
    this.store = store;
    this.cache = cache;
  }

  public List<Decision> check(UUID userId, List<Check> checks) {
    if (checks.size() > 2000) throw new IllegalArgumentException("At most 2000 checks per request");
    List<Decision> result = new ArrayList<>(checks.size());
    boolean active = userId != null && db.sql("select count(*) from hive_user where id = ? and active").param(userId).query(Long.class).single() == 1;
    Map<String, CatalogEntry> catalog = catalog(checks);
    Map<Integer, OpenFgaClient.Tuple> graphChecks = new LinkedHashMap<>();
    for (int i = 0; i < checks.size(); i++) {
      Check check = checks.get(i);
      CatalogEntry entry = catalog.get(check.applicationKey() + ":" + check.resourceKey());
      String reason = !active ? "USER_UNKNOWN_OR_INACTIVE"
          : entry == null ? "RESOURCE_UNKNOWN"
          : entry.archived() ? "RESOURCE_ARCHIVED"
          : check.action() == null || !(Graph.MANAGE.equals(check.action()) || entry.actions().contains(check.action())) ? "ACTION_UNDECLARED"
          : null;
      result.add(new Decision(check.applicationKey(), check.resourceKey(), check.action(), false, reason == null ? "PENDING" : reason));
      if (reason == null) graphChecks.put(i, Graph.decision(userId, entry.resourceId(), check.action()));
    }
    if (graphChecks.isEmpty()) return result;
    Map<OpenFgaClient.Tuple, Boolean> decisions = evaluate(new ArrayList<>(graphChecks.values()));
    graphChecks.forEach((index, tuple) -> {
      Decision pending = result.get(index);
      Boolean allowed = decisions.get(tuple);
      result.set(index, new Decision(pending.applicationKey(), pending.resourceKey(), pending.action(), Boolean.TRUE.equals(allowed),
          allowed == null ? "GRAPH_UNAVAILABLE" : allowed ? "ALLOWED" : "NO_RELATIONSHIP"));
    });
    return result;
  }

  public Decision check(UUID userId, Check check) { return check(userId, List.of(check)).getFirst(); }

  /** Platform (control-plane) role check; fails closed. */
  public boolean platform(UUID userId, Graph.PlatformRole role) { return platformRelation(userId, role.relation); }

  public boolean platformRelation(UUID userId, String relation) {
    if (userId == null) return false;
    boolean active = db.sql("select count(*) from hive_user where id = ? and active").param(userId).query(Long.class).single() == 1;
    if (!active) return false;
    var tuple = new OpenFgaClient.Tuple(Graph.user(userId), relation, Graph.PLATFORM);
    return Boolean.TRUE.equals(evaluate(List.of(tuple)).get(tuple));
  }

  private Map<OpenFgaClient.Tuple, Boolean> evaluate(List<OpenFgaClient.Tuple> tuples) {
    Map<OpenFgaClient.Tuple, Boolean> decisions = new HashMap<>();
    String epoch = cache.epoch();
    List<OpenFgaClient.Tuple> missing = new ArrayList<>();
    for (var tuple : tuples) {
      Boolean cached = cache.get(epoch, tuple);
      if (cached == null) missing.add(tuple); else decisions.put(tuple, cached);
    }
    if (missing.isEmpty()) return decisions;
    try {
      var coordinates = store.coordinates();
      Map<OpenFgaClient.Tuple, Boolean> fresh = missing.size() == 1
          ? Map.of(missing.getFirst(), client.check(coordinates.storeId(), coordinates.modelId(), missing.getFirst()))
          : client.batchCheck(coordinates.storeId(), coordinates.modelId(), missing);
      fresh.forEach((tuple, allowed) -> {
        decisions.put(tuple, allowed);
        cache.put(epoch, tuple, allowed);
      });
    } catch (OpenFgaClient.GraphUnavailable unavailable) {
      // Fail closed: absent entries are reported as GRAPH_UNAVAILABLE by the caller.
      store.invalidateIfMissing(unavailable);
    } catch (RuntimeException unavailable) {
      // Fail closed.
    }
    return decisions;
  }

  private Map<String, CatalogEntry> catalog(List<Check> checks) {
    Map<String, CatalogEntry> entries = new HashMap<>();
    var keys = checks.stream().map(c -> c.applicationKey() + ":" + c.resourceKey()).distinct().toList();
    if (keys.isEmpty()) return entries;
    db.sql("""
        select a.application_key || ':' || r.resource_key as fq, r.id, (r.archived or a.archived) as archived,
               coalesce(array_agg(ra.action_key) filter (where ra.action_key is not null and not ra.archived), '{}') as actions
        from resource r join application a on a.id = r.application_id
        left join resource_action ra on ra.resource_id = r.id
        where a.application_key || ':' || r.resource_key = any(:keys)
        group by a.application_key, r.resource_key, r.id, r.archived, a.archived""")
        .param("keys", keys.toArray(String[]::new))
        .query((rs, n) -> {
          entries.put(rs.getString("fq"), new CatalogEntry(rs.getObject("id", UUID.class), rs.getBoolean("archived"),
              Set.of((String[]) rs.getArray("actions").getArray())));
          return null;
        }).list();
    return entries;
  }
}
