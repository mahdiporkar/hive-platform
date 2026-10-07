package io.hiveplatform.bff.security;
import java.io.Serializable;
import java.security.Principal;
public record SessionIdentity(String id,String tenantId,String issuer,String subject,String displayName) implements Principal,Serializable {
 public SessionIdentity {if(id==null||id.isBlank()||tenantId==null||tenantId.isBlank()||issuer==null||issuer.isBlank()||subject==null||subject.isBlank())throw new IllegalArgumentException("Missing canonical validated identity");}
 @Override public String getName(){return id;}
}