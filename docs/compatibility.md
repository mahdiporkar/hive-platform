# Compatibility

The executable matrix is exported by @hive-platform/contracts.

| Platform | Contracts | Schema | Runtime | Manifest document |
|---|---|---|---|---|
| 0.1.x | 1.0.x deprecated; 1.1.x current | 1.0.x | 1.0.x | 1.x |

Versions must use stable major.minor.patch syntax. Missing versions, unsupported majors, future schema/runtime minors and malformed versions are rejected with typed diagnostic codes. Compatible patch revisions are accepted. The document version is distinct from its schema version.

Contract interfaces describe planned API shapes; they do not assert that the corresponding server endpoint or runtime has been implemented.