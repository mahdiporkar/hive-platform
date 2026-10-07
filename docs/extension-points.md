# Extension points

Consumers extend Hive surfaces without modifying Hive source. An extension is a framework-neutral `ExtensionRegistration` (`@hive-platform/contracts`) registered in an `ExtensionRegistry` (`@hive-platform/core`).

```ts
const banner: ExtensionRegistration = {
  key: 'campus.banner', point: 'HEADER', version: '1.0.0', contractVersion: '1.1.0', order: 10,
  requires: ['campus-example:student-example.list:annotate'],   // optional UI-hint permission filter
  render(element, context) { element.textContent = 'Open day this Friday'; return () => element.replaceChildren(); },
};
```

| Point | Default shell placement |
|---|---|
| `HEADER` | header bar |
| `NAVIGATION` | after the navigation links |
| `DASHBOARD` | above the workspace in DASHBOARD layout |
| `PROFILE` | next to the signed-in user |
| `NOTIFICATIONS` | header, after the layout switcher |
| `LOGIN_EXPERIENCE` | next to "Sign in" for anonymous visitors |
| `WORKSPACE_ACTIONS` | inside the layout switcher group |
| `RUNTIME_ACTIONS` | above the workspace |

Rules (tested in `tests/packages/headless.test.mjs`): keys `[a-z][a-z0-9.-]{1,79}`, unique; contract major must be 1; `render` receives its own element and may return a cleanup; a throwing extension is removed and reported as `EXTENSION_FAILED` without affecting others; `requires` entries are `application:resource:action` (`manage` implies all) and hide the extension otherwise — servers still enforce every operation.

## Registering with the default shell

Deploy an ES module at `/shell-extensions.js` that default-exports an array of registrations. The shell loads it at start (only when served as JavaScript) and renders each point. This is consumer configuration: it runs with the shell's privileges, so deploy it like any other trusted asset. Other hosts register extensions in code and render them with `registry.render(point, element, context)` or `<ExtensionSlot>` from `@hive-platform/react`.

Evidence: the Phase 10 E2E loads `tests/fixtures/shell/shell-extensions.js` (HEADER banner that changes after login, permission-gated NAVIGATION link, DASHBOARD widget).
