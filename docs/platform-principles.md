# Platform principles

> Platform owns capabilities. Solution owns business. Consumer owns presentation.

| Principle | How it is enforced (not only documented) |
|---|---|
| Hive Core has no business vocabulary | `tests/architecture/boundaries.test.mjs` rejects business identifiers (Student, Invoice, Payroll, …) in platform code; business words exist only in `examples/`, fixtures and tests |
| Hive Core has no UI framework | headless packages import no React/Vue/Angular/Svelte/Ant Design/MUI/Tailwind (AST + manifest checks); React lives only in `@hive-platform/react` |
| Consumers replace any UI | default shell and operator console are ordinary API clients; plain-DOM hosts and API-only administration are tested |
| Default deny | every authorization path denies unknown, archived, undeclared, unauthenticated and graph-failure cases; unregistered routes and integration operations are denied |
| Credentials stay on the server | browser receives only `HIVE_SESSION`; vault and token caches are encrypted; secrets are references |
| Control plane is the source of truth | PostgreSQL rows with outbox projection into OpenFGA; replay on graph loss |
| History is preserved | archive instead of delete; immutable published manifests; revoked grants kept |
| Versions are never guessed | one compatibility matrix executed in Java and TypeScript |
| Zero-consumer core | a fresh installation has no applications, users, roles, grants, routes, flags or audit rows (bootstrap test asserts every table) |
| Implementation is not proof | phases close only on executed tests; unexecuted checks are reported NOT EXECUTED |

Platform roles (`SUPER_ADMIN`, `OPERATOR`, `SECURITY_ADMIN`, `INTEGRATION_ADMIN`, `AUDITOR`) administer Hive. Business roles are defined by solutions and confer only resource grants. A platform operator is not a business administrator ([authorization](authorization.md)).
