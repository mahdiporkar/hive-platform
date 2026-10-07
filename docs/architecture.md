# Architecture

Hive is a headless, UI-agnostic enterprise application platform. Hive Core is two Spring Boot services — the **BFF** (browser-facing runtime) and the **authorization service** (control plane and runtime decisions) — with PostgreSQL, OpenFGA and Redis. Everything else (shells, consoles, micro-apps, business services, identity providers, Superset) is optional and replaceable.

## System context

```mermaid
flowchart TB
  user([Users and visitors]) --> consumer[Consumers: default shell, custom shells,<br/>SSR public sites, micro-apps in any stack]
  operator([Platform operators]) --> admin[Operator console / CLI / automation]
  consumer --> hive[Hive Core]
  admin --> hive
  hive --> idp[OIDC identity providers<br/>Keycloak or any]
  hive --> services[Business services and legacy systems]
  hive --> superset[Superset - optional]
```

## Containers and components

```mermaid
flowchart LR
  subgraph Browser
    SDK[SDK: http-client, auth, authorization hints,<br/>mfe-runtime, workspace, react adapter]
    MFE[micro-apps]
  end
  subgraph BFF[hive/bff]
    SEC[security: OIDC login, CSRF, session]
    VAULT[token vault + refresh]
    CTX[context endpoints]
    PROXY[runtime proxy + legacy tokens]
    TUN[Superset tunnel]
    ADMP[admin passthrough]
    OBS[observability publisher]
  end
  subgraph AZ[hive/authorization]
    ID[identity registry]
    CAT[resource catalog]
    ACC[access administration]
    MAN[manifest governance + runtime catalog]
    RTG[routing administration + resolver]
    INT[integrations]
    FF[feature flags]
    ENG[authorization engine + decision cache]
    OUT[graph outbox + replay]
    AUD[audit + API log]
  end
  SDK --> SEC & CTX & PROXY & TUN & ADMP
  MFE --> SDK
  CTX --> MAN
  PROXY --> RTG --> ENG
  TUN --> INT --> ENG
  ADMP --> ID & CAT & ACC & MAN & RTG & INT & FF & AUD
  SEC --> ID
  OBS --> AUD
  ENG --> FGA[(OpenFGA)]
  OUT --> FGA
  CAT & ACC & MAN & RTG & INT & FF & AUD & ID --> PG[(PostgreSQL)]
  VAULT & PROXY & TUN --> R[(Redis)]
  ENG -.-> R
```

## Request flows (details in the linked documents)

| Flow | Document |
|---|---|
| Login, session, vault, refresh, logout | [identity](identity.md) |
| Authorization decision, graph projection, platform roles | [authorization](authorization.md) |
| Manifest lifecycle and coordinated activation | [manifest governance](manifest-governance.md) |
| Dynamic route execution, forward token | [dynamic routing](dynamic-routing.md) |
| Legacy token acquisition | [legacy authentication](legacy-authentication.md) |
| MFE loading sequence | [MFE runtime](mfe-runtime.md) |
| Workspace lifecycle, multi-MFE runtime | [workspace runtime](workspace-runtime.md) |
| Event bus | [event bus](event-bus.md) |
| Public / hybrid / private requests | [public, hybrid and authenticated](public-hybrid-authenticated.md) |
| Superset tunnel | [ADR-011](adr/ADR-011-superset-integration.md) |
| Deployment topology | [deployment](deployment.md) |
| Control vs runtime plane | [control plane vs runtime plane](control-plane-runtime-plane.md) |

## OpenFGA synchronization

```mermaid
sequenceDiagram
  participant A as Admin API call
  participant T as Transaction (PostgreSQL)
  participant O as graph_outbox
  participant P as Projector
  participant F as OpenFGA
  participant C as Redis cache
  A->>T: insert grant row
  T->>O: insert WRITE tuple (same transaction)
  T-->>A: commit
  A->>P: drain after commit (scheduler is the safety net)
  P->>O: claim (FOR UPDATE SKIP LOCKED, per-tuple order)
  P->>C: epoch++
  P->>F: write (on_duplicate ignore)
  P->>C: epoch++
  P->>O: mark applied (claim owner checked)
```

## Superset integration

```mermaid
sequenceDiagram
  participant B as Browser (signed in)
  participant F as BFF tunnel
  participant A as Authorization service
  participant R as Redis
  participant S as Superset
  B->>F: POST /api/integrations/superset/bi/api/v1/chart/data {dashboard_id: 12}
  F->>A: resolve(bi, POST, /api/v1/chart/data, DASHBOARD 12, user)
  A-->>F: allowed (superset-bi:access + dashboard.12:view)
  F->>R: encrypted service token for bi@revision
  F->>S: POST /api/v1/chart/data, Bearer service token (no browser cookies)
  S-->>F: JSON (+ Set-Cookie)
  F-->>B: JSON (no cookies, no token)
```
