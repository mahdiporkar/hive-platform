package io.hiveplatform.authorization.routing;

import io.hiveplatform.authorization.graph.AuthorizationEngine;
import io.hiveplatform.spring.HiveException;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * Deterministic runtime resolution: canonical path, longest route prefix, then route priority, then pattern
 * specificity; equal candidates are an ambiguity error, never a guess. Unregistered paths and methods are denied.
 */
@Service
public class RouteResolver {
  public record Target(String key, String baseUrl, int connectTimeoutMs, int responseTimeoutMs, int maxRequestBytes, int maxResponseBytes) {}
  public record Legacy(String key, long revision, String tokenEndpointPath, String requestFormat, String credentialReference, String tokenPointer,
      String expiresInPointer, String tokenTypePointer, String scheme, String scope, String audience, int expirySkewSeconds, int maxResponseBytes) {}
  public record Decision(boolean allowed, String reason) {}
  public record Resolved(String routeKey, String operationKey, String applicationKey, String moduleKey, String method, String pathTemplate, String access,
      String authentication, String resourceKey, String action, Target target, Legacy legacy, String upstreamPath, Decision decision) {}

  private record Candidate(String routeKey, String applicationKey, String moduleKey, String prefix, String authentication, String upstreamBase, boolean strip, int priority,
      String operationKey, String pattern, String access, String resourceKey, String action, Target target, Legacy legacy) {}

  private final JdbcClient db;
  private final AuthorizationEngine engine;

  public RouteResolver(JdbcClient db, AuthorizationEngine engine) {
    this.db = db;
    this.engine = engine;
  }

  public Resolved resolve(String method, String rawPath, UUID userId) {
    String verb = method == null ? "" : method.toUpperCase(Locale.ROOT);
    String path;
    try {
      path = RoutePathPolicy.path(rawPath);
    } catch (IllegalArgumentException invalid) {
      throw new HiveException(HttpStatus.BAD_REQUEST, "ROUTE_PATH_INVALID", "Request path is not canonical (traversal, encoded separators, control characters or duplicate slashes)");
    }
    List<Candidate> matches = candidates(verb).stream()
        .filter(c -> prefixMatches(path, c.prefix()))
        .filter(c -> RoutePathPolicy.matches(c.pattern(), relative(path, c.prefix())))
        .sorted(Comparator.comparingInt((Candidate c) -> c.prefix().length()).reversed()
            .thenComparing(Comparator.comparingInt(Candidate::priority).reversed())
            .thenComparing(Comparator.comparingInt((Candidate c) -> RoutePathPolicy.specificity(c.pattern())).reversed()))
        .toList();
    if (matches.isEmpty()) throw new HiveException(HttpStatus.NOT_FOUND, "ROUTE_NOT_FOUND", "No active route operation for " + verb + " " + path);
    Candidate selected = matches.getFirst();
    if (matches.size() > 1) {
      Candidate second = matches.get(1);
      if (second.prefix().length() == selected.prefix().length() && second.priority() == selected.priority()
          && RoutePathPolicy.specificity(second.pattern()) == RoutePathPolicy.specificity(selected.pattern()))
        throw new HiveException(HttpStatus.CONFLICT, "ROUTE_AMBIGUOUS", "Ambiguous route operations " + selected.operationKey() + " and " + second.operationKey());
    }
    String relative = relative(path, selected.prefix());
    String downstream = selected.strip() ? relative : path;
    String upstream = RoutePathPolicy.path(join(selected.upstreamBase(), downstream));
    Decision decision;
    if (!"AUTHENTICATED".equals(selected.access())) decision = new Decision(true, selected.access());
    else if (userId == null) decision = new Decision(false, "UNAUTHENTICATED");
    else {
      var result = engine.check(userId, new AuthorizationEngine.Check(selected.applicationKey(), selected.resourceKey(), selected.action()));
      decision = new Decision(result.allowed(), result.reason());
    }
    String template = (selected.prefix().endsWith("/") ? selected.prefix().substring(0, selected.prefix().length() - 1) : selected.prefix()) + ("/".equals(selected.pattern()) ? "" : selected.pattern());
    return new Resolved(selected.routeKey(), selected.operationKey(), selected.applicationKey(), selected.moduleKey(), verb, template, selected.access(),
        selected.authentication(), selected.resourceKey(), selected.action(), selected.target(), selected.legacy(), upstream, decision);
  }

  private List<Candidate> candidates(String method) {
    return db.sql("""
        select r.route_key, a.application_key, m.module_key, r.path_prefix, r.authentication, r.upstream_base_path, r.strip_prefix, r.priority,
               o.operation_key, o.path_pattern, o.access, res.resource_key, o.action_key,
               t.target_key, t.base_url, t.connect_timeout_ms, t.response_timeout_ms, t.max_request_bytes, t.max_response_bytes,
               p.profile_key, p.revision as profile_revision, p.token_endpoint_path, p.request_format, p.credential_reference, p.token_pointer, p.expires_in_pointer,
               p.token_type_pointer, p.scheme, p.scope, p.audience, p.expiry_skew_seconds, p.max_response_bytes as profile_max
        from route_operation o join proxy_route r on r.id = o.route_id join application a on a.id = r.application_id
        join service_target t on t.id = r.service_target_id left join micro_app m on m.id = r.micro_app_id
        left join resource res on res.id = o.resource_id left join legacy_auth_profile p on p.id = r.legacy_profile_id
        where o.http_method = ? and not o.archived and not r.archived and not t.archived and not a.archived
          and (m.id is null or not m.archived) and (p.id is null or not p.archived)""")
        .param(method)
        .query((rs, n) -> new Candidate(rs.getString("route_key"), rs.getString("application_key"), rs.getString("module_key"), rs.getString("path_prefix"),
            rs.getString("authentication"), rs.getString("upstream_base_path"), rs.getBoolean("strip_prefix"), rs.getInt("priority"), rs.getString("operation_key"),
            rs.getString("path_pattern"), rs.getString("access"), rs.getString("resource_key"), rs.getString("action_key"),
            new Target(rs.getString("target_key"), rs.getString("base_url"), rs.getInt("connect_timeout_ms"), rs.getInt("response_timeout_ms"), rs.getInt("max_request_bytes"), rs.getInt("max_response_bytes")),
            rs.getString("profile_key") == null ? null : new Legacy(rs.getString("profile_key"), rs.getLong("profile_revision"), rs.getString("token_endpoint_path"),
                rs.getString("request_format"), rs.getString("credential_reference"), rs.getString("token_pointer"), rs.getString("expires_in_pointer"),
                rs.getString("token_type_pointer"), rs.getString("scheme"), rs.getString("scope"), rs.getString("audience"), rs.getInt("expiry_skew_seconds"), rs.getInt("profile_max"))))
        .list();
  }

  static boolean prefixMatches(String path, String prefix) {
    String bare = prefix.substring(0, prefix.length() - 1);
    return path.equals(bare) || path.startsWith(prefix);
  }

  static String relative(String path, String prefix) {
    String result = path.substring(prefix.length() - 1);
    return result.isEmpty() ? "/" : result;
  }

  static String join(String base, String path) {
    if (base == null || base.isBlank() || "/".equals(base)) return path;
    String trimmed = base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
    return "/".equals(path) ? trimmed : trimmed + path;
  }

  /** Summary view for previews: never includes a decision. */
  public Map<String, Object> preview(String method, String path) {
    var resolved = resolve(method, path, null);
    return Map.of("route", resolved.routeKey(), "operation", resolved.operationKey(), "access", resolved.access(), "authentication", resolved.authentication(),
        "target", resolved.target().key(), "upstreamPath", resolved.upstreamPath(), "pathTemplate", resolved.pathTemplate());
  }
}
