package io.hiveplatform.authorization.access;

import io.hiveplatform.authorization.audit.AuditLog;
import io.hiveplatform.authorization.graph.Graph;
import io.hiveplatform.authorization.graph.GraphOutbox;
import io.hiveplatform.authorization.graph.OpenFgaClient.Tuple;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * One-time bootstrap of the first platform super administrator from deployment configuration
 * ({@code HIVE_BOOTSTRAP_ADMIN_ISSUER} + {@code HIVE_BOOTSTRAP_ADMIN_SUBJECT}). The canonical user, the external identity
 * binding, the platform role, its audit entry and a durable completion marker commit together; once completed the
 * bootstrap never runs again, so revoking that administrator later is final. No administrator is ever invented.
 */
@Component
class FirstAdministrator {
  private static final Logger log = LoggerFactory.getLogger(FirstAdministrator.class);
  private final JdbcClient db;
  private final TransactionTemplate tx;
  private final GraphOutbox graph;
  private final AuditLog audit;
  private final String issuer;
  private final String subject;

  FirstAdministrator(JdbcClient db, TransactionTemplate tx, GraphOutbox graph, AuditLog audit,
      @Value("${hive.bootstrap.admin-issuer:${hive.identity.primary-issuer:}}") String issuer, @Value("${hive.bootstrap.admin-subject:}") String subject) {
    this.db = db;
    this.tx = tx;
    this.graph = graph;
    this.audit = audit;
    this.issuer = issuer == null ? "" : issuer.trim();
    this.subject = subject == null ? "" : subject.trim();
    if (this.subject.length() > 255 || this.subject.chars().anyMatch(c -> Character.isISOControl(c) || Character.isWhitespace(c)))
      throw new IllegalArgumentException("HIVE_BOOTSTRAP_ADMIN_SUBJECT must be a stable subject without whitespace (max 255)");
    if (!this.subject.isEmpty() && this.issuer.isEmpty()) throw new IllegalArgumentException("HIVE_BOOTSTRAP_ADMIN_ISSUER (or HIVE_PRIMARY_ISSUER) is required");
  }

  @EventListener(ApplicationReadyEvent.class)
  void provision() {
    if (subject.isEmpty()) return;
    String outcome = tx.execute(status -> {
      db.sql("select pg_advisory_xact_lock(hashtextextended('hive.bootstrap.first-administrator', 0))").query().singleValue();
      if (db.sql("select count(*) from platform_bootstrap where bootstrap_key = 'first-administrator'").query(Long.class).single() > 0) return "ALREADY_COMPLETED";
      UUID user = db.sql("select user_id from external_identity where issuer = ? and subject = ?").params(issuer, subject).query(UUID.class).optional().orElseGet(() -> {
        UUID id = UUID.randomUUID();
        db.sql("insert into hive_user(id, tenant_id, display_name) values (?, 'default', 'Bootstrap administrator')").param(id).update();
        db.sql("insert into external_identity(issuer, subject, user_id) values (?, ?, ?)").params(issuer, subject, id).update();
        return id;
      });
      db.sql("insert into platform_role_assignment(id, platform_role, subject_type, subject_id, created_by) values (?, 'SUPER_ADMIN', 'USER', ?, 'bootstrap') on conflict do nothing")
          .params(UUID.randomUUID(), user).update();
      graph.write(new Tuple(Graph.user(user), Graph.PlatformRole.SUPER_ADMIN.relation, Graph.PLATFORM));
      db.sql("insert into platform_bootstrap(bootstrap_key, details) values ('first-administrator', cast(? as jsonb))").param("{\"user\":\"" + user + "\"}").update();
      audit.recordAs("bootstrap", "platform-role.bootstrap", "SUCCESS", Map.of("user", user.toString(), "role", "SUPER_ADMIN"), UUID.randomUUID().toString());
      return "COMPLETED";
    });
    log.info("First administrator bootstrap: {}", outcome);
  }
}
