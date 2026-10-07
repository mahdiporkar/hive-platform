package io.hiveplatform.authorization;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
@WebMvcTest
@Import(SecurityConfiguration.class)
class SecurityConfigurationTest {
 @Autowired MockMvc mvc;
 @Test void anonymousPrivateRequestIsDenied() throws Exception { mvc.perform(get("/api/me/context")).andExpect(status().isUnauthorized()); }
 @Test void forgedActorHeadersCannotGrantAccess() throws Exception { mvc.perform(get("/api/admin/applications").header("X-Actor-Subject","administrator")).andExpect(status().isUnauthorized()); }
 @Test void mutationRequiresCsrf() throws Exception { mvc.perform(post("/api/admin/applications")).andExpect(status().isForbidden()); }
 @Test void csrfAloneDoesNotAuthorize() throws Exception { mvc.perform(post("/api/admin/applications").with(csrf())).andExpect(status().isUnauthorized()); }
 @Test void authenticatedPrincipalStillHasNoGrant() throws Exception { mvc.perform(get("/api/admin/applications").with(user("test"))).andExpect(status().isForbidden()); }
}