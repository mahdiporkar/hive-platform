# ADR-011: Optional Superset integration through an authorized API tunnel

Status: accepted; implemented in Phase 12.

## Context

The reference integration proxied the full Superset web UI and relied on a customized Superset build (a REMOTE_USER security manager trusting product-branded headers, namespaced cookie rewriting, location rewriting). That couples the platform to a private Superset fork and to Superset's cookie session model.

## Decision

- Superset is optional: no table row, configuration or container is required for Hive Core (verified by the bootstrap and zero-consumer tests).
- Registry: `superset_integration` (base URL, TLS requirement, service-account **secret reference**, owning application, enable flag, health) and `superset_asset` (dashboards and charts). Each integration and asset is an `EXTERNAL_RESOURCE` in the catalog (`superset-<key>` with action `access`; `superset-<key>.<type>.<id>` with action `view`), so asset grants are ordinary grants decided by OpenFGA.
- Runtime: the BFF exposes `/api/integrations/superset/{key}/...` to signed-in users. The control plane decides each request: integration enabled, `access` on the integration and `view` on the asset. The allowlist covers `GET /health`, `GET /api/v1/dashboard/{id}[/charts]`, `GET /api/v1/chart/{id}` and `POST /api/v1/chart/data` (asset taken from `dashboard_id`/`slice_id` in the body, reference inspector behavior); everything else is denied.
- The BFF authenticates to stock Superset's REST API with the service account (`/api/v1/security/login`), caches the token AES-GCM-encrypted in Redis per integration revision until shortly before its `exp`, drops it on upstream 401, and never forwards browser cookies or relays Superset cookies. The browser never sees a Superset credential or token.
- Network: base URLs pass the outbound policy (metadata/link-local/reserved never), the BFF's exact-origin allowlist, and `tlsRequired` (default true) forces HTTPS.
- Consumers render dashboards and charts from the tunneled JSON with their own UI stack (headless), rather than embedding Superset's SPA.

## Consequences and deferrals

- Embedding Superset's own UI (iframe/Embedded SDK) is not provided: it would require browser-visible guest tokens or a cookie-rewriting proxy. DEFERRED with this rationale.
- Mutual TLS to Superset is DEFERRED (the JVM trust store governs TLS; client certificates are not configured).
- Row-level security is whatever Superset enforces for the service account; per-user RLS would require guest tokens (deferred with embedding).
- Verified against a fixture that emulates the Superset REST endpoints; a real Superset instance was NOT EXECUTED in this repository's tests.

Evidence: `npm run test:superset`.
