package io.hiveplatform.bff;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.hiveplatform.bff.control.ControlPlaneClient;
import io.hiveplatform.bff.observability.ObservabilityPublisher;
import io.hiveplatform.bff.proxy.LegacyTokens;
import io.hiveplatform.bff.proxy.TargetGuard;
import io.hiveplatform.bff.security.TokenRefresh;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** Identity disabled (public-only deployment): anonymous runtime paths work, session paths are closed, CSRF applies. */
@WebMvcTest
@Import(SecurityConfiguration.class)
class SecurityConfigurationTest {
  @Autowired MockMvc mvc;
  @MockitoBean ControlPlaneClient control;
  @MockitoBean TargetGuard guard;
  @MockitoBean LegacyTokens legacy;
  @MockitoBean ObservabilityPublisher observability;
  @MockitoBean TokenRefresh refresh;

  @Test void anonymousPrivateRequestIsDenied() throws Exception { mvc.perform(get("/api/me/context")).andExpect(status().isUnauthorized()); }
  @Test void forgedActorHeadersCannotGrantAccess() throws Exception { mvc.perform(get("/api/admin/applications").header("X-Hive-Actor", "00000000-0000-0000-0000-000000000000")).andExpect(status().isUnauthorized()); }
  @Test void mutationRequiresCsrf() throws Exception { mvc.perform(post("/api/admin/applications")).andExpect(status().isForbidden()); }
  @Test void csrfAloneDoesNotAuthenticate() throws Exception { mvc.perform(post("/api/admin/applications").with(csrf())).andExpect(status().isUnauthorized()); }
  @Test void unknownApiPathsAreDenied() throws Exception { mvc.perform(get("/api/anything")).andExpect(status().isUnauthorized()); }
  @Test void actuatorBeyondHealthIsDenied() throws Exception { mvc.perform(get("/actuator/env")).andExpect(status().isUnauthorized()); }

  @Test
  void authenticatedNonHivePrincipalReachesNoControlPlane() throws Exception {
    mvc.perform(get("/api/admin/applications").with(user("test"))).andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
    verifyNoInteractions(control);
  }

  @Test
  void runtimeMutationsRequireCsrfEvenAnonymously() throws Exception {
    mvc.perform(post("/api/routes/records/items")).andExpect(status().isForbidden());
    verifyNoInteractions(control);
  }

  @Test
  void csrfTokenIsAvailableAnonymously() throws Exception {
    mvc.perform(get("/auth/csrf")).andExpect(status().isOk()).andExpect(jsonPath("$.headerName").value("X-CSRF-TOKEN"));
  }

  @Test
  void loginIsUnavailableWithoutIdentity() throws Exception {
    mvc.perform(get("/auth/login")).andExpect(status().isUnauthorized());
    verifyNoInteractions(control);
    verify(observability, never()).apiLog(any());
  }
}
