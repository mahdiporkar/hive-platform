package io.hiveplatform.bff.security;
import java.io.Serializable;
import java.security.Principal;
public record SessionIdentity(String issuer,String subject,String displayName) implements Principal, Serializable {
 public SessionIdentity {if(issuer==null||issuer.isBlank()||subject==null||subject.isBlank())throw new IllegalArgumentException("Missing validated identity");}
 @Override public String getName(){return issuer+"|"+subject;}
}