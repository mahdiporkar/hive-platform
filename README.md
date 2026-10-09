# Hive

Hive is a headless, UI-agnostic Enterprise Application Platform for composing secure public, private, and hybrid applications from independently deployable business modules.

> Platform owns capabilities. Solution owns business. Consumer owns presentation.

Hive provides identity and sessions, authorization (PostgreSQL + OpenFGA), a resource catalog, manifest governance, dynamic routing to backends, a framework-neutral micro-frontend runtime, a multi-slot workspace engine, audit and API logs, feature flags, extension points, an optional Superset integration, a CLI and an optional operator console. It knows applications, modules, routes, resources, actions, manifests, workspaces, identities and integrations — never your business domain, component library or CSS framework.

Consumers may use **React, Next.js, Vue, Angular, Svelte, Tailwind, Material UI, Ant Design, custom design systems, Web Components or plain JavaScript**. Hive Core and its headless SDK depend on none of them (enforced by architecture tests); React support is an optional adapter package.

**Status: `0.1.0-dev.0`, release candidate for the first milestone — see [phase evidence](docs/migration/phase-status.md). Not 1.0.**

## Quick start

Requires Docker, Node 22+ and Java 21.

```sh
npm ci && npm run build && ./mvnw -B package -DskipTests
npm run build:shell && npm run build:console
npx hive up --build --profile ui          # Hive Core + default shell (http://127.0.0.1:8080) + console (/console/)
npx hive doctor --bff http://127.0.0.1:18081 --authorization http://127.0.0.1:18082 --origin http://127.0.0.1:8080
npx hive down --volumes
```

A fresh installation contains zero applications, modules, users, roles, grants, routes and audit rows. Enable an OIDC provider (Keycloak or any) with `HIVE_IDENTITY_ENABLED`, `HIVE_OIDC_*` and the first administrator with `HIVE_BOOTSTRAP_ADMIN_SUBJECT` ([deployment](docs/deployment.md)). Build a solution with `hive create solution`, `hive add mfe`, `hive add service`, `hive register` ([consumer guide](docs/consumer-guide.md), [CLI](docs/cli.md)).

## Repository

```text
services/      bff, authorization (Hive Core), ui-artifact-security (network policy library)
starters/      hive-spring-boot-starter (correlation id, PlatformError, redaction, production guard)
packages/      contracts, core, http-client, auth, authorization, mfe-runtime, workspace, react
apps/          default-shell (optional React reference shell), operator-console (optional React + Ant Design)
cli/           hive
examples/      minimal-consumer (plain TypeScript), react-tailwind-consumer (React + Tailwind + SSR public site)
infra/         docker-compose (core deps, full stack), openfga model, nginx templates
tests/         architecture, contracts, packages, integration, e2e, cli, security
tools/         build, dev gateway, verification runner, repository guard
docs/          architecture, guides, ADRs, migration evidence
```

## Verify

```sh
npm run verify:all     # every suite below in order; writes .local/verification.json
```

Individual suites: `npm test` (architecture, contracts, packages), `./mvnw -B verify`, `npm run test:bootstrap | test:identity | test:keycloak | test:authorization | test:manifests | test:routing | test:superset | test:hardening`, `npm run test:e2e:mfe | test:e2e:workspace | test:e2e:console | test:e2e:api-admin | test:e2e:public-hybrid | test:e2e:golden`, `npm run test:cli | test:cli:up`, `npm run verify:compose`, `npm run test:log-scan`. Integration and E2E suites start isolated containers and services and clean up after themselves; browser suites use Playwright with Edge on Windows and Chromium elsewhere.

## Documentation

[Architecture](docs/architecture.md) · [Principles](docs/platform-principles.md) · [Control vs runtime plane](docs/control-plane-runtime-plane.md) · [Headless UI](docs/headless-ui-architecture.md) · [Contracts](docs/contracts.md) · [Compatibility](docs/compatibility.md) · [Versioning](docs/versioning.md) · [Identity](docs/identity.md) · [Authorization](docs/authorization.md) · [Resource catalog](docs/resource-catalog.md) · [Manifest governance](docs/manifest-governance.md) · [Dynamic routing](docs/dynamic-routing.md) · [MFE registration & resource management](docs/mfe-registration.md) · [Legacy authentication](docs/legacy-authentication.md) · [MFE runtime](docs/mfe-runtime.md) · [Workspace runtime](docs/workspace-runtime.md) · [Event bus](docs/event-bus.md) · [Public / hybrid / authenticated](docs/public-hybrid-authenticated.md) · [Extension points](docs/extension-points.md) · [Operator console](docs/operator-console.md) · [Consumer guide](docs/consumer-guide.md) · [React + Tailwind guide](docs/react-tailwind-guide.md) · [CLI](docs/cli.md) · [Deployment](docs/deployment.md) · [Security](docs/security.md) · [Observability](docs/observability.md) · [ADRs](docs/adr) · [Source capability map](docs/source-capability-map.md)
