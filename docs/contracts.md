# Contracts

`@hive-platform/contracts` (version 1.1.0) exports the versioned, framework-neutral data contracts shared by the platform, SDK packages, CLI and consumers, plus the executable compatibility validator ([compatibility](compatibility.md)). Server-produced shapes mirror the BFF and authorization service responses.

| Area | Contracts |
|---|---|
| Errors | `PlatformError` (every API error body: `code`, `message`, `correlationId`), `RuntimeDiagnostic` |
| Identity & context | `HiveIdentity` (token-free), `HiveSession`, `PublicHiveContext` (`authenticated:false`, public modules only), `HiveContext` (identity, session, permissions keyed `applicationKey:resourceKey`, platform roles), `FeatureFlag`, `RuntimeModule`, `RuntimeRoute` |
| Catalog & authorization | `Resource`, `ResourceAction`, `ResourceType`, `AuthorizationDecision` (with deny reasons), `PermissionGrant` |
| Manifests | `ResourceManifest` (authorization only), `MicroFrontendManifest` (artifact and routes only), `ManifestRevision` |
| Lifecycle | `HiveMicroApp` (`{contractVersion, create()}`), `HiveMicroAppInstance` (`mount`, `update?`, `unmount`), `HiveMountContext`, `EventPort`, `HiveEventEnvelope` |
| Workspace | `Workspace`, `WorkspaceSlot`, `WorkspaceLayout` (SINGLE, TABS, SPLIT, DASHBOARD), `WorkspaceState` (routes only), `WorkspaceEvent` |
| Routing | `ServiceTarget`, `ProxyRoute`, `RouteOperation`, `LegacyAuthenticationConfiguration` (secret reference only) |
| Extensions | `ExtensionRegistration`, `ExtensionPoint` |

Rules enforced by tests: contracts import no UI framework (`tests/architecture`); public context types cannot carry identity or permissions (`authenticated:false` discriminant); credentials appear nowhere in contracts — only secret references.
