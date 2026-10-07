# Observability

- **Correlation ID.** Every request gets `X-Correlation-Id` (a well-formed inbound value is kept, otherwise generated), placed in the logging MDC, echoed on the response, propagated BFF → authorization service → upstream targets, and recorded in audit events and API log entries (`hive-spring-boot-starter`).
- **PlatformError.** All API failures are `{code, message, correlationId}`; unexpected failures never expose exception text.
- **Audit log** (`audit_event`, `/admin/audit`, AUDITOR): every control-plane change with actor (`user:<id>`, `machine:provisioner`, `bootstrap`, `system:bff`), outcome, correlation id and redacted details; admin denials; protected and denied route calls; legacy and integration token acquisitions/invalidations.
- **API log** (`api_log`, `/admin/api-logs`, AUDITOR): every proxied and tunneled call with route, operation, path template (never query strings, bodies or headers), status, upstream status, duration, outcome (`SUCCESS`, `DENIED`, `UNAUTHENTICATED`, `NOT_FOUND`, `UPSTREAM_ERROR`, `REJECTED`) and reason. Delivered asynchronously from the BFF through a bounded queue.
- **Redaction.** Sensitive keys (password, secret, token, authorization, cookie, api key, private key, credential…) and token-shaped strings (Bearer, Basic, JWT) are masked recursively before persistence. A post-suite scan proves no fixture token, password or client secret appears in any service log.
- **Health and readiness.** Liveness and readiness probes on both services; authorization readiness includes PostgreSQL and the OpenFGA store/model.
- **Startup diagnostics.** Each service logs its effective non-secret configuration (`Hive authorization service ready: profile=… artifactPolicy=… decisionCache=… provisioningCredential=… firstAdministrator=…`, `Hive BFF ready: profile=… identity=… approvedTargetOrigins=…`).
- **Runtime diagnostics.** `/admin/diagnostics/graph` (graph readiness, outbox pending and dead-lettered, cache), `/admin/runtime/catalog`, `/admin/diagnostics/authorization/check` (explain decisions), MFE runtime and workspace `RuntimeDiagnostic`s in the browser, and `hive doctor`.

Structured JSON logging can be enabled with Spring Boot's `logging.structured.format.console=ecs` (environment `LOGGING_STRUCTURED_FORMAT_CONSOLE=ecs`); MDC values including the correlation id are included.
