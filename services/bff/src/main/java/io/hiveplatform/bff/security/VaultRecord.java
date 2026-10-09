package io.hiveplatform.bff.security;
import java.time.Instant;
import java.util.Objects;
/**
 * Server-only record. Never serialize through an HTTP controller. {@code idToken} (nullable) is the ID token validated
 * at login, kept only as the {@code id_token_hint} of OIDC RP-initiated logout so that signing out also ends the
 * identity provider's session; refreshes keep it (it identifies the same provider session).
 */
public record VaultRecord(String providerId,String accessToken,String refreshToken,Instant accessExpiresAt,Instant sessionExpiresAt,String idToken) {
 public VaultRecord {
  Objects.requireNonNull(providerId);Objects.requireNonNull(accessToken);Objects.requireNonNull(accessExpiresAt);Objects.requireNonNull(sessionExpiresAt);
  if(providerId.isBlank()||accessToken.isBlank())throw new IllegalArgumentException("Invalid vault record");
  if(idToken!=null&&idToken.isBlank())idToken=null;
 }
 public VaultRecord(String providerId,String accessToken,String refreshToken,Instant accessExpiresAt,Instant sessionExpiresAt){this(providerId,accessToken,refreshToken,accessExpiresAt,sessionExpiresAt,null);}
 public VaultRecord refreshed(String access,String refresh,Instant expires,Instant now) {
  if(!sessionExpiresAt.isAfter(now)||!expires.isAfter(now))throw new IllegalArgumentException("Expired refresh response or session");
  return new VaultRecord(providerId,access,refresh==null||refresh.isBlank()?refreshToken:refresh,expires,sessionExpiresAt,idToken);
 }
 @Override public String toString(){return "VaultRecord[REDACTED]";}
}
