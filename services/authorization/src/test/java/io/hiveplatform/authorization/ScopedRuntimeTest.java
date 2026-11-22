package io.hiveplatform.authorization;

import io.hiveplatform.authorization.graph.*;
import io.hiveplatform.authorization.audit.AuditLog;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;
import java.nio.file.*;
import java.util.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class ScopedRuntimeTest {
  @TempDir Path directory;
  @Test void scopeIsBoundedByApplicationAndResourceSegment() {
    assertThat(ScopedRuntimeController.inScope("app","module.class.a","app","module")).isTrue();
    assertThat(ScopedRuntimeController.inScope("app","module","app","module")).isTrue();
    assertThat(ScopedRuntimeController.inScope("other","module.class.a","app","module")).isFalse();
    assertThat(ScopedRuntimeController.inScope("app","module-other.a","app","module")).isFalse();
  }
  @Test void unknownSubjectOrWrongMachineCredentialNeverReachesEngine() throws Exception {
    Path secret=directory.resolve("key");Files.writeString(secret,"x".repeat(32));
    var engine=mock(AuthorizationEngine.class);var db=mock(JdbcTemplate.class);var outbox=mock(GraphOutbox.class);var audit=mock(AuditLog.class);
    var controller=new ScopedRuntimeController(engine,db,outbox,audit,"client",secret.toString(),"app","module");
    var jwt=Jwt.withTokenValue("redacted").header("alg","RS256").issuer("https://issuer").subject("unmapped").build();
    var check=new AuthorizationEngine.Check("app","module.class.a","join");
    assertThatThrownBy(()->controller.check(jwt,"client","wrong",check)).isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    assertThat(controller.check(jwt,"client","x".repeat(32),check)).containsEntry("allowed",false);
    assertThatThrownBy(()->controller.check(jwt,"client","x".repeat(32),new AuthorizationEngine.Check("app","other","view"))).isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    verifyNoInteractions(engine);
  }
  @Test void canonicalIdentityIsUsedAndPendingRevocationDenies() throws Exception {
    Path secret=directory.resolve("key");Files.writeString(secret,"x".repeat(32));
    var engine=mock(AuthorizationEngine.class);var db=mock(JdbcTemplate.class);var outbox=mock(GraphOutbox.class);var audit=mock(AuditLog.class);
    UUID user=UUID.randomUUID();
    when(db.query(anyString(),org.mockito.ArgumentMatchers.<org.springframework.jdbc.core.RowMapper<UUID>>any(),eq("https://issuer"),eq("external-subject"))).thenReturn(List.of(user));
    var check=new AuthorizationEngine.Check("app","module.class.a","join");
    when(engine.check(user,List.of(check))).thenReturn(List.of(new AuthorizationEngine.Decision("app","module.class.a","join",true,"ALLOWED")));
    var controller=new ScopedRuntimeController(engine,db,outbox,audit,"client",secret.toString(),"app","module");
    var jwt=Jwt.withTokenValue("redacted").header("alg","RS256").issuer("https://issuer").subject("external-subject").build();
    assertThat(controller.check(jwt,"client","x".repeat(32),check)).containsEntry("allowed",true);
    // audit_event only accepts these outcomes (audit_event_outcome_check).
    verify(audit).recordAs(eq("service:client"),eq("runtime.scoped.check"),eq("SUCCESS"),any(),any());
    when(outbox.pending()).thenReturn(1L);
    assertThat(controller.check(jwt,"client","x".repeat(32),check)).containsEntry("allowed",false);
    verify(audit).recordAs(eq("service:client"),eq("runtime.scoped.check"),eq("DENIED"),any(),any());
    verify(engine,times(1)).check(user,List.of(check));
  }
}
