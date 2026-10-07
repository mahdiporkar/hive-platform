package io.hiveplatform.authorization.identity;

import io.hiveplatform.authorization.admin.PlatformAccess;
import io.hiveplatform.authorization.admin.PlatformAccess.Relation;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** Identity provider and alias administration for platform security administrators (same rules as provisioning). */
@RestController
@PlatformAccess(Relation.SECURITY_ADMIN)
class IdentityAdminController {
  private final IdentityRegistry registry;

  IdentityAdminController(IdentityRegistry registry) { this.registry = registry; }

  @GetMapping("/admin/identity/providers") List<IdentityRegistry.Provider> providers() { return registry.list(); }
  @PostMapping("/admin/identity/providers") IdentityRegistry.Provider create(@RequestBody IdentityRegistry.Provider provider) { return registry.save(provider, true); }

  @PutMapping("/admin/identity/providers/{code}")
  IdentityRegistry.Provider update(@PathVariable String code, @RequestBody IdentityRegistry.Provider provider) {
    if (!code.equals(provider.code())) throw new IllegalArgumentException("Provider code mismatch");
    return registry.save(provider, false);
  }

  @PostMapping("/admin/identity/aliases") void alias(@RequestBody IdentityRegistry.Alias alias) { registry.link(alias); }
}
