# ADR-007: Dynamic routing

Status: accepted; implemented in Phase 6.

## Decision

- **Model.** `ServiceTarget` (trusted base URL, timeouts, size limits) ← `ProxyRoute` (application, optional module, path prefix, authentication mode) ← `RouteOperation` (method, path pattern, access mode, resource action). Browser URL: `/api/routes/<prefix>/<path>`. Routes change at runtime without rebuilding any consumer.
- **Per-operation access.** `PUBLIC` and `HYBRID` operations cannot require permissions; `AUTHENTICATED` operations must name a declared resource action (database constraint and service validation). A public UI route never makes an API public. Unregistered paths or methods are denied (`ROUTE_NOT_FOUND`).
- **Deterministic resolution.** Canonical path (reused reference `RoutePathPolicy`: no traversal, encoded separators, control characters, duplicate slashes; administrator patterns are a tiny literal/`{var}`/`*`/terminal-`**` language, never regex), then longest prefix, route priority, pattern specificity. Equal candidates are refused when saved (`AMBIGUOUS_OPERATION`) and at runtime (`ROUTE_AMBIGUOUS`).
- **Control/runtime split.** The BFF never reads routing tables; it calls `POST /internal/routing/resolve`, which returns a runtime representation including the authorization decision for the session's canonical user.
- **Two trust boundaries for targets.** The control plane validates target URLs with the reused artifact network policy (`HIVE_TARGET_NETWORK_POLICY`; metadata, link-local, reserved never allowed). The BFF independently requires the exact origin in `HIVE_PROXY_ALLOWED_ORIGINS` and re-checks resolved addresses per call (`TARGET_NOT_APPROVED`, `TARGET_BLOCKED`). Browsers can never supply a URL; redirects are never followed and `Location` is not relayed.
- **Header allowlists both ways.** Only content negotiation and conditional headers go upstream, plus `X-Correlation-Id`, `X-Hive-Route`, `X-Hive-Operation` and, for sessions, `X-Hive-User-Id`/`X-Hive-Tenant-Id`. Browser `Authorization`, `Cookie` and forwarding headers are dropped. Only content/caching headers come back; upstream `Set-Cookie` never does.
- **Authentication modes.** `NONE`, `FORWARD_TOKEN` (the vault access token, refreshed server-side when needed), `LEGACY` (see [legacy authentication](../legacy-authentication.md)). `API_KEY`, `OAUTH2_CLIENT_CREDENTIALS` and `MTLS` are reserved names rejected with `AUTHENTICATION_MODE_UNSUPPORTED` — no insecure placeholder exists.
- **Limits.** Request bytes (413), response bytes (502 `RESPONSE_TOO_LARGE`), connect and response timeouts (502 `UPSTREAM_UNREACHABLE`, 504 `UPSTREAM_TIMEOUT`).
- **Observability.** Every call produces an API log entry (route, operation, path template, status, upstream status, duration, outcome, reason; never query strings, bodies or headers). Protected and denied calls are also audited (`route.invoked`, `route.denied`). Delivery from BFF to the control plane is asynchronous through a bounded queue.

## Deviations from the reference

- The reference's rewrite-pattern transformation is not migrated (DEFER); Hive supports prefix stripping plus an upstream base path.
- The reference's per-route retry policy is not migrated (DEFER); Hive never retries.
- Firewall and container rejections are reported as 400 (explicit `RequestRejectedHandler`, `/error` permitted) instead of surfacing as 401 through the deny-all fallback.

Evidence: `npm run test:routing`, `RoutePathPolicyTest`.
