# ADR-003: Authorization source of truth and graph model

Status: accepted; implemented in Phase 4.

## Context

The reference implementation kept relational access data in PostgreSQL and projected it into OpenFGA through a transactional outbox, with a Redis decision cache invalidated by a graph epoch. Those mechanisms are proven and are reused. Two parts were unsuitable for a headless platform:

- Administrative authorization mapped URL fragments to hard-coded, product-branded objects (`application:<product>`), mixing platform administration with business resources.
- Business actions were mapped onto a fixed set of seven relations, so a solution action such as `enroll` had to be squeezed into `create`/`edit`.

## Decision

1. **PostgreSQL is the source of truth.** Users, groups, roles, assignments, grants, platform role assignments and the resource catalog are relational rows. Every change enqueues its OpenFGA tuples in `graph_outbox` in the same transaction.
2. **The authorization service is the only graph writer.** No other component holds OpenFGA write credentials. The outbox is drained after commit (read-your-writes for administrators) and by a scheduler; claims use `FOR UPDATE SKIP LOCKED`, events for the same tuple are applied in order, network I/O happens outside the claim transaction, failures back off exponentially and dead-letter after 12 attempts, and lost claim ownership is a fault rather than a retry.
3. **Model** (`infra/openfga/model.fga`, transformed by the official CLI into `model.json` and packaged):
   - `resource#manager` is inherited down `resource#parent`.
   - Each declared action is its own `action:<resource-id>.<key>` object; `allowed = grantee or manager from resource`. Solutions can therefore declare any action key without model changes. `manage` is implicit on every resource.
   - `platform:hive` holds control-plane roles (`super_admin`, `operator`, `security_admin`, `integration_admin`, `auditor`, computed `reader`). Resource grants never confer platform roles and vice versa.
   - Graph identifiers are UUIDs; business keys never appear in the graph.
4. **Default deny with reasons.** Decisions deny for unknown/inactive users, unknown or archived resources (or archived applications), undeclared actions and any graph failure (`GRAPH_UNAVAILABLE`). Only a graph relationship can allow.
5. **Optional decision cache.** With `HIVE_AUTHZ_CACHE_ENABLED=true`, decisions are cached in Redis under a global epoch that is incremented before and after every projected write (reference behavior). Cache read failures fall through to OpenFGA; an epoch increment failure aborts the projection so a stale ALLOW can never outlive a revocation.
6. **Store lifecycle.** The store is resolved under a PostgreSQL advisory lock and recorded in `graph_store`; the model is installed at startup. OpenFGA soft-deletes stores and keeps answering checks for a deleted id, so a scheduled job verifies the store exists; on loss a new store is created and the full relational state is replayed.
7. **Administration.** Every `/admin/**` handler declares its platform relation via `@PlatformAccess`; undeclared handlers are denied. The BFF calls admin APIs with its service credential and the canonical user in `X-Hive-Actor`. The optional `provisioner` credential is the deployment's machine administrator for automation.
8. **First administrator.** `HIVE_BOOTSTRAP_ADMIN_ISSUER`/`HIVE_BOOTSTRAP_ADMIN_SUBJECT` produce exactly one `SUPER_ADMIN` assignment, once, with a durable completion marker. No administrator exists otherwise. The last `SUPER_ADMIN` assignment cannot be revoked.

## Consequences

- Revocation is effective as soon as the outbox drains (synchronously after the admin call under normal operation); tests verify a cached ALLOW is not served after revocation.
- View permissions are not inherited (only `manage`), matching reference semantics; consumers grant per resource or use `manage` for subtree administration.
- Runtime policies/obligations (reference `RuntimePolicyService`) are not migrated in this milestone (DEFER); decisions are purely relationship-based.

Evidence: `npm run test:authorization`, `npm run test:model`, `SecurityConfigurationTest`.
