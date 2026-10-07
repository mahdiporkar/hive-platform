# ADR-010: Enforced framework neutrality

Status: accepted; enforced since Phase 2, proven end to end in Phases 7–11.

## Decision

- Contracts contain DOM and data interfaces only. A Micro App exports a factory (`create()`) that produces independent lifecycle instances, refining the requested `mount`/`unmount` example so concurrent instances cannot share an implicit singleton.
- The headless packages (`contracts`, `core`, `http-client`, `auth`, `authorization`, `mfe-runtime`, `workspace`) import no UI framework. React support lives only in `@hive-platform/react`, which takes React as a peer dependency and on which nothing in the platform depends.
- Hive never needs to know a consumer's component or CSS library: no manifest or contract field names one.

## Enforcement

- `tests/architecture/boundaries.test.mjs`: TypeScript AST inspection of static imports, re-exports, inline type imports, literal dynamic imports and `require` in headless modules; dependency manifests (incl. peer/dev) checked; Java platform code may not import solution/consumer namespaces; business-domain identifiers are rejected in platform implementation.
- `tests/architecture/consumers.test.mjs`: the React + Tailwind consumer has no Ant Design/MUI dependency, import or bundled code; the minimal consumer uses no framework; only `@hive-platform/react` imports React; platform code never imports apps or examples.

## Proof

- `examples/minimal-consumer`: plain TypeScript micro-apps and plain-DOM hosts using the runtime and the workspace engine without any framework (`test:e2e:mfe`, `test:e2e:workspace`).
- `examples/react-tailwind-consumer`: React + Tailwind micro-app in the default shell next to plain-TypeScript micro-apps, exchanging events (`test:e2e:public-hybrid`).
- `apps/operator-console`: React + Ant Design — the design system stays inside that optional app.

These are regression boundaries, not a security sandbox for arbitrary third-party code: micro-apps run in the page with the user's origin, which is why artifacts are registered by platform operators and pinned by SRI.
