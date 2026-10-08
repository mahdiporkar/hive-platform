package io.hiveplatform.bff;

import static org.assertj.core.api.Assertions.assertThat;

import io.hiveplatform.bff.control.ControlPlaneClient;
import io.hiveplatform.bff.observability.ObservabilityPublisher;
import io.hiveplatform.bff.proxy.LegacyTokens;
import io.hiveplatform.bff.proxy.TargetGuard;
import io.hiveplatform.bff.security.RuntimeCsrfTokenRequestHandler;
import io.hiveplatform.bff.security.TokenRefresh;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.DefaultCsrfToken;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.web.filter.FormContentFilter;
import org.springframework.web.multipart.MultipartResolver;

/**
 * The BFF forwards application bodies byte for byte (RuntimeProxy, AdminProxy, SupersetTunnel), so nothing in it may
 * parse them first: no multipart resolver (DispatcherServlet.checkMultipart would call Request.parseParts), no
 * FormContentFilter, and no CSRF fallback to a body parameter on runtime routes. tests/integration/multipart.test.mjs
 * proves the end-to-end behaviour; these guards fail fast if a configuration change reintroduces a body consumer.
 */
@WebMvcTest
@Import(SecurityConfiguration.class)
class OpaqueRequestBodyTest {
  @Autowired ApplicationContext context;
  @MockitoBean ControlPlaneClient control;
  @MockitoBean TargetGuard guard;
  @MockitoBean LegacyTokens legacy;
  @MockitoBean ObservabilityPublisher observability;
  @MockitoBean TokenRefresh refresh;
  @MockitoBean io.hiveplatform.bff.proxy.SecretResolver secrets;
  @MockitoBean org.springframework.data.redis.core.StringRedisTemplate redis;

  @Test
  void noMultipartResolverOrFormContentFilterParsesBodiesBeforeTheProxy() {
    // The settings themselves (the WebMvcTest slice does not include multipart auto-configuration) and the resulting beans.
    assertThat(context.getEnvironment().getProperty("spring.servlet.multipart.enabled", Boolean.class)).isFalse();
    assertThat(context.getEnvironment().getProperty("spring.mvc.formcontent.filter.enabled", Boolean.class)).isFalse();
    assertThat(context.getBeansOfType(MultipartResolver.class)).isEmpty();
    assertThat(context.getBeansOfType(FormContentFilter.class)).isEmpty();
  }

  @Test
  void runtimeRoutesTakeTheCsrfTokenOnlyFromTheHeader() {
    var handler = new RuntimeCsrfTokenRequestHandler();
    CsrfToken token = new DefaultCsrfToken("X-XSRF-TOKEN", "_csrf", "secret-token");
    var response = new MockHttpServletResponse();

    var bodyOnly = runtimeRequest("/api/routes/records/forms");
    bodyOnly.setParameter("_csrf", masked(handler, token, bodyOnly, response));
    assertThat(handler.resolveCsrfTokenValue(bodyOnly, token)).as("a form-body token is ignored on runtime routes").isNull();

    var header = runtimeRequest("/api/routes/records/forms");
    header.addHeader("X-XSRF-TOKEN", masked(handler, token, header, response));
    assertThat(handler.resolveCsrfTokenValue(header, token)).isEqualTo("secret-token");

    var logout = runtimeRequest("/auth/logout");
    logout.setParameter("_csrf", masked(handler, token, logout, response));
    assertThat(handler.resolveCsrfTokenValue(logout, token)).as("other BFF paths keep Spring's standard resolution").isEqualTo("secret-token");
  }

  private static MockHttpServletRequest runtimeRequest(String uri) {
    var request = new MockHttpServletRequest("POST", uri);
    request.setContentType("application/x-www-form-urlencoded");
    return request;
  }

  /** The masked (XOR) token value a browser receives from /auth/csrf. */
  private static String masked(RuntimeCsrfTokenRequestHandler handler, CsrfToken token, MockHttpServletRequest request, MockHttpServletResponse response) {
    handler.handle(request, response, () -> token);
    return ((CsrfToken) request.getAttribute(CsrfToken.class.getName())).getToken();
  }
}
