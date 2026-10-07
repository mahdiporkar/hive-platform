# Changelog

## 0.1.0-dev.0 — unreleased

- Independent repository and clean bootstrap with verified PostgreSQL/Flyway and durable OpenFGA model storage.
- Versioned framework-neutral contracts and executable compatibility/dependency checks.
- Primary OIDC code/PKCE flow, encrypted server vault, token-free Redis session, bounded refresh and CSRF-protected logout.
- Authorization control plane: resource catalog, users/groups/roles/grants, platform roles, OpenFGA outbox projection, decision API and cache.
- Manifest governance: module registry, resource and micro-frontend manifests, draft/diff/publish/rollback, immutable revisions, runtime catalog, shared compatibility matrix.
- Dynamic routing: service targets, proxy routes, route operations, FORWARD_TOKEN and LEGACY authentication, API logs.
- No production release or completion of the full platform specification is claimed.