# Identity implementation status

Phase 3 is in progress. The implemented primary OIDC flow uses Spring Security Authorization Code with PKCE, issuer validation, server-side Redis sessions and encrypted server-side token storage. The browser receives HIVE_SESSION with Secure, HttpOnly and SameSite=Lax attributes. A transient request-only authorized-client repository prevents OAuth clients from being written into ordinary session attributes. After login, the security principal is replaced with a token-free SessionIdentity.

Enable with HIVE_IDENTITY_ENABLED=true and configure HIVE_OIDC_ISSUER, HIVE_OIDC_CLIENT_ID, HIVE_OIDC_CLIENT_SECRET, HIVE_VAULT_KEY (Base64 256-bit key), HIVE_REDIS_HOST, HIVE_REDIS_PORT and HIVE_REDIS_PASSWORD. Secrets must be supplied by deployment configuration, never committed. The issuer requires HTTPS; a separate local-test flag permits only localhost/127.0.0.1 HTTP. External TLS termination must preserve a trusted public origin; production ingress configuration is not implemented yet.

- GET /auth/login?returnUrl=/local/path starts login.
- GET /auth/csrf obtains the CSRF header name and token.
- GET /api/me/session returns safe identity metadata after checking the vault and refreshing expiring tokens.
- POST /auth/logout requires CSRF, deletes the vault entry and invalidates the session.

Refresh uses a bounded response subscriber, a five-second HTTP deadline and a Redis ownership lease. The final encrypted write atomically checks both lease ownership and continued existence of the session vault record, preventing logout from being undone by an in-flight refresh. Refresh cannot extend the absolute session deadline. Idle vault entries expire automatically.

Executed HTTP integration evidence uses a signed-JWT OIDC fixture and real Redis: PKCE, session ID rotation, cookie flags, refresh, token-free Redis session, encrypted vault, CSRF denial and logout cleanup. It uses an explicit HTTP cookie jar, not a real browser. Browser behavior and production IdP interoperability remain NOT EXECUTED.

Remaining Phase 3 requirements: dynamic external provider persistence and routing, canonical identity aliases/login synchronization, adversarial OIDC response matrix, refresh concurrency/revocation integration tests and browser validation. No later feature phase is declared complete.