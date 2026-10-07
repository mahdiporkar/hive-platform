# Identity and session

Implemented in `services/bff` (OAuth client, session, vault, refresh) and `services/authorization` (`identity` package: providers, canonical users, aliases). Design decisions: [ADR-008](adr/ADR-008-identity-and-session.md).

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant F as BFF
  participant I as Identity Provider
  participant A as Authorization service
  participant R as Redis
  B->>F: GET /auth/login?returnUrl=/path[&provider|tenant|domain]
  F->>A: GET /internal/identity/route (only when a selector is given)
  F-->>B: 302 /oauth2/authorization/{code}
  B->>I: authorize (code_challenge S256, state, nonce)
  I-->>B: 302 /login/oauth2/code/{code}?code&state
  B->>F: callback
  F->>I: token exchange (client secret, code_verifier) — server side only
  F->>F: validate ID token (issuer, audience, signature, expiry, nonce)
  F->>A: POST /internal/identity/login (provider, issuer, subject, name)
  A-->>F: canonical user id + tenant
  F->>R: store AES-GCM vault record; session holds handle + token-free principal
  F-->>B: 302 returnUrl, Set-Cookie HIVE_SESSION (new id; Secure; HttpOnly; SameSite=Lax)
```

## Configuration

BFF: `HIVE_IDENTITY_ENABLED=true`, `HIVE_OIDC_ISSUER`, `HIVE_OIDC_CLIENT_ID`, `HIVE_OIDC_CLIENT_SECRET`, `HIVE_VAULT_KEY` (Base64 256-bit), optional `HIVE_VAULT_KEY_ID`/`HIVE_VAULT_PREVIOUS_KEYS`, `HIVE_REDIS_HOST|PORT|PASSWORD`, `HIVE_AUTHORIZATION_URL`, `HIVE_INTERNAL_PASSWORD`, `HIVE_IDP_ALLOWED_ORIGINS` and one `HIVE_IDP_<NAME>` variable per dynamic provider secret reference.

Authorization service: `HIVE_PRIMARY_ISSUER`, `HIVE_IDP_ALLOWED_ORIGINS`, `HIVE_INTERNAL_PASSWORD` (BFF runtime principal), `HIVE_PROVISIONING_PASSWORD` (machine provisioning principal).

HTTPS is mandatory for issuers and endpoints; `HIVE_OIDC_ALLOW_LOCAL_HTTP`/`HIVE_IDP_ALLOW_LOCAL_HTTP` permit plain HTTP only for `localhost`/`127.0.0.1` in tests.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /auth/login?returnUrl=&provider=&tenant=&domain=` | Start login. `returnUrl` must be a local path (no scheme, authority, traversal, backslash, control characters or auth loop). |
| `GET /auth/csrf` | CSRF header name and token for mutating calls. |
| `POST /auth/logout` | CSRF-protected; deletes the vault record and invalidates the session. |
| `GET /api/me/session` | Token-free identity and absolute expiry; refreshes the access token server-side when it is within 15 s of expiry. |
| `GET/POST/PUT /provisioning/identity/providers` | Machine provisioning of dynamic providers (optimistic `revision`). Also exposed to platform security administrators through the admin API. |
| `POST /provisioning/identity/aliases` | Explicitly link an additional external identity to a canonical user in the same tenant. |

## Executed evidence

- `npm run test:identity` — fixture IdP with signed JWTs; PKCE verified at the token endpoint; session-id rotation; cookie flags; 8 concurrent session calls on an expiring token cause exactly one refresh; vault is encrypted and the Redis session hash contains no tokens or OIDC authorities; CSRF-protected logout clears the vault; dynamic provider create/duplicate/unapproved-origin/stale-revision/disabled cases; domain+tenant routing; explicit cross-issuer alias keeps the canonical id; 6 concurrent first logins produce one user; cross-tenant alias rejected; Edge browser login with `returnUrl` and `document.cookie` secrecy; issuer, audience, expiry, nonce and signature faults rejected without creating a session.
- `npm run test:keycloak` — real Keycloak 26.3.3 login page in Edge; server-side token exchange only; canonical identity synchronized; logout clears vault.
