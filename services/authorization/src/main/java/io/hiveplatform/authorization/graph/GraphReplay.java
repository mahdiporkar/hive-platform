package io.hiveplatform.authorization.graph;

import io.hiveplatform.authorization.access.AccessAdministration;
import io.hiveplatform.authorization.audit.AuditLog;
import io.hiveplatform.authorization.catalog.ResourceCatalog;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/** Replays the complete relational authorization state into OpenFGA (idempotent writes). */
@Component
public class GraphReplay {
  private static final Logger log = LoggerFactory.getLogger(GraphReplay.class);
  private final ResourceCatalog catalog;
  private final AccessAdministration access;
  private final GraphOutbox outbox;
  private final GraphStore store;
  private final AuditLog audit;
  private final TransactionTemplate tx;

  public GraphReplay(ResourceCatalog catalog, AccessAdministration access, GraphOutbox outbox, GraphStore store, AuditLog audit, TransactionTemplate tx) {
    this.catalog = catalog;
    this.access = access;
    this.outbox = outbox;
    this.store = store;
    this.audit = audit;
    this.tx = tx;
  }

  public int replay(String reason) {
    return tx.execute(status -> {
      var tuples = new java.util.ArrayList<>(catalog.projection());
      tuples.addAll(access.projection());
      if (tuples.isEmpty()) return 0;
      tuples.forEach(outbox::write);
      audit.success("graph.replayed", Map.of("tuples", tuples.size(), "reason", reason));
      return tuples.size();
    });
  }

  /** Detects a newly created (empty) store, e.g. after OpenFGA data loss, and replays the source of truth. */
  @Scheduled(fixedDelayString = "${hive.graph.store-check-interval-ms:5000}", initialDelay = 0)
  public void replayIfFresh() {
    try {
      store.verify();
      store.coordinates();
      if (store.consumeFreshStore()) log.info("Replayed {} relationships into a new authorization store", replay("NEW_STORE"));
    } catch (RuntimeException unavailable) {
      log.debug("Authorization graph not ready: {}", unavailable.getMessage());
    }
  }
}
