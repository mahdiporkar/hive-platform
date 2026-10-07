# Operator Console

`apps/operator-console` is Hive's official control-plane UI (React + Ant Design, served under `/console/`). It is a plain administrative API client: every screen calls `/api/admin/**` through `@hive-platform/http-client` with the operator's session cookie and CSRF token, and the control plane enforces platform roles on every call. Hive is fully operable without it (see the API-only acceptance test below), and a solution may replace it with its own tool.

| Area | Screens |
|---|---|
| Runtime | Diagnostics (graph readiness, outbox, cache, runtime catalog revision and active modules) |
| Catalog | Applications, resource tree per application, manual resources |
| Modules | Registration (definition modes, manifest URLs); resource manifests (import/fetch, diff, publish, activate/rollback); artifacts (register, activate); release history |
| Security | Users (create with identity binding, (de)activate), groups, business roles (assign, archive), grants (create, revoke), platform roles, identity providers (create, enable/disable) |
| Integration | Service targets, legacy authentication profiles, proxy routes and operations, routing preview |
| Configuration | Feature flags |
| Audit | Audit log (filter by event type), API logs (filter by route) |

Menu visibility follows platform roles (UI hint only). Users without any platform role see "No platform role"; business roles never grant console access, and `/api/admin/**` answers 403 for them regardless of the UI.

Build: `npm run build:console` (Vite, output `apps/operator-console/dist`). Deployments serve it as static files under `/console/` on the same origin as the BFF.

## Executed evidence

- `npm run test:e2e:console` (Edge): the bootstrapped super administrator signs in; creates an application; registers a module; imports a resource manifest, reviews the diff, publishes; registers and activates an artifact; sees an incompatible manifest rejected with `VERSION_MAJOR_UNSUPPORTED: contractVersion: supported major 1, received 2`; inspects the resource tree; creates a user with an identity binding, a role, a role assignment, a grant and a platform role; creates a service target, a forward-token route and a protected operation and previews resolution; creates and toggles a feature flag; checks diagnostics; reads audit and API logs. The test then verifies through the API that every action was audited with the operator as actor and that the console-made role assignment and grant are effective for authorization. A user without a platform role sees "No platform role" and gets 403 from the admin API.
- `npm run test:e2e:api-admin`: the same administration performed by a scripted session against `/api/admin/**` without any UI, followed by runtime verification (context, navigation, permissions, forwarded token, server-side denial, audit and API logs).
