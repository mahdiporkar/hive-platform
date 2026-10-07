package io.hiveplatform.authorization.graph;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Transactional outbox for OpenFGA. Writers enqueue tuples inside their database transaction; projection happens
 * after commit, outside any claim transaction, in id order per tuple. Lost claim ownership is a coordination fault,
 * never silently retried as a projection failure.
 */
@Component
public class GraphOutbox {
  public record Pending(long id, String operation, String subject, String relation, String object) {}

  private static final Logger log = LoggerFactory.getLogger(GraphOutbox.class);
  private static final int BATCH = 100;
  private final JdbcClient db;
  private final OpenFgaClient client;
  private final GraphStore store;
  private final DecisionCache cache;
  private final int maxAttempts;
  private final int claimTimeoutSeconds;

  public GraphOutbox(JdbcClient db, OpenFgaClient client, GraphStore store, DecisionCache cache,
      @Value("${hive.outbox.max-attempts:12}") int maxAttempts, @Value("${hive.outbox.claim-timeout-seconds:60}") int claimTimeoutSeconds) {
    this.db = db;
    this.client = client;
    this.store = store;
    this.cache = cache;
    this.maxAttempts = maxAttempts;
    this.claimTimeoutSeconds = claimTimeoutSeconds;
  }

  /** Must be called inside the transaction that changes the relational source of truth. */
  public void write(OpenFgaClient.Tuple tuple) { enqueue("WRITE", tuple); }
  public void delete(OpenFgaClient.Tuple tuple) { enqueue("DELETE", tuple); }

  private void enqueue(String operation, OpenFgaClient.Tuple tuple) {
    if (!TransactionSynchronizationManager.isActualTransactionActive()) throw new IllegalStateException("Graph changes require a transaction");
    db.sql("insert into graph_outbox(operation, subject, relation, object) values (?, ?, ?, ?)")
        .params(operation, tuple.user(), tuple.relation(), tuple.object()).update();
    if (TransactionSynchronizationManager.isSynchronizationActive() && !Boolean.TRUE.equals(TransactionSynchronizationManager.getResource(this))) {
      TransactionSynchronizationManager.bindResource(this, Boolean.TRUE);
      TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
        @Override public void afterCompletion(int status) { TransactionSynchronizationManager.unbindResourceIfPossible(GraphOutbox.this); }
        @Override public void afterCommit() {
          // Read-your-writes for administrative callers; the scheduler is the safety net.
          try { drain(Duration.ofSeconds(5)); } catch (RuntimeException failure) { log.warn("Deferred graph projection: {}", failure.getMessage()); }
        }
      });
    }
  }

  @Scheduled(fixedDelayString = "${hive.outbox.interval-ms:1000}", initialDelayString = "${hive.outbox.initial-delay-ms:1000}")
  public void scheduled() {
    try { drain(Duration.ofSeconds(10)); } catch (RuntimeException failure) { log.debug("Graph projection deferred: {}", failure.getMessage()); }
  }

  /** Projects claimable events until none remain or the deadline passes. Returns events applied. */
  public int drain(Duration budget) {
    Instant deadline = Instant.now().plus(budget);
    int applied = 0;
    while (Instant.now().isBefore(deadline)) {
      UUID owner = UUID.randomUUID();
      List<Pending> batch = claim(owner);
      if (batch.isEmpty()) break;
      var coordinates = store.coordinates();
      for (Pending event : batch) {
        var tuple = new OpenFgaClient.Tuple(event.subject(), event.relation(), event.object());
        try {
          cache.invalidate();
          if ("WRITE".equals(event.operation())) client.write(coordinates.storeId(), coordinates.modelId(), List.of(tuple), List.of());
          else client.write(coordinates.storeId(), coordinates.modelId(), List.of(), List.of(tuple));
          cache.invalidate();
        } catch (RuntimeException failure) {
          if (failure instanceof OpenFgaClient.GraphUnavailable unavailable) store.invalidateIfMissing(unavailable);
          retry(event.id(), owner, failure.getMessage());
          continue;
        }
        if (db.sql("update graph_outbox set processed_at = now(), attempts = attempts + 1, last_error = null, claimed_at = null, claim_owner = null where id = ? and claim_owner = ?")
            .params(event.id(), owner).update() != 1) throw new IllegalStateException("Graph outbox claim lost before completion");
        applied++;
      }
    }
    return applied;
  }

  public long pending() {
    return db.sql("select count(*) from graph_outbox where processed_at is null and dead_lettered_at is null").query(Long.class).single();
  }

  public long deadLettered() {
    return db.sql("select count(*) from graph_outbox where dead_lettered_at is not null").query(Long.class).single();
  }

  private List<Pending> claim(UUID owner) {
    // An event is claimable only when no older unprocessed event exists for the same tuple, preserving write/delete order.
    return db.sql("""
        with candidates as (
          select c.id from graph_outbox c
          where c.processed_at is null and c.dead_lettered_at is null and c.available_at <= now()
            and (c.claimed_at is null or c.claimed_at < now() - make_interval(secs => :timeout))
            and not exists (select 1 from graph_outbox o where o.subject = c.subject and o.relation = c.relation
                            and o.object = c.object and o.id < c.id and o.processed_at is null)
          order by c.id for update skip locked limit :limit)
        update graph_outbox e set claimed_at = now(), claim_owner = :owner from candidates where e.id = candidates.id
        returning e.id, e.operation, e.subject, e.relation, e.object""")
        .param("timeout", claimTimeoutSeconds).param("limit", BATCH).param("owner", owner)
        .query((rs, n) -> new Pending(rs.getLong("id"), rs.getString("operation"), rs.getString("subject"), rs.getString("relation"), rs.getString("object")))
        .list().stream().sorted((a, b) -> Long.compare(a.id(), b.id())).toList();
  }

  private void retry(long id, UUID owner, String error) {
    String safe = error == null ? "unknown" : error.length() > 900 ? error.substring(0, 900) : error;
    db.sql("""
        update graph_outbox set attempts = attempts + 1,
          available_at = now() + make_interval(secs => least(300, cast(power(2, least(attempts, 8)) as integer))),
          dead_lettered_at = case when attempts + 1 >= :max then now() else null end,
          last_error = :error, claimed_at = null, claim_owner = null
        where id = :id and claim_owner = :owner""")
        .param("max", maxAttempts).param("error", safe).param("id", id).param("owner", owner).update();
  }
}
