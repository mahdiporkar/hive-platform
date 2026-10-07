package io.hiveplatform.authorization.admin;

import io.hiveplatform.authorization.audit.AuditLog;
import io.hiveplatform.authorization.graph.AuthorizationEngine;
import io.hiveplatform.spring.CorrelationId;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * Enforces platform roles on every control-plane handler. The BFF runtime principal may act only on behalf of the
 * canonical user it names in {@code X-Hive-Actor}; the provisioning principal is the deployment's machine administrator.
 */
@Component
public class AdminAuthorization implements HandlerInterceptor {
  public static final String ACTOR_HEADER = "X-Hive-Actor";
  private final AuthorizationEngine engine;
  private final AuditLog audit;

  public AdminAuthorization(AuthorizationEngine engine, AuditLog audit) {
    this.engine = engine;
    this.audit = audit;
  }

  @Override
  public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
    if (!(handler instanceof HandlerMethod method)) return true;
    PlatformAccess.Relation required = required(method, request.getMethod());
    var authentication = SecurityContextHolder.getContext().getAuthentication();
    var roles = authentication == null ? java.util.Set.<String>of()
        : authentication.getAuthorities().stream().map(GrantedAuthority::getAuthority).collect(java.util.stream.Collectors.toSet());
    if (required == null) return deny(response, "No platform permission is declared for this operation", null);
    if (roles.contains("ROLE_PROVISIONING")) {
      Actor.set(Actor.machine("provisioner"));
      return true;
    }
    if (!roles.contains("ROLE_RUNTIME")) return deny(response, "Unknown principal", null);
    UUID user;
    try {
      user = UUID.fromString(String.valueOf(request.getHeader(ACTOR_HEADER)));
    } catch (IllegalArgumentException missing) {
      return deny(response, "A canonical actor is required", null);
    }
    if (!engine.platformRelation(user, required.relation)) {
      audit.recordAs("user:" + user, "admin.denied", "DENIED", Map.of("method", request.getMethod(), "path", request.getRequestURI(),
          "required", required.name()), CorrelationId.current());
      return deny(response, "Platform permission required: " + required.name(), user);
    }
    Actor.set(Actor.user(user));
    return true;
  }

  @Override
  public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception ex) {
    Actor.clear();
  }

  static PlatformAccess.Relation required(HandlerMethod method, String httpMethod) {
    PlatformAccess onMethod = method.getMethodAnnotation(PlatformAccess.class);
    if (onMethod != null) return onMethod.value();
    PlatformAccess onType = method.getBeanType().getAnnotation(PlatformAccess.class);
    if (onType == null) return null;
    return "GET".equals(httpMethod) || "HEAD".equals(httpMethod) ? onType.read() : onType.value();
  }

  private static boolean deny(HttpServletResponse response, String message, UUID user) throws java.io.IOException {
    response.setStatus(HttpStatus.FORBIDDEN.value());
    response.setContentType("application/json");
    response.getWriter().write("{\"code\":\"ACCESS_DENIED\",\"message\":\"" + message.replace("\"", "'") + "\",\"correlationId\":\"" + CorrelationId.current() + "\"}");
    return false;
  }
}
