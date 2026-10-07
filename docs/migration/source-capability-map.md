# Source capability map

Migration reference document (historical source names are intentional here). Reference: `mahdiporkar/aurevia-super-app`, commit `4bdd8b89bb8c53193a4c486afe30c03eab35b5d9`, inspected read-only; nothing was written to it. Source tests were not executed; Hive behavior is proven by the Hive tests listed.

BFF = `services/superapp-bff/src/main/java/com/aurevia/bff`; AUTH = `services/authorization-service/src/main/java/com/aurevia/authz`.

Status: COMPLETE (implemented and tested in Hive), DEFERRED (valid, outside this milestone), DROPPED (not entering Hive).

| Source Capability | Source Location | Classification | Hive Target | Reason | Status | Tests | Notes |
|---|---|---|---|---|---|---|---|
| Token envelope | BFF/security/TokenVaultCrypto.java | REUSE | services/bff/security/TokenVaultCrypto | AES-256-GCM, random IV, key rotation | COMPLETE | TokenVaultCryptoTest; test:identity | tamper rejection kept |
| Token-free session principal | BFF/security/TokenFreeSecurityContextRepository.java | REFACTOR | services/bff/security (SessionIdentity, RequestAuthorizedClients) | no OIDC authorities persisted | COMPLETE | test:identity (Redis session scan) | servlet transport |
| Session logout | BFF/security/VaultLogoutHandler.java | REFACTOR | IdentityConfiguration logout | vault cleanup with invalidation | COMPLETE | test:identity, golden path | HIVE_SESSION |
| OIDC and refresh | BFF/security | REFACTOR | services/bff/security | PKCE, issuer validation, lease-coordinated refresh | COMPLETE | test:identity (5 token faults, 8-way refresh), test:keycloak | absolute deadline never extended |
| Dynamic identity providers | AUTH/identityprovider | REFACTOR | authorization/identity | secret references, origin allow-list, revisions | COMPLETE | test:identity | admin + provisioning APIs |
| Canonical users and aliases | AUTH/identity | REFACTOR | authorization/identity | provider-independent identity, explicit aliases | COMPLETE | test:identity (concurrent first login) | no e-mail auto-linking |
| First administrator | AUTH/bootstrap | REUSE | authorization/access/FirstAdministrator | one-time, durable marker | COMPLETE | test:authorization, golden path | no invented admin |
| Roles, groups, grants | AUTH/access | REFACTOR | authorization/access | PostgreSQL source of truth, history | COMPLETE | test:authorization | subject references |
| OU and LDAP | AUTH/directory | REFACTOR | optional directory integration | optional enterprise integration | DEFERRED | — | not required by Core; no partial stub shipped |
| Authorization graph | AUTH/openfga; infra/openfga/model.fga | REWRITE | infra/openfga/model.fga | per-action objects, platform type, no branded roots | COMPLETE | test:model, test:authorization | ADR-003 |
| Transactional outbox | AUTH/sync/OutboxReconciler.java | REUSE | authorization/graph/GraphOutbox | claims, ordering, retries, lost-claim fault | COMPLETE | test:authorization | after-commit drain added |
| Startup/graph reconciliation | AUTH/sync/OpenFgaStartupReconciler.java | REFACTOR | authorization/graph/GraphReplay + GraphStore.verify | replay on store loss (incl. soft delete) | COMPLETE | test:authorization (store deletion) | |
| Decision cache | AUTH/openfga/OpenFgaRelationshipAdapter.java | REUSE | authorization/graph/DecisionCache | epoch invalidation, fail-closed bump | COMPLETE | test:authorization (cached allow revoked) | optional |
| Runtime policies/obligations | AUTH/policy | REFACTOR | — | not required for relationship decisions | DEFERRED | — | ADR-003 |
| Semantics registry (action aliases) | AUTH/semantics | DROP | — | replaced by declared per-action objects | DROPPED | — | |
| Resource catalog | AUTH/registry/ResourceManifestService.java | REFACTOR | authorization/catalog/ResourceCatalog | parent rules, cycles, ownership, archive | COMPLETE | test:authorization, test:manifests | |
| Manifest draft/diff/publish/activate | AUTH/registry | REFACTOR | authorization/manifest/ModuleRegistry | immutable versions, coordinated activation | COMPLETE | test:manifests, test:e2e:console | DB triggers added |
| Manifest fetcher | AUTH/registry/HttpManifestFetcher.java | REUSE | authorization/manifest/ManifestFetcher | bounded, no redirects, classified errors | COMPLETE | test:manifests | |
| Artifact registry | AUTH/ui | REFACTOR | artifact_revision + ModuleRegistry | immutable revisions, SRI required | COMPLETE | test:manifests | |
| Artifact URI/network policy | services/ui-artifact-security | REUSE | services/ui-artifact-security | tested SSRF matrix | COMPLETE | UiArtifactNetworkMatrixTest (54), UiArtifactUriPolicyTest | namespace changed |
| MFE contracts | packages/contracts/src/index.ts | REWRITE | packages/contracts | source imported React types | COMPLETE | tests/contracts, architecture | |
| Dynamic loader | apps/shell/src/remote-loader.ts | REWRITE | packages/mfe-runtime | instances, SRI over executed bytes, diagnostics | COMPLETE | tests/packages/mfe-runtime, test:e2e:mfe | ADR-004 |
| Navigation and context | apps/shell; BFF/api/MeController.java | REFACTOR | BFF ContextController + RuntimeContexts | separate public/authenticated projections | COMPLETE | test:e2e:public-hybrid | |
| Navigation overlays (menu overrides) | AUTH/registry | REFACTOR | navigation_overlay | presentation only | COMPLETE | test:manifests | |
| Panel discovery special case | AUTH/authorization/AuthorizationDecisionService.java | DROP | — | product-specific | DROPPED | — | |
| Workspace | apps/shell/src/index.tsx | REWRITE | packages/workspace | headless engine | COMPLETE | tests/packages/workspace, test:e2e:workspace | ADR-005/006 |
| HTTP client | packages/http-client | REFACTOR | packages/http-client | cookie/CSRF transport, no tokens | COMPLETE | tests/packages/headless | |
| UI authorization helpers | packages/authorization-sdk | REFACTOR | packages/authorization | headless hints | COMPLETE | tests/packages/headless | |
| Shared UI library | packages/sh-core-ui | DROP | — | presentation belongs to consumers | DROPPED | consumers.test.mjs | |
| Route resolution | AUTH/routing/RouteResolutionService.java | REFACTOR | authorization/routing/RouteResolver | longest prefix, priority, specificity, ambiguity | COMPLETE | test:routing | runtime projection API |
| Route path policy | AUTH/routing/RoutePathPolicy.java | REUSE | authorization/routing/RoutePathPolicy | canonical paths, pattern language | COMPLETE | RoutePathPolicyTest (migrated) | |
| Upstream rewrite patterns | AUTH/routing/UpstreamPathPolicy.java | REFACTOR | strip prefix + base path | simpler transformation | DEFERRED (rewrite) | — | ADR-007 |
| Approved upstream policy | BFF/proxy/GatewayTargetPolicy.java | REUSE | bff/proxy/TargetGuard | exact-origin allow-list | COMPLETE | test:routing | + DNS-resolved policy |
| Forward token proxy | BFF/api/OperationalProxyController.java | REFACTOR | bff/proxy/RuntimeProxy | allowlisted headers, limits | COMPLETE | test:routing, golden path | |
| Proxy retries | BFF/proxy/ProxyRetryPolicy.java | REFACTOR | — | never retry silently | DEFERRED | — | ADR-007 |
| Legacy token acquisition | BFF/outboundauth | REFACTOR | bff/proxy/LegacyTokens | encrypted cache, single flight, breaker | COMPLETE | test:routing (LEGACY section) | revision-keyed cache |
| Outbound connection registry | AUTH/outbound | REFACTOR | service_target + legacy_auth_profile | validated modes, revisions | COMPLETE | test:routing | |
| Superset | AUTH/superset; BFF/api/OperationSupersetProxyController.java | REWRITE | integrations + bff/integrations/SupersetTunnel | stock Superset API, no custom build | COMPLETE | test:superset | ADR-011; UI embedding DEFERRED |
| Audit and API logs | AUTH/observability; BFF/observability | REFACTOR | authorization/audit, routing/ApiLog, starter Redaction | structured, redacted | COMPLETE | test:authorization, test:routing, test:log-scan | |
| Administrative API security | AUTH/config/AdminAuthorizationInterceptor.java | REWRITE | authorization/admin/AdminAuthorization | explicit per-handler platform roles | COMPLETE | SecurityConfigurationTest, test:authorization | URL heuristics dropped |
| Production configuration guard | AUTH/openfga/ProductionOpenFgaConfigurationGuard.java | REFACTOR | starter ProductionGuard + StartupGuard | fail closed | COMPLETE | ProductionGuardTest, test:hardening | |
| Operator interface | apps/mfe-admin | REWRITE | apps/operator-console | standalone API client | COMPLETE | test:e2e:console | |
| HR/Finance/Reports demos | apps/mfe-hr; apps/mfe-finance; apps/mfe-reports | DROP | — | business demos | DROPPED | domain leakage, bootstrap zero-data | examples authored afresh |
| Database migration chain | services/authorization-service/src/main/resources/db | REWRITE | V1–V7 | clean baseline without seeds | COMPLETE | test:bootstrap (all tables empty) | |
| Production topology | infra/docker-compose/compose.yml | REWRITE | infra/docker-compose/hive.yml | zero-consumer core, optional UI profile | COMPLETE | test:cli:up, verify:compose | |
| OpenAPI documents | BFF/docs; AUTH/docs | REFACTOR | — | endpoint docs in Markdown | DEFERRED | — | docs list every API |
| Verification tooling | tools; tests/e2e | REFACTOR | tools, tests | real bootstrap/routing/browser checks | COMPLETE | verify:all | |
| Historical documents | docs | DROP | — | old reports are not evidence | DROPPED | — | |
