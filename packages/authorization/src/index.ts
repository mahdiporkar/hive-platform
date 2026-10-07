/**
 * @hive-platform/authorization — permission helpers over a Hive context. These answers drive UI affordances only:
 * every protected backend operation is authorized again by the server (route operations, admin APIs).
 */
import type {AnyHiveContext, RuntimeModule, RuntimeRoute} from '@hive-platform/contracts';

export type RouteAccess = 'ALLOWED'|'LOGIN_REQUIRED'|'DENIED';

export interface PermissionSet {
 can(applicationKey:string, resourceKey:string, action:string):boolean;
 actions(applicationKey:string, resourceKey:string):readonly string[];
}

export function permissionsOf(context:AnyHiveContext):PermissionSet {
 const map=context.authenticated?context.permissions:{};
 const actions=(application:string, resource:string)=>map[`${application}:${resource}`]??[];
 return {
  actions,
  can:(application,resource,action)=>{const held=actions(application,resource);return held.includes(action)||held.includes('manage');},
 };
}

/** Whether a route may be opened in this context (servers re-check every operation the route triggers). */
export function routeAccess(route:RuntimeRoute, module:Pick<RuntimeModule,'applicationKey'>, context:AnyHiveContext):RouteAccess {
 if(route.access==='PUBLIC'||route.access==='HYBRID')return 'ALLOWED';
 if(!context.authenticated)return 'LOGIN_REQUIRED';
 if(!route.resource||!route.action)return 'ALLOWED';
 return permissionsOf(context).can(module.applicationKey,route.resource,route.action)?'ALLOWED':'DENIED';
}

/** Permission view scoped to one application, as handed to a mounted micro-app. */
export function scopedPermissions(context:AnyHiveContext, applicationKey:string):{can(resourceKey:string, action:string):boolean} {
 const set=permissionsOf(context);
 return {can:(resource,action)=>set.can(applicationKey,resource,action)};
}
