# Micro-frontend registration and resource management

Register a micro-frontend (MFE) from its network address — `http://10.0.0.15:3004/remoteEntry.js` — entirely from the
Operator Console: no Nginx rule, no shell or BFF rebuild, no restart, no per-module environment variable and no
hand-computed integrity hash. Then manage its resource tree visually and grant access from it. Decisions:
[ADR-013](adr/ADR-013-artifact-gateway.md).

| Concept | What it is | Stored in | Console |
|---|---|---|---|
| **Micro-frontend (module)** | UI code + navigation routes, loaded in the browser | `micro_app`, `artifact_revision` | *Micro apps & manifests* |
| **Resource tree** | Authorization vocabulary (pages, actions) | `resource`, `resource_action`, `resource_manifest_revision` | *Resource management* |
| **Service target / proxy route** | Backend API reached server-side by the BFF | `service_target`, `proxy_route`, `route_operation` | *Service targets*, *Proxy routes* ([dynamic routing](dynamic-routing.md)) |

An MFE needs no service target. Its backend, if any, is configured separately and may name the owning module (`moduleKey`).

## Register a micro-frontend (console)

*Micro apps & manifests → Register micro-frontend* opens a five-step wizard (`apps/operator-console/src/pages/Registration.tsx`):

1. **General** — application, module key, display name, description, icon, status (active after registration or draft), environment.
2. **Network** — host or IP, port, HTTP/HTTPS, base path and entry file, or a full URL. Buttons:
   *Validate address* (syntax + network policy, no connection), *Test connection* and *Check runtime compatibility*
   (reachability, HTTP status, content type, format detection, SRI computation), *Fetch manifest* (also discovers
   `mf-manifest.json` and `resource-manifest.json` next to the entry). Each check reports its own code, e.g.
   `CONNECTION_REFUSED` (server offline or wrong port), `HOST_UNREACHABLE`, `ENTRY_NOT_FOUND`, `FORMAT_UNRECOGNIZED`,
   `ADDRESS_BLOCKED` (network policy), `ADDRESS_INVALID`.
3. **Runtime** — format (auto-detected): Hive ES module, webpack Module Federation (container global `remoteName`) or
   Vite Module Federation; exposed module (e.g. `./plugin`); style isolation. The computed integrity is shown.
4. **Manifests** — definition mode (MANIFEST, HYBRID, MANUAL); routes fetched from the MFE, defined in the wizard or
   pasted; resources fetched, pasted, kept (existing published revision) or none. A tree previews the resource
   manifest; routes that reference undeclared resources can be created as manual resources (resource discovery).
5. **Validate & activate** — *Validate* checks manifest validity, identity, route conflicts with active modules,
   resource references, artifact availability and unchanged integrity, and the runtime format. *Save draft* registers
   without publishing or activating; *Publish & activate* registers, imports and publishes resources, registers the
   artifact revision and activates it. Every step is logged with its result.

Afterwards the module page offers *Change address / new version* (same wizard, new immutable artifact version),
*Deactivate*, *Activate* / *Roll back* per artifact version, resource-manifest *Diff* (tree preview, grant impact,
broken routes), *Publish*, *Discard*, *Activate (rollback)*, a scoped **Resource tree** and a **Routes** tab.

## API

All under `/api/admin` in the browser (BFF admin relay) and `/admin` on the control plane.

| Method | Path | Purpose |
|---|---|---|
| POST | `/admin/modules/probe` | `{url}` or `{protocol, host, port, basePath, entryPath}`, optional `fetchManifests`, `validateOnly`, `mfManifestPath`, `resourceManifestPath` → checks, `detectedFormat`, `remoteName`, `exposedModules`, `integrity`, discovered manifests. No state change. |
| POST/PUT | `/admin/modules[/{module}]` | adds `description`, `icon`, `environment`, `entryUrl` (policy-validated; audited, also on change) |
| POST | `/admin/modules/{module}/artifacts?pinIntegrity=true` | registers a manifest whose absolute artifact has no `integrity` with the SRI of the bytes served now |
| POST | `/admin/modules/{module}/artifacts/fetch` | body `{url?, pinIntegrity?}` |
| GET | `/admin/modules/{module}/routes?version=` | routes of the active (or given) artifact with resource status `OK`, `NO_RESOURCE`, `RESOURCE_MISSING`, `ACTION_UNDECLARED` |
| GET | `/admin/applications/{app}/resource-tree?includeArchived=` | catalog nodes with owner module, definition mode, manifest revision, grant count, editability, allowed child types, routes; unreferenced pages |
| GET | `/admin/applications/{app}/resources/{key}/access` | direct grants, inherited `manage` from ancestors, ancestry |
| POST | `/admin/access/inspect` | `{userId, applicationKey, resourceKey}` → engine decisions per action, groups, roles and the grants that explain each decision |
| GET | `/admin/grants?resourceKey=` | grant filter by resource |
| GET | `/admin/modules/{module}/resource-manifests/{v}/diff` | adds `impact` (active grants on resources/actions the version removes) and `warnings` (active routes it breaks); manual nodes under removed nodes are `CONFLICT` |

Activation of an absolute artifact URL now fetches the artifact and verifies it against its registered integrity
(`ARTIFACT_INTEGRITY_MISMATCH` 409, unreachable host 502 with the precise cause). `HIVE_ARTIFACT_VERIFY_ON_ACTIVATION=false`
disables this check.

Manifest artifact descriptor (`schemaVersion` 1.0.x, additive):

```json
"artifact": {"url": "http://10.0.0.15:3004/remoteEntry.js", "integrity": "sha384-…", "format": "WEBPACK_FEDERATION",
             "remoteName": "reports_remote", "exposedModule": "./plugin"}
```

`format`: `ES_MODULE` (no container fields), `WEBPACK_FEDERATION` (`remoteName` and `exposedModule` required),
`VITE_FEDERATION` (`exposedModule` required). Whatever the packaging, the loaded code provides the same micro-app
contract: `{contractVersion, create()}` as the default export of the module (or of the exposed module).

## Runtime loading

`RuntimeCatalog` rewrites upstream artifact URLs for browsers to `/api/mfe/{module}/{version}/{entry}`; the registered
address never appears in a runtime context. `MfeRuntime` (`packages/mfe-runtime`) delegates to one loader per format:

| Loader | How | Integrity |
|---|---|---|
| `HiveEsModuleLoader` | fetch, verify, evaluate the verified bytes from a Blob URL | exact bytes |
| `WebpackFederationLoader` | fetch + verify (precise diagnostics), then attach the container `<script src integrity crossorigin>`; `init(shareScope)`, `get(exposedModule)` | browser SRI on the executed script |
| `ViteFederationLoader` | fetch + verify, then native `import(url)`; `init`, `get` | gateway serves the entry only if it matches the registered integrity |

Chunks and stylesheets are resolved by the bundle itself, relative to its entry URL (webpack `publicPath: 'auto'`,
`import.meta.url`), so they also load from `/api/mfe/{module}/{version}/…`. Custom loaders can be registered per format
(`new MfeRuntime({loaders})`). New diagnostics: `FEDERATION_CONTAINER_INVALID`, `FEDERATION_INIT_FAILED`,
`FEDERATION_MODULE_NOT_FOUND`, `FEDERATION_SCRIPT_FAILED`.

The default shell re-reads the context on focus and every 60 s (`window.hiveShell.refresh()`), so activation,
rollback, deactivation and grant changes reach open sessions without a new login.

## Artifact gateway (BFF)

`GET /api/mfe/{module}/{version}/{asset}` (`services/bff/.../mfe/ArtifactGateway.java`).

- **Resolution.** The BFF asks the control plane (`/internal/runtime/artifacts/{module}?userId=`) for the active
  artifact of the module; the answer is given only if the module is in the caller's runtime context (public context
  for anonymous callers). Unknown, deactivated and invisible modules all answer `404 MFE_MODULE_UNAVAILABLE`; another
  version than the active one answers `404 MFE_VERSION_NOT_ACTIVE`.
- **Path confinement.** Assets must resolve below the directory of the registered entry on the same origin; dot
  segments, encoded separators and unusual characters are refused (`400 MFE_ASSET_PATH_INVALID`).
- **Upstream policy.** Every fetch re-resolves DNS and applies `HIVE_MFE_NETWORK_POLICY` (metadata, link-local,
  multicast and reserved ranges are never reachable). Redirects are refused; nothing from the browser (cookies,
  `Authorization`, headers) is forwarded; size (`HIVE_MFE_MAX_ASSET_BYTES`, 20 MiB) and time limits apply.
- **Content.** `.js`/`.mjs` must be served as JavaScript, `.css` as `text/css`, `.json`/`.map` as JSON; HTML and
  mislabelled script are refused (`502 MFE_CONTENT_TYPE`). Responses carry `nosniff`, `Cross-Origin-Resource-Policy:
  same-origin` and a sandboxing CSP for direct navigation.
- **Integrity.** The entry is served only if it matches its registered SRI (`502 ARTIFACT_INTEGRITY_MISMATCH`).
- **Cache.** Resolutions per caller and module for `HIVE_MFE_RESOLVE_TTL_MS` (5 s); assets in a byte-bounded LRU
  (`HIVE_MFE_CACHE_BUDGET_BYTES`, 64 MiB) per catalog revision and upstream URL for `HIVE_MFE_CACHE_TTL_SECONDS` (60 s).
  Activation, rollback and deactivation bump the catalog revision. Browsers revalidate (`private, no-cache` + `ETag`).
- **Errors** are PlatformErrors: `MFE_UPSTREAM_UNREACHABLE`, `MFE_UPSTREAM_TIMEOUT`, `MFE_ASSET_NOT_FOUND`,
  `MFE_UPSTREAM_HTTP_ERROR`, `MFE_REDIRECT_REFUSED`, `MFE_ASSET_TOO_LARGE`, `MFE_TARGET_BLOCKED`.

The shell keeps its CSP (`script-src 'self' blob:`, `connect-src 'self'`, `style-src 'self' 'unsafe-inline'`): every
MFE file is same-origin.

## Configuration (once per deployment, never per module)

| Service | Variable | For an internal MFE such as `http://10.0.0.15:3004` |
|---|---|---|
| authorization | `HIVE_ARTIFACT_NETWORK_POLICY` | `INTERNAL_ENTERPRISE` (default `PRODUCTION_INTERNET` blocks private addresses) |
| authorization | `HIVE_ARTIFACT_ALLOWED_PRIVATE_CIDRS` | e.g. `10.0.0.0/24` |
| authorization | `HIVE_ARTIFACT_ALLOW_HTTP` | `true` for plain HTTP; in the production profile only with `INTERNAL_ENTERPRISE` |
| BFF | `HIVE_MFE_NETWORK_POLICY` | `INTERNAL_ENTERPRISE` (default `UNRESTRICTED`, still blocking metadata/link-local/reserved) |
| BFF | `HIVE_MFE_ALLOWED_PRIVATE_CIDRS` | same ranges |
| BFF | `HIVE_MFE_ALLOW_HTTP` | `true` for plain HTTP; in the production profile only with `INTERNAL_ENTERPRISE` |
| BFF | `HIVE_MFE_RESOLVE_TTL_MS`, `HIVE_MFE_CACHE_TTL_SECONDS`, `HIVE_MFE_MAX_ASSET_BYTES`, `HIVE_MFE_CACHE_BUDGET_BYTES` | tuning |

## Resource management

*Resource management* (`apps/operator-console/src/pages/Resources.tsx`; also in *Applications → {app}* and in the
module page's *Resource tree* tab) shows the persisted hierarchy: search, type and origin filters, archived toggle,
type icons, origin and manifest-revision badges, grant counts and route links. Selecting a node shows key, ancestry,
owner module and its definition mode, manifest revision, status, descendants, allowed child types, available actions
and linked routes, plus:

- **Access** — grant or revoke actions to users, groups and roles (`/admin/grants`), direct assignments per subject
  and `manage` inherited from ancestors. Only `manage` is inherited by descendants in the authorization model
  (`resource#manager from parent`); action grants apply to the node only, and the console does not simulate more.
- **Effective permissions** — pick a user: decisions per action from the authorization engine (OpenFGA, default deny
  with reasons such as `NO_RELATIONSHIP`), the user's groups and roles, and the grants that explain each `ALLOWED`.

Governance (enforced by the control plane, `ResourceCatalog`):

| Node | Editable here | Children |
|---|---|---|
| `SYSTEM` (application root) | no | yes |
| `MANUAL` | name, parent (cycle and parent-type checked), actions; archive/restore (children first; grant loss is confirmed) | yes |
| `MANIFEST` of a MANIFEST module | no — import and publish a new revision | no |
| `MANIFEST` of a HYBRID or MANUAL module | no — new revision | yes (manual) |

Keys and types are immutable; duplicate keys, cycles and invalid parent types are rejected; published revisions are
immutable. In HYBRID modules manual nodes survive every manifest update: a manifest that claims a manual key or drops
a node that still has manual children is refused at import (exact dry run) or, if the conflict appears later, shown as
`CONFLICT` in the diff and refused at publish. Diff impact lists the active grants a version would leave on archived
resources or actions; nothing is revoked silently, and a rollback restores them.

Routes are bound to resources through a new artifact version (*Routes → Bind resource*); active artifact revisions
are never changed in place.

## Verification

`npm run test:mfe-registration` (API level) and `npm run test:e2e:mfe-registration` (browser: console wizard by IP and
port, resource tree, grants from the tree, users with and without access in the default shell under the deployment
CSP). Unit tests: `FederationFormatsTest`, `ArtifactGatewayTest`, `tests/packages/mfe-loaders.test.mjs`. The fixture
MFEs (`tests/support/mfe-fixture.mjs`) reproduce webpack and Vite container semantics (global container, `publicPath`
from `document.currentScript`, `import.meta.url` chunks); they are not produced by the webpack or Vite toolchains.

## Limitations

- Module Federation **shared dependencies** are not negotiated with the shell: containers receive an empty share scope
  and use their own bundled copies. Remotes configured with `import: false` for a shared package cannot load.
- Only the entry is integrity-verified; chunks and stylesheets are trusted by origin (registered host, path confinement,
  network policy), as Module Federation provides no per-chunk SRI.
- `VITE_FEDERATION` targets `@originjs/vite-plugin-federation`-style entries (an ES module exporting `get`/`init`).
  Webpack containers must use a global library type (`var`/`window`), not `module`.
- Format detection is heuristic; the operator can override the detected format and container name.
- The probe tells an operator (platform role `OPERATOR`) whether hosts allowed by the artifact network policy answer —
  the same reach the existing manifest *fetch* already had. Restrict the policy (`INTERNAL_ENTERPRISE` + CIDRs) accordingly.
- Each gateway resolution evaluates the caller's runtime context (cached per caller and module for
  `HIVE_MFE_RESOLVE_TTL_MS`); applications with very large resource catalogs pay that cost once per TTL.
