package io.hiveplatform.bff.context;

import com.fasterxml.jackson.databind.JsonNode;
import io.hiveplatform.bff.control.ControlPlaneClient;
import io.hiveplatform.bff.security.IdentityConfiguration;
import io.hiveplatform.bff.security.SessionIdentity;
import io.hiveplatform.bff.security.TokenRefresh;
import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Runtime contexts for consumers. {@code /api/public/context} is safe for anonymous callers: branding, locale,
 * public modules and navigation only. {@code /api/me/context} adds the token-free identity, effective permissions and
 * the routes the user may open; it is never cached by intermediaries.
 */
@RestController
class ContextController {
  static final String CONTRACT_VERSION = "1.1.0";
  private final ControlPlaneClient control;
  private final ObjectProvider<TokenRefresh> refresh;
  private final String brandName, locale, direction;

  ContextController(ControlPlaneClient control, ObjectProvider<TokenRefresh> refresh, @Value("${hive.runtime.branding-name:Hive}") String brandName,
      @Value("${hive.runtime.locale:en}") String locale, @Value("${hive.runtime.direction:ltr}") String direction) {
    if (!List.of("ltr", "rtl").contains(direction)) throw new IllegalArgumentException("HIVE_DIRECTION must be ltr or rtl");
    this.control = control;
    this.refresh = refresh;
    this.brandName = brandName;
    this.locale = locale;
    this.direction = direction;
  }

  @GetMapping("/api/public/context")
  ResponseEntity<Map<String, Object>> publicContext() {
    JsonNode projection = control.get("/internal/runtime/public-context");
    var body = base(false);
    body.put("applications", projection.path("applications"));
    body.put("modules", projection.path("modules"));
    body.put("features", control.get("/internal/runtime/features?audience=PUBLIC").path("features"));
    body.put("revision", projection.path("revision").asLong());
    return ResponseEntity.ok().cacheControl(CacheControl.noCache()).body(body);
  }

  @GetMapping("/api/me/context")
  ResponseEntity<Map<String, Object>> context(HttpServletRequest request) {
    var authentication = SecurityContextHolder.getContext().getAuthentication();
    if (authentication == null || !(authentication.getPrincipal() instanceof SessionIdentity identity)) return ResponseEntity.status(401).build();
    var session = request.getSession(false);
    Object handle = session == null ? null : session.getAttribute(IdentityConfiguration.VAULT_HANDLE);
    TokenRefresh tokens = refresh.getIfAvailable();
    if (tokens == null || !(handle instanceof String vaultHandle)) return ResponseEntity.status(401).build();
    String expiresAt;
    try {
      expiresAt = tokens.ensureFresh(vaultHandle).sessionExpiresAt().toString();
    } catch (RuntimeException expired) {
      session.invalidate();
      return ResponseEntity.status(401).build();
    }
    JsonNode projection = control.get("/internal/runtime/context?userId=" + identity.id());
    var body = base(true);
    body.put("identity", Map.of("id", identity.id(), "tenantId", identity.tenantId(), "displayName", identity.displayName(), "issuer", identity.issuer(), "subject", identity.subject()));
    body.put("session", Map.of("expiresAt", expiresAt));
    body.put("applications", projection.path("applications"));
    body.put("modules", projection.path("modules"));
    body.put("permissions", projection.path("permissions"));
    body.put("platformRoles", projection.path("platformRoles"));
    body.put("features", control.get("/internal/runtime/features?audience=AUTHENTICATED&userId=" + identity.id()).path("features"));
    body.put("revision", projection.path("revision").asLong());
    return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);
  }

  private Map<String, Object> base(boolean authenticated) {
    var body = new LinkedHashMap<String, Object>();
    body.put("contractVersion", CONTRACT_VERSION);
    body.put("authenticated", authenticated);
    body.put("locale", locale);
    body.put("direction", direction);
    body.put("branding", Map.of("name", brandName));
    return body;
  }
}
