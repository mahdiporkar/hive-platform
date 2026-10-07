package io.hiveplatform.bff.observability;

import io.hiveplatform.bff.control.ControlPlaneClient;
import io.hiveplatform.spring.CorrelationId;
import io.hiveplatform.spring.Redaction;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.atomic.AtomicLong;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * Delivers API log entries and BFF audit events to the authorization service asynchronously so request latency
 * never depends on log persistence. Queues are bounded; overflow is counted and logged, never blocking a request.
 */
public final class ObservabilityPublisher {
  public record ApiLogEntry(String correlationId, String actorId, String method, String routeKey, String operationKey, String pathTemplate, int status,
      Integer upstreamStatus, int durationMs, String outcome, String reason, String access) {}
  public record AuditEvent(String eventType, String outcome, String actorId, String correlationId, Map<String, Object> details) {}

  private static final Logger log = LoggerFactory.getLogger(ObservabilityPublisher.class);
  private final ControlPlaneClient control;
  private final BlockingQueue<ApiLogEntry> apiLogs = new ArrayBlockingQueue<>(10_000);
  private final BlockingQueue<AuditEvent> events = new ArrayBlockingQueue<>(2_000);
  private final AtomicLong dropped = new AtomicLong();

  public ObservabilityPublisher(ControlPlaneClient control) { this.control = control; }

  public void apiLog(ApiLogEntry entry) {
    if (!apiLogs.offer(entry)) log.warn("API log queue full; dropped {} entries so far", dropped.incrementAndGet());
  }

  @SuppressWarnings("unchecked")
  public void audit(String eventType, String outcome, String actorId, Map<String, Object> details) {
    var event = new AuditEvent(eventType, outcome, actorId, CorrelationId.current(), (Map<String, Object>) Redaction.value(details));
    if (!events.offer(event)) log.warn("Audit queue full; dropped {} entries so far", dropped.incrementAndGet());
  }

  public long dropped() { return dropped.get(); }

  @Scheduled(fixedDelayString = "${hive.observability.flush-ms:300}")
  public void flush() {
    send("/internal/observability/api-logs", apiLogs);
    send("/internal/observability/audit", events);
  }

  private <T> void send(String path, BlockingQueue<T> queue) {
    while (!queue.isEmpty()) {
      List<T> batch = new ArrayList<>();
      queue.drainTo(batch, 200);
      try {
        control.post(path, batch);
      } catch (RuntimeException failure) {
        // Requeue what fits; persistence will be retried on the next tick.
        int requeued = 0;
        for (T item : batch) if (queue.offer(item)) requeued++;
        if (requeued < batch.size()) dropped.addAndGet(batch.size() - requeued);
        log.debug("Observability delivery deferred: {}", failure.getMessage());
        return;
      }
    }
  }
}
