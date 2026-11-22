package io.hiveplatform.authorization.graph;

import io.hiveplatform.authorization.audit.AuditLog;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

@RestController
@ConditionalOnProperty(name="hive.scoped-runtime.enabled",havingValue="true")
public class ScopedRuntimeController {
  private final AuthorizationEngine engine;private final JdbcTemplate db;private final GraphOutbox outbox;private final AuditLog audit;
  private final String client,secretFile,application,prefix;
  public ScopedRuntimeController(AuthorizationEngine engine,JdbcTemplate db,GraphOutbox outbox,AuditLog audit,
      @Value("${hive.scoped-runtime.client}") String client,@Value("${hive.scoped-runtime.secret-file}") String secretFile,
      @Value("${hive.scoped-runtime.application}") String application,@Value("${hive.scoped-runtime.resource-prefix}") String prefix) {
    this.engine=engine;this.db=db;this.outbox=outbox;this.audit=audit;this.client=client;this.secretFile=secretFile;this.application=application;this.prefix=prefix;
    if(prefix.isBlank() || application.isBlank() || client.isBlank())throw new IllegalArgumentException("Runtime scope required");
  }
  public static boolean inScope(String app,String resource,String configuredApp,String prefix) {
    return configuredApp.equals(app) && resource!=null && (resource.equals(prefix)||resource.startsWith(prefix+"."));
  }
  @PostMapping("/runtime/scoped/check")
  public Map<String,Boolean> check(@AuthenticationPrincipal Jwt jwt,@RequestHeader("X-Hive-Service") String caller,
      @RequestHeader("X-Hive-Service-Key") String key,@RequestBody AuthorizationEngine.Check check) {
    String secret;
    try { secret=Files.readString(Path.of(secretFile)).strip(); }catch(java.io.IOException e){throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);}
    if(secret.length()<32 || !client.equals(caller) || !MessageDigest.isEqual(secret.getBytes(StandardCharsets.UTF_8),key.getBytes(StandardCharsets.UTF_8)))
      throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    if(!inScope(check.applicationKey(),check.resourceKey(),application,prefix) || check.action()==null || !check.action().matches("[a-z][a-z0-9_-]{0,79}"))
      throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    // Read-only canonical mapping. Never accept userId, acting position, or unsigned identity headers from callers.
    var users=db.query("select u.id from hive_user u join external_identity e on e.user_id=u.id where u.active and e.issuer=? and e.subject=?",
      (r,n)->r.getObject(1,UUID.class),jwt.getIssuer().toString(),jwt.getSubject());
    boolean allowed=users.size()==1 && outbox.pending()==0 && outbox.deadLettered()==0
      && engine.check(users.getFirst(),List.of(check)).getFirst().allowed();
    audit.recordAs("service:"+client,"runtime.scoped.check",allowed?"SUCCESS":"DENIED",
      Map.of("resource",check.resourceKey(),"action",check.action(),"subject",users.isEmpty()?"unmapped":users.getFirst().toString()),io.hiveplatform.spring.CorrelationId.current());
    return Map.of("allowed",allowed);
  }
}
