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

Milestone 0.1.0-dev.0: phases 0–15 COMPLETE, 28/28 verification steps PASS. Release 1.0.0 is NOT EXECUTED — see the final verification matrix at the end.

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

## Phase 7 — MFE runtime (COMPLETE)

Implemented: `@hive-platform/core` (signals, lifetimes, diagnostics, route matching, extension registry), `@hive-platform/http-client` (cookie session, CSRF with one refresh retry, correlation ids, timeouts, PlatformError), `@hive-platform/auth` (contexts, safe login return URLs, logout), `@hive-platform/authorization` (permission and route-access hints), `@hive-platform/mfe-runtime` (compatibility-first loading, SRI over executed bytes, precise diagnostics, shared artifact load with independent instances, SCOPED/SHADOW_DOM containers, lifecycle deadlines); runtime context projections (`/internal/runtime/public-context`, `/internal/runtime/context`) and BFF `/api/public/context`, `/api/me/context`; feature flags (environment restriction, tenant overrides, exposure classes, audited); `examples/minimal-consumer` plain-TypeScript micro-app and plain-DOM host; dev gateway; esbuild bundling with build-time SRI; example type-checking.
Reused: none (the reference loader was unsuitable).
Refactored: context/manifest projections into server-side runtime contexts.
Rewritten: MFE loader and lifecycle (ADR-004).
Dropped: module-scoped remote caching, React types in shared contracts, vague "container not registered" errors.
Deferred: none for this phase.
Tests Added: `tests/packages/mfe-runtime.test.mjs` (6 tests, 11 failure classes), `tests/packages/headless.test.mjs` (5), `tests/e2e/mfe-runtime.test.mjs` (Edge).
Tests Executed: typecheck (packages + examples); npm test; mvnw verify; test:e2e:mfe.
PASS: 36 Node tests; 122 Java tests; Phase 7 browser E2E.
FAIL (fixed): extension ordering expectation in test; E2E logged in the fixture IdP's default subject instead of the granted user (test); authenticated contexts dropped public-only modules (product bug, fixed); unknown anonymous paths now mean "sign in" because public contexts never disclose protected routes (host behavior, ADR-004); example type-check found an undeclared field (fixed).
NOT EXECUTED: non-Chromium browsers (Firefox/WebKit not installed).
Open Blockers: none.
Commit SHA: see git log (Phase 6 commit is 81cca46).

## Phase 8 — Workspace runtime (COMPLETE)

Implemented: `@hive-platform/workspace` — WorkspaceEngine (SINGLE/TABS/SPLIT/DASHBOARD with capacities, serialized per-slot lifecycle, per-slot status/authorization/error, multi-instance modules, in-module update vs cross-module remount, context re-evaluation), HiveEventHub (namespaced, scoped, copied, async, failure-isolated, auto-released subscriptions), session persistence with hostile-state sanitizing and restore, optional plain-DOM renderer with stable slot elements; `directory-example` event-publishing micro-app; plain-DOM workspace host; server context change so application members can see DENIED routes.
Reused: none (the reference workspace was embedded in a React shell).
Refactored: route visibility in authenticated contexts (members see all routes of their applications with required actions).
Rewritten: workspace model and lifecycle outside any UI component tree.
Dropped: shell-owned workspace state.
Deferred: NEW_WINDOW / POPOUT layouts (the model anticipates them).
Tests Added: `tests/packages/workspace.test.mjs` (5), `tests/e2e/workspace.test.mjs` (Edge).
Tests Executed: npm test; typecheck; mvnw verify; test:e2e:workspace; test:e2e:mfe (regression).
PASS: 41 Node tests; 122 Java tests; both browser E2E suites.
FAIL (fixed): the fake DOM lacked APIs used by the renderer (test support extended); revoked access surfaced as ROUTE_NOT_FOUND because contexts hid every non-allowed route (contexts now expose routes to application members; ADR-005).
NOT EXECUTED: NEW_WINDOW/POPOUT; non-Chromium browsers.
Open Blockers: none.
Commit SHA: see git log (Phase 7 commit is c778a81).

## Phase 9 — Operator Console (COMPLETE)

Implemented: `apps/operator-console` (React 19 + Ant Design 5, Vite) as a pure admin API client: diagnostics, applications and resource trees, modules with manifest import/fetch/diff/publish/rollback and artifact activation, users, groups, roles, grants, platform roles, identity providers, service targets, legacy profiles, proxy routes and operations with preview, feature flags, audit and API logs; role-based menu hints and a no-role screen; identity provider/alias administration endpoints for SECURITY_ADMIN; identity audit entries attribute the real actor; per-workspace `engines` declarations.
Reused: administrative feature set of the reference admin UI (as requirements, not code).
Refactored: admin UI into a standalone API client without shell privileges.
Rewritten: all screens.
Dropped: reference admin micro-frontend coupling to its shell.
Deferred: OU/LDAP screens (feature deferred); Superset screens (Phase 12).
Tests Added: `tests/e2e/operator-console.test.mjs` (E2E 11), `tests/e2e/api-only-administration.test.mjs` (E2E 12 / spec §22).
Tests Executed: typecheck (incl. console); build:console; mvnw verify; test:e2e:console; test:e2e:api-admin.
PASS: both E2E suites; typecheck; console build.
FAIL (fixed): a per-directory Node version shim selected Node 11 for the app folder (engines declared); Ant Design Tree/Result do not forward data-testid (selectors adjusted); API omits null fields so the tree root was not found (console fixed); audit table default page size hid rows (pagination and filter).
NOT EXECUTED: accessibility audit of the console.
Open Blockers: none.
Commit SHA: see git log (Phase 8 commit is c4ec33b).

## Phase 10 — Public / hybrid / authenticated runtime (COMPLETE)

Implemented: `@hive-platform/react` (createReactMicroApp, HiveProvider, usePermission, useWorkspace, WorkspaceView, ExtensionSlot); `apps/default-shell` (navigation filtered by access, all layouts, slot chrome for loading/error/denied/sign-in, URL mirrors the active route only, restore, login/logout with context re-evaluation, HEADER/NAVIGATION/DASHBOARD extension slots loaded from an optional consumer `/shell-extensions.js`); `examples/react-tailwind-consumer` (student-example micro-app with PUBLIC, HYBRID and AUTHENTICATED routes, permission-gated actions, dynamic routes, events; Tailwind in a shadow root; server-rendered public site); campus fixture API; gateway single-file mounts; consumer architecture tests.
Reused: none.
Refactored: route access semantics surfaced end to end (UI hint vs server enforcement).
Rewritten: shell (reference shell replaced by a replaceable SDK client).
Dropped: shell-coupled navigation and admin privileges.
Deferred: none for this phase.
Tests Added: `tests/e2e/public-hybrid.test.mjs`, `tests/architecture/consumers.test.mjs` (4).
Tests Executed: typecheck (packages, examples, console, shell); npm test; build:shell; build:examples; test:e2e:public-hybrid.
PASS: 45 Node tests; Phase 10 browser E2E (E2E 2, 4, 5, 6, shell restore, SSR).
FAIL (fixed): TypeScript crashed on a multi-candidate path mapping (explicit react mapping); test misunderstood SINGLE-layout replacement (test navigates back).
NOT EXECUTED: Next.js specifically (SSR proven with react-dom/server; pattern identical).
Open Blockers: none.
Commit SHA: see git log (Phase 9 commit is ed6e464).

## Phase 11 — SDK, CLI and extension model (COMPLETE)

Implemented: `hive` CLI (version, validate with SRI and cross-checks, doctor with real checks and NOT EXECUTED reporting, up/down with generated secrets and isolated projects, create solution, add mfe, add service, register, upgrade --check); all eight extension points rendered by the default shell; Docker images (`hive/authorization`, `hive/bff` non-root; `hive/default-shell` gateway and `hive/operator-console` nginx with security headers); `infra/docker-compose/hive.yml` with an optional `ui` profile; consumer guide, CLI and extension docs.
Reused: none.
Refactored: none.
Rewritten: CLI (no reference equivalent).
Dropped: none.
Deferred: `hive add domain` (business domains belong to solutions); automatic `hive upgrade` (no release channel yet).
Tests Added: `tests/cli/cli.test.mjs` (4), `tests/cli/up.test.mjs` (1); ManifestDocumentsTest dot-segment cases.
Tests Executed: npm test; typecheck; mvnw verify (authorization); test:cli; test:cli:up.
PASS: 45 Node tests; CLI suite; hive up/down with real images.
FAIL (fixed): route paths with `.`/`..` segments were accepted by both the server and the CLI (security fix, regression test added); a test fixture's duplicate key masked a parent-type check; the gateway served the shell for `/actuator/*` (now 404 except readiness).
NOT EXECUTED: publishing packages to a registry; Windows-native (non-Docker) service install.
Open Blockers: none.
Commit SHA: see git log (Phase 10 commit is 862160b).

## Phase 12 — Optional integrations (COMPLETE)

Implemented: optional Superset integration — instance registry with TLS-by-default, network policy and secret references; asset registry mapped to catalog resources (asset grants via ordinary grants); BFF same-origin authorized tunnel with an operation allowlist, body-based asset identification for chart data, server-side service-account token (encrypted, revision-scoped, dropped on 401), no cookie forwarding either way, size limits, API logs and audit; health recording; enable/disable lifecycle; Operator Console page.
Reused: request-body asset inspector behavior; asset-grant concept; exact-origin target policy.
Refactored: integration registry onto the generic catalog and graph.
Rewritten: tunnel (stock Superset REST API with a service account instead of a customized Superset and cookie rewriting) — ADR-011.
Dropped: REMOTE_USER header trust, product-branded headers, cookie/location rewriting, Superset demo assets and roles.
Deferred: embedding Superset's UI (guest tokens), per-user RLS, mTLS to Superset (ADR-011).
Tests Added: `tests/integration/superset.test.mjs`, Superset fixture, BFF security test for integration sessions.
Tests Executed: mvnw verify; typecheck; build:console; test:superset.
PASS: Superset integration suite; 123 Java tests; typecheck.
FAIL (fixed): encoded traversal assertion needed a raw HTTP request (client normalization).
NOT EXECUTED: a real Superset instance.
Open Blockers: none.
Commit SHA: see git log (Phase 11 commit is b4f0694).

## Phase 13 — Production hardening (COMPLETE)

Implemented: fail-closed production profile (default) in both services via a shared `ProductionGuard`; startup diagnostics without secrets; trusted-proxy forwarded headers; graceful shutdown; secret-leak scan over all service logs; compose validation tool; branding scan; full verification runner (`npm run verify:all`); deployment, security and observability documentation.
Reused: the reference production-guard concept (fail closed on unsafe configuration).
Refactored: guard into a reusable starter component with per-service rules.
Rewritten: none.
Dropped: none.
Deferred: rate limiting/WAF (ingress responsibility); OpenAPI documents; mTLS; multi-instance load testing.
Tests Added: ProductionGuardTest (4), `tests/integration/hardening.test.mjs` (2), `tests/security/log-scan.test.mjs`, `tests/architecture/branding.test.mjs` (2), `tools/verify-compose.mjs`.
Tests Executed: mvnw verify; test:hardening; test:log-scan; branding scan; verify:compose.
PASS: 127 Java tests; hardening (unsafe refusal, clean production start, forwarded headers); 35 service logs clean; branding scan; both compose files valid.
FAIL (fixed): a guard test's own substring assertion was wrong ("unsafe;" contains "safe;").
NOT EXECUTED: TLS termination in front of the gateway (documented, not run locally).
Open Blockers: none.
Commit SHA: see git log (Phase 12 commit is 1520119).

## Phase 14 — End-to-end acceptance and documentation (COMPLETE)

Implemented: golden-path E2E (`tests/e2e/golden-path.test.mjs`, 31 steps against real Keycloak 26.3.3, PostgreSQL, OpenFGA, Redis, both services and the dev gateway); documentation set (architecture, principles, control/runtime plane, versioning, source capability map) with an executable documentation check; full 28-step verification runner (`npm run verify:all`).
Reused: none.
Refactored: test harness (`beforeBff` hook, development profile for test services).
Rewritten: none.
Dropped: none.
Deferred: none added in this phase.
Tests Added: golden path E2E (1 scenario, 31 steps); `tests/architecture/docs.test.mjs` (3).
Tests Executed: complete `npm run verify:all` (28 steps).
PASS: 28/28 runner steps; 50 Node tests; 127 Java tests (0 failures, 0 errors, 0 skipped).
FAIL (fixed): (1) regression found by the golden path — the dev gateway and the nginx template set `X-Forwarded-Proto` without a port while the services honour native forwarded headers, so the OAuth `redirect_uri` lost its port; both gateways now pass forwarded headers through untouched. (2) The nginx gateway served the shell for `/actuator/*`; it now returns 404. (3) The runner could not launch `mvnw.cmd` on Windows (cmd does not search the working directory); it now uses an absolute path.
NOT EXECUTED: hosted GitHub Actions run; non-Chromium browsers.
Open Blockers: none.
Commit SHA: see git log (Phase 13 commit is ed533bf).

E2E coverage map (spec E2E 1–14): fresh install zero data → test:bootstrap; first administrator → test:authorization, golden; module registration and manifests → test:manifests, test:e2e:console, golden; grants and decisions → test:authorization, golden; forward-token route → test:routing, golden; legacy route → test:routing; public/hybrid/authenticated → test:e2e:public-hybrid; multi-MFE and isolation → test:e2e:mfe; workspace layout, events and restore → test:e2e:workspace, golden; operator console → test:e2e:console; API-only administration → test:e2e:api-admin; Superset tunnel → test:superset (stub upstream); logout and session revocation → test:identity, golden; CLI lifecycle → test:cli, test:cli:up.

## Phase 15 — Release candidate (COMPLETE for milestone 0.1.0-dev.0)

Implemented: final verification matrix and acceptance checklist below; version remains `0.1.0-dev.0` (1.0.0 is reserved for final acceptance, which includes items NOT EXECUTED here).
Reused / Refactored / Rewritten / Dropped: none in this phase.
Deferred: see "Deferred work" below.
Tests Executed: `npm run verify:all` — 28/28 PASS (results in `.local/verification.json`).
NOT EXECUTED: listed in the matrix with the exact limitation.
Open Blockers: none for the milestone; the NOT EXECUTED rows block 1.0.0.
Commit SHA: see git log (Phase 14 commit is cb90070).

## Final verification matrix

| Check | Result | Evidence / exact limitation |
|---|---|---|
| npm clean install | PASS | `npm ci` |
| npm build / typecheck | PASS | all packages, strict TypeScript, 4 tsconfigs |
| npm tests (architecture, contracts, packages, docs) | PASS | 50 tests, 0 failures |
| Maven verify | PASS | 127 Java tests, 0 failures/errors/skips |
| Architecture / forbidden dependency / domain / branding | PASS | `test:architecture` |
| Contract and compatibility matrix | PASS | shared fixture executed by Java and TypeScript |
| Fresh DB / Flyway V1–V7 / zero data | PASS | `test:bootstrap` |
| OpenFGA model and bootstrap | PASS | `test:model`, `test:bootstrap` |
| Identity: OIDC/PKCE, vault, refresh, logout | PASS | `test:identity` |
| Keycloak interoperability | PASS | real Keycloak 26.3.3 (`test:keycloak`, golden path) |
| Authorization, outbox, replay, cache | PASS | `test:authorization` |
| Manifest governance | PASS | `test:manifests` |
| Dynamic routing: forward token, legacy | PASS | `test:routing` |
| Superset tunnel | PASS | `test:superset` against a stub of the stock Superset API |
| Real Superset instance | NOT EXECUTED | no Superset deployed in verification |
| Production hardening / log secrecy | PASS | `test:hardening`, `test:log-scan` |
| MFE runtime / workspace / console / API admin / public-hybrid E2E | PASS | Playwright, Edge (Windows) |
| Golden path E2E (31 steps) | PASS | `test:e2e:golden` |
| Non-Chromium browsers (Firefox, WebKit) | NOT EXECUTED | only Chromium-family engines run |
| CLI and CLI up/down with images | PASS | `test:cli`, `test:cli:up` |
| Docker Compose config | PASS | `verify:compose` |
| TLS termination | NOT EXECUTED | documented in deployment guide; not run locally |
| Next.js consumer | NOT EXECUTED | SSR proven with React + Vite example, not Next.js |
| Hosted CI | NOT EXECUTED | workflow authored; no hosted run observed |

## Final acceptance checklist

| Criterion | Status |
|---|---|
| Independent repository, no source history, source repository untouched | COMPLETE |
| Fresh installation contains zero business data | COMPLETE |
| Core free of React/AntD/MUI/Tailwind and business domain | COMPLETE |
| No OAuth/refresh/legacy/service tokens reach browser JavaScript | COMPLETE (session scan, golden path, log scan) |
| Identity, authorization, catalog, manifests, routing, MFE, workspace, public/hybrid | COMPLETE |
| Operator console optional; API-only administration | COMPLETE |
| SDK, CLI, extension points, consumer examples | COMPLETE |
| Optional Superset integration | COMPLETE (API tunnel); UI embedding DEFERRED |
| Production hardening | COMPLETE; rate limiting/WAF, mTLS DEFERRED |
| Documentation and ADRs | COMPLETE |
| Hosted CI, real Superset, TLS, non-Chromium browsers | NOT EXECUTED |
| 1.0.0 release | NOT EXECUTED (blocked on the rows above) |

## Deferred work

RP-initiated IdP logout; OU/LDAP directory integration; runtime policies/obligations; application-scoped delegated administration; upstream rewrite patterns; proxy retries; API_KEY / OAUTH2_CLIENT_CREDENTIALS / MTLS route modes; NEW_WINDOW / POPOUT layouts; `hive add domain` and automatic `hive upgrade`; Superset UI embedding, guest tokens, per-user RLS; OpenAPI documents; rate limiting/WAF; multi-instance load testing.
