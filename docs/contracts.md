# Contracts

`@hive-platform/contracts` exports versioned data contracts and a real compatibility validator. `npm run build` generates JavaScript and declarations in the package's own `dist` directory. Consumers import only the public package export.

Identity and session contain safe identity metadata, never credentials or token values. Public context is a separate allowlisted shape; interfaces alone do not sanitize server responses. Server-side projections and browser secrecy checks are required in later phases.

The MFE ABI creates an independent lifecycle instance per mount. Workspace persistence stores route descriptors rather than arbitrary app state. Service targets and secret references are control-plane-only contracts and cannot be included in public context.

`npm run typecheck` validates types. `npm test` executes compatibility and dependency boundary tests. Runtime features represented by interfaces are not yet implemented.