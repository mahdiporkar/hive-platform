/**
 * Versioned, framework-neutral Hive contracts. Nothing here depends on a UI framework; the HiveMicroApp lifecycle only
 * needs a DOM element. Server-produced shapes mirror services/bff and services/authorization responses.
 */
export type Version = `${number}.${number}.${number}`;
export type AccessMode = 'PUBLIC' | 'HYBRID' | 'AUTHENTICATED';
export type Direction = 'ltr' | 'rtl';
export type Json = null | boolean | number | string | readonly Json[] | {readonly [key:string]:Json};

// ---- errors and diagnostics ------------------------------------------------------------------------------------

/** Error body of every Hive API. */
export interface PlatformError {code:string; message:string; correlationId?:string; details?:Readonly<Record<string,Json>>}
export interface RuntimeDiagnostic extends PlatformError {severity:'ERROR'|'WARNING'|'INFO'; component:string; moduleKey?:string; instanceId?:string}

// ---- identity and context --------------------------------------------------------------------------------------

/** Token-free canonical identity. Never contains credentials. */
export interface HiveIdentity {id:string; tenantId:string; displayName:string; issuer:string; subject:string}
export interface HiveSession {expiresAt:string}
export interface FeatureFlag {key:string; enabled:boolean}
export interface Branding {name:string}
export interface RuntimeApplication {key:string; displayName:string}
export interface RouteNavigation {label:string; order?:number; icon?:string}
export interface RuntimeRoute {key:string; path:string; access:AccessMode; resource?:string; action?:string; navigation?:RouteNavigation}
export interface ArtifactDescriptor {url:string; integrity:string; format:'ES_MODULE'}
/** A published, active module as delivered to consumers (runtime representation of a MicroFrontendManifest). */
export interface RuntimeModule {
 applicationKey:string; moduleKey:string; displayName:string;
 schemaVersion:Version; manifestVersion:Version; contractVersion:Version; runtimeVersion:Version;
 artifact:ArtifactDescriptor; styleIsolation:'SCOPED'|'SHADOW_DOM'; routes:readonly RuntimeRoute[];
}
interface ContextBase {
 contractVersion:Version; locale:string; direction:Direction; branding:Branding; revision:number;
 applications:readonly RuntimeApplication[]; modules:readonly RuntimeModule[]; features:readonly FeatureFlag[];
}
/** Anonymous context: public modules and navigation only — no identity, permissions, targets or secrets. */
export interface PublicHiveContext extends ContextBase {authenticated:false}
/** Authenticated context. `permissions` keys are `applicationKey:resourceKey`; UI hints only, servers re-authorize. */
export interface HiveContext extends ContextBase {
 authenticated:true; identity:HiveIdentity; session:HiveSession;
 permissions:Readonly<Record<string,readonly string[]>>; platformRoles:readonly PlatformRole[];
}
export type AnyHiveContext = PublicHiveContext | HiveContext;
export type PlatformRole = 'SUPER_ADMIN'|'OPERATOR'|'SECURITY_ADMIN'|'INTEGRATION_ADMIN'|'AUDITOR';

// ---- authorization and catalog ---------------------------------------------------------------------------------

export type ResourceType = 'APPLICATION'|'MODULE'|'PAGE'|'UI_COMPONENT'|'FIELD'|'BUSINESS_RESOURCE'|'EXTERNAL_RESOURCE'|'API_RESOURCE'|'DATA_RESOURCE'|'DATA_GOVERNANCE_RESOURCE';
export interface ResourceAction {key:string; description?:string; archived?:boolean}
export interface Resource {key:string; applicationKey:string; type:ResourceType; parentKey:string|null; displayName:string; actions:readonly ResourceAction[]; archived:boolean; origin?:'SYSTEM'|'MANIFEST'|'MANUAL'; ownerModuleKey?:string}
export type DenyReason = 'USER_UNKNOWN_OR_INACTIVE'|'RESOURCE_UNKNOWN'|'RESOURCE_ARCHIVED'|'ACTION_UNDECLARED'|'NO_RELATIONSHIP'|'GRAPH_UNAVAILABLE';
export interface AuthorizationDecision {applicationKey:string; resourceKey:string; action:string; allowed:boolean; reason:'ALLOWED'|DenyReason}
export interface PermissionGrant {id:string; subject:`user:${string}`|`group:${string}`|`role:${string}`; applicationKey:string; resourceKey:string; action:string; createdBy:string; createdAt:string; revokedAt?:string}

// ---- manifests -------------------------------------------------------------------------------------------------

export interface ResourceManifestEntry {key:string; type:Exclude<ResourceType,'APPLICATION'>; parentKey:string; name:string; actions?:readonly (string|ResourceAction)[]}
/** Authorization vocabulary of one module. Must not contain frontend fields. */
export interface ResourceManifest {schemaVersion:Version; manifestVersion:Version; applicationKey:string; moduleKey:string; resources:readonly ResourceManifestEntry[]}
export interface ManifestRoute {key:string; path:string; access:AccessMode; resource?:string; action?:string; navigation?:RouteNavigation}
/** Executable artifact and routes of one module. Must not contain authorization fields. */
export interface MicroFrontendManifest {
 schemaVersion:Version; manifestVersion:Version; contractVersion:Version; runtimeVersion:Version;
 applicationKey:string; moduleKey:string; displayName:string; resourceManifestVersion?:Version;
 artifact:ArtifactDescriptor; styleIsolation?:'SCOPED'|'SHADOW_DOM'; routes:readonly ManifestRoute[];
}
export interface ManifestRevision {id:string; moduleKey:string; manifestVersion:Version; schemaVersion:Version; checksum:string; status:'DRAFT'|'PUBLISHED'; active:boolean; createdAt:string; publishedAt?:string}

// ---- micro-app lifecycle ---------------------------------------------------------------------------------------

export interface HiveEventEnvelope<T extends Json = Json> {name:string; payload:T; sourceInstanceId:string; workspaceId:string; scope:'WORKSPACE'|'APPLICATION'|'GLOBAL'; sentAt:string}
/** Event port handed to each instance; subscriptions are released automatically when the instance unmounts. */
export interface EventPort {
 publish<T extends Json>(name:string, payload:T, options?:{scope?:'WORKSPACE'|'APPLICATION'|'GLOBAL'}):void;
 subscribe<T extends Json>(name:string, listener:(event:HiveEventEnvelope<T>)=>void):()=>void;
}
export interface HiveMountContext {
 contractVersion:Version; moduleKey:string; applicationKey:string; instanceId:string; slotId:string;
 route:string; params:Readonly<Record<string,string>>; locale:string; direction:Direction;
 context:AnyHiveContext; permissions:{can(resourceKey:string, action:string):boolean};
 events:EventPort; signal:AbortSignal; basePath:string;
 /** Navigate the hosting workspace slot; hosts may ignore requests outside the module's routes. */
 navigate(route:string):void;
}
export interface HiveMicroAppInstance {
 mount(element:HTMLElement, context:HiveMountContext):void|Promise<void>;
 unmount():void|Promise<void>;
 update?(context:HiveMountContext):void|Promise<void>;
}
/** Default export of an ES_MODULE artifact. Every create() call must return an independent instance. */
export interface HiveMicroApp {contractVersion:Version; create():HiveMicroAppInstance}

// ---- workspace -------------------------------------------------------------------------------------------------

export type WorkspaceLayout = 'SINGLE'|'TABS'|'SPLIT'|'DASHBOARD';
export type SlotStatus = 'IDLE'|'LOADING'|'MOUNTED'|'ERROR'|'DENIED'|'LOGIN_REQUIRED';
export interface WorkspaceSlot {
 slotId:string; moduleKey:string; instanceId:string; route:string; status:SlotStatus;
 loading:boolean; error:RuntimeDiagnostic|null; authorization:'UNKNOWN'|'ALLOWED'|'DENIED'|'LOGIN_REQUIRED';
}
export interface Workspace {id:string; layout:WorkspaceLayout; slots:readonly WorkspaceSlot[]; activeSlotId:string|null}
/** Persisted descriptor: module keys and routes only — never module state, identity or tokens. */
export interface WorkspaceState {schemaVersion:Version; layout:WorkspaceLayout; activeSlotId:string|null; slots:readonly Pick<WorkspaceSlot,'slotId'|'moduleKey'|'instanceId'|'route'>[]}
export interface WorkspaceEvent {type:'SLOT_OPENED'|'SLOT_CLOSED'|'SLOT_STATUS'|'LAYOUT_CHANGED'|'ACTIVE_CHANGED'|'ROUTE_CHANGED'; workspaceId:string; slotId?:string; detail?:Json}

// ---- routing (control plane descriptors) ----------------------------------------------------------------------

export interface ServiceTarget {key:string; displayName:string; baseUrl:string; connectTimeoutMs:number; responseTimeoutMs:number; maxRequestBytes:number; maxResponseBytes:number; archived:boolean; revision:number}
export type RouteAuthentication = 'NONE'|'FORWARD_TOKEN'|'LEGACY';
export interface ProxyRoute {key:string; applicationKey:string; moduleKey?:string; pathPrefix:string; targetKey:string; authentication:RouteAuthentication; legacyProfileKey?:string; upstreamBasePath:string; stripPrefix:boolean; priority:number; archived:boolean; revision:number}
export interface RouteOperation {key:string; routeKey:string; method:'GET'|'HEAD'|'POST'|'PUT'|'PATCH'|'DELETE'; pathPattern:string; access:AccessMode; resourceKey?:string; action?:string; archived:boolean; revision:number}
/** Holds a secret *reference* only (env:HIVE_SECRET_* or file:*); credentials never appear in contracts. */
export interface LegacyAuthenticationConfiguration {key:string; targetKey:string; tokenEndpointPath:string; requestFormat:'JSON'|'FORM_URLENCODED'|'HTTP_BASIC'|'OAUTH_CLIENT_CREDENTIALS'; credentialReference:string; tokenPointer:string; expiresInPointer:string; tokenTypePointer?:string; scheme:string; expirySkewSeconds:number; revision:number}

// ---- extensions ------------------------------------------------------------------------------------------------

export type ExtensionPoint = 'HEADER'|'NAVIGATION'|'DASHBOARD'|'PROFILE'|'NOTIFICATIONS'|'LOGIN_EXPERIENCE'|'WORKSPACE_ACTIONS'|'RUNTIME_ACTIONS';
/** Consumer-provided extension. `render` receives a DOM element; frameworks are an implementation detail of the extension. */
export interface ExtensionRegistration {
 key:string; point:ExtensionPoint; version:Version; contractVersion:Version; order?:number;
 /** Shown only when every listed `applicationKey:resourceKey:action` permission is held (UI hint). */
 requires?:readonly string[];
 render(element:HTMLElement, context:AnyHiveContext):void|(()=>void);
}

export {checkCompatibility, CompatibilityError, compatibilityMatrix, compareVersions, parseVersion} from './version.js';
