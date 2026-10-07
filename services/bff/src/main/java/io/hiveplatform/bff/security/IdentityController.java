package io.hiveplatform.bff.security;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.*;
@RestController
@ConditionalOnProperty(name="hive.identity.enabled",havingValue="true")
class IdentityController {
 private final TokenVault vault; private final TokenRefresh refresh;
 IdentityController(TokenVault vault,TokenRefresh refresh){this.vault=vault;this.refresh=refresh;}
 @GetMapping("/auth/login") ResponseEntity<Void> login(@RequestParam(defaultValue="/")String returnUrl,HttpServletRequest request){
  final String safe;try{safe=ReturnUrl.validate(returnUrl);}catch(IllegalArgumentException invalid){return ResponseEntity.badRequest().build();}
  request.getSession().setAttribute(IdentityConfiguration.RETURN_URL,safe);
  return ResponseEntity.status(302).location(java.net.URI.create("/oauth2/authorization/primary")).build();
 }
 @GetMapping("/auth/csrf") Map<String,String> csrf(CsrfToken token){return Map.of("headerName",token.getHeaderName(),"token",token.getToken());}
 @GetMapping("/api/me/session") ResponseEntity<?> session(Authentication authentication,HttpServletRequest request){
  if(!(authentication.getPrincipal() instanceof SessionIdentity identity))return ResponseEntity.status(401).build();
  Object handle=request.getSession().getAttribute(IdentityConfiguration.VAULT_HANDLE);
  if(!(handle instanceof String value))return ResponseEntity.status(401).build();
  try{var record=refresh.ensureFresh(value);return ResponseEntity.ok(Map.of("identity",identity,"expiresAt",record.sessionExpiresAt().toString()));}
  catch(RuntimeException expired){vault.delete(value);request.getSession().invalidate();return ResponseEntity.status(401).build();}
 }
}