package io.hiveplatform.authorization.routing;

import io.hiveplatform.authorization.audit.AuditLog;
import io.hiveplatform.spring.CorrelationId;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * API log for proxied runtime calls. Entries carry route/operation identity and templates, never query strings, bodies,
 * headers or credentials. Protected and denied calls are additionally written to the audit trail.
 */
@Service
public class ApiLog {
  public record Entry(String correlationId, String actorId, String method, String routeKey, String operationKey, String pathTemplate, int status,
      Integer upstreamStatus, int durationMs, String outcome, String reason, String access) {}
  public record Row(long id, Instant occurredAt, String correlationId, String actorId, String method, String routeKey, String operationKey, String pathTemplate,
      int status, Integer upstreamStatus, int durationMs, String outcome, String reason) {}

  private static final Set<String> OUTCOMES = Set.of("SUCCESS", "DENIED", "UNAUTHENTICATED", "NOT_FOUND", "UPSTREAM_ERROR", "REJECTED");
  private final JdbcClient db;
  private final AuditLog audit;

  public ApiLog(JdbcClient db, AuditLog audit) {
    this.db = db;
    this.audit = audit;
  }

  @Transactional
  public int record(List<Entry> entries) {
    if (entries.size() > 500) throw new IllegalArgumentException("At most 500 entries per batch");
    for (Entry e : entries) {
      if (!OUTCOMES.contains(e.outcome())) throw new IllegalArgumentException("Unknown outcome " + e.outcome());
      String correlation = CorrelationId.sanitize(e.correlationId());
      db.sql("insert into api_log(correlation_id, actor_id, http_method, route_key, operation_key, path_template, status, upstream_status, duration_ms, outcome, reason) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .params(correlation, trim(e.actorId(), 255), trim(e.method(), 8), trim(e.routeKey(), 80), trim(e.operationKey(), 80), trim(e.pathTemplate(), 600), e.status(),
              e.upstreamStatus(), Math.max(0, e.durationMs()), e.outcome(), trim(e.reason(), 64)).update();
      boolean protectedCall = "AUTHENTICATED".equals(e.access());
      if (protectedCall || "DENIED".equals(e.outcome()) || "UNAUTHENTICATED".equals(e.outcome())) {
        var details = new LinkedHashMap<String, Object>();
        details.put("route", String.valueOf(e.routeKey()));
        details.put("operation", String.valueOf(e.operationKey()));
        details.put("method", String.valueOf(e.method()));
        details.put("pathTemplate", String.valueOf(e.pathTemplate()));
        details.put("status", e.status());
        details.put("reason", String.valueOf(e.reason()));
        String outcome = "SUCCESS".equals(e.outcome()) ? "SUCCESS" : "UPSTREAM_ERROR".equals(e.outcome()) ? "FAILURE" : "DENIED";
        audit.recordAs(e.actorId() == null ? "anonymous" : e.actorId(), "SUCCESS".equals(outcome) ? "route.invoked" : "route.denied", outcome, details, correlation);
      }
    }
    return entries.size();
  }

  public record BffEvent(String eventType, String outcome, String actorId, String correlationId, Map<String, Object> details) {}
  /** Audit events the BFF may originate; anything else is rejected rather than trusted. */
  private static final Set<String> BFF_EVENTS = Set.of("legacy-token.acquired", "legacy-token.failed", "legacy-token.invalidated");

  @Transactional
  public int recordEvents(List<BffEvent> events) {
    if (events.size() > 500) throw new IllegalArgumentException("At most 500 events per batch");
    for (BffEvent e : events) {
      if (!BFF_EVENTS.contains(e.eventType())) throw new IllegalArgumentException("Event type not accepted from the BFF: " + e.eventType());
      if (!Set.of("SUCCESS", "FAILURE", "DENIED").contains(e.outcome())) throw new IllegalArgumentException("Unknown outcome");
      audit.recordAs(e.actorId() == null ? "system:bff" : trim(e.actorId(), 255), e.eventType(), e.outcome(), e.details() == null ? Map.of() : e.details(), e.correlationId());
    }
    return events.size();
  }

  public List<Row> search(String routeKey, String outcome, String correlationId, Instant before, int limit) {
    return db.sql("""
        select * from api_log where (:route = '' or route_key = :route) and (:outcome = '' or outcome = :outcome)
          and (:correlation = '' or correlation_id = :correlation) and occurred_at < :before order by id desc limit :limit""")
        .param("route", routeKey == null ? "" : routeKey).param("outcome", outcome == null ? "" : outcome).param("correlation", correlationId == null ? "" : correlationId)
        .param("before", Timestamp.from(before == null ? Instant.now().plusSeconds(1) : before)).param("limit", Math.max(1, Math.min(limit, 1000)))
        .query((rs, n) -> new Row(rs.getLong("id"), rs.getTimestamp("occurred_at").toInstant(), rs.getString("correlation_id"), rs.getString("actor_id"),
            rs.getString("http_method"), rs.getString("route_key"), rs.getString("operation_key"), rs.getString("path_template"), rs.getInt("status"),
            (Integer) rs.getObject("upstream_status"), rs.getInt("duration_ms"), rs.getString("outcome"), rs.getString("reason"))).list();
  }

  private static String trim(String value, int max) { return value == null ? null : value.length() > max ? value.substring(0, max) : value; }
}
