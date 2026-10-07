# Versioning

Semantic Versioning everywhere; nothing is 1.0.0 until the final acceptance criteria are met.

| Artifact | Current | Where |
|---|---|---|
| Platform | `0.1.0-dev.0` (Maven `0.1.0-SNAPSHOT`) | root `package.json`, `pom.xml` |
| Contracts (`@hive-platform/contracts`) | `1.1.0` | contract line used by artifacts (`contractVersion`) |
| Manifest schema | `1.0.0` | `schemaVersion` in both manifest kinds |
| MFE lifecycle / runtime | `1.0.0` | `runtimeVersion`; `RUNTIME_VERSION` in `@hive-platform/core` |
| Workspace state schema | `1.0.0` | `WORKSPACE_SCHEMA_VERSION` in `@hive-platform/workspace` |
| SDK packages | `0.1.0` | `packages/*/package.json` |
| CLI | `0.1.0` | `cli/package.json`; `hive version` prints all of the above |
| Database | Flyway `V1`–`V7` | `services/authorization/src/main/resources/db/migration` |

Compatibility rules (executable, shared by Java and TypeScript): [compatibility](compatibility.md).

Rules for changes:
- A breaking contract change bumps the contract major and is rejected by older runtimes (`VERSION_MAJOR_UNSUPPORTED`) instead of failing obscurely.
- A new optional contract field bumps the minor; runtimes reject unknown future minors (`VERSION_MINOR_UNSUPPORTED`) so artifacts never run on a runtime that lacks what they rely on.
- Deprecated minors stay accepted with `VERSION_DEPRECATED` warnings for at least one platform minor.
- Database changes are new Flyway versions; published manifest content and released migrations are never edited.
- Manifest content versions (`manifestVersion`) are immutable per module.
