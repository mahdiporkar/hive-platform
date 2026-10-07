# Hive

Hive is a headless, UI-agnostic Enterprise Application Platform for composing secure public, private, and hybrid applications from independently deployable business modules.

**Work in progress, not a completed platform or release candidate.** Bootstrap and contracts are implemented. The identity phase has a working primary OIDC flow but remains open. Authorization administration, manifest governance, dynamic routing, MFE/workspace runtime, operator console, CLI and release hardening are not implemented.

Platform owns capabilities. Solution owns business. Consumer owns presentation. Consumers may use React, Next.js, Vue, Angular, Svelte, Web Components or plain JavaScript with their own design systems. The contracts package does not depend on any of them.

## Verify the implemented scope

Requires Node 22+, npm, Java 21, Maven 3.9+ and Docker with Linux containers.

```sh
npm ci
npm run typecheck
npm test
./mvnw -B verify
npm run test:bootstrap
npm run test:identity
npm run test:keycloak
```

Integration tests create isolated test containers, volumes and local Java processes, then clean them up. Bootstrap uses ports 25432, 28080, 28081 and 28082. Identity uses ports 26379, 28180 and 28181. Logs remain in ignored `.local/`. The identity fixture uses signed JWTs and a manual HTTP cookie jar; it is not browser E2E.

## Current code

```text
services/
  bff/                  primary OIDC, token-free session, encrypted vault, refresh
  authorization/        empty database baseline, health, denied feature APIs
packages/
  contracts/            framework-neutral types and compatibility validation
infra/
  docker-compose/       isolated local PostgreSQL/OpenFGA dependencies
  openfga/              reviewed relationship model (no seeded tuples)
tests/
  architecture/         repository and dependency boundaries
  contracts/            compatibility and public package imports
  integration/          real bootstrap and OIDC HTTP scenarios
tools/                  package build, repository guard, model generation
docs/
  adr/                  recorded design decisions
  migration/            original requirements, source map, phase evidence
```

See [phase evidence](docs/migration/phase-status.md), [identity behavior](docs/identity.md), [contracts](docs/contracts.md), [compatibility](docs/compatibility.md) and [source capability map](docs/migration/source-capability-map.md). The local Compose topology is not production deployment configuration.