# Demo deployment of Hive (GitHub Actions → GHCR → CapRover)

Every push to `develop` is verified (`verify.yml`). The Hive components that differ from the version verified on the
demo are then built into images, deployed to the demo CapRover server, checked, and rolled back automatically if
the checks fail. Pushes to `platform-v1` and `main` are verified only and never deploy. The pipeline is independent
of the solutions that run on Hive: deploying Hive never rebuilds or redeploys a solution, and a solution's pipeline
never rebuilds Hive.

## Workflows

| Workflow | Trigger | Does |
|---|---|---|
| `verify.yml` | pull requests; pushes to any branch except `develop`; called by the deploy workflows | migration guard, then the full verification (contracts, services, integration, end-to-end, compose, architecture) |
| `deploy-demo.yml` | push to `develop` | Verify → components to deploy → `images.yml` → `deploy-caprover.yml` |
| `deploy-manual.yml` | Actions → *Deploy demo (manual)* | deploys any commit, branch or tag: `affected`, `all`, `authorization`, `bff` or `console` |
| `images.yml` | called | builds and pushes the missing images of one commit; existing images are reused |
| `deploy-caprover.yml` | called | `deploy/deploy.mjs`: deploy, smoke checks (`deploy/smoke.mjs`), rollback, summary, notification |

Demo pipelines share one queue (`deploy-demo-hive-platform`), so deployments never overlap. Components to deploy
(`deploy/components.json`, `deploy/affected.mjs`) are computed against the version verified on the demo, so a
superseded run never leaves a change undeployed.

| Component | Image (tag = commit SHA; `demo-good` = last verified) | Rebuilt when these change | CapRover app | Port |
|---|---|---|---|---|
| authorization | `ghcr.io/<owner>/hive-platform/hive-authorization` | `services/authorization/`, `services/ui-artifact-security/`, `starters/`, `pom.xml`, Maven wrapper | `hive-authorization` | 8082 |
| bff | `ghcr.io/<owner>/hive-platform/hive-bff` | `services/bff/`, `services/ui-artifact-security/`, `starters/`, `pom.xml`, Maven wrapper | `hive-bff` | 8081 |
| console | `ghcr.io/<owner>/hive-platform/hive-operator-console` | `apps/operator-console/`, `packages/`, `package*.json`, `infra/nginx/console.conf.template` | `hive-operator-console` | 8080 |

Deployment order is authorization, then BFF, then console. The checks run through the demo's public gateway:

- the BFF is ready;
- the anonymous context answers (gateway → BFF → authorization);
- the console answers at `/console/` with the deployed commit in `/console/version.json`.

The services do not publish their commit, so the checks start after a settle period and must pass twice in a row.
Authorization runs its Flyway migrations at start. CI's migration guard (`deploy/check-migrations.mjs`) keeps them
append-only and backward compatible, so a rollback can start the previous image against the migrated database.

## One-time setup

**CapRover.** Hive's infrastructure apps run as persistent CapRover apps that the pipeline never touches:
`hive-db` (PostgreSQL), `hive-graph-db` (PostgreSQL), `hive-openfga` (OpenFGA, migrated once) and `hive-redis`.
The demo solution's document lists their settings, together with the solution's own apps. Create
`hive-authorization`, `hive-bff` and `hive-operator-console` as internal apps (not public) with the ports above.
Enable an *App Token* on each, and add `ghcr.io` with a `read:packages` token under *Docker Registry Configuration*.

| App | Environment (CapRover → App Configs) |
|---|---|
| `hive-authorization` | `HIVE_PROFILE=production`, `HIVE_DB_URL=jdbc:postgresql://srv-captain--hive-db:5432/hive`, `HIVE_DB_USER=hive`, `HIVE_DB_PASSWORD` (≥ 16), `HIVE_OPENFGA_URL=http://srv-captain--hive-openfga:8080`, `HIVE_INTERNAL_PASSWORD` (≥ 32), `HIVE_PROVISIONING_PASSWORD` (≥ 32; the solution's web app uses it to register itself), `HIVE_REDIS_HOST=srv-captain--hive-redis`, `HIVE_REDIS_PASSWORD`, `HIVE_AUTHZ_CACHE_ENABLED=true`, `HIVE_PRIMARY_ISSUER` (OIDC issuer), `HIVE_BOOTSTRAP_ADMIN_SUBJECT` (first administrator), `HIVE_TARGET_ALLOW_HTTP=true` (solution services on the internal network), `HIVE_ENVIRONMENT=demo` |
| `hive-bff` | `HIVE_PROFILE=production`, `HIVE_AUTHORIZATION_URL=http://srv-captain--hive-authorization:8082`, `HIVE_CONTROL_ALLOW_HTTP=true`, `HIVE_INTERNAL_PASSWORD`, `HIVE_REDIS_HOST=srv-captain--hive-redis`, `HIVE_REDIS_PASSWORD`, `HIVE_VAULT_KEY` (Base64, 256 bit), `HIVE_IDENTITY_ENABLED=true`, `HIVE_OIDC_ISSUER`, `HIVE_OIDC_CLIENT_ID`, `HIVE_OIDC_CLIENT_SECRET`, `HIVE_PROXY_ALLOWED_ORIGINS` (each solution service's internal origin, e.g. `http://srv-captain--erp-backend:8090`), `HIVE_PROXY_ALLOW_HTTP=true` |
| `hive-operator-console` | — |

Secrets stay in CapRover's app configuration only; they never go into GitHub or the images.

**GitHub** (repository → Settings):

| Where | Name | Value |
|---|---|---|
| Variables (repository) | `DEMO_DEPLOY_ENABLED` | `true` turns deployment on. Without it, `develop` is verified and images are built, and the run says deployment was skipped |
| Environment `demo` → variables | `DEMO_URL` | the public URL of the demo gateway |
| | `CAPROVER_URL` | `https://captain.<root domain>` |
| | `CAPROVER_APP_AUTHORIZATION`, `CAPROVER_APP_BFF`, `CAPROVER_APP_CONSOLE` | only for non-default app names |
| Environment `demo` → secrets | `CAPROVER_TOKEN_AUTHORIZATION`, `CAPROVER_TOKEN_BFF`, `CAPROVER_TOKEN_CONSOLE` | the app tokens |
| | `DEPLOY_NOTIFY_WEBHOOK` | optional chat webhook (`{"text": …}`) |

Images are pushed with the workflow's own `GITHUB_TOKEN`; there is no registry secret to store.

## Recovering a previous version

A deployment that fails its checks rolls back to the `demo-good` images, and the run fails visibly. To go back on
demand, run *Deploy demo (manual)* with the earlier commit; its images are reused. Every pushed image stays in GHCR
under its commit SHA.

## Verification status

The deployment logic was rehearsed locally against the same images in a CapRover-like Docker topology
(`university-erp/deploy/rehearsal`):

- a BFF and console update was deployed and verified;
- a BFF that its production startup guard refused was rolled back automatically, while the solution kept working.

The workflows pass `actionlint` and `shellcheck`. **Deployment to a real CapRover server has not been verified
yet**, because no authorized target existed. It is verified once `DEMO_DEPLOY_ENABLED` is set and a push to `develop`
has deployed and passed its checks.
