# Security

| Invariant | Mechanism | Evidence |
|---|---|---|
| No tokens or credentials in browser JavaScript | BFF is the only OAuth client; opaque `HIVE_SESSION` (Secure, HttpOnly, SameSite=Lax); AES-GCM vault; token-free session principal; legacy/integration tokens encrypted in Redis; secrets are references resolved by the BFF | identity, Keycloak, routing, Superset and all E2E suites assert absence in responses, `document.cookie`, contexts and logs |
| CSRF on every unsafe method | Spring Security CSRF (session repository) for `/api/**` and `/auth/logout`, anonymous or not | BFF security tests; routing and E2E suites |
| Server-side authorization, default deny | Route operations, admin handlers (`@PlatformAccess`), Superset tunnel and contexts all decide in the authorization service; unknown/archived/undeclared/graph-failure all deny | authorization, routing, superset, public-hybrid suites |
| Platform vs business roles | `platform:hive` relations, never conferred by resource grants; last super-admin protected; first admin only from configuration | authorization suite, console E2E |
| Trusted targets only | Registered service targets validated by network policy; BFF exact-origin allowlist; DNS-resolved check per call; no redirects; no browser-supplied URLs | routing suite (metadata IP, unapproved origin, redirect) |
| Path safety | Canonical path language (no traversal, encoded separators, duplicate slashes, control characters); dot segments rejected in route definitions; firewall rejections answer 400 | RoutePathPolicyTest, ManifestDocumentsTest, routing/superset raw-request tests |
| Header allowlists | Only content-negotiation/conditional headers forwarded; cookies and browser `Authorization` dropped; upstream cookies and internals never relayed | routing suite |
| Executable artifact integrity | SRI required; runtime verifies digest of the exact bytes it evaluates; artifact URLs pass network policy | mfe-runtime unit tests, Phase 7 E2E, CLI/doctor tamper tests |
| Safe redirects | `returnUrl` validated server-side and mirrored client-side | ReturnUrlTest, auth package tests, identity suite |
| Public context secrecy | Separate projection without identity, permissions, protected routes, targets, origins or non-public flags | public-hybrid E2E |
| Fail-closed production | Production profile refuses unsafe settings at startup | ProductionGuardTest, hardening suite |
| No secrets in logs or audit | Recursive redaction of audit details and API errors; logs scanned after every suite | `npm run test:log-scan`, audit assertions |
| Immutable governance history | Published manifests and artifacts immutable (DB triggers); grants and resources archived, never deleted | manifests and authorization suites |

## Artifact gateway

The BFF serves MFE files only for modules in the caller's runtime context, from the active registered revision, below the entry directory, after a per-fetch network-policy check, without redirects or forwarded credentials, with type and size checks and entry integrity verification ([ADR-013](adr/ADR-013-artifact-gateway.md)).

## Known limits

Micro-apps run in the page's origin; they are trusted code registered by platform operators and pinned by SRI, not sandboxed. CSP allows `blob:` scripts for the verified-import loader and inline styles for shadow roots. Rate limiting and WAF rules belong to the ingress (not provided). mTLS to targets and upstream, and API_KEY/OAUTH2_CLIENT_CREDENTIALS route modes are deferred (explicitly rejected, never stubbed).
