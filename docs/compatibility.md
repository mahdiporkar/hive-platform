# Compatibility

One matrix, two executable implementations: `@hive-platform/contracts` (`checkCompatibility`, used by the browser MFE runtime and the CLI) and `services/authorization` `Compatibility.java` (used at manifest registration). Both run the same fixture, [`tests/contracts/compatibility-cases.json`](../tests/contracts/compatibility-cases.json) (16 cases).

| Platform | contractVersion | schemaVersion | runtimeVersion | manifestVersion |
|---|---|---|---|---|
| 0.1.x | 1.0.x (deprecated, warning), 1.1.x (current) | 1.0.x | 1.0.x | any valid SemVer (content version) |

| Field | Meaning |
|---|---|
| `contractVersion` | HiveMicroApp lifecycle ABI the artifact implements |
| `schemaVersion` | manifest document format |
| `runtimeVersion` | minimum MFE runtime the artifact needs |
| `manifestVersion` | the content version of this manifest; immutable once registered |

## Rules

| Situation | Result | Code |
|---|---|---|
| supported major, minor ≤ supported, any patch | accept | — |
| deprecated compatible minor | accept + warning | `VERSION_DEPRECATED` |
| different major | reject | `VERSION_MAJOR_UNSUPPORTED` |
| newer minor than supported (unknown future schema/runtime/contract) | reject | `VERSION_MINOR_UNSUPPORTED` |
| missing | reject | `VERSION_MISSING` |
| pre-release, partial, leading zero, non-string, > 9 digits | reject (never guessed) | `VERSION_INVALID` |

Messages name the field and both versions, e.g. `runtimeVersion: supported major 1, received 2`. The server returns these as `PlatformError` with HTTP 422; the MFE runtime raises them as `RuntimeDiagnostic` before any artifact is fetched, so a version problem is never reported as a network or loading failure.
