# ADR-008: Server-side identity and session boundary

Status: accepted direction; Phase 3 remains open.

Preserve AES-256-GCM envelope encryption, random IVs and previous-key decryption from the reviewed source implementation. Tokens belong only in a server-side vault. The browser receives an opaque Secure, HttpOnly session cookie; token-bearing OIDC authorities must never be persisted in the ordinary session context.

Refresh must preserve the original absolute session deadline and use the actual upstream expiry. The reference implementation applied a minimum 30-second access lifetime and could extend its vault deadline; Hive's new VaultRecord rejects expired refresh responses without inventing validity.

Login return paths reject absolute/protocol-relative URLs, encoded slashes/backslashes, control characters, traversal and authentication redirect loops. Query strings on safe local paths are permitted.

Current implementation includes primary OIDC orchestration, encrypted Redis vault, bounded refresh with distributed ownership checks and token-free session persistence. The signed-JWT HTTP fixture executes PKCE, refresh, cookie/secrecy checks and CSRF logout against real Redis. Dynamic provider management, canonical synchronization and real browser validation remain unimplemented or unexecuted; Phase 3 is not complete. The BFF currently uses Spring MVC servlet security instead of the source reactive transport; transport changed while security invariants are preserved through executable integration tests.