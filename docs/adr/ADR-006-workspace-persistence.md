# ADR-006: Workspace persistence

Status: accepted; implemented in Phase 8.

## Decision

- Persist only `WorkspaceState`: schema version, layout, active slot id and per slot `{slotId, instanceId, moduleKey, route}`. Never micro-app state, identity, permissions or tokens.
- Default store: `sessionStorage` (per browser tab, survives reload, not shared with the server or other tabs). The URL carries only the primary route path, never workspace state or sensitive parameters.
- Restored state is untrusted input: `sanitizeState` rejects unknown schema versions and drops slots with malformed ids or module keys, non-local or protocol-relative routes, control characters or oversized routes, and anything beyond 12 slots. The engine then re-resolves every route against the current context and re-applies authorization, so a restored slot can never bypass a revoked permission.
- Logical instance ids survive a reload so micro-apps can key their own (self-managed) storage on them if they choose.

Evidence: workspace unit tests (hostile state sanitizing, restore fidelity) and the E2E reload assertions (identical slots, layout, active slot and instance ids; persisted text contains no identity or token).
