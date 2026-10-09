# MFE runtime

`@hive-platform/mfe-runtime` loads micro-app artifacts and hosts their instances without depending on any UI framework. Contract and rationale: [ADR-004](adr/ADR-004-mfe-runtime-contract.md).

```mermaid
sequenceDiagram
  participant H as Host (any framework or none)
  participant R as MfeRuntime
  participant S as Static origin / CDN
  participant M as Micro-app module
  H->>R: mount(host, runtimeModule, input)
  R->>R: checkCompatibility(contract, schema, runtime, manifest versions)
  R->>S: fetch artifact.url (same-origin credentials)
  S-->>R: bytes
  R->>R: digest(bytes) == artifact.integrity ?
  R->>M: import(Blob URL of verified bytes)
  M-->>R: default export {contractVersion, create}
  R->>R: declared contract == registered contract ?
  R->>M: create() → instance; instance.mount(container, context)
  R-->>H: MountedInstance {update, unmount, container}
```

## Writing a micro-app (any stack)

```ts
import type {HiveMicroApp} from '@hive-platform/contracts';

const app: HiveMicroApp = {
  contractVersion: '1.1.0',
  create() {
    let root: HTMLElement | null = null;
    return {
      mount(element, context) { root = element; element.textContent = `Hello ${context.route}`; },
      update(context) { root!.textContent = `Hello ${context.route}`; },
      unmount() { root!.replaceChildren(); root = null; },
    };
  },
};
export default app;
```

Bundle it as one ES module (esbuild, Vite library mode, Rollup), publish the file, compute its SRI (`sha384-…`), and register a micro-frontend manifest that points at it. React users can use `@hive-platform/react`'s `createReactMicroApp` (Phase 11), which wraps `createRoot` behind this same contract.

## Hosting

```ts
import {MfeRuntime} from '@hive-platform/mfe-runtime';
const runtime = new MfeRuntime({onDiagnostic: d => console.warn(d)});
const instance = await runtime.mount(slotElement, module, {instanceId, slotId, route, params, locale, direction,
  context, permissions, events, basePath, navigate});
await instance.update({...input, route: '/records/42', params: {id: '42'}});
await instance.unmount();
```

`@hive-platform/workspace` builds multi-slot layouts on top of this API; any host can use the runtime directly.

## Artifact formats and loaders

`MfeRuntime` delegates to one loader per `artifact.format`: `HiveEsModuleLoader` (Blob URL of the verified bytes), `WebpackFederationLoader` (container script with SRI, `init`/`get`) and `ViteFederationLoader` (`import(url)`, `init`/`get`); `options.loaders` adds or replaces loaders. All formats provide the same `{contractVersion, create()}` micro-app. Upstream artifacts are served same-origin by the BFF artifact gateway; see [MFE registration](mfe-registration.md).

## Diagnostics

| Code | Meaning |
|---|---|
| `MANIFEST_INCOMPATIBLE` | versions outside the supported line (details.reason carries the compatibility code); nothing was fetched |
| `ARTIFACT_NETWORK_FAILURE` | the artifact URL could not be reached |
| `ARTIFACT_HTTP_ERROR` | non-2xx response (details.status) |
| `ARTIFACT_INTEGRITY_UNSUPPORTED` / `_MISMATCH` | no usable SRI value / bytes differ from the registered digest; code is never executed |
| `ARTIFACT_MODULE_FORMAT` | the bytes are not an evaluable module, or no loader exists for the format |
| `FEDERATION_*` | Module Federation: container script refused, no container, init failure, exposed module not found |
| `MICRO_APP_CONTRACT_INVALID` | missing default export `{contractVersion, create}` or invalid instance shape |
| `MICRO_APP_CONTRACT_MISMATCH` | artifact implements a different contract minor/major than its manifest declares |
| `MOUNT_FAILED`, `MOUNT_TIMEOUT`, `UPDATE_FAILED`, `UPDATE_TIMEOUT`, `UNMOUNT_FAILED`, `UNMOUNT_TIMEOUT` | lifecycle failures (default deadline 15 s) |

## Content Security Policy

The default importer needs `script-src 'self' blob:`. Deployments that forbid `blob:` can pass an `importModule` implementation (for example native `import()` combined with an import map that carries the integrity) — SRI must still cover the executed code.
