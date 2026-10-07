package io.hiveplatform.authorization;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.hiveplatform.authorization.admin.AdminAuthorization;
import io.hiveplatform.authorization.audit.AuditLog;
import io.hiveplatform.authorization.catalog.Applications;
import io.hiveplatform.authorization.catalog.ResourceCatalog;
import io.hiveplatform.authorization.graph.AuthorizationEngine;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(controllers = io.hiveplatform.authorization.catalog.CatalogController.class)
@Import({SecurityConfiguration.class, AdminAuthorization.class})
@TestPropertySource(properties = {"hive.internal.password=runtime-secret-runtime-secret-0001", "hive.provisioning.password=provision-secret-provision-secret-01"})
class SecurityConfigurationTest {
  private static final String RUNTIME = "runtime-secret-runtime-secret-0001", PROVISIONING = "provision-secret-provision-secret-01";
  @Autowired MockMvc mvc;
  @MockitoBean Applications applications;
  @MockitoBean ResourceCatalog catalog;
  @MockitoBean AuthorizationEngine engine;
  @MockitoBean AuditLog audit;

  @Test void healthIsPublic() throws Exception { mvc.perform(get("/actuator/health")).andExpect(status().is(404)); }
  @Test void unknownBrowserPathsAreDenied() throws Exception { mvc.perform(get("/api/me/context")).andExpect(status().isUnauthorized()); }
  @Test void anonymousAdminIsRejected() throws Exception { mvc.perform(get("/admin/applications")).andExpect(status().isUnauthorized()); }
  @Test void wrongSecretIsRejected() throws Exception { mvc.perform(get("/admin/applications").with(httpBasic("bff", "wrong-secret-wrong-secret-wrong-secret"))).andExpect(status().isUnauthorized()); }

  @Test
  void runtimePrincipalWithoutActorIsDenied() throws Exception {
    mvc.perform(get("/admin/applications").with(httpBasic("bff", RUNTIME))).andExpect(status().isForbidden());
    verify(applications, never()).list();
  }

  @Test
  void forgedActorWithoutPlatformRoleIsDeniedAndAudited() throws Exception {
    UUID actor = UUID.randomUUID();
    when(engine.platformRelation(eq(actor), anyString())).thenReturn(false);
    mvc.perform(get("/admin/applications").with(httpBasic("bff", RUNTIME)).header(AdminAuthorization.ACTOR_HEADER, actor.toString())).andExpect(status().isForbidden());
    verify(audit).recordAs(eq("user:" + actor), eq("admin.denied"), eq("DENIED"), any(), anyString());
    verify(applications, never()).list();
  }

  @Test
  void readsRequireReaderAndWritesRequireOperator() throws Exception {
    UUID actor = UUID.randomUUID();
    when(engine.platformRelation(actor, "reader")).thenReturn(true);
    when(engine.platformRelation(actor, "operator")).thenReturn(false);
    when(applications.list()).thenReturn(List.of());
    mvc.perform(get("/admin/applications").with(httpBasic("bff", RUNTIME)).header(AdminAuthorization.ACTOR_HEADER, actor.toString())).andExpect(status().isOk());
    mvc.perform(post("/admin/applications").with(httpBasic("bff", RUNTIME)).header(AdminAuthorization.ACTOR_HEADER, actor.toString())
        .contentType(MediaType.APPLICATION_JSON).content("{\"key\":\"demo\",\"displayName\":\"Demo\"}")).andExpect(status().isForbidden());
    verify(applications, never()).create(any());
  }

  @Test
  void provisioningPrincipalAdministers() throws Exception {
    mvc.perform(post("/admin/applications").with(httpBasic("provisioner", PROVISIONING)).contentType(MediaType.APPLICATION_JSON)
        .content("{\"key\":\"demo\",\"displayName\":\"Demo\"}")).andExpect(status().isOk());
    verify(applications).create(new Applications.Definition("demo", "Demo"));
  }

  @Test
  void principalsAreConfinedToTheirChannels() throws Exception {
    mvc.perform(get("/provisioning/identity/providers").with(httpBasic("bff", RUNTIME))).andExpect(status().isForbidden());
    mvc.perform(post("/internal/authorization/check").with(httpBasic("provisioner", PROVISIONING))).andExpect(status().isForbidden());
  }
}
