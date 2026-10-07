package io.hiveplatform.bff.admin;

import io.hiveplatform.bff.control.ControlPlaneClient;
import io.hiveplatform.bff.security.SessionIdentity;
import io.hiveplatform.spring.CorrelationId;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.InputStream;
import java.util.Map;
import java.util.Set;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

/**
 * Administrative API for browser and scripted clients: {@code /api/admin/**} is relayed to the control plane's
 * {@code /admin/**} on behalf of the session's canonical user. Platform roles are enforced by the control plane;
 * the BFF only guarantees that the actor is the authenticated session user and that CSRF was checked.
 */
@RestController
class AdminProxy {
  private static final int MAX_BODY = 1024 * 1024;
  private static final Set<String> BODY = Set.of("POST", "PUT", "PATCH", "DELETE");
  private final ControlPlaneClient control;

  AdminProxy(ControlPlaneClient control) { this.control = control; }

  @RequestMapping(value = "/api/admin/**", method = {RequestMethod.GET, RequestMethod.POST, RequestMethod.PUT, RequestMethod.PATCH, RequestMethod.DELETE})
  void relay(HttpServletRequest request, HttpServletResponse response) throws IOException {
    var authentication = SecurityContextHolder.getContext().getAuthentication();
    if (authentication == null || !(authentication.getPrincipal() instanceof SessionIdentity identity)) {
      write(response, 403, "application/json", ("{\"code\":\"ACCESS_DENIED\",\"message\":\"A Hive session is required\",\"correlationId\":\"" + CorrelationId.current() + "\"}").getBytes());
      return;
    }
    String path = request.getRequestURI().substring("/api".length());
    String query = request.getQueryString();
    if (query != null && (query.length() > 4096 || query.chars().anyMatch(c -> c < 0x20))) {
      write(response, 400, "application/json", "{\"code\":\"QUERY_INVALID\",\"message\":\"Query string is not acceptable\"}".getBytes());
      return;
    }
    byte[] body = null;
    if (BODY.contains(request.getMethod())) {
      try (InputStream in = request.getInputStream()) {
        body = in.readNBytes(MAX_BODY + 1);
      }
      if (body.length > MAX_BODY) {
        write(response, 413, "application/json", "{\"code\":\"REQUEST_TOO_LARGE\",\"message\":\"Administrative requests are limited to 1 MiB\"}".getBytes());
        return;
      }
      if (body.length == 0) body = null;
    }
    var raw = control.exchange(request.getMethod(), path + (query == null ? "" : "?" + query), body, request.getContentType(), Map.of("X-Hive-Actor", identity.id()));
    write(response, raw.status(), raw.contentType(), raw.body());
  }

  private static void write(HttpServletResponse response, int status, String type, byte[] body) throws IOException {
    response.setStatus(status);
    response.setContentType(type);
    response.setHeader("Cache-Control", "no-store");
    response.getOutputStream().write(body);
  }
}
