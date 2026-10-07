package io.hiveplatform.authorization.identity;
import java.net.URI;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
@Service
public class IdentityRegistry {
 public record Provider(String code,String name,String issuer,String tenantId,List<String> domains,String clientId,String secretReference,String authorizationEndpoint,String tokenEndpoint,String jwksUri,boolean enabled,long revision){}
 public record Login(String providerCode,String issuer,String subject,String displayName){}
 public record Identity(UUID id,String tenantId,String displayName,String issuer,String subject){}
 public record Alias(UUID userId,String providerCode,String issuer,String subject){}
 private final JdbcTemplate db;private final Set<String> origins;private final String primaryIssuer;private final boolean local;
 public IdentityRegistry(JdbcTemplate db,@Value("${hive.identity.allowed-origins:}")String origins,@Value("${hive.identity.primary-issuer:}")String primaryIssuer,@Value("${hive.identity.allow-local-http:false}")boolean local){this.db=db;this.origins=Set.copyOf(Arrays.stream(origins.split(",")).map(String::trim).filter(s->!s.isEmpty()).toList());this.primaryIssuer=primaryIssuer;this.local=local;}
 public List<Provider> list(){return db.query("select * from identity_provider order by code",(r,n)->new Provider(r.getString("code"),r.getString("name"),r.getString("issuer"),r.getString("tenant_id"),Arrays.asList((String[])r.getArray("domains").getArray()),r.getString("client_id"),r.getString("secret_reference"),r.getString("authorization_endpoint"),r.getString("token_endpoint"),r.getString("jwks_uri"),r.getBoolean("enabled"),r.getLong("revision")));}
 public Provider enabled(String code){return list().stream().filter(p->p.code().equals(code)&&p.enabled()).findFirst().orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Provider unavailable"));}
 public Provider route(String code,String tenant,String domain){var matches=list().stream().filter(Provider::enabled).filter(p->code==null||p.code().equals(code)).filter(p->tenant==null||p.tenantId().equals(tenant)).filter(p->domain==null||p.domains().contains(domain.toLowerCase(Locale.ROOT))).toList();if(matches.isEmpty())throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Provider unavailable");if(matches.size()!=1)throw new ResponseStatusException(HttpStatus.CONFLICT,"Select an explicit provider");return matches.getFirst();}
 @Transactional public Provider save(Provider p,boolean create){
  validate(p);
  if(create)db.update("insert into identity_provider(code,name,issuer,tenant_id,domains,client_id,secret_reference,authorization_endpoint,token_endpoint,jwks_uri,enabled) values(?,?,?,?,?,?,?,?,?,?,?)",p.code(),p.name(),p.issuer(),p.tenantId(),p.domains().toArray(String[]::new),p.clientId(),p.secretReference(),p.authorizationEndpoint(),p.tokenEndpoint(),p.jwksUri(),p.enabled());
  else if(db.update("update identity_provider set name=?,domains=?,client_id=?,secret_reference=?,authorization_endpoint=?,token_endpoint=?,jwks_uri=?,enabled=?,revision=revision+1 where code=? and revision=? and issuer=? and tenant_id=?",p.name(),p.domains().toArray(String[]::new),p.clientId(),p.secretReference(),p.authorizationEndpoint(),p.tokenEndpoint(),p.jwksUri(),p.enabled(),p.code(),p.revision(),p.issuer(),p.tenantId())!=1)throw new ResponseStatusException(HttpStatus.CONFLICT,"Revision conflict or immutable issuer/tenant changed");
  audit("identity_provider."+(create?"created":"updated"),p.code());return list().stream().filter(v->v.code().equals(p.code())).findFirst().orElseThrow();
 }
 @Transactional public Identity sync(Login login){
  required(login.subject(),255);required(login.displayName(),255);String tenant=tenant(login.providerCode(),login.issuer());
  // Serialize first login for one external identity; do not auto-link by untrusted profile/email.
  db.queryForObject("select pg_advisory_xact_lock(hashtextextended(?,0))",Object.class,login.issuer()+"\n"+login.subject());
  var users=db.query("select u.id,u.tenant_id,u.display_name,u.active from hive_user u join external_identity e on e.user_id=u.id where e.issuer=? and e.subject=?",(r,n)->Map.of("id",r.getObject("id",UUID.class),"tenant",r.getString("tenant_id"),"name",r.getString("display_name"),"active",r.getBoolean("active")),login.issuer(),login.subject());
  UUID id;
  if(users.isEmpty()){id=UUID.randomUUID();db.update("insert into hive_user(id,tenant_id,display_name,last_login_at) values(?,?,?,now())",id,tenant,login.displayName());db.update("insert into external_identity(issuer,subject,user_id) values(?,?,?)",login.issuer(),login.subject(),id);}
  else {var user=users.getFirst();if(!Boolean.TRUE.equals(user.get("active"))||!tenant.equals(user.get("tenant")))throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Identity inactive or tenant mismatch");id=(UUID)user.get("id");db.update("update hive_user set display_name=?,last_login_at=now() where id=?",login.displayName(),id);}
  audit("identity.login",id.toString());return new Identity(id,tenant,login.displayName(),login.issuer(),login.subject());
 }
 @Transactional public void link(Alias alias){
  required(alias.subject(),255);String tenant=tenant(alias.providerCode(),alias.issuer());
  Integer active=db.queryForObject("select count(*) from hive_user where id=? and tenant_id=? and active",Integer.class,alias.userId(),tenant);if(active==null||active!=1)throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Active same-tenant user required");
  db.update("insert into external_identity(issuer,subject,user_id) values(?,?,?)",alias.issuer(),alias.subject(),alias.userId());audit("identity.alias.linked",alias.userId().toString());
 }
 private String tenant(String code,String issuer){if("primary".equals(code)){if(primaryIssuer.isBlank()||!primaryIssuer.equals(issuer))throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Unknown primary issuer");return "default";}var provider=enabled(code);if(!provider.issuer().equals(issuer))throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Issuer mismatch");return provider.tenantId();}
 private void validate(Provider p){if(p==null||p.code()==null||!p.code().matches("[a-z][a-z0-9-]{2,79}")||p.code().equals("primary"))throw new IllegalArgumentException("Invalid provider code");required(p.name(),255);required(p.clientId(),255);required(p.tenantId(),160);if(p.secretReference()==null||!p.secretReference().matches("env:HIVE_IDP_[A-Z0-9_]{1,100}"))throw new IllegalArgumentException("Provider requires a permitted secret reference");if(p.domains()==null||p.domains().size()>100||p.domains().stream().anyMatch(d->d==null||!d.matches("[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?")))throw new IllegalArgumentException("Invalid routing domains");for(String uri:new String[]{p.issuer(),p.authorizationEndpoint(),p.tokenEndpoint(),p.jwksUri()})validateUri(uri);if(p.issuer().equals(primaryIssuer))throw new IllegalArgumentException("Primary issuer is managed by deployment configuration");}
 private void validateUri(String value){required(value,2048);URI uri=URI.create(value);if(uri.getHost()==null||uri.getUserInfo()!=null||uri.getFragment()!=null||uri.getQuery()!=null)throw new IllegalArgumentException("Invalid provider URI");String origin=uri.getScheme()+"://"+uri.getRawAuthority();if(!origins.contains(origin))throw new IllegalArgumentException("Provider origin is not approved");if(!"https".equals(uri.getScheme())&&!(local&&"http".equals(uri.getScheme())&&Set.of("127.0.0.1","localhost").contains(uri.getHost())))throw new IllegalArgumentException("Provider requires HTTPS");}
 private static void required(String value,int max){if(value==null||value.isBlank()||value.length()>max)throw new IllegalArgumentException("Invalid identity field");}
 private void audit(String event,String subject){db.update("insert into audit_event(id,actor_id,event_type,correlation_id,outcome,details) values(?,?,?,?, 'SUCCESS',jsonb_build_object('subject',cast(? as text)))",UUID.randomUUID(),org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication().getName(),event,UUID.randomUUID().toString(),subject);}
}