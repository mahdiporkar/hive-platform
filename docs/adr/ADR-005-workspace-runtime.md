# ADR-005: Workspace runtime

Status: accepted; implemented in Phase 8 (`@hive-platform/workspace`).

## Decision

- The workspace engine is a headless package. It owns the model (`Workspace`, `WorkspaceSlot`), slot lifecycle, per-slot authorization state, the event hub and persistence. Renderers only hand an element to `attach(slotId, element)`. The package ships an optional plain-DOM renderer; the default shell's React renderer is another client. Nothing in the engine imports a shell or a UI framework (architecture tests).
- Layouts and capacity: `SINGLE` (1; opening replaces the content), `TABS` (12; inactive tabs stay mounted), `SPLIT` (4 panes), `DASHBOARD` (12). Reducing capacity closes the newest slots but always keeps the active one. `NEW_WINDOW`/`POPOUT` are anticipated by the slot model (a slot is just an element) but not implemented.
- Every slot has `status` (`IDLE`, `LOADING`, `MOUNTED`, `ERROR`, `DENIED`, `LOGIN_REQUIRED`), `authorization` (`UNKNOWN`, `ALLOWED`, `DENIED`, `LOGIN_REQUIRED`), `error` (a `RuntimeDiagnostic`), `moduleKey`, `instanceId` and `route`. Operations on a slot are serialized; operations on different slots are independent, so one failing or slow micro-app never blocks another.
- `setContext()` re-evaluates every slot after login, logout or a permission change: newly allowed slots mount, revoked slots unmount and show `DENIED`, protected slots after logout show `LOGIN_REQUIRED`, public slots continue.
- Navigation inside a module calls `update()`; navigation to another module unmounts and mounts. The same module may be open in several slots with distinct `instanceId`s.
- Server support: authenticated contexts list all routes of applications the user is a member of (holds any permission in), each with its required action, so the engine can distinguish `DENIED` from `ROUTE_NOT_FOUND`; applications the user has no permission in expose only public routes (see ADR-004 for anonymous behavior).

Evidence: `tests/packages/workspace.test.mjs` (5 tests), `tests/e2e/workspace.test.mjs` (Edge).
