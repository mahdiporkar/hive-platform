package io.hiveplatform.authorization.features;

import io.hiveplatform.authorization.admin.PlatformAccess;
import io.hiveplatform.authorization.admin.PlatformAccess.Relation;
import io.hiveplatform.authorization.audit.AuditLog;
import io.hiveplatform.spring.HiveException;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Boolean feature flags. Evaluation: tenant override, else the flag default; then the flag is off outside its listed
 * environments ({@code HIVE_ENVIRONMENT}). Unknown flags are absent and therefore off for consumers. PUBLIC flags reach
 * anonymous contexts, AUTHENTICATED flags only sessions, INTERNAL flags never leave the platform.
 */
@RestController
@PlatformAccess(Relation.OPERATOR)
public class FeatureFlags {
  public record Flag(String key, String description, boolean enabled, String exposure, List<String> environments, long revision, List<Override> overrides) {}
  public record Override(String scope, String value, boolean enabled) {}
  public record FlagRequest(String key, String description, Boolean enabled, String exposure, List<String> environments, Long revision) {}
  public record OverrideRequest(boolean enabled) {}
  public record Evaluated(String key, boolean enabled) {}

  private static final Pattern KEY = Pattern.compile("[a-z][a-zA-Z0-9.-]{1,119}");
  private static final Set<String> EXPOSURE = Set.of("PUBLIC", "AUTHENTICATED", "INTERNAL");
  private final JdbcClient db;
  private final AuditLog audit;
  private final String environment;

  FeatureFlags(JdbcClient db, AuditLog audit, @Value("${hive.environment:production}") String environment) {
    this.db = db;
    this.audit = audit;
    this.environment = environment;
  }

  @GetMapping("/admin/feature-flags")
  public List<Flag> flags() {
    return db.sql("select * from feature_flag order by flag_key").query((rs, n) -> {
      String key = rs.getString("flag_key");
      return new Flag(key, rs.getString("description"), rs.getBoolean("enabled"), rs.getString("exposure"), Arrays.asList((String[]) rs.getArray("environments").getArray()),
          rs.getLong("revision"), db.sql("select scope, scope_value, enabled from feature_flag_override where flag_key = ? order by scope, scope_value").param(key)
              .query((o, m) -> new Override(o.getString("scope"), o.getString("scope_value"), o.getBoolean("enabled"))).list());
    }).list();
  }

  @PostMapping("/admin/feature-flags")
  @Transactional
  public Flag create(@RequestBody FlagRequest r) {
    validate(r);
    if (db.sql("insert into feature_flag(flag_key, description, enabled, exposure, environments) values (?, ?, ?, ?, ?) on conflict do nothing")
        .params(r.key(), r.description(), Boolean.TRUE.equals(r.enabled()), r.exposure(), environments(r)).update() != 1) throw HiveException.conflict("Flag " + r.key() + " exists");
    audit.success("feature-flag.created", Map.of("flag", r.key(), "enabled", Boolean.TRUE.equals(r.enabled()), "exposure", r.exposure()));
    return flag(r.key());
  }

  @PutMapping("/admin/feature-flags/{key}")
  @Transactional
  public Flag update(@PathVariable String key, @RequestBody FlagRequest r) {
    var request = new FlagRequest(key, r.description(), r.enabled(), r.exposure(), r.environments(), r.revision());
    validate(request);
    if (db.sql("update feature_flag set description = ?, enabled = ?, exposure = ?, environments = ?, revision = revision + 1, updated_at = now() where flag_key = ? and revision = ?")
        .params(r.description(), Boolean.TRUE.equals(r.enabled()), r.exposure(), environments(request), key, r.revision() == null ? -1 : r.revision()).update() != 1) throw HiveException.stale();
    audit.success("feature-flag.updated", Map.of("flag", key, "enabled", Boolean.TRUE.equals(r.enabled()), "exposure", r.exposure()));
    return flag(key);
  }

  @PutMapping("/admin/feature-flags/{key}/overrides/{scope}/{value}")
  @Transactional
  public Flag override(@PathVariable String key, @PathVariable String scope, @PathVariable String value, @RequestBody OverrideRequest r) {
    flag(key);
    if (!Set.of("TENANT", "APPLICATION").contains(scope) || value.length() > 160 || !value.matches("[A-Za-z0-9._-]+")) throw HiveException.invalid("Invalid override scope");
    db.sql("insert into feature_flag_override(flag_key, scope, scope_value, enabled) values (?, ?, ?, ?) on conflict (flag_key, scope, scope_value) do update set enabled = excluded.enabled, updated_at = now()")
        .params(key, scope, value, r.enabled()).update();
    audit.success("feature-flag.override.set", Map.of("flag", key, "scope", scope, "value", value, "enabled", r.enabled()));
    return flag(key);
  }

  @DeleteMapping("/admin/feature-flags/{key}/overrides/{scope}/{value}")
  @Transactional
  public ResponseEntity<Void> removeOverride(@PathVariable String key, @PathVariable String scope, @PathVariable String value) {
    db.sql("delete from feature_flag_override where flag_key = ? and scope = ? and scope_value = ?").params(key, scope, value).update();
    audit.success("feature-flag.override.removed", Map.of("flag", key, "scope", scope, "value", value));
    return ResponseEntity.noContent().build();
  }

  /** Runtime evaluation for contexts; unauthenticated audiences only ever see PUBLIC flags. */
  @GetMapping("/internal/runtime/features")
  public Map<String, List<Evaluated>> evaluate(@RequestParam String audience, @RequestParam(required = false) UUID userId) {
    boolean authenticated = "AUTHENTICATED".equals(audience) && userId != null;
    String tenant = authenticated ? db.sql("select tenant_id from hive_user where id = ? and active").param(userId).query(String.class).optional().orElse(null) : null;
    var result = flags().stream()
        .filter(f -> "PUBLIC".equals(f.exposure()) || (authenticated && "AUTHENTICATED".equals(f.exposure())))
        .map(f -> {
          boolean enabled = f.enabled();
          if (tenant != null) for (var o : f.overrides()) if ("TENANT".equals(o.scope()) && o.value().equals(tenant)) enabled = o.enabled();
          if (!f.environments().isEmpty() && !f.environments().contains(environment)) enabled = false;
          return new Evaluated(f.key(), enabled);
        }).toList();
    return Map.of("features", result);
  }

  private Flag flag(String key) {
    return flags().stream().filter(f -> f.key().equals(key)).findFirst().orElseThrow(() -> HiveException.notFound("Unknown flag " + key));
  }

  private static void validate(FlagRequest r) {
    if (r.key() == null || !KEY.matcher(r.key()).matches()) throw HiveException.invalid("Flag key must match " + KEY.pattern());
    if (r.description() == null || r.description().isBlank() || r.description().length() > 500) throw HiveException.invalid("description is required");
    if (!EXPOSURE.contains(r.exposure())) throw HiveException.invalid("exposure must be PUBLIC, AUTHENTICATED or INTERNAL");
    if (r.environments() != null && r.environments().stream().anyMatch(e -> e == null || !e.matches("[a-z][a-z0-9-]{0,39}"))) throw HiveException.invalid("Invalid environment name");
  }

  private static String[] environments(FlagRequest r) { return r.environments() == null ? new String[0] : r.environments().toArray(String[]::new); }
}
