# ADR-008: Server-side identity and session boundary

Status: accepted; implemented in Phase 3.

## Decision

- The BFF is the only OAuth client. Browser JavaScript receives an opaque `HIVE_SESSION` cookie (Secure, HttpOnly, SameSite=Lax) and never an access, refresh or ID token.
- Tokens live in an AES-256-GCM encrypted Redis vault (random 96-bit IV, key id prefix, previous-key decryption for rotation). The session stores only a vault handle and a token-free `SessionIdentity` principal.
- A request-scoped authorized-client repository hands the validated OAuth client to the success handler and is cleared before the response; OIDC authorities are never persisted.
- Refresh preserves the absolute session deadline, uses the real upstream expiry, is bounded (size, 5 s deadline) and is coordinated across BFF instances with a Redis ownership lease. The final vault write is a Lua compare-and-set on lease ownership *and* continued vault existence, so logout cannot be undone by an in-flight refresh.
- Identity providers: one deployment-configured `primary` provider plus control-plane providers in `identity_provider` (authorization service). Provider endpoints must match the deployment allow-list on both services; secrets are references (`env:HIVE_IDP_*`) resolved by the BFF, never stored or returned. Routing by `provider`, `tenant` and `domain` is deterministic; ambiguity returns 409.
- Canonical identity: every login is synchronized into `hive_user` + `external_identity (issuer, subject)` by the authorization service under a per-identity advisory lock, so concurrent first logins converge. Aliases are linked explicitly by provisioning — never inferred from e-mail or profile claims — and must stay within the provider's tenant.
- Keycloak is the reference IdP but is not referenced by Hive Core code; any OIDC provider with discovery or explicit endpoints works.

## Deviations from the reference implementation

- The reference applied a minimum 30-second access lifetime and could extend the vault deadline; Hive rejects expired refresh responses and never extends the absolute deadline.
- Transport moved from reactive to servlet Spring Security; invariants are proved by integration tests rather than by code similarity.
- RP-initiated logout at the IdP (`end_session_endpoint`) is not performed; Hive logout invalidates the Hive session and vault only. Recorded as deferred work.

## Evidence

`tests/integration/identity.test.mjs` (signed-JWT fixture IdP, real Redis/PostgreSQL/OpenFGA, real Edge browser) and `tests/integration/keycloak.test.mjs` (real Keycloak 26.3.3 login form).
