package io.hiveplatform.bff.security;
import java.time.Instant;
import java.util.Objects;
/** Server-only record. Never serialize through an HTTP controller. */
public record VaultRecord(String providerId,String accessToken,String refreshToken,Instant accessExpiresAt,Instant sessionExpiresAt) {
 public VaultRecord {
  Objects.requireNonNull(providerId);Objects.requireNonNull(accessToken);Objects.requireNonNull(accessExpiresAt);Objects.requireNonNull(sessionExpiresAt);
  if(providerId.isBlank()||accessToken.isBlank())throw new IllegalArgumentException("Invalid vault record");
 }
 public VaultRecord refreshed(String access,String refresh,Instant expires,Instant now) {
  if(!sessionExpiresAt.isAfter(now)||!expires.isAfter(now))throw new IllegalArgumentException("Expired refresh response or session");
  return new VaultRecord(providerId,access,refresh==null||refresh.isBlank()?refreshToken:refresh,expires,sessionExpiresAt);
 }
 @Override public String toString(){return "VaultRecord[REDACTED]";}
}