package io.hiveplatform.authorization.audit;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.hiveplatform.authorization.admin.Actor;
import io.hiveplatform.spring.CorrelationId;
import io.hiveplatform.spring.Redaction;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/** Append-only audit trail. Details are recursively redacted before persistence. */
@Component
public class AuditLog {
  public record Event(UUID id, Instant occurredAt, String actorId, String eventType, String correlationId, String outcome, String details) {}

  private final JdbcClient db;
  private final ObjectMapper json;

  public AuditLog(JdbcClient db, ObjectMapper json) {
    this.db = db;
    this.json = json;
  }

  public void success(String eventType, Map<String, ?> details) { record(eventType, "SUCCESS", details); }
  public void denied(String eventType, Map<String, ?> details) { record(eventType, "DENIED", details); }

  public void record(String eventType, String outcome, Map<String, ?> details) {
    recordAs(Actor.currentId(), eventType, outcome, details, CorrelationId.current());
  }

  public void recordAs(String actor, String eventType, String outcome, Map<String, ?> details, String correlationId) {
    try {
      db.sql("insert into audit_event(id, actor_id, event_type, correlation_id, outcome, details) values (?, ?, ?, ?, ?, cast(? as jsonb))")
          .params(UUID.randomUUID(), actor, eventType, CorrelationId.sanitize(correlationId), outcome,
              json.writeValueAsString(Redaction.value(details == null ? Map.of() : details)))
          .update();
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("Audit details are not serializable", e);
    }
  }

  public List<Event> search(String eventPrefix, String actor, String correlationId, Instant before, int limit) {
    return db.sql("""
        select id, occurred_at, actor_id, event_type, correlation_id, outcome, details::text as details from audit_event
        where (:prefix = '' or event_type like :prefix || '%') and (:actor = '' or actor_id = :actor)
          and (:correlation = '' or correlation_id = :correlation) and occurred_at < :before
        order by occurred_at desc, id limit :limit""")
        .param("prefix", eventPrefix == null ? "" : eventPrefix).param("actor", actor == null ? "" : actor)
        .param("correlation", correlationId == null ? "" : correlationId)
        .param("before", Timestamp.from(before == null ? Instant.now().plusSeconds(1) : before))
        .param("limit", Math.max(1, Math.min(limit, 500)))
        .query((rs, n) -> new Event(rs.getObject("id", UUID.class), rs.getTimestamp("occurred_at").toInstant(), rs.getString("actor_id"),
            rs.getString("event_type"), rs.getString("correlation_id"), rs.getString("outcome"), rs.getString("details")))
        .list();
  }
}
