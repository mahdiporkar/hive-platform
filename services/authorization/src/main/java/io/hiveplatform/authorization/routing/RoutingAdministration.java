package io.hiveplatform.authorization.routing;

import io.hiveplatform.artifacts.security.UiArtifactUriPolicy;
import io.hiveplatform.authorization.audit.AuditLog;
import io.hiveplatform.authorization.catalog.ResourceCatalog;
import io.hiveplatform.spring.HiveException;
import java.net.URI;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Control plane for dynamic routing: service targets, legacy authentication profiles, proxy routes and route
 * operations. Everything is validated when saved so that runtime resolution never meets an ambiguous or unsafe rule.
 */
@Service
public class RoutingAdministration {
  public record Target(UUID id, String key, String displayName, String baseUrl, int connectTimeoutMs, int responseTimeoutMs, int maxRequestBytes,
      int maxResponseBytes, boolean archived, long revision) {}
  public record TargetRequest(String key, String displayName, String baseUrl, Integer connectTimeoutMs, Integer responseTimeoutMs, Integer maxRequestBytes,
      Integer maxResponseBytes, Boolean archived, Long revision) {}
  public record LegacyProfile(UUID id, String key, String targetKey, String tokenEndpointPath, String requestFormat, String credentialReference, String tokenPointer,
      String expiresInPointer, String tokenTypePointer, String scheme, String scope, String audience, int expirySkewSeconds, int maxResponseBytes, boolean archived, long revision) {}
  public record LegacyProfileRequest(String key, String targetKey, String tokenEndpointPath, String requestFormat, String credentialReference, String tokenPointer,
      String expiresInPointer, String tokenTypePointer, String scheme, String scope, String audience, Integer expirySkewSeconds, Integer maxResponseBytes, Boolean archived, Long revision) {}
  public record Route(UUID id, String key, String applicationKey, String moduleKey, String pathPrefix, String targetKey, String authentication, String legacyProfileKey,
      String upstreamBasePath, boolean stripPrefix, int priority, boolean archived, long revision) {}
  public record RouteRequest(String key, String applicationKey, String moduleKey, String pathPrefix, String targetKey, String authentication, String legacyProfileKey,
      String upstreamBasePath, Boolean stripPrefix, Integer priority, Boolean archived, Long revision) {}
  public record Operation(UUID id, String routeKey, String key, String method, String pathPattern, String access, String resourceKey, String action, boolean archived, long revision) {}
  public record OperationRequest(String key, String method, String pathPattern, String access, String resourceKey, String action, Boolean archived, Long revision) {}

  private static final Pattern KEY = Pattern.compile("[a-z][a-z0-9-]{1,79}");
  private static final Pattern OPERATION_KEY = Pattern.compile("[a-z][a-z0-9-]{0,79}");
  private static final Pattern CREDENTIAL = Pattern.compile("env:HIVE_SECRET_[A-Z0-9_]{1,80}|file:[a-z0-9][a-z0-9-]{0,79}");
  private static final Pattern POINTER = Pattern.compile("(/[A-Za-z0-9_.~-]{1,64}){1,8}");
  private static final Set<String> METHODS = Set.of("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE");
  private static final Set<String> ACCESS = Set.of("PUBLIC", "HYBRID", "AUTHENTICATED");
  private static final Set<String> AUTHENTICATION = Set.of("NONE", "FORWARD_TOKEN", "LEGACY");
  /** Planned modes are rejected explicitly rather than accepted as insecure placeholders. */
  private static final Set<String> PLANNED_AUTHENTICATION = Set.of("API_KEY", "OAUTH2_CLIENT_CREDENTIALS", "MTLS");
  private static final Set<String> FORMATS = Set.of("JSON", "FORM_URLENCODED", "HTTP_BASIC", "OAUTH_CLIENT_CREDENTIALS");

  private final JdbcClient db;
  private final UiArtifactUriPolicy targetPolicy;
  private final ResourceCatalog catalog;
  private final AuditLog audit;

  public RoutingAdministration(JdbcClient db, @org.springframework.beans.factory.annotation.Qualifier("targetPolicy") UiArtifactUriPolicy targetPolicy,
      ResourceCatalog catalog, AuditLog audit) {
    this.db = db;
    this.targetPolicy = targetPolicy;
    this.catalog = catalog;
    this.audit = audit;
  }

  // ---- service targets ---------------------------------------------------------------------------------------

  public List<Target> targets() {
    return db.sql("select * from service_target order by target_key").query((rs, n) -> new Target(rs.getObject("id", UUID.class), rs.getString("target_key"),
        rs.getString("display_name"), rs.getString("base_url"), rs.getInt("connect_timeout_ms"), rs.getInt("response_timeout_ms"), rs.getInt("max_request_bytes"),
        rs.getInt("max_response_bytes"), rs.getBoolean("archived"), rs.getLong("revision"))).list();
  }

  public Target target(String key) {
    return targets().stream().filter(t -> t.key().equals(key)).findFirst().orElseThrow(() -> HiveException.notFound("Unknown service target " + key));
  }

  @Transactional
  public Target saveTarget(TargetRequest r, boolean create) {
    require(r.key(), KEY, "key");
    name(r.displayName());
    String base = baseUrl(r.baseUrl());
    int connect = between(r.connectTimeoutMs(), 2000, 100, 30000, "connectTimeoutMs");
    int response = between(r.responseTimeoutMs(), 10000, 100, 120000, "responseTimeoutMs");
    int maxRequest = between(r.maxRequestBytes(), 1048576, 0, 52428800, "maxRequestBytes");
    int maxResponse = between(r.maxResponseBytes(), 5242880, 1, 52428800, "maxResponseBytes");
    if (create) {
      if (db.sql("insert into service_target(id, target_key, display_name, base_url, connect_timeout_ms, response_timeout_ms, max_request_bytes, max_response_bytes) values (?, ?, ?, ?, ?, ?, ?, ?) on conflict do nothing")
          .params(UUID.randomUUID(), r.key(), r.displayName(), base, connect, response, maxRequest, maxResponse).update() != 1) throw HiveException.conflict("Service target " + r.key() + " already exists");
    } else if (db.sql("update service_target set display_name = ?, base_url = ?, connect_timeout_ms = ?, response_timeout_ms = ?, max_request_bytes = ?, max_response_bytes = ?, archived = coalesce(?, archived), revision = revision + 1, updated_at = now() where target_key = ? and revision = ?")
        .params(r.displayName(), base, connect, response, maxRequest, maxResponse, r.archived(), r.key(), r.revision() == null ? -1 : r.revision()).update() != 1) throw HiveException.stale();
    audit.success(create ? "service-target.created" : "service-target.updated", Map.of("target", r.key(), "baseUrl", base));
    return target(r.key());
  }

  /** Absolute HTTP(S) URL accepted by the outbound network policy; optional base path without query or fragment. */
  private String baseUrl(String value) {
    URI uri;
    try {
      uri = targetPolicy.validateConfigured(value, UiArtifactUriPolicy.ArtifactType.EXTERNAL_ORIGIN, "baseUrl");
    } catch (IllegalArgumentException rejected) {
      throw new HiveException(HttpStatus.UNPROCESSABLE_ENTITY, "TARGET_LOCATION_REJECTED", rejected.getMessage());
    }
    String path = uri.getRawPath() == null || uri.getRawPath().isEmpty() ? "/" : RoutePathPolicy.definition(uri.getRawPath());
    String origin = uri.getScheme().toLowerCase(Locale.ROOT) + "://" + uri.getRawAuthority().toLowerCase(Locale.ROOT);
    return origin + ("/".equals(path) ? "" : path);
  }

  // ---- legacy authentication profiles ------------------------------------------------------------------------

  public List<LegacyProfile> legacyProfiles() {
    return db.sql("select p.*, t.target_key from legacy_auth_profile p join service_target t on t.id = p.service_target_id order by p.profile_key")
        .query((rs, n) -> new LegacyProfile(rs.getObject("id", UUID.class), rs.getString("profile_key"), rs.getString("target_key"), rs.getString("token_endpoint_path"),
            rs.getString("request_format"), rs.getString("credential_reference"), rs.getString("token_pointer"), rs.getString("expires_in_pointer"),
            rs.getString("token_type_pointer"), rs.getString("scheme"), rs.getString("scope"), rs.getString("audience"), rs.getInt("expiry_skew_seconds"),
            rs.getInt("max_response_bytes"), rs.getBoolean("archived"), rs.getLong("revision"))).list();
  }

  public LegacyProfile legacyProfile(String key) {
    return legacyProfiles().stream().filter(p -> p.key().equals(key)).findFirst().orElseThrow(() -> HiveException.notFound("Unknown legacy authentication profile " + key));
  }

  @Transactional
  public LegacyProfile saveLegacyProfile(LegacyProfileRequest r, boolean create) {
    require(r.key(), KEY, "key");
    Target target = target(r.targetKey());
    String endpoint;
    try { endpoint = RoutePathPolicy.definition(r.tokenEndpointPath()); } catch (IllegalArgumentException e) { throw HiveException.invalid("tokenEndpointPath must be a canonical path on the target origin"); }
    if (r.requestFormat() == null || !FORMATS.contains(r.requestFormat())) throw HiveException.invalid("requestFormat must be one of " + FORMATS);
    if (r.credentialReference() == null || !CREDENTIAL.matcher(r.credentialReference()).matches())
      throw HiveException.invalid("credentialReference must be env:HIVE_SECRET_<NAME> or file:<name>; credentials themselves are never stored");
    require(r.tokenPointer(), POINTER, "tokenPointer");
    require(r.expiresInPointer(), POINTER, "expiresInPointer");
    if (r.tokenTypePointer() != null) require(r.tokenTypePointer(), POINTER, "tokenTypePointer");
    String scheme = r.scheme() == null ? "Bearer" : r.scheme();
    if (!scheme.matches("[A-Za-z][A-Za-z0-9-]{0,31}")) throw HiveException.invalid("scheme must be an HTTP authorization scheme token");
    int skew = between(r.expirySkewSeconds(), 30, 0, 3600, "expirySkewSeconds");
    int max = between(r.maxResponseBytes(), 65536, 256, 1048576, "maxResponseBytes");
    for (String value : new String[] {r.scope(), r.audience()}) if (value != null && (value.length() > 512 || value.chars().anyMatch(c -> c < 0x20))) throw HiveException.invalid("Invalid scope or audience");
    if (create) {
      if (db.sql("""
          insert into legacy_auth_profile(id, profile_key, service_target_id, token_endpoint_path, request_format, credential_reference, token_pointer, expires_in_pointer,
            token_type_pointer, scheme, scope, audience, expiry_skew_seconds, max_response_bytes) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict do nothing""")
          .params(UUID.randomUUID(), r.key(), target.id(), endpoint, r.requestFormat(), r.credentialReference(), r.tokenPointer(), r.expiresInPointer(), r.tokenTypePointer(),
              scheme, r.scope(), r.audience(), skew, max).update() != 1) throw HiveException.conflict("Legacy profile " + r.key() + " already exists");
    } else if (db.sql("""
        update legacy_auth_profile set service_target_id = ?, token_endpoint_path = ?, request_format = ?, credential_reference = ?, token_pointer = ?, expires_in_pointer = ?,
          token_type_pointer = ?, scheme = ?, scope = ?, audience = ?, expiry_skew_seconds = ?, max_response_bytes = ?, archived = coalesce(?, archived), revision = revision + 1
        where profile_key = ? and revision = ?""")
        .params(target.id(), endpoint, r.requestFormat(), r.credentialReference(), r.tokenPointer(), r.expiresInPointer(), r.tokenTypePointer(), scheme, r.scope(), r.audience(),
            skew, max, r.archived(), r.key(), r.revision() == null ? -1 : r.revision()).update() != 1) throw HiveException.stale();
    // Revision changes invalidate the BFF's cached legacy token (cache key includes the revision).
    audit.success(create ? "legacy-profile.created" : "legacy-profile.updated", Map.of("profile", r.key(), "target", target.key(), "credentialReference", r.credentialReference()));
    return legacyProfile(r.key());
  }

  // ---- routes and operations ---------------------------------------------------------------------------------

  public List<Route> routes() {
    return db.sql("""
        select r.*, a.application_key, m.module_key, t.target_key, p.profile_key from proxy_route r join application a on a.id = r.application_id
        left join micro_app m on m.id = r.micro_app_id join service_target t on t.id = r.service_target_id left join legacy_auth_profile p on p.id = r.legacy_profile_id
        order by r.route_key""")
        .query((rs, n) -> new Route(rs.getObject("id", UUID.class), rs.getString("route_key"), rs.getString("application_key"), rs.getString("module_key"), rs.getString("path_prefix"),
            rs.getString("target_key"), rs.getString("authentication"), rs.getString("profile_key"), rs.getString("upstream_base_path"), rs.getBoolean("strip_prefix"),
            rs.getInt("priority"), rs.getBoolean("archived"), rs.getLong("revision"))).list();
  }

  public Route route(String key) {
    return routes().stream().filter(r -> r.key().equals(key)).findFirst().orElseThrow(() -> HiveException.notFound("Unknown proxy route " + key));
  }

  @Transactional
  public Route saveRoute(RouteRequest r, boolean create) {
    require(r.key(), KEY, "key");
    UUID app = catalog.applicationId(r.applicationKey());
    UUID module = null;
    if (r.moduleKey() != null) module = db.sql("select id from micro_app where module_key = ? and application_id = ?").params(r.moduleKey(), app).query(UUID.class)
        .optional().orElseThrow(() -> HiveException.invalid("Module " + r.moduleKey() + " does not belong to application " + r.applicationKey()));
    String prefix;
    try { prefix = RoutePathPolicy.prefix(r.pathPrefix()); } catch (IllegalArgumentException e) { throw HiveException.invalid("pathPrefix must be a canonical path without encodings"); }
    if ("/".equals(prefix)) throw HiveException.invalid("pathPrefix cannot be the root");
    Target target = target(r.targetKey());
    if (target.archived()) throw HiveException.conflict("Service target is archived");
    String authentication = r.authentication() == null ? "FORWARD_TOKEN" : r.authentication();
    if (PLANNED_AUTHENTICATION.contains(authentication)) throw new HiveException(HttpStatus.UNPROCESSABLE_ENTITY, "AUTHENTICATION_MODE_UNSUPPORTED",
        authentication + " is a planned authentication mode and is not available in this release");
    if (!AUTHENTICATION.contains(authentication)) throw HiveException.invalid("authentication must be NONE, FORWARD_TOKEN or LEGACY");
    UUID profile = null;
    if ("LEGACY".equals(authentication)) {
      LegacyProfile legacy = legacyProfile(r.legacyProfileKey());
      if (!legacy.targetKey().equals(target.key())) throw HiveException.invalid("Legacy profile must obtain tokens from the route's own service target");
      profile = legacy.id();
    } else if (r.legacyProfileKey() != null) throw HiveException.invalid("legacyProfileKey is only valid for LEGACY routes");
    String upstreamBase;
    try { upstreamBase = RoutePathPolicy.definition(r.upstreamBasePath() == null ? "/" : r.upstreamBasePath()); } catch (IllegalArgumentException e) { throw HiveException.invalid("upstreamBasePath must be canonical"); }
    boolean strip = r.stripPrefix() == null || r.stripPrefix();
    int priority = between(r.priority(), 0, -1000, 1000, "priority");
    if (create) {
      if (db.sql("""
          insert into proxy_route(id, route_key, application_id, micro_app_id, path_prefix, service_target_id, authentication, legacy_profile_id, upstream_base_path, strip_prefix, priority)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict do nothing""")
          .params(UUID.randomUUID(), r.key(), app, module, prefix, target.id(), authentication, profile, upstreamBase, strip, priority).update() != 1)
        throw HiveException.conflict("Route key or path prefix already exists");
    } else if (db.sql("""
        update proxy_route set application_id = ?, micro_app_id = ?, path_prefix = ?, service_target_id = ?, authentication = ?, legacy_profile_id = ?, upstream_base_path = ?,
          strip_prefix = ?, priority = ?, archived = coalesce(?, archived), revision = revision + 1 where route_key = ? and revision = ?""")
        .params(app, module, prefix, target.id(), authentication, profile, upstreamBase, strip, priority, r.archived(), r.key(), r.revision() == null ? -1 : r.revision()).update() != 1)
      throw HiveException.stale();
    audit.success(create ? "proxy-route.created" : "proxy-route.updated", Map.of("route", r.key(), "prefix", prefix, "target", target.key(), "authentication", authentication));
    return route(r.key());
  }

  public List<Operation> operations(String routeKey) {
    Route route = route(routeKey);
    return db.sql("select o.*, res.resource_key from route_operation o left join resource res on res.id = o.resource_id where o.route_id = ? order by o.path_pattern, o.http_method")
        .param(route.id()).query((rs, n) -> new Operation(rs.getObject("id", UUID.class), routeKey, rs.getString("operation_key"), rs.getString("http_method"),
            rs.getString("path_pattern"), rs.getString("access"), rs.getString("resource_key"), rs.getString("action_key"), rs.getBoolean("archived"), rs.getLong("revision"))).list();
  }

  @Transactional
  public Operation saveOperation(String routeKey, OperationRequest r, boolean create) {
    Route route = route(routeKey);
    db.sql("select id from proxy_route where id = ? for update").param(route.id()).query(UUID.class).single();
    require(r.key(), OPERATION_KEY, "key");
    String method = r.method() == null ? null : r.method().toUpperCase(Locale.ROOT);
    if (!METHODS.contains(method)) throw HiveException.invalid("method must be one of " + METHODS);
    String pattern;
    try { pattern = RoutePathPolicy.pattern(r.pathPattern()); } catch (IllegalArgumentException e) { throw HiveException.invalid("pathPattern may contain literals, {variables}, * and a terminal **"); }
    if (!ACCESS.contains(r.access())) throw HiveException.invalid("access must be PUBLIC, HYBRID or AUTHENTICATED");
    UUID resourceId = null;
    if ("AUTHENTICATED".equals(r.access())) {
      if (r.resourceKey() == null || r.action() == null) throw HiveException.invalid("AUTHENTICATED operations must name the resource action that authorizes them");
      var resource = catalog.get(route.applicationKey(), r.resourceKey());
      if (resource.archived()) throw HiveException.conflict("Resource is archived");
      if (!"manage".equals(r.action()) && resource.actions().stream().noneMatch(a -> a.key().equals(r.action()) && !a.archived()))
        throw HiveException.invalid("Action " + r.action() + " is not declared on " + r.resourceKey());
      resourceId = resource.id();
    } else if (r.resourceKey() != null || r.action() != null) {
      throw HiveException.invalid(r.access() + " operations are anonymous-capable and cannot require a resource permission; use AUTHENTICATED");
    }
    boolean archived = Boolean.TRUE.equals(r.archived());
    if (!archived) for (Operation other : operations(routeKey)) {
      if (other.archived() || other.key().equals(r.key()) || !other.method().equals(method)) continue;
      if (other.pathPattern().equals(pattern) || (RoutePathPolicy.overlaps(other.pathPattern(), pattern) && RoutePathPolicy.specificity(other.pathPattern()) == RoutePathPolicy.specificity(pattern)))
        throw new HiveException(HttpStatus.CONFLICT, "AMBIGUOUS_OPERATION", "Operation " + r.key() + " would be ambiguous with " + other.key() + " (" + method + " " + other.pathPattern() + ")");
    }
    if (create) {
      if (db.sql("insert into route_operation(id, route_id, operation_key, http_method, path_pattern, access, resource_id, action_key) values (?, ?, ?, ?, ?, ?, ?, ?) on conflict do nothing")
          .params(UUID.randomUUID(), route.id(), r.key(), method, pattern, r.access(), resourceId, resourceId == null ? null : r.action()).update() != 1)
        throw HiveException.conflict("Operation " + r.key() + " already exists on route " + routeKey);
    } else if (db.sql("update route_operation set http_method = ?, path_pattern = ?, access = ?, resource_id = ?, action_key = ?, archived = ?, revision = revision + 1 where route_id = ? and operation_key = ? and revision = ?")
        .params(method, pattern, r.access(), resourceId, resourceId == null ? null : r.action(), archived, route.id(), r.key(), r.revision() == null ? -1 : r.revision()).update() != 1)
      throw HiveException.stale();
    audit.success(create ? "route-operation.created" : "route-operation.updated", Map.of("route", routeKey, "operation", r.key(), "method", method, "pattern", pattern, "access", r.access()));
    return operations(routeKey).stream().filter(o -> o.key().equals(r.key())).findFirst().orElseThrow();
  }

  private static void require(String value, Pattern pattern, String field) {
    if (value == null || !pattern.matcher(value).matches()) throw HiveException.invalid(field + " must match " + pattern.pattern());
  }

  private static void name(String value) {
    if (value == null || value.isBlank() || value.length() > 255) throw HiveException.invalid("displayName is required");
  }

  private static int between(Integer value, int fallback, int min, int max, String field) {
    int result = value == null ? fallback : value;
    if (result < min || result > max) throw HiveException.invalid(field + " must be between " + min + " and " + max);
    return result;
  }
}
