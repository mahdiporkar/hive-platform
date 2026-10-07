# React + Tailwind guide

`examples/react-tailwind-consumer` is the reference for teams using React and Tailwind. It depends on React, Tailwind and the Hive SDK only — no Ant Design or Material UI (enforced by `tests/architecture/consumers.test.mjs`).

## Micro-app

```tsx
import type {HiveMountContext} from '@hive-platform/contracts';
import {createReactMicroApp} from '@hive-platform/react';
import css from '../dist/tailwind.css';          // compiled by the Tailwind CLI, imported as text

function App({context}: {context: HiveMountContext}) {
  const canEnroll = context.permissions.can('student-example.courses', 'enroll');   // UI hint
  return <div><style>{css}</style>{/* routes by context.route / context.params */}</div>;
}
export default createReactMicroApp(App);
```

- `createReactMicroApp` creates one React root per instance (`createRoot` on mount, re-render on update, `root.unmount()` on unmount).
- Declare `"styleIsolation": "SHADOW_DOM"` in the micro-frontend manifest and render the compiled Tailwind CSS inside the component: Preflight and utilities then apply only inside the shadow root. Tailwind v4 defines its theme variables on `:root, :host`, so they work inside shadow roots.
- If you must use `SCOPED`, disable Preflight and scope utilities to the module root; never ship global resets.
- Render portals (modals, popovers) inside the instance container, not `document.body`.
- Use `context.navigate(path)` for in-module navigation, `context.events` to talk to other micro-apps, `@hive-platform/http-client` to call `/api/routes/...` (the session cookie and CSRF are handled; tokens never reach the browser).

## Build

`node examples/react-tailwind-consumer/build.mjs`:
1. `@tailwindcss/cli` compiles `student-example/src/styles.css` (with `@source` pointing at the sources);
2. esbuild bundles `StudentApp.tsx` with React into one ES module (`loader: {'.css': 'text'}`);
3. the SRI (`sha384-…`) of the bundle is written into `mf-manifest.json` next to `resource-manifest.json`.

Register with any admin client (console, CLI or API): create the module, import and publish the resource manifest, register and activate the micro-frontend manifest.

## Server-rendered public site

`public-web/server.mjs` renders public pages with `react-dom/server` and Tailwind from Hive's public APIs (no session, no cookies) — see [public, hybrid and authenticated runtime](public-hybrid-authenticated.md).
