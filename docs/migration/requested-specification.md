# HIVE ENTERPRISE PLATFORM
## Master Engineering Prompt V2 — FINAL

---

# 0. Mission

You are responsible for engineering a new enterprise-grade platform named:

**Hive**

Hive must be built as a new independent product using the existing Aurevia repository only as:

- a reference implementation;
- a source of proven capabilities;
- a source of behavior that may be migrated selectively;
- a source of lessons, tests, architectural patterns, and implementation knowledge.

Hive is NOT:

- a rename of Aurevia;
- a fork of Aurevia;
- a mechanical copy of Aurevia;
- a search/replace operation;
- a new branch of Aurevia;
- a university application;
- a banking application;
- an HR application;
- a fixed Super App.

Source/reference repository:

```text
https://github.com/mahdiporkar/aurevia-super-app
```

Target repository:

```text
https://github.com/mahdiporkar/hive-platform
```

Never modify or push anything to the source repository.

All Hive implementation must exist only in:

```text
mahdiporkar/hive-platform
```

---

# 1. Product Vision

Hive is a:

**Headless, UI-agnostic Enterprise Application Platform**

capable of hosting arbitrary enterprise and public-facing solutions.

Examples include:

```text
University
Banking
Insurance
Healthcare
Government
ERP
CRM
Commerce
Internal Enterprise Portals
Public Websites
Hybrid Public/Private Applications
Future Unknown Business Domains
```

The core architectural rule is:

> Platform owns capabilities.  
> Solution owns business.  
> Consumer owns presentation.

This rule MUST be enforced by architecture and automated tests.

It must not exist only in documentation.

---

# 2. Key Architectural Test

The architecture is successful only if the following statement is true:

> A new team can build an entirely new business application using React + Tailwind, React + Material UI, React + Ant Design, Vue, Angular, Svelte, Web Components, Vanilla JavaScript, or another UI stack; register its modules and services with Hive; use Hive identity, authorization, routing, manifests, workspace, audit, integrations, and runtime capabilities; and upgrade Hive independently without copying or modifying Hive source code.

If this statement is false, continue refactoring.

---

# 3. Critical Non-Negotiable Constraints

Do NOT:

- copy Aurevia Git history;
- rename the source repository;
- blindly copy the full source repository;
- mechanically replace Aurevia → Hive;
- mechanically replace Super App → Hive;
- migrate demo HR data into Hive Core;
- migrate demo Finance data into Hive Core;
- migrate demo Reports data into Hive Core;
- couple Hive Core to React;
- couple Hive Core to React DOM;
- couple Hive Core to Ant Design;
- couple Hive Core to Material UI;
- couple Hive Core to Tailwind;
- assume every Hive consumer uses React;
- assume every route requires authentication;
- assume only one Micro App may be mounted at a time;
- introduce business-domain concepts into Platform Core;
- require a consumer to modify Hive source;
- expose OAuth access tokens to browser JavaScript;
- expose refresh tokens to browser JavaScript;
- expose Legacy credentials to browser JavaScript;
- expose Legacy tokens to browser JavaScript;
- expose Service credentials to browser JavaScript;
- weaken security properties already proven in Aurevia;
- implement placeholders and claim completion;
- disable tests merely to obtain green CI;
- claim success for checks that were never executed;
- stop after architecture analysis;
- stop after documentation;
- stop after scaffolding.

The objective is working software.

---

# 4. Git Safety Gate

Before the first write operation:

```bash
git remote -v
git status
git branch --show-current
```

Verify that:

```text
active target repository = mahdiporkar/hive-platform
```

and:

```text
source repository != target repository
```

No write operation may occur until this invariant is verified.

Never:

```text
push
commit
force-push
rebase remote history
```

against:

```text
mahdiporkar/aurevia-super-app
```

If there is any uncertainty about the current write repository:

**STOP ALL WRITE OPERATIONS.**

Read-only source analysis may continue.

---

# 5. Naming

Product:

```text
Hive
```

Repository:

```text
hive-platform
```

CLI:

```text
hive
```

NPM scope:

```text
@hive-platform/*
```

Java namespace:

```text
io.hiveplatform
```

Examples:

```text
@hive-platform/contracts
@hive-platform/core
@hive-platform/http-client
@hive-platform/auth
@hive-platform/authorization
@hive-platform/mfe-runtime
@hive-platform/workspace
@hive-platform/react
```

Java examples:

```text
io.hiveplatform.bff
io.hiveplatform.authorization
io.hiveplatform.security
```

Docker examples:

```text
hive/bff
hive/authorization
hive/operator-console
hive/default-shell
```

Browser session cookie:

```text
HIVE_SESSION
```

No Hive runtime component may depend on obsolete Aurevia/SuperApp names.

Old source branding is permitted only inside explicitly marked:

```text
migration
reference
historical comparison
```

documentation where required for traceability.

---

# 6. Definition of Hive Core

For this project, **Hive Core** means the mandatory platform runtime required for a clean empty Hive installation.

Hive Core includes:

```text
BFF
Authorization Service
Control Plane persistence
OpenFGA integration
core contracts
identity/session infrastructure
resource catalog
manifest infrastructure
dynamic routing infrastructure
audit infrastructure
runtime context
platform configuration
```

Redis may be part of a deployment when required by enabled functionality.

Hive Core does NOT include:

```text
Operator Console
Default Shell
example consumers
demo MFEs
business services
Superset
Keycloak server itself
business-domain fixtures
development-only environments
E2E fixtures
```

Hive Core must start successfully with zero consumer applications.

---

# 7. Platform Layers

Hive must explicitly separate:

## Platform

Reusable enterprise capabilities.

## Solution

Business-domain implementation.

Examples:

```text
University
Bank
Insurance
Healthcare
```

## Consumer

Presentation and interaction layer.

Examples:

```text
React
Next.js
Angular
Vue
Svelte
Web Components
Vanilla JavaScript
```

The Platform must never depend on Solution or Consumer implementation details.

---

# 8. Domain Leakage Rule

Hive Platform MUST NOT contain business concepts such as:

```text
Student
Professor
Course
BankAccount
Loan
InsurancePolicy
Patient
MedicalRecord
ProductOrder
Invoice
Warehouse
Payroll
EmployeeBusinessProcess
```

except inside explicitly marked:

```text
examples
fixtures
e2e
test data
```

Add automated architecture checks to detect accidental business-domain leakage into Platform Core.

---

# 9. Source Repository Archaeology

Before implementing equivalent Hive capabilities, deeply inspect Aurevia.

At minimum inspect:

```text
apps/
packages/
services/
infra/
tools/
tests/
docs/
pom.xml
package.json
```

Understand the actual implementation of:

```text
BFF
session management
OIDC
dynamic Identity Providers
Token Vault
Redis
Authorization Service
OpenFGA
PostgreSQL control plane
users
roles
groups
OU / LDAP integration
Access Groups
Resource Catalog
Resource Actions
Permission Grants
Manifest import
Manifest Draft
Manifest Diff
Manifest Publish
MFE registry
artifact revisions
dynamic MFE loading
navigation
context API
dynamic proxy routing
Service Targets
Route Operations
Forward Token
Legacy authentication
outbound connections
Superset integration
audit logs
API logs
security policies
SSRF controls
production profiles
Swagger/OpenAPI
tests
E2E verification tools
```

Do not assume source documentation is correct.

Use this precedence:

```text
1. executable implementation
2. DTO/controller/validation/configuration
3. database migrations
4. automated tests
5. canonical architecture documentation
6. old reports
```

---

# 10. Capability Classification

Every discovered Aurevia capability MUST be classified as exactly one of:

## REUSE

Behavior and architecture are proven and suitable.

Migration may preserve most implementation logic while removing branding and unwanted coupling.

## REFACTOR

Behavior is useful and correct, but structure, naming, boundaries, or dependencies must change.

## REWRITE

Capability is required, but the existing implementation is architecturally unsuitable or incorrect.

## DROP

Capability is:

```text
demo-specific
business-specific
obsolete
unsafe
duplicated
not applicable to Hive
```

and must not enter Hive.

## DEFER

Capability is valid but intentionally excluded from the current release milestone.

Create:

```text
docs/migration/source-capability-map.md
```

with columns:

```text
Source Capability
Source Location
Classification
Hive Target
Reason
Status
Tests
Notes
```

Do not migrate capabilities without classification.

---

# 11. Architecture Decision Records

Create:

```text
docs/adr/
```

Use ADRs for significant architectural choices and deviations.

At minimum create:

```text
ADR-001-monorepo-architecture.md
ADR-002-control-plane-runtime-plane.md
ADR-003-authorization-source-of-truth.md
ADR-004-mfe-runtime-contract.md
ADR-005-workspace-runtime.md
ADR-006-workspace-persistence.md
ADR-007-dynamic-routing.md
ADR-008-identity-and-session.md
ADR-009-manifest-versioning.md
ADR-010-framework-neutrality.md
```

Architectural deviations from this specification are allowed only if:

1. the original requirement cannot be cleanly satisfied;
2. the alternative improves correctness, maintainability, or operability;
3. no acceptance criterion is weakened;
4. the decision is recorded in an ADR;
5. corresponding automated tests are added.

---

# 12. Execution Model

Do not attempt the entire project as one uncontrolled implementation pass.

Work through explicit engineering phases.

A phase is NOT complete because:

```text
files exist
code compiles partially
UI appears
documentation exists
implementation "looks correct"
```

A phase is complete only when its required executable acceptance criteria pass.

Mandatory phases:

```text
PHASE 0  Repository Archaeology
PHASE 1  Clean Platform Bootstrap
PHASE 2  Contracts + Architecture Boundaries
PHASE 3  Identity + Session
PHASE 4  Authorization + Resource Catalog
PHASE 5  Manifest Governance
PHASE 6  Dynamic Routing
PHASE 7  MFE Runtime
PHASE 8  Workspace Runtime
PHASE 9  Operator Console
PHASE 10 Public / Hybrid / Authenticated Runtime
PHASE 11 SDK + CLI + Extension Model
PHASE 12 Optional Integrations
PHASE 13 Production Hardening
PHASE 14 End-to-End Validation
PHASE 15 Release Candidate
```

Do not start Phase N+1 until all mandatory acceptance tests for Phase N pass.

An exception is permitted only for a genuine dependency blocker and must be explicitly documented.

---

# 13. Phase Reporting

At the end of every phase report:

```text
Implemented
Reused
Refactored
Rewritten
Dropped
Deferred
Tests Added
Tests Executed
PASS
FAIL
NOT EXECUTED
Open Blockers
Commit SHA
```

Never represent:

```text
implemented
```

as equivalent to:

```text
tested
```

---

# 14. Repository Architecture

Create a clean Monorepo approximately following:

```text
hive-platform/
│
├── apps/
│   ├── operator-console/
│   └── default-shell/
│
├── services/
│   ├── bff/
│   ├── authorization/
│   └── ui-artifact-security/
│
├── packages/
│   ├── contracts/
│   ├── core/
│   ├── http-client/
│   ├── auth/
│   ├── authorization/
│   ├── mfe-runtime/
│   ├── workspace/
│   └── react/
│
├── starters/
│   ├── hive-spring-boot-starter/
│   ├── hive-security-starter/
│   └── hive-audit-starter/
│
├── cli/
│
├── infra/
│   ├── docker-compose/
│   ├── openfga/
│   ├── postgres/
│   ├── redis/
│   └── nginx/
│
├── examples/
│   ├── react-tailwind-consumer/
│   └── minimal-consumer/
│
├── tests/
│   ├── architecture/
│   ├── contracts/
│   ├── integration/
│   └── e2e/
│
├── tools/
├── docs/
│   ├── adr/
│   └── migration/
├── package.json
├── pom.xml
├── README.md
└── CHANGELOG.md
```

Deviation is allowed only when technically justified and recorded in an ADR.

---

# 15. Core Package Rule

`@hive-platform/core` must remain intentionally small.

Do not turn `core` into a generic dumping ground.

Do not place functionality in Core merely because no better package currently exists.

Prefer explicit cohesive packages.

Core must contain only stable platform primitives and orchestration concepts that genuinely belong to the platform kernel.

---

# 16. Contract-First Engineering

Before implementing runtime behavior, define stable versioned contracts.

At minimum define:

```text
HiveContext
PublicHiveContext
HiveIdentity
HiveSession
HiveMicroApp
HiveMountContext
HiveMicroAppInstance
Workspace
WorkspaceSlot
WorkspaceState
WorkspaceEvent
Resource
ResourceAction
ResourceManifest
MicroFrontendManifest
ManifestRevision
AuthorizationDecision
PermissionGrant
ServiceTarget
ProxyRoute
RouteOperation
LegacyAuthenticationConfiguration
FeatureFlag
ExtensionRegistration
PlatformError
RuntimeDiagnostic
```

Implementation code must depend on explicit contracts.

Contracts must not be reverse-engineered from UI components.

---

# 17. Contract Versioning

Relevant contracts must contain explicit versions where appropriate:

```text
contractVersion
schemaVersion
runtimeVersion
manifestVersion
```

Use Semantic Versioning where appropriate.

Compatibility rules must be explicit.

Examples:

```text
unsupported major → reject
compatible minor → accept
unknown future schema → reject safely
missing mandatory version → actionable error
```

Do not silently guess compatibility.

---

# 18. Executable Compatibility Matrix

Create a compatibility matrix.

Example:

```text
Platform   Contracts   Manifest   Runtime
0.1.x      1.x         1.x        1.x
```

The matrix must not exist only in documentation.

Add automated tests covering:

```text
supported combination
unsupported major
newer unsupported schema
missing version
deprecated compatible version
```

Diagnostics must explain the real incompatibility.

Avoid vague errors such as:

```text
Remote container was not registered
```

when the root cause is actually:

```text
network failure
contract mismatch
manifest incompatibility
SRI validation
runtime mismatch
module-format error
```

---

# 19. Headless Platform Requirement

Hive Engine must be UI-agnostic.

The following packages MUST NOT depend on:

```text
React
React DOM
Ant Design
Material UI
Tailwind
Vue
Angular
Svelte
presentation libraries
```

including:

```text
contracts
core
http-client
auth
authorization
mfe-runtime core
workspace core
```

React-specific functionality must live only inside:

```text
@hive-platform/react
```

or explicitly React-specific applications.

Add CI architecture tests preventing forbidden dependencies.

---

# 20. UI Ownership

Hive does not own consumer presentation.

Valid consumers include:

```text
University → React + Tailwind
Bank → React + Material UI
Insurance → Angular + Material
Portal → Next.js + Tailwind
Legacy → Vanilla JavaScript
```

All must be capable of using the same Hive Engine.

Never make this a required Hive concept:

```yaml
ui:
  framework: tailwind
```

Hive should not need to know which component or CSS framework a consumer uses.

---

# 21. Operator Console

Hive provides an official management application:

```text
operator-console
```

React + Ant Design is acceptable here.

Operator Console belongs to the **Control Plane presentation layer**.

It must only be an administrative API client.

Hive must remain fully operable without Operator Console.

Operator Console may manage:

```text
Identity Providers
users
roles
groups
organizational units
access groups
applications
Micro Apps
manifests
resource trees
permissions
grants
Service Targets
Proxy Routes
Route Operations
Legacy Authentication
Forward Token routing
outbound connections
Superset integrations
audit logs
API logs
feature flags
extensions
runtime diagnostics
```

Do not mix:

```text
Platform Administration
```

with:

```text
Business Administration
```

Example:

```text
Platform Operator != University Education Administrator
```

---

# 22. API-Only Administration Acceptance Test

All mandatory platform administration must be possible without Operator Console.

Implement an automated API-driven flow:

```text
create application
→ register MFE
→ import resource manifest
→ publish manifest
→ create role
→ create user or identity binding
→ grant permission
→ create Service Target
→ create Proxy Route
→ create Route Operation
→ verify runtime behavior
```

If this flow depends on the Operator Console UI, the architecture is incorrect.

---

# 23. Identity Architecture

Preserve and generalize proven identity capabilities.

Requirements:

```text
OIDC Authorization Code flow
PKCE where appropriate
dynamic external Identity Providers
Keycloak-compatible
generic OIDC-compatible
tenant/domain/provider routing
canonical Hive user identity
external identity aliases
login synchronization
server-side session
opaque Secure HttpOnly cookie
encrypted server-side Token Vault
refresh lifecycle
logout cleanup
```

LDAP/OU integration must remain optional.

Keycloak must not be hard-coded into Hive Core.

Keycloak may be the default/reference Identity Provider.

---

# 24. Session Security

Browser authentication should use an opaque:

```text
Secure
HttpOnly
SameSite-aware
```

session cookie.

Recommended name:

```text
HIVE_SESSION
```

Browser JavaScript must not receive:

```text
OAuth access token
OAuth refresh token
legacy access token
client secret
service credential
password
```

Mutating cookie-authenticated operations must retain CSRF protection.

---

# 25. Authorization

Preserve the OpenFGA-based model unless source inspection reveals a correctness problem.

Concepts:

```text
Resource
Action
Grant
Role
Group
User
Inheritance
Policy
Obligation
OpenFGA relationship graph
```

PostgreSQL remains the Control Plane source of truth.

OpenFGA remains the runtime authorization graph.

Authorization Service must be the controlled writer of OpenFGA relationships.

Redis may cache short-lived decisions.

Authorization writes must invalidate relevant cache entries.

Default:

```text
DENY
```

UI visibility is never sufficient authorization.

Protected backend operations MUST authorize server-side.

---

# 26. Resource Catalog

Support at minimum:

```text
APPLICATION
MODULE
PAGE
UI_COMPONENT
FIELD
BUSINESS_RESOURCE
EXTERNAL_RESOURCE
API_RESOURCE
DATA_RESOURCE
DATA_GOVERNANCE_RESOURCE
```

Enforce:

```text
parent-child validity
no cycles
ownership boundaries
resource action validity
history preservation
```

Prevent:

```text
cross-application accidental ownership
invalid parent type
destructive history loss
```

Prefer:

```text
deprecate/archive
```

over destructive deletion where historical grants or audit data depend on a resource.

---

# 27. Manifest Architecture

Maintain separate contracts for:

```text
mf-manifest
resource-manifest
```

Do not hard-code React into Manifest contracts.

Manifest lifecycle:

```text
Fetch
Import
Validate
Draft
Diff
Publish
Version
History
Rollback where supported
```

Published revisions must be immutable.

Resource Manifest versions must be immutable.

Retain these definition modes when technically justified:

```text
MANIFEST
MANUAL
HYBRID
```

Navigation overlays must remain independent from authorization resources.

---

# 28. Manifest Acceptance Tests

Test:

```text
valid import
invalid schema
duplicate resource
invalid parent
cycle
draft creation
diff generation
publish
immutable revision
second version
history
rollback where supported
authorization after version change
```

---

# 29. Framework-Neutral Micro App Contract

Micro Apps must not be defined as React components.

Create a framework-neutral lifecycle.

Example:

```ts
interface HiveMicroApp {
  mount(
    element: HTMLElement,
    context: HiveMountContext
  ): Promise<void> | void;

  unmount(): Promise<void> | void;

  update?(
    context: HiveMountContext
  ): Promise<void> | void;
}
```

Support multiple instances of the same Micro App.

Context may include:

```text
moduleKey
instanceId
slotId
route
workspaceContext
permissions
locale
direction
```

React adapter may use:

```text
createRoot()
```

internally.

Core must not know React exists.

---

# 30. Framework-Neutral Proof

Create:

```text
examples/minimal-consumer
```

using plain TypeScript/DOM or an equivalent framework-neutral implementation.

It must implement:

```text
mount
unmount
update
```

and run through the same MFE Runtime contract.

This fixture is mandatory evidence of framework neutrality.

---

# 31. Workspace Runtime

Hive must support multiple simultaneously mounted Micro Apps.

Workspace layout modes:

```text
SINGLE
TABS
SPLIT
DASHBOARD
```

Architect for future:

```text
NEW_WINDOW
POPOUT
```

Conceptually:

```text
Workspace
├── Slot A → Micro App A
├── Slot B → Micro App B
└── Slot C → Micro App C
```

Each slot tracks:

```text
slotId
moduleKey
instanceId
route
state
loading
error
authorization state
```

The same Micro App may exist more than once using different `instanceId` values.

---

# 32. Workspace Engine vs Default Shell

Workspace Engine MUST live in reusable Hive packages.

`default-shell` is only one renderer/client of Workspace Engine.

These capabilities must remain usable without `default-shell`:

```text
workspace model
slot lifecycle
module lifecycle
workspace persistence
workspace events
authorization state
module mounting
layout model
```

Do not implement the real Workspace Engine only inside a React UI component tree.

---

# 33. Inter-Micro-App Communication

Micro Apps must NEVER directly import one another.

Provide a:

```text
Hive Event Bus
Workspace Event API
```

Example:

```text
Student-like MFE
      ↓
student:selected
      ↓
Hive Event Bus
      ↓
Finance-like MFE
```

Requirements:

```text
typed contracts where practical
namespaced events
subscription lifecycle
automatic cleanup
workspace scope
optional application/global scope
no hidden global mutable state
```

Add tests for cross-MFE communication.

---

# 34. Workspace Persistence

Serializable Workspace State should survive browser refresh where appropriate.

Example:

```json
{
  "layout": "SPLIT",
  "panes": [
    {
      "slotId": "left",
      "module": "student-example",
      "route": "/students/123"
    },
    {
      "slotId": "right",
      "module": "finance-example",
      "route": "/students/123/payments"
    }
  ]
}
```

Use safe URL/session persistence.

Do not place sensitive state in URL parameters.

Test restoration after refresh.

---

# 35. UI and CSS Isolation

Multiple simultaneously mounted MFEs may use:

```text
Tailwind
Ant Design
Material UI
CSS Modules
custom CSS
```

Prevent global style leakage.

Document and test where practical:

```text
scoped roots
CSS naming boundaries
Tailwind Preflight risks
global reset restrictions
portal container behavior
z-index conventions
optional Shadow DOM
```

Tailwind-specific behavior must not enter Core.

---

# 36. Public / Hybrid / Authenticated Routes

Support route access modes:

```text
PUBLIC
HYBRID
AUTHENTICATED
```

## PUBLIC

No login required.

Examples:

```text
/
/about
/news
/courses
```

## AUTHENTICATED

Requires a valid session.

Protected behavior additionally requires authorization.

Examples:

```text
/student/profile
/finance
/admin
```

## HYBRID

Can render anonymously but gains authenticated capabilities after login.

Example:

```text
/course/123
```

Anonymous:

```text
view course
```

Authenticated:

```text
enroll
pay
save
```

---

# 37. Public Context

Provide safe anonymous context, for example:

```http
GET /api/public/context
```

It must NEVER leak:

```text
private user identity
protected permissions
OAuth tokens
Legacy tokens
internal Service Targets
credentials
private integrations
secrets
```

It may contain:

```text
branding
locale
direction
public module catalog
public navigation
public feature flags
safe tenant metadata
```

Authenticated context remains separate:

```http
GET /api/me/context
```

---

# 38. Login Return URL

Support safe return flows:

```text
/auth/login?returnUrl=/news/123
```

After successful login return to the original route.

Validate same-origin/local path semantics.

Prevent open redirect vulnerabilities.

---

# 39. API Security for Public Applications

A PUBLIC UI route does NOT make its backend APIs public.

Every Route Operation must declare its access behavior independently.

Example:

```text
GET /api/public/news
anonymous allowed
```

while:

```text
POST /api/admin/news
authenticated + authorized
```

UI declarations must never weaken API authorization.

---

# 40. SEO-Compatible Architecture

Hive must support server-rendered public consumers.

For example:

```text
Next.js + Tailwind public site
+
Hive APIs
+
Hive authenticated portal
```

Hive Core must not require every public screen to be implemented as a client-side MFE.

---

# 41. Dynamic Proxy Routing

Preserve and clean the proven model:

```text
Application / Micro App
→ ProxyRoute
→ ServiceTarget
→ RouteOperation
→ Resource + Action
```

Routes must be configurable dynamically without rebuilding the consumer MFE.

Support multiple routes per Micro App.

Route resolution must be deterministic.

Enforce:

```text
HTTP method validation
path validation
route specificity
longest-prefix behavior where applicable
request size limit
response size limit
timeout
trusted target registry
no browser-supplied arbitrary target URL
no open proxy behavior
```

---

# 42. Backend Authentication Modes

At minimum support:

## FORWARD_TOKEN

Hive forwards the approved current user's bearer token from the server side.

Browser JavaScript must never gain access to the token.

## LEGACY

Hive obtains and caches a server-side Legacy token using registered authentication configuration.

Legacy credentials and tokens must never reach browser JavaScript.

Design the model so future authentication modes can be added cleanly:

```text
NONE
API_KEY
OAUTH2_CLIENT_CREDENTIALS
MTLS
```

Do not create insecure placeholder implementations.

---

# 43. Dynamic Routing E2E

Test both:

```text
FORWARD_TOKEN
LEGACY
```

Full Forward flow:

```text
register Service Target
→ register Proxy Route
→ register Route Operation
→ associate permission
→ login
→ call Hive route
→ verify forwarding
→ verify authorization
→ verify audit
```

Full Legacy flow:

```text
register target
→ register Legacy authentication
→ acquire token server-side
→ cache according to configured lifecycle
→ invoke target
→ verify browser never sees token
→ verify audit
```

---

# 44. Superset

Superset remains an optional external integration.

Hive must start without it.

Support where appropriate:

```text
instance registry
integration registry
asset grants
same-origin authorized tunnel
SSRF protections
TLS
optional mTLS
independent lifecycle
```

No Superset demo data may be required by Hive Core.

---

# 45. Control Plane vs Runtime Plane

Formally separate:

```text
Control Plane
```

from:

```text
Runtime Plane
```

Control Plane includes:

```text
registrations
manifests
permissions
identity configuration
routes
integrations
configuration
audit policy
feature management
```

Runtime Plane includes:

```text
sessions
effective context
authorization checks
MFE runtime
route execution
workspace runtime
```

Document the boundaries.

Avoid runtime code reaching directly into administrative concepts where a versioned runtime representation should exist.

---

# 46. Database Strategy

Hive is a new product.

Do NOT copy the full Aurevia migration history.

Create a clean Flyway baseline.

Example:

```text
V1__hive_platform_baseline.sql
```

Future:

```text
V2__
V3__
...
```

Production baseline must not contain:

```text
HR demo data
Finance demo data
Reports demo data
sample business users
sample business roles
Superset demo assets
demo consumer resources
```

Development and test fixtures must remain separate.

---

# 47. Production Core Zero-Consumer Test

Fresh production Hive must start with:

```text
zero business MFEs
zero business services
zero Superset instances
zero demo resources
zero business roles
zero business permissions
```

The system should represent:

> An empty enterprise platform ready to receive solutions.

---

# 48. SDK Architecture

Provide:

```text
@hive-platform/contracts
@hive-platform/core
@hive-platform/http-client
@hive-platform/auth
@hive-platform/authorization
@hive-platform/mfe-runtime
@hive-platform/workspace
@hive-platform/react
```

`@hive-platform/react` is optional convenience.

A consumer must be able to use Hive Core without installing the React package.

---

# 49. Spring Boot Support

Create reusable Spring support only where real reusable behavior exists.

Potential modules:

```text
hive-spring-boot-starter
hive-security-starter
hive-audit-starter
```

Possible shared concerns:

```text
Correlation ID
ProblemDetail
Hive identity propagation
service authorization
audit
observability
request metadata
```

Never place business-domain code inside these starters.

Do not create empty ceremonial starter packages.

---

# 50. Feature Flags

Provide a generic feature flag system.

Requirements:

```text
environment-aware
potentially tenant-aware
potentially solution-aware
strongly typed where possible
safe defaults
auditable changes where relevant
```

Examples:

```text
workspaceSplitView
publicHybridRoutes
newPermissionEditor
```

Feature flags must not hide permanently broken implementations.

---

# 51. Extension Points

Consumers must extend Hive without modifying Hive source.

Create extension contracts where appropriate:

```text
Header
Navigation
Dashboard
Profile
Notifications
Login Experience
Workspace Actions
Runtime Actions
```

Register extensions through contracts/configuration.

Do not tightly couple consumer components to Hive internals.

---

# 52. Default Shell

Provide:

```text
default-shell
```

as an optional reference implementation.

It may use React.

It should demonstrate:

```text
navigation
single MFE
tabs
split workspace
dashboard
authentication
PUBLIC route
HYBRID route
AUTHENTICATED route
loading state
error isolation
extension slots
workspace restore
```

Consumers must be able to replace it completely.

---

# 53. React + Tailwind Proof Consumer

Create:

```text
examples/react-tailwind-consumer
```

It MUST NOT depend on Ant Design.

Demonstrate:

```text
public page
authenticated page
permission-based action
Hive context
MFE lifecycle
mf-manifest
resource-manifest
workspace mount
Event Bus
dynamic backend route
```

This example is mandatory evidence that Hive does not depend on the Operator Console design system.

---

# 54. CLI

Provide working command:

```bash
hive
```

Mandatory commands:

```bash
hive version
hive validate
hive doctor
hive up
hive down
```

Add where realistically implementable:

```bash
hive create solution
hive add mfe
hive add service
hive add domain
hive upgrade
```

`hive doctor` must execute real diagnostics.

Potential checks:

```text
PostgreSQL
Redis
OpenFGA
Authorization Service
BFF
Identity Provider when configured
Manifest validity
Remote Entry reachability
contract compatibility
runtime compatibility
route configuration
```

Never print PASS for a check that was not executed.

---

# 55. Versioning

Use Semantic Versioning.

Start development at:

```text
0.1.0
```

or another justified prerelease version.

Do not use:

```text
1.0.0
```

until final acceptance criteria are satisfied.

Document:

```text
Platform version
Contracts version
Manifest schema version
MFE lifecycle version
Workspace schema version
```

Avoid hidden breaking changes.

---

# 56. Observability

Provide:

```text
Correlation ID
structured API logging
audit logs
sanitized metadata
health endpoints
readiness endpoints
startup diagnostics
integration diagnostics
runtime diagnostics
```

Never log:

```text
passwords
OAuth access tokens
refresh tokens
legacy tokens
legacy credentials
client secrets
API keys
private keys
```

---

# 57. Security Invariants

Maintain or improve the strongest proven security properties.

Browser:

```text
opaque Secure HttpOnly session cookie
```

Authorization:

```text
server-side enforcement
default DENY
```

Routing:

```text
trusted registered targets only
```

Maintain:

```text
SSRF protections
path traversal protections
CSRF protection
production fail-closed behavior
TLS policies
mTLS where required
safe redirect handling
```

Do not weaken correctness or security merely to simplify development or demo setup.

---

# 58. Demo Isolation

Keep:

```text
production
development
fixtures
e2e
examples
```

strictly separated.

Production Core must never depend on test or demo data.

---

# 59. Platform Roles vs Business Roles

Platform roles may include:

```text
PLATFORM_SUPER_ADMIN
PLATFORM_OPERATOR
SECURITY_ADMIN
INTEGRATION_ADMIN
AUDITOR
```

Business roles may include example concepts such as:

```text
STUDENT
PROFESSOR
FINANCE_EXPERT
```

They may share the same authorization engine, but represent different architectural concerns.

Document the difference clearly.

---

# 60. Testing Strategy

Implement:

## Unit Tests

For Core libraries and services.

## Contract Tests

For:

```text
context
public context
identity
manifest
resource manifest
MFE lifecycle
workspace
event bus
proxy route
route operation
extensions
```

## Integration Tests

For:

```text
PostgreSQL
Redis
OpenFGA
Authorization
BFF
Token Vault
dynamic routing
```

## Architecture Tests

For dependency boundaries and forbidden coupling.

## E2E Tests

For full business-independent runtime flows.

---

# 61. Golden Path E2E — Mandatory

Create one full end-to-end scenario starting from a completely clean Hive installation.

Scenario:

```text
1. Start fresh Hive.

2. Verify zero consumer applications.

3. Create an Application.

4. Register a Micro App.

5. Import its Resource Manifest.

6. Validate Manifest.

7. Publish Manifest.

8. Create a user or synchronize an external identity.

9. Create a role.

10. Assign the role.

11. Grant PAGE:view.

12. Register Service Target.

13. Register Forward Token Proxy Route.

14. Register Route Operation.

15. Login.

16. Retrieve authenticated context.

17. Verify application appears.

18. Verify navigation appears.

19. Mount the Micro App.

20. Invoke backend operation.

21. Verify server-side authorization.

22. Verify audit entry.

23. Verify API log.

24. Open a second Micro App.

25. Verify both coexist.

26. Emit Workspace Event.

27. Verify receiving Micro App handles it.

28. Refresh browser.

29. Verify Workspace restoration.

30. Logout.

31. Verify session invalidation.
```

This E2E must be executable and repeatable.

---

# 62. Additional E2E Scenarios

Implement at minimum:

## E2E 1 — Clean Core

Fresh Hive contains zero business modules.

## E2E 2 — React + Tailwind Consumer

Register and mount the Tailwind MFE.

## E2E 3 — Permission Denial

User without permission:

```text
cannot see protected resource
cannot invoke protected backend operation
```

## E2E 4 — PUBLIC

Anonymous access works.

## E2E 5 — AUTHENTICATED

Anonymous user is safely rejected or redirected.

## E2E 6 — HYBRID

Anonymous and authenticated states behave differently as designed.

## E2E 7 — Multi-MFE Workspace

Mount at least two Micro Apps.

Verify:

```text
independent lifecycle
independent errors
independent authorization
workspace events
```

## E2E 8 — Forward Token

Verify actual server-side forwarding.

## E2E 9 — Legacy Authentication

Verify Legacy token acquisition and token secrecy.

## E2E 10 — Manifest Versioning

```text
import
publish
new version
diff
publish
history
rollback where supported
```

## E2E 11 — Operator Console

Test real administrative flows against real APIs.

## E2E 12 — API-only Administration

Perform management without Operator Console.

## E2E 13 — Workspace Restore

Refresh and restore prior Workspace state.

## E2E 14 — Compatibility Failure

Register an incompatible consumer and verify an actionable error.

---

# 63. Architectural Enforcement

CI must fail when forbidden coupling is introduced.

Examples:

Core packages must fail when they import:

```text
react
react-dom
antd
@mui/*
tailwindcss
vue
angular
```

unless inside explicitly presentation-specific packages/apps.

Java Platform Core must not import Solution/domain modules.

Production schema must not contain demo HR/Finance/Reports entities.

Platform packages must not depend on example consumers.

Workspace Engine must not depend on `default-shell`.

Authorization Service must remain the controlled authorization graph writer.

---

# 64. Branding Cleanup

Perform a final case-insensitive repository scan for obsolete source-product/runtime names.

Examples:

```text
aurevia
Aurevia
AUREVIA
superapp
SuperApp
SUPERAPP
superapp-bff
AUREVIA_SESSION
com.aurevia
@aurevia
aurevia_auth
```

Exceptions are allowed only inside clearly identified migration/reference documentation where the old source name is required for traceability.

Scan:

```text
file content
filenames
directory names
Docker images
environment variables
Java packages
npm scopes
database names
comments
documentation
tests
JSON
YAML
manifests
scripts
CI
```

Do not perform only a blind string replacement.

Review semantic naming as well.

Runtime/product code must contain no obsolete Aurevia/SuperApp identifiers.

---

# 65. Documentation

Create living documentation:

```text
README.md

docs/
  architecture.md
  platform-principles.md
  control-plane-runtime-plane.md
  headless-ui-architecture.md
  contracts.md
  compatibility.md
  mfe-runtime.md
  workspace-runtime.md
  event-bus.md
  public-hybrid-authenticated.md
  authorization.md
  resource-catalog.md
  manifest-governance.md
  dynamic-routing.md
  legacy-authentication.md
  identity.md
  operator-console.md
  consumer-guide.md
  react-tailwind-guide.md
  cli.md
  deployment.md
  observability.md
  security.md
  versioning.md
  extension-points.md
  source-capability-map.md
  adr/
```

Documentation must describe actual implemented behavior.

Do not document functionality that does not exist.

---

# 66. Architecture Diagrams

Use Mermaid where appropriate.

Include professional diagrams for:

```text
platform topology
system context
container/component architecture
Control Plane vs Runtime Plane
identity/login flow
session/token flow
authorization sequence
OpenFGA synchronization
manifest lifecycle
dynamic route execution
Forward Token sequence
Legacy authentication sequence
MFE loading sequence
Workspace lifecycle
Multi-MFE runtime
Event Bus
public/hybrid/private request flows
Superset integration
deployment topology
```

Diagrams must match actual code.

---

# 67. README Positioning

README should position Hive approximately as:

> Hive is a headless, UI-agnostic Enterprise Application Platform for composing secure public, private, and hybrid applications from independently deployable business modules.

Explain that consumers may use:

```text
React
Next.js
Vue
Angular
Svelte
Tailwind
Material UI
Ant Design
custom design systems
Web Components
Vanilla JavaScript
```

without Hive Core depending on those technologies.

---

# 68. CI

Configure GitHub Actions.

Mandatory checks:

```text
npm clean install
TypeScript typecheck
frontend/package tests
Java Maven verify
architecture tests
contract tests
manifest tests
documentation verification
Docker Compose config validation
forbidden-brand scan
forbidden-dependency scan
domain-leakage scan
```

Where practical:

```text
build Docker images
run integration tests
run E2E suite
```

Do not bypass failing tests.

Do not disable tests to make CI green.

---

# 69. Git Workflow

Work in:

```text
mahdiporkar/hive-platform
```

Recommended branch:

```text
platform-v1
```

Use incremental commits.

Examples:

```text
chore: bootstrap hive platform monorepo

docs: map aurevia capabilities to hive architecture

feat: add versioned headless platform contracts

feat: implement identity and session runtime

feat: migrate authorization control plane

feat: add resource catalog

feat: implement manifest governance

feat: add dynamic proxy routing

feat: add framework-neutral mfe runtime

feat: add workspace runtime

feat: add public hybrid authenticated routing

feat: add operator console

feat: add hive cli

test: add golden path platform e2e

test: add enterprise architecture enforcement

docs: add hive architecture and consumer guides
```

Never silently overwrite unrelated remote changes.

Do not force-push unless absolutely necessary and explicitly justified.

---

# 70. No Fake Completion

Allowed execution results are only:

```text
PASS
FAIL
NOT EXECUTED
```

Do not use ambiguous status labels as substitutes, including:

```text
should work
probably works
looks correct
expected to pass
mostly complete
partially validated
implemented but assumed working
```

If a check was not run:

```text
NOT EXECUTED
```

must be reported with the exact reason.

Never state:

```text
all tests passed
```

unless every test being referred to actually ran and passed.

Implementation is not proof.

Compilation is not proof of runtime correctness.

UI rendering is not proof of backend authorization.

Documentation is not proof of implementation.

---

# 71. Mandatory Final Verification

Before declaring project completion, execute and report:

```text
npm build
npm typecheck
npm tests
Maven verify
architecture tests
contract tests
Docker Compose config validation
fresh database startup
Flyway baseline
OpenFGA bootstrap
BFF health
Authorization Service health
runtime health
Golden Path E2E
Forward Token E2E
Legacy E2E
Public route E2E
Hybrid route E2E
Multi-MFE E2E
Workspace restoration E2E
branding scan
forbidden dependency scan
domain leakage scan
```

For each output provide:

```text
PASS
FAIL
NOT EXECUTED
```

plus useful diagnostic evidence.

---

# 72. Final Acceptance Criteria

Hive is acceptable only if:

```text
[ ] Independent target repository exists
[ ] Aurevia Git history was not copied
[ ] Source repository was not modified
[ ] Hive naming is clean
[ ] No obsolete Aurevia/SuperApp runtime identifiers remain
[ ] Clean database baseline exists
[ ] Core starts without consumer applications
[ ] Core starts without Superset
[ ] Core has no React dependency
[ ] Core has no React DOM dependency
[ ] Core has no AntD dependency
[ ] Core has no MUI dependency
[ ] Core has no Tailwind dependency
[ ] Core has no business-domain dependency
[ ] Contracts are explicitly versioned
[ ] Compatibility tests exist
[ ] Tailwind consumer works
[ ] Framework-neutral consumer works
[ ] Dynamic MFE registration works
[ ] Resource Manifest works
[ ] Draft/Diff/Publish works
[ ] Manifest revisions are immutable
[ ] User/Role/Group authorization works
[ ] OpenFGA works
[ ] Authorization is enforced server-side
[ ] Dynamic Forward Token routing works
[ ] Dynamic Legacy authentication works
[ ] Browser receives no protected tokens
[ ] PUBLIC route works anonymously
[ ] AUTHENTICATED route is protected
[ ] HYBRID route works in both states
[ ] Public context leaks no private data
[ ] Multiple MFEs run simultaneously
[ ] Workspace SINGLE works
[ ] Workspace TABS works
[ ] Workspace SPLIT works
[ ] Workspace DASHBOARD architecture works
[ ] Event Bus works
[ ] Workspace state restoration works
[ ] MFE failures are isolated
[ ] CSS isolation strategy exists
[ ] Operator Console works
[ ] API-only administration works
[ ] Consumer can replace Operator Console
[ ] Consumer can replace Default Shell
[ ] Workspace Engine works independently of Default Shell
[ ] Superset remains optional
[ ] Audit works
[ ] API logs work
[ ] Production Core contains no business demo data
[ ] CLI validate works
[ ] CLI doctor performs real checks
[ ] Golden Path E2E passes
[ ] CI passes
[ ] Documentation matches implementation
[ ] ADRs match major architectural decisions
```

---

# 73. Generic University-Like Architectural Proof

Do NOT implement actual university business logic inside Hive.

Use a generic architectural fixture proving a future Solution can look like:

```text
Consumer Solution
│
├── public-web
│   └── Next.js + Tailwind possible
│
├── custom-shell
│   └── React + Tailwind possible
│
├── student-like MFE
│   └── independently deployable
│
├── finance-like MFE
│   └── different UI implementation possible
│
└── business services
```

Prove that:

```text
student-like MFE
```

and:

```text
finance-like MFE
```

can appear simultaneously.

Hive must understand only Platform abstractions such as:

```text
application
module
route
resource
action
manifest
workspace
identity
authorization
integration
```

Hive must not understand their business implementation or CSS/component library.

---

# 74. Execution Instructions

Do not return only a plan.

Execute the project phase-by-phase.

For every phase:

```text
1. Inspect the relevant Aurevia implementation.

2. Record discovered source behavior.

3. Classify capabilities:
   REUSE / REFACTOR / REWRITE / DROP / DEFER.

4. Define or update Hive contracts.

5. Design the Hive architecture.

6. Add or update ADR when required.

7. Implement.

8. Migrate only reusable behavior.

9. Remove obsolete source branding.

10. Add automated tests.

11. Execute tests.

12. Fix failures.

13. Re-run tests.

14. Update documentation.

15. Verify phase acceptance criteria.

16. Commit.

17. Record commit SHA.
```

Do not ask for confirmation between ordinary implementation phases.

Make reasonable architectural decisions within this specification.

If Aurevia has a stronger proven implementation than a generic rewrite:

```text
preserve the proven behavior
```

while removing:

```text
branding
business coupling
architectural coupling
obsolete assumptions
```

If Aurevia contains a bug or architectural problem:

```text
do not reproduce it
```

Fix it and document the deviation.

Do not weaken acceptance criteria merely because an implementation is difficult.

---

# 75. Final Delivery

At the end:

1. Push the completed branch to:

```text
mahdiporkar/hive-platform
```

2. Provide:

```text
branch name
final commit SHA
PR URL if created
Hive version
```

3. Provide exact test summary.

Example:

```text
npm build                         PASS
npm typecheck                     PASS
npm tests                         PASS
Maven verify                      PASS
architecture tests               PASS
contract tests                   PASS
Docker Compose config             PASS
fresh DB bootstrap                PASS
OpenFGA bootstrap                 PASS
Golden Path E2E                   PASS
Forward Token E2E                 PASS
Legacy E2E                        PASS
Multi-MFE E2E                     PASS
Workspace restore E2E             PASS
branding scan                     PASS
domain leakage scan               PASS
```

4. Provide unresolved issues.

5. Provide the resulting repository tree.

6. Provide a capability matrix:

```text
Capability
Source State
Hive Classification
Hive Implementation
Tests
Status
```

7. Provide ADR summary.

8. Provide compatibility matrix.

9. Provide deferred work.

10. Provide dropped Aurevia capabilities and reasons.

11. Clearly distinguish:

```text
COMPLETE
DEFERRED
FAILED
NOT EXECUTED
```

capabilities.

---

# 76. Ultimate Objective

The objective is NOT to duplicate Aurevia.

The objective is NOT to rename an existing Super App.

The objective is NOT to create another fixed enterprise portal.

The objective is to transform proven capabilities from Aurevia into a:

**clean, reusable, headless, UI-agnostic, secure, extensible, versioned, independently upgradeable Enterprise Application Platform.**

Hive must remain independent from:

- business domains;
- consumer UI frameworks;
- a specific shell implementation;
- a specific administration UI;
- a specific Identity Provider;
- optional external systems such as Superset.

The final system must deserve the name:

# Hive Enterprise Application Platform