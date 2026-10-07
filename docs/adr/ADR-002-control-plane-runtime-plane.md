# ADR-002: Control plane and runtime plane

Status: accepted; implemented across Phases 4–12. Details: [control plane vs runtime plane](../control-plane-runtime-plane.md).

## Decision

- **Control plane** (authorization service, `/admin/**`): applications, resource catalog, modules and manifests, identities and providers, roles, groups, grants, platform roles, service targets, routes, operations, legacy profiles, integrations, feature flags, audit and API log queries. PostgreSQL is the source of truth; the service is the only writer of the OpenFGA graph.
- **Runtime plane** (BFF + `/internal/**` runtime APIs of the authorization service): sessions, contexts, authorization decisions, route resolution and execution, integration tunnels, MFE and workspace runtimes in the browser.
- Runtime code never reads administrative tables directly. It consumes versioned runtime representations: `/internal/runtime/catalog` (with a monotonic revision), `/internal/runtime/public-context`, `/internal/runtime/context`, `/internal/routing/resolve`, `/internal/authorization/check`, `/internal/integrations/superset/resolve`, `/internal/runtime/features`.
- Channels: browsers reach only the BFF; the BFF reaches the authorization service with a machine credential (`bff`, role RUNTIME); automation may use the optional `provisioner` credential for `/admin/**` and `/provisioning/**`. Consumers never touch databases or the graph.

Evidence: bootstrap (both services run without consumers; graph readiness), authorization/manifests/routing suites (control-plane APIs), E2E suites (runtime through the BFF only), API-only administration and console suites.
