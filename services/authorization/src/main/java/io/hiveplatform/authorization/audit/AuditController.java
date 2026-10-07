package io.hiveplatform.authorization.audit;

import io.hiveplatform.authorization.admin.PlatformAccess;
import io.hiveplatform.authorization.admin.PlatformAccess.Relation;
import java.time.Instant;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/admin/audit")
@PlatformAccess(value = Relation.AUDITOR, read = Relation.AUDITOR)
class AuditController {
  private final AuditLog audit;

  AuditController(AuditLog audit) { this.audit = audit; }

  @GetMapping
  List<AuditLog.Event> search(@RequestParam(required = false) String eventType, @RequestParam(required = false) String actor,
      @RequestParam(required = false) String correlationId, @RequestParam(required = false) Instant before, @RequestParam(defaultValue = "100") int limit) {
    return audit.search(eventType, actor, correlationId, before, limit);
  }
}
