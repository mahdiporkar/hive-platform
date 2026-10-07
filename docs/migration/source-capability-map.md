# Source capability map

Reference: `mahdiporkar/aurevia-super-app`, commit `4bdd8b89bb8c53193a4c486afe30c03eab35b5d9`. Source was inspected read-only. Locations below are relative to that repository. Classification records intended migration, not implemented or verified Hive functionality. No source test has been executed in this session.

BFF = `services/superapp-bff/src/main/java/com/aurevia/bff`; AUTH = `services/authorization-service/src/main/java/com/aurevia/authz`. Tests are under the corresponding `src/test/java` tree.

| Source Capability | Source Location | Classification | Hive Target | Reason | Status | Tests | Notes |
|---|---|---|---|---|---|---|---|
| Token envelope | BFF/security/TokenVaultCrypto.java | REUSE | services/bff/security | AES-256-GCM, random 96-bit IV, key rotation | NOT EXECUTED | TokenVaultCryptoTest | Preserve tamper rejection |
| Token-free session principal | BFF/security/TokenFreeSecurityContextRepository.java | REFACTOR | services/bff/security | Removes credential-bearing OIDC authorities before persistence | NOT EXECUTED | TokenFreeSecurityContextRepositoryTest | Keep server-side vault separate |
| Session logout | BFF/security/VaultLogoutHandler.java | REFACTOR | services/bff/security | Vault cleanup must accompany session invalidation | NOT EXECUTED | VaultLogoutHandlerTest | HIVE_SESSION cookie |
| OIDC and refresh | BFF/security | REFACTOR | services/bff/identity | Generic OIDC with dynamic registration; remove product assumptions | NOT EXECUTED | OidcIssuerValidationTest, OidcLoginSuccessHandlerTest | Preserve issuer/audience validation |
| Dynamic providers | AUTH/identityprovider | REFACTOR | services/authorization/identity | Control-plane configuration and secret references | NOT EXECUTED | IdentityProviderServiceTest | No browser credentials |
| Canonical users and aliases | AUTH/identity | REFACTOR | services/authorization/identity | Provider-independent identity | NOT EXECUTED | CanonicalIdentityResolverTest | No business profile fields |
| First administrator | AUTH/bootstrap | REFACTOR | services/authorization/bootstrap | Explicit bootstrap, no demo grants | NOT EXECUTED | FirstAdministratorBootstrapIntegrationTest | Must not invent default administrator |
| Roles, groups, grants | AUTH/access | REFACTOR | services/authorization/access | Catalog-dependent grants | NOT EXECUTED | AccessAdministrationServiceTest | PostgreSQL source of truth |
| OU and LDAP | AUTH/directory | REFACTOR | optional directory integration | Useful optional enterprise identity integration | NOT EXECUTED | DirectoryDnParserTest, OuRuleEvaluatorTest | Disabled without explicit configuration |
| Authorization graph | AUTH/openfga; infra/openfga/model.fga | REFACTOR | services/authorization/openfga | Preserve relationship semantics; remove branded roots | NOT EXECUTED | OpenFgaRelationshipAdapterTest | Only authorization service writes graph |
| Transactional outbox | AUTH/sync/OutboxReconciler.java | REUSE | services/authorization/sync | Claim ownership, retries and startup coordination | NOT EXECUTED | OutboxReconcilerTest | Do not replace with best-effort dual writes |
| Authorization decision cache | AUTH/authorization; AUTH/openfga | REFACTOR | services/authorization | Fail closed; invalidate on writes | NOT EXECUTED | PermissionLifecycleIntegrationTest | Revocation consistency requires dedicated tests |
| Resource catalog | AUTH/registry/ResourceManifestService.java | REFACTOR | services/authorization/catalog | Parent validity, cycles, action uniqueness | NOT EXECUTED | ResourceManifestServiceTest | Remove synthetic branded application keys |
| Manifest draft/diff/publish | AUTH/registry | REFACTOR | services/authorization/manifests | Immutable version checksums and coordinated activation | NOT EXECUTED | ResourceManifestWorkflowTest, ManifestReleaseIntegrationTest | Resource and artifact revisions remain separate |
| Artifact registry | AUTH/ui | REFACTOR | services/authorization/artifacts | Independent immutable artifact revisions | NOT EXECUTED | UiPluginRegistryServiceTest | Framework-neutral contract required |
| MFE contracts | packages/contracts/src/index.ts | REWRITE | packages/contracts | Source imports React ComponentType in shared contract | NOT EXECUTED | New compatibility tests required | Existing mount ABI is marked legacy |
| Dynamic loader | apps/shell/src/remote-loader.ts | REWRITE | packages/mfe-runtime | Loader owned by shell, module globals and vague errors | NOT EXECUTED | remote-loader.test.ts | Multiple factory-created instances |
| Navigation and context | apps/shell; BFF/api/MeController.java | REFACTOR | packages/core; services/bff | Separate public and authenticated projections | NOT EXECUTED | MeControllerTest | UI navigation is not authorization |
| Workspace | apps/shell/src/index.tsx | REWRITE | packages/workspace | Extract reusable model and instance lifecycle | NOT EXECUTED | New workspace tests required | SINGLE/TABS/SPLIT/DASHBOARD |
| HTTP client | packages/http-client | REFACTOR | packages/http-client | Cookie/CSRF transport without tokens | NOT EXECUTED | Package tests | Injectable fetch |
| UI authorization helpers | packages/authorization-sdk | REFACTOR | packages/authorization | Headless decisions with optional React adapter | NOT EXECUTED | Package tests | Server enforcement remains mandatory |
| Shared UI library | packages/sh-core-ui | DROP | none | Presentation belongs to consumers | NOT EXECUTED | Architecture tests required | No wholesale migration |
| Route resolution | AUTH/routing/RouteResolutionService.java | REFACTOR | services/authorization/routing | Longest prefix, priority, specificity, ambiguity rejection | NOT EXECUTED | RouteResolutionServiceTest | Explicit operation access modes |
| Approved upstream policy | BFF/proxy/GatewayTargetPolicy.java | REFACTOR | services/bff/proxy | Exact approved origin and normalized paths | NOT EXECUTED | GatewayTargetPolicyTest | Avoid arbitrary browser URLs |
| Forward token proxy | BFF/api/OperationalProxyController.java; BFF/outboundauth | REFACTOR | services/bff/proxy | Server-held user token | NOT EXECUTED | OperationalProxyForwardingTest | Real browser secrecy E2E required |
| Legacy token acquisition | BFF/outboundauth | REFACTOR | services/bff/outboundauth | Secret references, bounded response, expiry, refresh coordination | NOT EXECUTED | LegacyTokenResponseParserTest, LegacyServiceTokenProviderTest | Preserve redacted diagnostic records |
| Outbound connection registry | AUTH/outbound | REFACTOR | services/authorization/outbound | Validated modes and optimistic concurrency | NOT EXECUTED | Runtime integration tests required | Credentials remain server-side |
| SSRF and artifact policy | services/ui-artifact-security | REFACTOR | services/ui-artifact-security | Tested network policy boundary | NOT EXECUTED | UiArtifactNetworkMatrixTest | Preserve production checks |
| Superset | AUTH/superset; BFF/proxy/SupersetTargetPolicy.java | REFACTOR | optional integration | Useful but cannot be mandatory Core | NOT EXECUTED | SupersetSplitRoutingTest | Independent lifecycle |
| Audit and API logs | AUTH/observability; BFF/observability | REFACTOR | services/authorization/audit | Structured events and recursive redaction | NOT EXECUTED | SafeErrorBodySerializerTest | No raw token payloads |
| Administrative API security | AUTH/config/AdminAuthorizationInterceptor.java | REFACTOR | services/authorization/security | Server-side graph checks for privileged mutations | NOT EXECUTED | AdminAuthorizationInterceptorTest | Actor headers require trusted boundary |
| Operator interface | apps/mfe-admin | REFACTOR | apps/operator-console | Standalone API client, optional deployment | NOT EXECUTED | API-only acceptance required | Remove shell privilege assumptions |
| HR/Finance/Reports demos | apps/mfe-hr; apps/mfe-finance; apps/mfe-reports | DROP | none | Business/demo presentation excluded from Core | NOT EXECUTED | Domain leakage checks required | Generic fixtures will be authored independently |
| Database migration chain | services/authorization-service/src/main/resources/db | REWRITE | V1__hive_platform_baseline.sql | Existing baseline includes admin artifacts and Superset roles | NOT EXECUTED | CoreBaselineInstallationIntegrationTest | Do not copy history or existing seeds |
| Production topology | infra/docker-compose/compose.yml | REWRITE | infra/docker-compose | Existing Core mounts shell and carries development defaults | NOT EXECUTED | verify-core-compose-isolation.mjs | New zero-consumer acceptance |
| OpenAPI | BFF/docs; AUTH/docs | REFACTOR | service API specifications | Retain security documentation and coverage tests | NOT EXECUTED | OpenApiDocumentationCoverageTest | Reflect implemented endpoints only |
| Verification tooling | tools; tests/e2e | REFACTOR | tools; tests | Real bootstrap, routing and browser verification patterns | NOT EXECUTED | Existing scenario scripts | Never transplant credentials or demo fixtures |
| Historical documents | docs | DROP | docs/migration references only | Describe implementation afresh | NOT EXECUTED | Documentation verification | Old reports are not current evidence |

## Concrete source findings

- Shared contracts explicitly import React. A renamed package would violate the new boundary.
- Remote loads are cached at module scope; one global scope binds to one artifact. Instance lifecycle must be separated from artifact loading.
- Manifest staging rejects a different checksum at an existing version; publish coordinates artifact and resource activation under a lock. Preserve that invariant.
- Outbox network calls happen outside claim transactions; lost claim ownership is not swallowed as a retryable projection error.
- Source Core baseline tests expect an ADMIN panel, six artifacts, Superset roles and reports-related resources. It cannot serve as Hive's zero-consumer baseline.
- Source security configuration authenticates almost all requests and special-cases Superset CSRF. Hive needs independent route-operation access decisions and optional integration configuration.

## Archaeology acceptance

Repository identity, source commit, architectural coupling, source locations, migration classifications and executable source-test references have been recorded. This is a capability-level survey, not a claim that every source method has been audited. Each later phase must inspect and execute the relevant behavior before migration, as required by the specification.