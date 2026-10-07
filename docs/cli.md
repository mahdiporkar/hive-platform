# CLI

`hive` (`cli/`, package `@hive-platform/cli`, plain Node ESM, Node 22+). In this repository: `node cli/bin/hive.mjs …` or `npx hive …` after `npm ci`.

| Command | What it does |
|---|---|
| `hive version [--json]` | CLI, platform and contracts versions and the compatibility line |
| `hive validate <file\|dir>…` | Offline validation of resource and micro-frontend manifests with the control plane's rules (contract separation, versions, keys, types and parents, cycles, actions, routes, artifact URL, SRI format); verifies a built `entry.js` next to a manifest against its SRI; cross-checks routes against the sibling resource manifest. Exit 1 on any error. |
| `hive doctor [options] [--json]` | Real diagnostics: BFF and authorization readiness, OpenFGA health, PostgreSQL wire protocol (SSLRequest), Redis `PING`, OIDC discovery, compatibility of active public modules, artifact reachability and SRI, graph projection status and route configuration (need `HIVE_PROVISIONING_PASSWORD`), manifest validity. Each check is `PASS`, `FAIL` or `NOT EXECUTED` with a reason; nothing unexecuted is ever reported as PASS. Exit 1 on any FAIL. Options: `--bff`, `--authorization`, `--openfga`, `--postgres host:port`, `--redis host:port`, `--issuer`, `--origin`, `--manifest` (or `HIVE_*` environment variables). |
| `hive up [--build] [--profile ui] [--env-file f] [--http-port n] [--bff-port n] [--authorization-port n] [--project p]` | Runs `infra/docker-compose/hive.yml`; on first use generates an ignored `.env` with random secrets (≥ 32 characters, never printed). Profile `ui` adds the default shell gateway (port 8080) and the operator console. |
| `hive down [--volumes] [--env-file f] [--project p]` | Stops (and optionally deletes the data of) that installation. |
| `hive create solution <dir> --application <key> [--name text]` | New solution: `hive.solution.json`, `package.json`, `build.mjs` (esbuild bundle + SRI), README. |
| `hive add mfe <key> [--route /path] [--public]` | Framework-neutral micro-app skeleton with resource and micro-frontend manifests. |
| `hive add service <key> --url <baseUrl> --prefix </path> [--auth FORWARD_TOKEN\|NONE]` | Service descriptor (target, route, operations). LEGACY routes are configured through the admin API because they need a profile with a secret reference. |
| `hive register [--solution dir] --authorization <url>` | Applies a built solution through `/admin/**` with the provisioning credential: application, modules, resource manifests (import + publish), artifacts (register + activate), targets, routes, operations. Idempotent. |
| `hive upgrade --check [--solution dir]` | Reports whether a solution's manifests are compatible with this CLI's platform line. It never rewrites a solution. |

Not provided: `hive add domain` (business domains belong to solutions; Hive has no domain model to scaffold) and an automatic `hive upgrade` (no published release channel exists yet; see deferred work).

## Executed evidence

- `npm run test:cli`: version; validation of all example manifests with SRI verification; tampered artifact, eight classes of manifest errors and an undeclared route action rejected; doctor with no configuration reports only NOT EXECUTED; doctor against unreachable endpoints reports FAIL; create solution → add mfe → add service → build → validate → upgrade --check → register (twice, idempotent; wrong credential rejected) → registered public route serves traffic → doctor with every check PASS against a live core, a fixture IdP and a gateway → doctor detects a tampered served artifact.
- `npm run test:cli:up`: `hive up --build --profile ui` with real images, generated secrets, doctor PASS for core checks, gateway security headers, console served, zero consumer applications, admin API closed, `/actuator/*` closed except readiness, non-root containers, `hive down --volumes` leaves no containers.
