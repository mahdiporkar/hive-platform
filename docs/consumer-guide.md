# Consumer guide

How a team builds a solution on Hive without copying or modifying Hive.

## 1. Start

```sh
hive create solution campus --application campus-example --name "Campus"
cd campus && hive add mfe records --route /records && hive add service records --url https://records.internal --prefix /records
npm install && npm run build && hive validate dist/modules
HIVE_PROVISIONING_PASSWORD=… hive register --authorization https://hive-authorization.internal
```

Or perform the same steps with the Operator Console or any HTTP client against `/api/admin/**` (see [operator console](operator-console.md) and the API-only acceptance test).

## 2. Micro-apps

- Any stack, one ES module exporting `{contractVersion: '1.1.0', create()}` ([MFE runtime](mfe-runtime.md)). React teams may use `createReactMicroApp` ([React + Tailwind guide](react-tailwind-guide.md)).
- Two manifests per module: resource manifest (authorization vocabulary) and micro-frontend manifest (artifact, routes, navigation) ([manifest governance](manifest-governance.md)).
- Use `context.permissions.can()` for affordances only; protect every backend operation with an `AUTHENTICATED` route operation that names the resource action.
- Talk to other micro-apps through `context.events` ([event bus](event-bus.md)); never import another micro-app.
- Style isolation: prefer `SHADOW_DOM`; with `SCOPED`, prefix selectors and ship no global resets ([workspace runtime](workspace-runtime.md#css-isolation)).

## 3. Backends

Register service targets, proxy routes and route operations ([dynamic routing](dynamic-routing.md)). Backends receive `Authorization: Bearer <user token>` (FORWARD_TOKEN) or a legacy service token (LEGACY), plus `X-Hive-User-Id`, `X-Hive-Tenant-Id` and `X-Correlation-Id`. Accept these only from the BFF's network.

## 4. Hosts

Use the default shell (optionally extended through `/shell-extensions.js`, [extension points](extension-points.md)), or build your own host with `@hive-platform/auth` + `@hive-platform/workspace` (any framework) — `examples/minimal-consumer` shows a 60-line plain-DOM workspace host. Public, SEO-relevant pages can be server-rendered from the public APIs ([public, hybrid and authenticated](public-hybrid-authenticated.md)).

## 5. Upgrading Hive

Solutions depend only on published contracts and APIs, so Hive upgrades independently. `hive upgrade --check` reports whether your manifests fit the installed platform line; incompatible manifests are rejected at registration with a precise diagnostic ([compatibility](compatibility.md)).
