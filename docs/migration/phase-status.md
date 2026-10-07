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

## Phase 3 — Identity (OPEN)

Implemented: primary OIDC Authorization Code with PKCE; server-side Redis session; Secure/HttpOnly/SameSite cookie; token-free session principal; AES-GCM encrypted vault; key rotation primitive; bounded token refresh; Redis refresh ownership; fixed absolute session deadline; CSRF-protected logout; safe return URL.
Reused: reviewed TokenVaultCrypto behavior, selectively migrated with its package namespace changed.
Refactored: source token-free login/vault behavior to servlet security with request-only authorized-client handoff.
Rewritten: return-URL validation, bounded refresh transport, refresh ownership/revocation write guard.
Dropped: source-specific integration-cookie cleanup from mandatory identity runtime.
Deferred: no mandatory requirement removed. Dynamic providers, canonical aliases/login synchronization and remaining acceptance tests are unfinished, not release deferrals.
Tests Added: 10 Java security primitive tests and 1 real HTTP OIDC/Redis integration scenario.
Tests Executed: clean npm install; typecheck; npm test; Maven verify; bootstrap integration; identity integration.
PASS: 14 Node architecture/contract tests; 20 Java tests, zero skipped; 2 real integration scenarios. OIDC fixture verifies code/PKCE, session rotation, cookie flags, server refresh, encrypted vault, token-free Redis principal, CSRF enforcement, logout and post-logout denial. Bootstrap regression remains passing.
FAIL: intermediate configuration concatenation was detected by Maven and fixed; redirect assertion was corrected to compare equivalent same-origin URLs. Both reruns passed.
NOT EXECUTED: real-browser login, Keycloak interoperability, provider management, canonical synchronization, refresh race/adversarial integration matrix. Therefore Phase 3 is not complete and Phases 4–15 have not started.
Open Blockers: unfinished engineering and validation listed above; no missing user confirmation is asserted.
Commit SHA: see the commit introducing this section.

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