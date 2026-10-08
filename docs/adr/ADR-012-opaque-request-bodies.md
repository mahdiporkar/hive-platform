# ADR-012: The BFF treats application request bodies as opaque

Status: accepted.

## Context

Browsers upload files with standard `FormData`, i.e. `multipart/form-data; boundary=…`. Through RuntimeProxy such
uploads reached the target with the multipart `Content-Type` but **no body**: downstream Spring services answered
`Required part 'file' is not present`, and uploads of 1 MiB or more failed inside the BFF with
`MaxUploadSizeExceededException` (500).

Root cause, reproduced by `tests/integration/multipart.test.mjs` before the fix:

1. Spring Boot auto-configures `StandardServletMultipartResolver` (`spring.servlet.multipart.enabled=true` by
   default). Before any controller runs, `DispatcherServlet.checkMultipart` → `resolveMultipart` →
   `StandardMultipartHttpServletRequest.parseRequest` → Tomcat `Request.parseParts` reads and parses the entire
   body (with Boot's 1 MiB per-file default). RuntimeProxy's `request.getInputStream()` then returned an exhausted
   stream, and an empty body was forwarded.
2. Spring Boot's `FormContentFilter` (enabled by default) parses `application/x-www-form-urlencoded` bodies of PUT,
   PATCH and DELETE into parameters, consuming the stream the same way.
3. Spring Security's CSRF handler falls back from the header to `request.getParameter("_csrf")`; for a POST form
   without the header that makes Tomcat parse — and consume — the body before the proxy.

## Decision

The BFF is a transport and policy boundary, not a consumer of application payloads. RuntimeProxy, AdminProxy and
SupersetTunnel forward bodies byte for byte, so nothing in the BFF may parse them first:

- `spring.servlet.multipart.enabled=false` — no multipart resolver; DispatcherServlet never parses multipart.
- `spring.mvc.formcontent.filter.enabled=false` — no form parsing for PUT/PATCH/DELETE.
- On `/api/routes/**` the CSRF token is accepted only from the header (`RuntimeCsrfTokenRequestHandler`); other BFF
  paths keep Spring's standard resolution. Hive's clients always send the header, so this only narrows what passes.
- RuntimeProxy refuses to forward a body shorter than its declared `Content-Length`
  (`500 REQUEST_BODY_UNAVAILABLE`), so any future body consumer fails loudly instead of corrupting requests.

No BFF endpoint parses multipart locally: the BFF's own endpoints (`/auth/*`, `/api/me/*`, `/api/public/*`,
`/api/admin/**` relayed as JSON, OAuth2 callbacks via query parameters) have no multipart inputs. Should one ever need
it, it must parse lazily and explicitly on its own path, never globally.

## Consequences

- Downstream applications receive standard requests (multipart, forms, JSON, binary) and parse them with their own
  framework; they need no Hive-specific upload contract.
- Size enforcement is unchanged: the target's `maxRequestBytes` bounds every body with bounded buffering; business
  limits (per file, per type) belong to the application.
- Header allowlists, credential injection per authentication mode, identity headers, CSRF and authorization are
  unchanged for every body type.
- Guarded by `OpaqueRequestBodyTest` (configuration and CSRF resolution), `npm run test:multipart` (real BFF and
  authorization service, Spring Boot target) and `npm run test:e2e:multipart` (Keycloak, browser `FormData`).
