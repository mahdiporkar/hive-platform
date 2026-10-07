package io.hiveplatform.authorization.identity;
import java.util.List;
import org.springframework.web.bind.annotation.*;
@RestController
public class IdentityController {
 private final IdentityRegistry registry;
 public IdentityController(IdentityRegistry registry){this.registry=registry;}
 @GetMapping("/internal/identity/providers/{code}") IdentityRegistry.Provider runtime(@PathVariable String code){return registry.enabled(code);}
 @GetMapping("/internal/identity/route") IdentityRegistry.Provider route(@RequestParam(required=false)String code,@RequestParam(required=false)String tenant,@RequestParam(required=false)String domain){return registry.route(code,tenant,domain);}
 @PostMapping("/internal/identity/login") IdentityRegistry.Identity sync(@RequestBody IdentityRegistry.Login login){return registry.sync(login);}
 @GetMapping("/provisioning/identity/providers") List<IdentityRegistry.Provider> list(){return registry.list();}
 @PostMapping("/provisioning/identity/providers") IdentityRegistry.Provider create(@RequestBody IdentityRegistry.Provider provider){return registry.save(provider,true);}
 @PutMapping("/provisioning/identity/providers/{code}") IdentityRegistry.Provider update(@PathVariable String code,@RequestBody IdentityRegistry.Provider provider){if(!code.equals(provider.code()))throw new IllegalArgumentException("Provider code mismatch");return registry.save(provider,false);}
 @PostMapping("/provisioning/identity/aliases") void alias(@RequestBody IdentityRegistry.Alias alias){registry.link(alias);}
}