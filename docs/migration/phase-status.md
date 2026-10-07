# Phase evidence

## Phase 0 — Repository archaeology

Implemented: capability-level source inventory and target repository safety check.
Reused: no runtime code yet.
Refactored: none yet.
Rewritten: none yet.
Dropped: business demos, shared presentation library and historical migration chain from the planned Core.
Deferred: no mandatory acceptance criterion removed.
Tests Added: repository guard acceptance tests will accompany bootstrap.
Tests Executed: source and target Git remote/status/branch inspection; target remote read.
PASS: source is clean; target remote is mahdiporkar/hive-platform; target has no copied history; remote has no refs.
FAIL: none in repository identity checks.
NOT EXECUTED: source behavior tests; no source writes authorized.
Open Blockers: none for bootstrap. Deep per-capability inspection remains mandatory before each migration.
Commit SHA: see the commit introducing this report.

## Overall release status

Full platform acceptance is NOT EXECUTED. Read the phase-specific sections below; no release or production readiness is asserted.
## Phase 1 — Clean bootstrap

Implemented: independent Java reactor, BFF and Authorization health endpoints, deny-all API boundary, empty Flyway V1, PostgreSQL-backed OpenFGA verification topology, repository guard.
Reused: reviewed relationship semantics from the source OpenFGA DSL; no tuples or source history.
Refactored: dependency health reporting and clean service configuration.
Rewritten: database baseline and local verification deployment.
Dropped: mandatory shell, admin artifacts, demo seeds, Superset dependency.
Deferred: production deployment images/configuration to Phase 13; business APIs remain gated by later phases.
Tests Added: 2 repository guard tests, 10 HTTP security tests, 1 real integration scenario.
Tests Executed: npm test; npm run verify:repository; Maven verify; npm run test:bootstrap.
PASS: 2 Node tests; 10 Java tests; Compose configuration; fresh PostgreSQL migration; zero application/configuration/audit rows; OpenFGA model creation, default-deny and persistence after restart; both service health checks; authorization readiness failure when graph stops.
FAIL: initial offline Maven attempt could not resolve uncached compiler plugin; online retry passed. Initial npm invocation hit PowerShell execution policy; npm.cmd retry passed without changing system policy.
NOT EXECUTED: feature E2E, TypeScript build, production deployment. Features are not implemented yet.
Open Blockers: none for Phase 2. Bootstrap does not imply functional identity, authorization APIs or production readiness.
Commit SHA: see commit introducing this section; Phase 0 commit is 5c06ed2.

## Phase 2 — Contracts and boundaries

Implemented: all requested named contract interfaces, instance-producing Micro App ABI, strict compatibility validator, TypeScript package exports, architecture checks and CI workflow.
Reused: resource type vocabulary and public/private separation requirements.
Refactored: none of the source UI-coupled contracts copied.
Rewritten: headless contracts and version validation.
Dropped: shared React ComponentType from platform contracts.
Deferred: corresponding runtime implementations to their required phases.
Tests Added: 3 architecture tests, 8 compatibility cases and 1 public-package import test.
Tests Executed: npm run typecheck; npm test (includes build).
PASS: TypeScript typecheck and build; 14 Node tests total.
FAIL: none.
NOT EXECUTED: hosted GitHub Actions, MFE lifecycle behavior and browser E2E (runtime not implemented).
Open Blockers: none for identity implementation. Contract declarations are not server functionality.
Commit SHA: see commit introducing this section; Phase 1 commit is de59b43dcd974e7c458d01e940ea901ce2034df1.

## Phase 3 — Identity and session (COMPLETE)

Implemented: primary OIDC Authorization Code + PKCE; dynamic control-plane identity providers with deployment origin allow-list, secret references and optimistic revisions; tenant/domain/provider login routing; canonical users with external identity aliases; idempotent concurrent login synchronization; Redis session with Secure/HttpOnly/SameSite cookie; token-free principal; AES-GCM vault with key rotation; bounded, lease-coordinated refresh; absolute session deadline; CSRF-protected logout; safe return URLs; audit rows for identity changes.
Reused: TokenVaultCrypto behavior.
Refactored: token-free login/vault, dynamic provider registry, canonical identity resolver (servlet transport, explicit alias linking only).
Rewritten: return-URL validation, bounded refresh transport, refresh ownership/revocation write guard.
Dropped: source integration-cookie cleanup from the mandatory identity runtime.
Deferred: RP-initiated IdP logout (`end_session_endpoint`); LDAP/OU directory integration (optional, see capability map).
Tests Added: identity browser checks, five ID-token fault cases, concurrent refresh, dynamic provider/alias/tenant cases, Keycloak interoperability test; shared stack harness `tests/support/stack.mjs`.
Tests Executed: npm ci; typecheck; npm test; mvnw verify; test:bootstrap; test:identity; test:keycloak.
PASS: 14 Node tests; 20 Java tests; bootstrap; identity (fixture IdP + Edge); Keycloak 26.3.3 browser login.
FAIL: first identity run failed because the browser landed on a BFF-denied return path and Playwright treated the empty 403 as a navigation error; the test was corrected to assert the redirect target and probe from a same-origin document. First Keycloak run was cancelled by an event-loop drain during readiness polling; the harness now keeps a referenced timer. Both reran PASS.
NOT EXECUTED: production IdP over TLS (Phase 13).
Open Blockers: none.
Commit SHA: recorded in the following phase section.

## Phase 4 — Authorization and resource catalog (COMPLETE)

Implemented: applications with immutable root nodes; resource catalog (10 types, parent-type matrix, cycle/same-application/ownership checks, archive-only history, optimistic revisions); per-action OpenFGA objects and inherited `manage`; users (pre-provisioning with identity bindings, deactivation), groups, roles, assignments, grants with retained revocation history; platform roles on `platform:hive`; `@PlatformAccess` admin enforcement with actor forwarding and denial audit; transactional graph outbox with ordered, claim-owned projection, backoff and dead-lettering; optional Redis decision cache with epoch invalidation; store resolution/model installation; soft-deleted store detection with full replay; first administrator bootstrap; audit query; runtime decision API with reason codes; shared `hive-spring-boot-starter` (correlation id, PlatformError, redaction).
Reused: outbox claim/ownership semantics; epoch-based decision cache; first-administrator durable bootstrap.
Refactored: access administration (subject references, platform/business role split), OpenFGA adapter (HTTP client, idempotent `on_duplicate`/`on_missing`), catalog validation.
Rewritten: authorization model (per-action objects, platform type, no branded roots); admin authorization (explicit per-handler relations instead of URL heuristics).
Dropped: reference runtime-policy/obligation evaluation and OU/LDAP directory sync from this milestone (see Deferred); product-specific semantics registry aliases.
Deferred: runtime policies/obligations; OU/LDAP directory integration; application-scoped delegated administration.
Tests Added: 9 admin-boundary MockMvc tests, 3 starter tests, `tests/integration/authorization.test.mjs`, `tests/integration/openfga-model.test.mjs`.
Tests Executed: mvnw verify; npm test; test:model; test:authorization; test:bootstrap; test:identity.
PASS: 27 Java tests; 14 Node tests; model consistency (2); authorization integration (catalog, grants, inheritance, cache revocation, platform roles, audit, store recovery); bootstrap (now V1–V3, zero business rows); identity regression.
FAIL: first run showed OpenFGA keeps serving checks for a soft-deleted store, so deletion went unnoticed; added scheduled existence verification. A self-invoked `@Transactional` replay bypassed the proxy; replaced with TransactionTemplate. An empty startup replay produced an audit row on a fresh core; empty replays are no longer audited. All reran PASS.
NOT EXECUTED: multi-instance outbox contention under load (single instance tested); OpenFGA over TLS.
Open Blockers: none.
Commit SHA: see git log (Phase 3 commit is 8cf9cbc).

## Phase 5 — Manifest governance (COMPLETE)

Implemented: module registry with MANIFEST/MANUAL/HYBRID modes; separate resource and micro-frontend manifest contracts with cross-field rejection; canonical checksums; import/fetch → validated draft (real catalog dry-run in a rolled-back transaction) → diff → publish → activate (rollback/roll-forward) → discard drafts; immutable versions enforced in code and by database triggers; immutable artifact revisions; coordinated artifact+resource activation with route/resource validation and cross-module path conflicts; ordered release history; navigation overlays; runtime catalog projection with a monotonic revision; validation endpoint; shared Java/TypeScript compatibility matrix.
Reused: artifact URL/network policy library (`ui-artifact-security`, 62 migrated tests); version immutability and checksum invariants; bounded, redirect-free fetcher with classified failures.
Refactored: manifest workflow (module-scoped, framework-neutral, no legacy mixed manifests), coordinated activation.
Rewritten: manifest contracts and compatibility semantics (`manifestVersion` = content version).
Dropped: legacy mixed-manifest compatibility path; product-branded panel/slug concepts; panel discovery-resource special case.
Deferred: none for this phase.
Tests Added: 6 ManifestDocumentsTest, 16 CompatibilityMatrixTest (shared fixture), 62 artifact-policy tests, 16 shared TS matrix cases + 3 contract tests, `tests/integration/manifests.test.mjs`.
Tests Executed: mvnw verify; npm test; typecheck; test:manifests; test:authorization; test:bootstrap.
PASS: 96 Java tests; 25 Node tests; manifest lifecycle integration; authorization and bootstrap regressions (now V1–V4, zero rows in all module/manifest tables).
FAIL: overlay staleness assertion was wrong (a second update at revision 0 legitimately succeeds) — test corrected. Release history ordering was nondeterministic (same-transaction timestamps); added a sequence column. Both reran PASS.
NOT EXECUTED: fetch over TLS against a real CDN; DNS-failure classification (requires an unresolvable resolver in CI; covered by code path only).
Open Blockers: none.
Commit SHA: see git log (Phase 4 commit is d78f47d).

## Phase 6 — Dynamic routing (COMPLETE)

Implemented: service targets, legacy authentication profiles (secret references only), proxy routes and route operations with save-time validation (canonical paths, network policy, ambiguity, per-operation access constraints); runtime resolution API returning a runtime representation with the authorization decision; BFF runtime proxy with exact-origin allowlist and DNS-checked network policy, allowlisted headers both ways, request/response limits, timeouts, no redirects; FORWARD_TOKEN from the server vault; LEGACY token acquisition (4 request formats, JSON pointers), encrypted Redis cache keyed by profile revision, single-flight lease, circuit breaker, invalidation on upstream 401; API log and audit pipeline; admin passthrough `/api/admin/**`; CSRF endpoint for anonymous callers; unified BFF security model with identity-optional operation; firewall/container rejections reported as 400.
Reused: `RoutePathPolicy` and its tests; exact-origin gateway policy; legacy cache/parser/breaker semantics; file secret resolver semantics.
Refactored: route resolution into a runtime API; header handling into allowlists; secret resolution confined to the BFF.
Rewritten: proxy transport (servlet + java.net.http instead of reactive WebClient).
Dropped: product-specific identity headers and Superset special cases from the generic proxy.
Deferred: rewrite patterns; retries; API_KEY / OAUTH2_CLIENT_CREDENTIALS / MTLS route modes (explicitly rejected).
Tests Added: RoutePathPolicyTest (migrated), rewritten BFF security tests (11), `tests/integration/routing.test.mjs`, fixtures `oidc-fixture.mjs` and `upstream-fixture.mjs`; bootstrap now derives migration list and asserts every table empty.
Tests Executed: mvnw verify; npm test; test:routing; test:bootstrap; test:identity; test:keycloak; test:authorization; test:manifests.
PASS: 122 Java tests; 25 Node tests; all 7 integration suites.
FAIL (fixed): anonymous CSRF failures surface as 401 in the identity chain (test accepts 401/403 and asserts no upstream contact); `fetch` normalized encoded traversal client-side (raw HTTP used); container rejections surfaced as 401 via `/error` (now 400); the echo fixture leaked its own received token (fixture corrected). All reran PASS.
NOT EXECUTED: TLS to upstream targets; DNS-rebinding scenario.
Open Blockers: none.
Commit SHA: see git log (Phase 5 commit is 30a6782).

## Requested release verification matrix

| Check | Result | Evidence / exact limitation |
|---|---|---|
| npm clean install | PASS | npm ci executed |
| npm build | PASS | Executed by npm test; contracts package only |
| npm typecheck | PASS | Strict TypeScript compiler |
| npm tests | PASS | 14 implemented Node tests, not future platform tests |
| Maven verify | PASS | 20 Java tests, no failures/errors/skips |
| Architecture / forbidden dependency / domain checks | PASS | Current implemented platform source only |
| Contract tests | PASS | Version rejection, deprecation, package export |
| Docker Compose config | PASS | Executed by bootstrap scenario |
| Fresh DB / Flyway baseline | PASS | V1 from empty isolated PostgreSQL; zero application/config/audit rows |
| OpenFGA bootstrap | PASS | Model accepted; denied unknown resource; model survives restart |
| BFF / authorization health | PASS | Real Java processes; dependency failure changes readiness |
| Primary OIDC HTTP flow | PASS | Signed-JWT fixture plus real Redis; not browser E2E |
| Branding scan | PASS | Read-only scan of implemented services/packages/tools/tests/infra/ADRs found no obsolete runtime names |
| Golden Path E2E | NOT EXECUTED | Registration, grants, manifests and runtime not implemented |
| Forward Token / Legacy E2E | NOT EXECUTED | Dynamic routing not implemented |
| Public / Hybrid route E2E | NOT EXECUTED | Public context and route runtime not implemented |
| Multi-MFE / Workspace restoration E2E | NOT EXECUTED | MFE/workspace engines not implemented |
| Operator Console / API administration | NOT EXECUTED | Administrative APIs and UI not implemented |
| Production images / TLS / operational hardening | NOT EXECUTED | Phase 13 not started |
| Hosted CI | NOT EXECUTED | Workflow authored; no hosted result observed |
| Release candidate | NOT EXECUTED | Mandatory phases remain open |