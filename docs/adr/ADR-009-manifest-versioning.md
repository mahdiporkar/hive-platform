# ADR-009: Manifest versioning and governance

Status: accepted; implemented in Phase 5.

## Decision

- **Two contracts.** A *resource manifest* carries only authorization vocabulary (resources, actions). A *micro-frontend manifest* carries only an executable artifact, its routes and navigation hints. Each rejects the other's fields (`routes`/`artifact`/`url`… vs `resources`/`grants`…). Neither mentions a UI framework; the only artifact format is `ES_MODULE` (extended with the Module Federation formats by [ADR-013](ADR-013-artifact-gateway.md)).
- **Versions.** `manifestVersion` is the content version. A (module, version) pair is immutable: re-importing identical content (canonical, key-order-independent SHA-256) is idempotent; different content is `409 MANIFEST_VERSION_IMMUTABLE`. Compatibility fields are described in [compatibility](../compatibility.md).
- **Lifecycle.** fetch/import → validate → DRAFT → diff → publish → (activate other published version = rollback/roll-forward). Validation runs the real catalog application inside an always-rolled-back transaction, so a draft exists only if publishing it would currently succeed. Publish re-validates under a module row lock.
- **Immutability in the database.** Triggers reject any update or delete of published resource revisions and any update or delete of artifact revisions. Drafts may only be discarded.
- **Coordinated activation.** An artifact names the resource manifest version it needs; activating the artifact activates that published revision in the same transaction, then verifies every route's resource/action is declared and active, and that no route path collides with another active module. Any failure rolls back the whole activation. Activating an older resource revision fails if the active artifact would then reference undeclared actions.
- **History.** `module_release` (ordered by a sequence, not timestamps) records every publish, activation, artifact activation and deactivation; audit events mirror them.
- **Rollback semantics.** Activating an earlier revision re-materializes its resource set: resources/actions missing from it are archived, previously archived ones are restored. Grants are never removed, so access returns exactly when the vocabulary returns.
- **Definition modes.** `MANIFEST`: resources only via manifests, manual nodes cannot attach under the module's nodes. `HYBRID`: manifests plus manual nodes under them. `MANUAL`: manifests rejected; resources are managed through the catalog API.
- **Navigation overlays** (`navigation_overlay`) adjust label/order/visibility of declared routes only and are applied in the runtime catalog; they never affect authorization.
- **Fetching.** Registered manifest URLs pass the migrated artifact network policy at registration and again (with DNS resolution) at fetch time; redirects are refused; bodies are limited to 1 MiB; failures are classified (`MANIFEST_HTTP_ERROR`, `MANIFEST_REDIRECT_REFUSED`, `MANIFEST_CONTENT_TYPE`, `MANIFEST_UNREACHABLE`, `MANIFEST_DNS`, `MANIFEST_TLS`, `MANIFEST_TIMEOUT`, `MANIFEST_LOCATION_REJECTED`, …).

## Deviations from the reference

- The reference coupled manifests to a branded root application key and allowed legacy mixed manifests; Hive rejects mixed documents outright.
- The reference's `ManifestRevision` contract status set is reused (DRAFT, PUBLISHED); "active" is a pointer, not a status.
- `manifestVersion` in the TypeScript contracts previously meant a document format major (`1.x`); it now means the content version, and `schemaVersion` is the format version. Contract tests were updated accordingly.

Evidence: `npm run test:manifests`, `ManifestDocumentsTest`, `CompatibilityMatrixTest`, `tests/contracts/compatibility.test.mjs`.
