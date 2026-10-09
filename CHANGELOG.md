# Changelog

## 0.1.0-dev.0 — unreleased

- Independent repository and clean bootstrap with verified PostgreSQL/Flyway and durable OpenFGA model storage.
- Versioned framework-neutral contracts and executable compatibility/dependency checks.
- Primary OIDC code/PKCE flow, encrypted server vault, token-free Redis session, bounded refresh and CSRF-protected logout.
- Authorization control plane: resource catalog, users/groups/roles/grants, platform roles, OpenFGA outbox projection, decision API and cache.
- Manifest governance: module registry, resource and micro-frontend manifests, draft/diff/publish/rollback, immutable revisions, runtime catalog, shared compatibility matrix.
- Dynamic routing: service targets, proxy routes, route operations, FORWARD_TOKEN and LEGACY authentication, API logs.
- Headless SDK packages (core, http-client, auth, authorization, mfe-runtime), runtime contexts, feature flags and the framework-neutral example.
- Workspace runtime: headless engine, layouts, event hub, persistence and plain-DOM renderer.
- Operator Console (React + Ant Design) as a pure admin API client; API-only administration acceptance test.
- React adapter, default shell, React + Tailwind proof consumer with SSR public site; public, hybrid and authenticated routes end to end.
- hive CLI (validate, doctor, up/down, scaffolding, register), container images and full-stack compose, all extension points.
- Optional Superset integration through an authorized API tunnel with asset grants.
- Production hardening: fail-closed production profile, forwarded headers, log secrecy scan, branding scan, verification runner.
- End-to-end acceptance: golden-path scenario against real Keycloak; documentation set with executable link/script checks; forwarded-header pass-through fix in both gateways.
- Fix: RuntimeProxy forwards standard `multipart/form-data` (and PUT/PATCH/DELETE forms) intact — the BFF no longer parses request bodies before proxying (ADR-012); multipart regression and browser E2E suites.
- Micro-frontend registration by IP/port or URL from the Operator Console (probe, format detection, integrity computed by Hive, wizard), same-origin BFF artifact gateway (`/api/mfe/**`), webpack and Vite Module Federation loaders, visual resource management with grants and effective-permission inspection, diff impact on grants and routes, context refresh in the default shell (ADR-013, Flyway V8).
- No production release or completion of the full platform specification is claimed.