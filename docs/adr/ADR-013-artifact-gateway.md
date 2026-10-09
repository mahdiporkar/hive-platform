# ADR-013: Same-origin artifact gateway and format loaders

## Status

Accepted.

## Context

Micro-frontends were loaded by the browser from the URL in their manifest. A module served from an internal address
(`http://10.0.0.15:3004/remoteEntry.js`) therefore needed a reverse-proxy rule per module or relaxed `connect-src` /
`script-src` policies, mixed-content exceptions and CORS on the MFE host. Only single-file ES modules were supported;
Module Federation containers, whose chunks load relative to the entry, could not run from a Blob URL.

## Decision

- The BFF serves registered artifacts at `/api/mfe/{module}/{version}/{asset}`. The upstream comes only from the
  control plane's registry (active revision), only for modules in the caller's runtime context; assets are confined
  below the entry directory, re-checked against the BFF network policy per fetch, never redirected, size- and
  type-checked; the entry must match its registered integrity. The runtime catalog rewrites upstream artifact URLs to
  this path, so browsers never see or contact MFE hosts and the shell CSP stays `'self'`.
- `MfeRuntime` delegates loading to one loader per `artifact.format` (`ES_MODULE`, `WEBPACK_FEDERATION`,
  `VITE_FEDERATION`); the mount contract (`{contractVersion, create()}`) is unchanged for every format.
- Registration tooling (probe, integrity pinning, activation-time verification) lives in the control plane and uses
  the same artifact network policy as manifest fetching.

## Consequences

- Registering, upgrading, rolling back or deactivating an MFE needs no deployment change; the network policy is set
  once per deployment.
- The BFF carries artifact traffic (bounded LRU cache, `ETag` revalidation).
- Chunk integrity relies on origin confinement; shared-dependency negotiation with the shell is out of scope.
