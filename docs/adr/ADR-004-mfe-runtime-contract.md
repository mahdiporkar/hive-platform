# ADR-004: Framework-neutral micro-app contract and runtime

Status: accepted; implemented in Phase 7 (`@hive-platform/mfe-runtime`).

## Decision

- An artifact is one self-contained ES module whose default export is `{contractVersion, create()}`. `create()` returns an independent instance with `mount(element, context)`, `unmount()` and optional `update(context)`. Nothing in the contract names a UI framework; a React, Vue, Svelte or plain-DOM micro-app all implement the same three functions.
- The runtime loads an artifact once per (URL, integrity) and creates a new instance per mount, so the same module can be mounted many times concurrently. A failed load is not cached.
- **Order of checks**, each with its own diagnostic code so the root cause is never masked: manifest compatibility (`MANIFEST_INCOMPATIBLE`, before any network call) → fetch (`ARTIFACT_NETWORK_FAILURE`, `ARTIFACT_HTTP_ERROR`) → SRI over the fetched bytes (`ARTIFACT_INTEGRITY_UNSUPPORTED`, `ARTIFACT_INTEGRITY_MISMATCH`) → evaluation (`ARTIFACT_MODULE_FORMAT`) → export shape (`MICRO_APP_CONTRACT_INVALID`) → declared vs registered contract (`MICRO_APP_CONTRACT_MISMATCH`) → lifecycle (`MOUNT_FAILED`, `MOUNT_TIMEOUT`, `UPDATE_*`, `UNMOUNT_*`).
- **SRI covers what executes.** The runtime verifies the digest of the bytes it fetched and evaluates exactly those bytes (Blob URL import by default; an injectable importer supports other CSP setups). Artifacts must therefore be self-contained bundles or use absolute URLs for any further imports.
- **Containment.** Each instance gets its own container element, never the host element: `SCOPED` modules get a `div.hive-mfe-root[data-hive-module][data-hive-instance]`; `SHADOW_DOM` modules get that container inside an open shadow root. Unmount always removes the container, including after failed mounts.
- **Mount context** carries identifiers (`moduleKey`, `applicationKey`, `instanceId`, `slotId`), the route and its params, locale/direction, the public or authenticated context, an application-scoped permission view (UI hint), an event port, an `AbortSignal` aborted at unmount and a `navigate` callback.
- **Hosts are replaceable.** The runtime has no notion of shells; `examples/minimal-consumer` hosts modules with a plain-DOM page of about 100 lines.
- **Unknown paths for anonymous visitors.** Public contexts never disclose protected routes, so hosts treat an unmatched path as "sign in to continue" for anonymous visitors and "not found" for signed-in users.

## Deviations from the reference

The reference shared contract imported React's `ComponentType`, cached remote modules at module scope (one global per remote) and reported many distinct failures as "remote container was not registered". All three are replaced.

Evidence: `tests/packages/mfe-runtime.test.mjs` (lifecycle, multi-instance, shadow DOM, 11 failure classes, retry after failure, deprecation warnings), `tests/e2e/mfe-runtime.test.mjs` (Edge: public mount, login-required, authenticated mount, in-place update, integrity failure isolation, unmount, permission-driven UI, no browser-visible tokens).
