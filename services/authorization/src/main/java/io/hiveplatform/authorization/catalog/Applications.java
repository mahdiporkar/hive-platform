package io.hiveplatform.authorization.catalog;

import io.hiveplatform.authorization.audit.AuditLog;
import io.hiveplatform.spring.HiveException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Applications are the top-level ownership boundary for modules, resources, routes and grants. */
@Service
public class Applications {
  public record Application(UUID id, String key, String displayName, boolean archived, long revision, Instant createdAt) {}
  public record Definition(String key, String displayName) {}

  private static final Pattern KEY = Pattern.compile("[a-z][a-z0-9-]{1,79}");
  private final JdbcClient db;
  private final ResourceCatalog catalog;
  private final AuditLog audit;

  public Applications(JdbcClient db, ResourceCatalog catalog, AuditLog audit) {
    this.db = db;
    this.catalog = catalog;
    this.audit = audit;
  }

  public List<Application> list() {
    return db.sql("select id, application_key, display_name, archived, revision, created_at from application order by application_key")
        .query((rs, n) -> new Application(rs.getObject("id", UUID.class), rs.getString("application_key"), rs.getString("display_name"),
            rs.getBoolean("archived"), rs.getLong("revision"), rs.getTimestamp("created_at").toInstant())).list();
  }

  public Application get(String key) {
    return list().stream().filter(a -> a.key().equals(key)).findFirst().orElseThrow(() -> HiveException.notFound("Unknown application " + key));
  }

  @Transactional
  public Application create(Definition definition) {
    if (definition == null || definition.key() == null || !KEY.matcher(definition.key()).matches())
      throw HiveException.invalid("Application key must match " + KEY.pattern());
    requireName(definition.displayName());
    UUID id = UUID.randomUUID();
    if (db.sql("insert into application(id, application_key, display_name) values (?, ?, ?) on conflict (application_key) do nothing")
        .params(id, definition.key(), definition.displayName()).update() != 1) throw HiveException.conflict("Application " + definition.key() + " already exists");
    catalog.createRoot(id, definition.key(), definition.displayName());
    audit.success("application.created", Map.of("application", definition.key()));
    return get(definition.key());
  }

  @Transactional
  public Application update(String key, String displayName, Boolean archived, long revision) {
    requireName(displayName);
    Application current = get(key);
    boolean archive = archived == null ? current.archived() : archived;
    if (db.sql("update application set display_name = ?, archived = ?, revision = revision + 1, updated_at = now() where application_key = ? and revision = ?")
        .params(displayName, archive, key, revision).update() != 1) throw HiveException.stale();
    db.sql("update resource set display_name = ? where application_id = ? and resource_type = 'APPLICATION'").params(displayName, current.id()).update();
    audit.success(archive != current.archived() ? (archive ? "application.archived" : "application.restored") : "application.updated", Map.of("application", key));
    return get(key);
  }

  private static void requireName(String displayName) {
    if (displayName == null || displayName.isBlank() || displayName.length() > 255) throw HiveException.invalid("displayName is required (max 255 characters)");
  }
}
