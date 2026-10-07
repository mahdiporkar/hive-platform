export type Version = `${number}.${number}.${number}`;
export type AccessMode = 'PUBLIC' | 'HYBRID' | 'AUTHENTICATED';
export type Json = null | boolean | number | string | readonly Json[] | {readonly [key:string]:Json};
export interface PlatformError {code:string; message:string; correlationId?:string; details?:Readonly<Record<string,Json>>}
export interface RuntimeDiagnostic extends PlatformError {severity:'ERROR'|'WARNING'|'INFO'; component:string; instanceId?:string}
export interface HiveIdentity {id:string; displayName:string; issuer:string; subject:string}
export interface HiveSession {identity:HiveIdentity; expiresAt:string; authenticationTime:string}
export interface FeatureFlag {key:string; enabled:boolean}
export interface PublicModule {moduleKey:string; routes:readonly PublicRoute[]}
export interface PublicRoute {key:string; path:string; access:'PUBLIC'|'HYBRID'}
export interface PublicHiveContext {
 contractVersion:Version; locale:string; direction:'ltr'|'rtl';
 branding:{name:string}; modules:readonly PublicModule[]; features:readonly FeatureFlag[];
}
export interface HiveContext {
 contractVersion:Version; identity:HiveIdentity; session:HiveSession;
 locale:string; direction:'ltr'|'rtl'; modules:readonly MicroFrontendManifest[];
 permissions:Readonly<Record<string,readonly string[]>>; features:readonly FeatureFlag[];
}
export interface AuthorizationDecision {allowed:boolean; resource:string; action:string; reason:string; evaluatedAt:string}
export type ResourceType = 'APPLICATION'|'MODULE'|'PAGE'|'UI_COMPONENT'|'FIELD'|'BUSINESS_RESOURCE'|'EXTERNAL_RESOURCE'|'API_RESOURCE'|'DATA_RESOURCE'|'DATA_GOVERNANCE_RESOURCE';
export interface ResourceAction {key:string; description?:string}
export interface Resource {key:string; applicationKey:string; type:ResourceType; parentKey:string|null; name:string; actions:readonly ResourceAction[]; archived:boolean}
export interface PermissionGrant {id:string; subject:{type:'USER'|'ROLE'|'GROUP';id:string}; resource:string; action:string; revision:number}
export interface ResourceManifest {schemaVersion:Version; manifestVersion:Version; applicationKey:string; moduleKey:string; resources:readonly Resource[]}
export interface ManifestRevision {id:string; version:Version; checksum:string; status:'DRAFT'|'PUBLISHED'; createdAt:string; publishedAt?:string}
export interface MicroFrontendManifest {
 schemaVersion:Version; manifestVersion:Version; contractVersion:Version; runtimeVersion:Version;
 moduleKey:string; applicationKey:string;
 artifact:{url:string; integrity:string; format:'ES_MODULE'};
 routes:readonly {key:string; path:string; access:AccessMode; resource?:string; action?:string}[];
}
export interface EventPort {
 publish(event:WorkspaceEvent):void;
 subscribe(name:string, listener:(event:WorkspaceEvent)=>void):()=>void;
}
export interface HiveMountContext {
 contractVersion:Version; moduleKey:string; instanceId:string; slotId:string; route:string;
 locale:string; direction:'ltr'|'rtl'; context:PublicHiveContext|HiveContext;
 events:EventPort; signal:AbortSignal;
}
export interface HiveMicroAppInstance {
 mount(element:HTMLElement, context:HiveMountContext):void|Promise<void>;
 unmount():void|Promise<void>;
 update?(context:HiveMountContext):void|Promise<void>;
}
/** Every create call must return an independent instance, even for the same module. */
export interface HiveMicroApp {contractVersion:Version; create():HiveMicroAppInstance}
export type WorkspaceLayout = 'SINGLE'|'TABS'|'SPLIT'|'DASHBOARD';
export interface WorkspaceSlot {
 slotId:string; moduleKey:string; instanceId:string; route:string;
 state:Json; loading:boolean; error:RuntimeDiagnostic|null;
 authorization:'UNKNOWN'|'ALLOWED'|'DENIED';
}
export interface Workspace {id:string; layout:WorkspaceLayout; slots:readonly WorkspaceSlot[]; activeSlotId:string|null}
/** Persistence contains routing descriptors, never arbitrary Micro App state or identity. */
export interface WorkspaceState {schemaVersion:Version; layout:WorkspaceLayout; activeSlotId:string|null; slots:readonly Pick<WorkspaceSlot,'slotId'|'moduleKey'|'instanceId'|'route'>[]}
export interface WorkspaceEvent {name:string; workspaceId:string; sourceInstanceId:string; payload:Json}
/** Control-plane-only descriptor. Never include service targets in public context. */
export interface ServiceTarget {id:string; origin:string; connectTimeoutMs:number; responseTimeoutMs:number; maxRequestBytes:number; maxResponseBytes:number; revision:number}
export interface ProxyRoute {id:string; moduleKey:string; prefix:string; serviceTargetId:string; authentication:'FORWARD_TOKEN'|'LEGACY'; revision:number}
export interface RouteOperation {id:string; routeId:string; method:'GET'|'HEAD'|'POST'|'PUT'|'PATCH'|'DELETE'|'OPTIONS'; pattern:string; access:AccessMode; resource?:string; action?:string}
export interface LegacyAuthenticationConfiguration {id:string; connectionId:string; secretReference:string; tokenEndpointPath:string; tokenPointer:string; expiresInPointer:string; expirySkewSeconds:number}
export interface ExtensionRegistration {key:string; version:Version; contractVersion:Version; capabilities:readonly string[]}
export {checkCompatibility, CompatibilityError, compatibilityMatrix, compareVersions, parseVersion} from './version.js';