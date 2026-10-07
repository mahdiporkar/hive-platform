package io.hiveplatform.authorization.integrations;

import io.hiveplatform.artifacts.security.UiArtifactUriPolicy;
import io.hiveplatform.authorization.audit.AuditLog;
import io.hiveplatform.authorization.catalog.ResourceCatalog;
import io.hiveplatform.authorization.graph.AuthorizationEngine;
import io.hiveplatform.spring.HiveException;
import java.net.URI;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Optional Superset integration: registry of instances and assets, and the runtime decision for the BFF's
 * authorized tunnel. Only an allowlist of read operations is tunneled; each one is tied to an asset whose catalog
 * resource must be granted. Everything else is denied.
 */
@Service
public class SupersetIntegrations {
  public record Integration(String key, String applicationKey, String displayName, String baseUrl, boolean tlsRequired, String credentialReference,
      String resourceKey, boolean enabled, String healthStatus, long revision) {}
  public record IntegrationRequest(String key, String applicationKey, String displayName, String baseUrl, Boolean tlsRequired, String credentialReference, Boolean enabled, Long revision) {}
  public record Asset(String integrationKey, String assetType, String assetId, String displayName, String resourceKey) {}
  public record AssetRequest(String assetType, String assetId, String displayName) {}
  public record Resolution(boolean allowed, String reason, String baseUrl, boolean tlsRequired, String credentialReference, long revision, String operation) {}

  private static final Pattern KEY = Pattern.compile("[a-z][a-z0-9-]{1,59}");
  private static final Pattern ASSET = Pattern.compile("[a-z0-9-]{1,64}");
  private static final Pattern CREDENTIAL = Pattern.compile("env:HIVE_SECRET_[A-Z0-9_]{1,80}|file:[a-z0-9][a-z0-9-]{0,79}");
  private static final Pattern DASHBOARD = Pattern.compile("/api/v1/dashboard/([a-z0-9-]{1,64})(/charts)?/?");
  private static final Pattern CHART = Pattern.compile("/api/v1/chart/([a-z0-9-]{1,64})/?");

  private final JdbcClient db;
  private final ResourceCatalog catalog;
  private final AuthorizationEngine engine;
  private final UiArtifactUriPolicy policy;
  private final AuditLog audit;

  public SupersetIntegrations(JdbcClient db, ResourceCatalog catalog, AuthorizationEngine engine, @Qualifier("targetPolicy") UiArtifactUriPolicy policy, AuditLog audit) {
    this.db = db;
    this.catalog = catalog;
    this.engine = engine;
    this.policy = policy;
    this.audit = audit;
  }

  public List<Integration> integrations() {
    return db.sql("""
        select s.*, a.application_key, r.resource_key from superset_integration s join application a on a.id = s.application_id join resource r on r.id = s.resource_id
        order by s.integration_key""")
        .query((rs, n) -> new Integration(rs.getString("integration_key"), rs.getString("application_key"), rs.getString("display_name"), rs.getString("base_url"),
            rs.getBoolean("tls_required"), rs.getString("credential_reference"), rs.getString("resource_key"), rs.getBoolean("enabled"), rs.getString("health_status"),
            rs.getLong("revision"))).list();
  }

  public Integration integration(String key) {
    return integrations().stream().filter(i -> i.key().equals(key)).findFirst().orElseThrow(() -> HiveException.notFound("Unknown Superset integration " + key));
  }

  @Transactional
  public Integration create(IntegrationRequest r) {
    if (r.key() == null || !KEY.matcher(r.key()).matches()) throw HiveException.invalid("key must match " + KEY.pattern());
    boolean tls = r.tlsRequired() == null || r.tlsRequired();
    String base = baseUrl(r.baseUrl(), tls);
    credential(r.credentialReference());
    if (r.displayName() == null || r.displayName().isBlank()) throw HiveException.invalid("displayName is required");
    String resourceKey = "superset-" + r.key();
    catalog.createManual(r.applicationKey(), new ResourceCatalog.ResourceNode(resourceKey, "EXTERNAL_RESOURCE", r.applicationKey(), r.displayName(),
        List.of(new ResourceCatalog.ActionSpec("access", "Use this Superset integration"))));
    UUID resource = catalog.get(r.applicationKey(), resourceKey).id();
    db.sql("insert into superset_integration(id, integration_key, application_id, display_name, base_url, tls_required, credential_reference, resource_id, enabled) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .params(UUID.randomUUID(), r.key(), catalog.applicationId(r.applicationKey()), r.displayName(), base, tls, r.credentialReference(), resource, r.enabled() == null || r.enabled())
        .update();
    audit.success("superset.integration.created", Map.of("integration", r.key(), "baseUrl", base, "tlsRequired", tls));
    return integration(r.key());
  }

  @Transactional
  public Integration update(String key, IntegrationRequest r) {
    Integration current = integration(key);
    boolean tls = r.tlsRequired() == null ? current.tlsRequired() : r.tlsRequired();
    String base = baseUrl(r.baseUrl() == null ? current.baseUrl() : r.baseUrl(), tls);
    String credential = r.credentialReference() == null ? current.credentialReference() : r.credentialReference();
    credential(credential);
    if (db.sql("update superset_integration set display_name = coalesce(?, display_name), base_url = ?, tls_required = ?, credential_reference = ?, enabled = coalesce(?, enabled), revision = revision + 1 where integration_key = ? and revision = ?")
        .params(r.displayName(), base, tls, credential, r.enabled(), key, r.revision() == null ? -1 : r.revision()).update() != 1) throw HiveException.stale();
    audit.success(Boolean.FALSE.equals(r.enabled()) ? "superset.integration.disabled" : "superset.integration.updated", Map.of("integration", key));
    return integration(key);
  }

  public List<Asset> assets(String key) {
    integration(key);
    return db.sql("""
        select s.integration_key, a.asset_type, a.asset_id, a.display_name, r.resource_key from superset_asset a join superset_integration s on s.id = a.integration_id
        join resource r on r.id = a.resource_id where s.integration_key = ? order by a.asset_type, a.asset_id""").param(key)
        .query((rs, n) -> new Asset(rs.getString("integration_key"), rs.getString("asset_type"), rs.getString("asset_id"), rs.getString("display_name"), rs.getString("resource_key"))).list();
  }

  /** Registers a dashboard or chart as a catalog resource (`superset-<key>.<type>.<id>`, action `view`) so it can be granted. */
  @Transactional
  public Asset registerAsset(String key, AssetRequest r) {
    Integration integration = integration(key);
    String type = r.assetType() == null ? "" : r.assetType().toUpperCase(Locale.ROOT);
    if (!List.of("DASHBOARD", "CHART").contains(type)) throw HiveException.invalid("assetType must be DASHBOARD or CHART");
    if (r.assetId() == null || !ASSET.matcher(r.assetId()).matches()) throw HiveException.invalid("assetId must match " + ASSET.pattern());
    String resourceKey = integration.resourceKey() + "." + type.toLowerCase(Locale.ROOT) + "." + r.assetId();
    catalog.createManual(integration.applicationKey(), new ResourceCatalog.ResourceNode(resourceKey, "EXTERNAL_RESOURCE", integration.resourceKey(),
        r.displayName() == null ? resourceKey : r.displayName(), List.of(new ResourceCatalog.ActionSpec("view", "View this " + type.toLowerCase(Locale.ROOT)))));
    db.sql("insert into superset_asset(integration_id, asset_type, asset_id, display_name, resource_id) select id, ?, ?, ?, ? from superset_integration where integration_key = ?")
        .params(type, r.assetId(), r.displayName() == null ? resourceKey : r.displayName(), catalog.get(integration.applicationKey(), resourceKey).id(), key).update();
    audit.success("superset.asset.registered", Map.of("integration", key, "assetType", type, "assetId", r.assetId()));
    return assets(key).stream().filter(a -> a.assetType().equals(type) && a.assetId().equals(r.assetId())).findFirst().orElseThrow();
  }

  /** Runtime decision for one tunneled request. Default deny for every operation not in the allowlist. */
  public Resolution resolve(String key, String method, String path, String hintType, String hintId, UUID userId) {
    Integration integration = integrations().stream().filter(i -> i.key().equals(key)).findFirst().orElse(null);
    if (integration == null || !integration.enabled()) return deny(integration, "INTEGRATION_UNAVAILABLE", null);
    if (userId == null) return deny(integration, "UNAUTHENTICATED", null);
    String verb = method == null ? "" : method.toUpperCase(Locale.ROOT);
    String assetType = null, assetId = null, operation;
    Matcher dashboard = DASHBOARD.matcher(path == null ? "" : path), chart = CHART.matcher(path == null ? "" : path);
    if ("GET".equals(verb) && "/health".equals(path)) operation = "health";
    else if ("GET".equals(verb) && dashboard.matches()) { operation = "dashboard"; assetType = "DASHBOARD"; assetId = dashboard.group(1); }
    else if ("GET".equals(verb) && chart.matches()) { operation = "chart"; assetType = "CHART"; assetId = chart.group(1); }
    else if ("POST".equals(verb) && "/api/v1/chart/data".equals(path)) {
      operation = "chart-data";
      if (!("DASHBOARD".equals(hintType) || "CHART".equals(hintType)) || hintId == null || !ASSET.matcher(hintId).matches()) return deny(integration, "ASSET_UNIDENTIFIED", operation);
      assetType = hintType; assetId = hintId;
    } else return deny(integration, "OPERATION_NOT_ALLOWED", null);
    var checks = new java.util.ArrayList<AuthorizationEngine.Check>();
    checks.add(new AuthorizationEngine.Check(integration.applicationKey(), integration.resourceKey(), "access"));
    if (assetType != null) checks.add(new AuthorizationEngine.Check(integration.applicationKey(), integration.resourceKey() + "." + assetType.toLowerCase(Locale.ROOT) + "." + assetId, "view"));
    for (var decision : engine.check(userId, checks))
      if (!decision.allowed()) return deny(integration, decision.resourceKey().equals(integration.resourceKey()) ? "INTEGRATION_" + decision.reason() : "ASSET_" + decision.reason(), operation);
    return new Resolution(true, "ALLOWED", integration.baseUrl(), integration.tlsRequired(), integration.credentialReference(), integration.revision(), operation);
  }

  @Transactional
  public void recordHealth(String key, String status) {
    if (!List.of("ACTIVE", "UNREACHABLE").contains(status)) throw HiveException.invalid("status must be ACTIVE or UNREACHABLE");
    db.sql("update superset_integration set health_status = ?, health_checked_at = now() where integration_key = ?").params(status, key).update();
  }

  private static Resolution deny(Integration integration, String reason, String operation) {
    return new Resolution(false, reason, null, integration != null && integration.tlsRequired(), null, integration == null ? 0 : integration.revision(), operation);
  }

  private String baseUrl(String value, boolean tlsRequired) {
    URI uri;
    try {
      uri = policy.validateConfigured(value, UiArtifactUriPolicy.ArtifactType.EXTERNAL_ORIGIN, "baseUrl");
    } catch (IllegalArgumentException rejected) {
      throw new HiveException(HttpStatus.UNPROCESSABLE_ENTITY, "TARGET_LOCATION_REJECTED", rejected.getMessage());
    }
    if (tlsRequired && !"https".equals(uri.getScheme())) throw new HiveException(HttpStatus.UNPROCESSABLE_ENTITY, "TLS_REQUIRED", "This integration requires an https base URL");
    return value.replaceAll("/+$", "");
  }

  private static void credential(String reference) {
    if (reference == null || !CREDENTIAL.matcher(reference).matches())
      throw HiveException.invalid("credentialReference must be env:HIVE_SECRET_<NAME> or file:<name>; credentials are never stored");
  }
}
