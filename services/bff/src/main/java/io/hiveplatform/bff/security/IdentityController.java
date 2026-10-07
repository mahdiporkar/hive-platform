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
 @ExceptionHandler(org.springframework.web.server.ResponseStatusException.class) ResponseEntity<?> status(org.springframework.web.server.ResponseStatusException error){return ResponseEntity.status(error.getStatusCode()).body(Map.of("code","IDENTITY_REQUEST_REJECTED"));}
 private final TokenVault vault; private final TokenRefresh refresh; private final IdentityControlClient control;
 IdentityController(TokenVault vault,TokenRefresh refresh,IdentityControlClient control){this.vault=vault;this.refresh=refresh;this.control=control;}
 @GetMapping("/auth/login") ResponseEntity<Void> login(@RequestParam(defaultValue="/")String returnUrl,@RequestParam(required=false)String provider,@RequestParam(required=false)String tenant,@RequestParam(required=false)String domain,HttpServletRequest request){
  final String safe;try{safe=ReturnUrl.validate(returnUrl);}catch(IllegalArgumentException invalid){return ResponseEntity.badRequest().build();}
  String code=(provider==null&&tenant==null&&domain==null)||"primary".equals(provider)?"primary":control.route(provider,tenant,domain).code();
  request.getSession().setAttribute(IdentityConfiguration.RETURN_URL,safe);
  return ResponseEntity.status(302).location(java.net.URI.create("/oauth2/authorization/"+code)).build();
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