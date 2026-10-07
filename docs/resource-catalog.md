# Resource catalog

Every application owns one tree of resources rooted at an immutable `APPLICATION` node (key = application key) created with the application. Resources are the authorization vocabulary; navigation and UI layout are separate (see [manifest governance](manifest-governance.md)).

## Types and allowed parents

| Type | Allowed parents |
|---|---|
| APPLICATION | none (root only, one per application) |
| MODULE | APPLICATION, MODULE |
| PAGE | MODULE, PAGE |
| UI_COMPONENT | PAGE, UI_COMPONENT |
| FIELD | PAGE, UI_COMPONENT, DATA_RESOURCE, BUSINESS_RESOURCE |
| BUSINESS_RESOURCE | APPLICATION, MODULE, BUSINESS_RESOURCE |
| EXTERNAL_RESOURCE | APPLICATION, MODULE, EXTERNAL_RESOURCE |
| API_RESOURCE | APPLICATION, MODULE, API_RESOURCE |
| DATA_RESOURCE | APPLICATION, MODULE, BUSINESS_RESOURCE, DATA_RESOURCE |
| DATA_GOVERNANCE_RESOURCE | APPLICATION, DATA_RESOURCE, DATA_GOVERNANCE_RESOURCE |

## Rules (enforced in `ResourceCatalog`, tested in `tests/integration/authorization.test.mjs`)

- Keys match `[a-z][a-z0-9._-]{0,159}` and are unique per application; types are immutable.
- Parents must exist in the same application, be active and be an allowed type; re-parenting that would create a cycle is rejected.
- Actions match `[a-z][a-z0-9_-]{0,79}`, are unique per resource, at most 50; `manage` is implicit and reserved.
- **Ownership.** `origin` is `SYSTEM` (root), `MANUAL` (operator-created) or `MANIFEST` (published by a module, `owner_module_key`). Manual APIs cannot edit manifest-owned nodes (409 `RESOURCE_OWNED`); a module's manifest cannot touch nodes owned by another module or by manual configuration, and may attach only to the application root or its own nodes.
- **History.** Nothing is deleted. Resources and actions are archived; archiving requires active children to be archived first; grants on archived resources remain as history and decisions return `RESOURCE_ARCHIVED`. Removed manifest actions are archived.
- Optimistic concurrency via `revision` on every manual mutation.

## Admin API

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/admin/applications` | create creates the root node |
| GET/PUT | `/admin/applications/{app}` | rename, archive/restore with `revision` |
| GET | `/admin/applications/{app}/resources?includeArchived=` | flat tree with parent keys and actions |
| POST | `/admin/applications/{app}/resources` | manual node `{key,type,parentKey,displayName,actions}` |
| PUT | `/admin/applications/{app}/resources/{key}` | manual nodes only; `revision` required |
| POST | `/admin/applications/{app}/resources/{key}/archive` | `{archived, revision}` |
