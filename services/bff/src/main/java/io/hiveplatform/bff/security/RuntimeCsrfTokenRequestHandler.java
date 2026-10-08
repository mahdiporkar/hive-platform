package io.hiveplatform.bff.security;

import io.hiveplatform.bff.proxy.RuntimeProxy;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.util.function.Supplier;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.CsrfTokenRequestHandler;
import org.springframework.security.web.csrf.XorCsrfTokenRequestAttributeHandler;

/**
 * CSRF token resolution that never reads a runtime-route request body. Spring's default handler falls back from the
 * CSRF header to {@code request.getParameter("_csrf")}, which makes the servlet container parse (and consume) a
 * form-urlencoded body before RuntimeProxy forwards it. On {@code /api/routes/**} the token is therefore accepted only
 * from the header Hive's clients always send; every other BFF path keeps Spring's standard behaviour. This narrows,
 * never widens, what passes CSRF.
 */
public final class RuntimeCsrfTokenRequestHandler implements CsrfTokenRequestHandler {
  private final XorCsrfTokenRequestAttributeHandler standard = new XorCsrfTokenRequestAttributeHandler();

  @Override
  public void handle(HttpServletRequest request, HttpServletResponse response, Supplier<CsrfToken> csrfToken) {
    standard.handle(request, response, csrfToken);
  }

  @Override
  public String resolveCsrfTokenValue(HttpServletRequest request, CsrfToken csrfToken) {
    if (!request.getRequestURI().startsWith(RuntimeProxy.PREFIX + "/")) return standard.resolveCsrfTokenValue(request, csrfToken);
    HttpServletRequest headerOnly = new HttpServletRequestWrapper(request) {
      @Override public String getParameter(String name) { return null; }
    };
    return standard.resolveCsrfTokenValue(headerOnly, csrfToken);
  }
}
