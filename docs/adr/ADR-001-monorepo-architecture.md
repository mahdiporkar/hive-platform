# ADR-001: Independent monorepo

Status: accepted.

## Decision

A fresh repository (no imported history) containing Java 21 / Spring Boot 3.5 services, framework-neutral TypeScript packages, optional apps, examples, a CLI and verification tooling. The authorization service owns all PostgreSQL migrations. Consumers are optional and never become service dependencies. No source migration history or demo seeds are imported; the Flyway chain starts at `V1__hive_platform_baseline.sql`.

| Path | Contents |
|---|---|
| `services/bff`, `services/authorization` | Hive Core services |
| `services/ui-artifact-security` | network/URL policy library used by both services |
| `starters/hive-spring-boot-starter` | shared Spring behavior (correlation id, PlatformError, redaction, production guard) |
| `packages/*` | `@hive-platform/contracts, core, http-client, auth, authorization, mfe-runtime, workspace` (headless) and `react` (optional adapter) |
| `apps/operator-console`, `apps/default-shell` | optional UIs |
| `cli` | `hive` |
| `examples/*` | proof consumers (plain TypeScript; React + Tailwind with SSR) |
| `infra` | compose files, OpenFGA model, nginx templates |
| `tests/{architecture,contracts,packages,integration,e2e,cli,security}` | executable verification |
| `tools` | build, gateway, verification runner, repository guard |

## Deviations from the requested layout (justified)

- `services/ui-artifact-security` is a library module, not a running service: the policy is needed in-process by the authorization service (registration-time checks) and the BFF (fetch/forward-time checks); a network hop would add a trust boundary without benefit.
- Only `hive-spring-boot-starter` exists. `hive-security-starter` and `hive-audit-starter` were not created because no reusable code exists for them: authorization and audit are owned by the authorization service and consumed over its API (spec §49 forbids empty ceremonial starters).
- `infra/postgres` and `infra/redis` directories are not needed: both run from official images configured in the compose files.
- `tests/` adds `packages`, `cli` and `security` groups next to the requested ones.

Verification: `tools/verify-repository.mjs` (target repository guard), architecture tests, and `npm run verify:all`.
