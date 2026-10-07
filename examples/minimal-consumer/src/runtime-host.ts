/**
 * A plain-DOM host that uses only the MFE runtime: resolves the current URL to a module route, enforces the UI hint
 * for access (servers re-check every operation), mounts/updates/unmounts the module and shows runtime diagnostics.
 * No framework, no Hive shell.
 */
import type {AnyHiveContext, RuntimeModule, RuntimeRoute} from '@hive-platform/contracts';
import {createAuth} from '@hive-platform/auth';
import {routeAccess, scopedPermissions} from '@hive-platform/authorization';
import {matchRoute, routeSpecificity, toDiagnostic} from '@hive-platform/core';
import {createHttpClient} from '@hive-platform/http-client';
import {MfeRuntime, type MountedInstance} from '@hive-platform/mfe-runtime';

const http=createHttpClient();
const auth=createAuth(http);
const diagnostics:unknown[]=[];
const runtime=new MfeRuntime({onDiagnostic:d=>diagnostics.push(d)});
const slot=document.getElementById('slot')!, nav=document.getElementById('nav')!, status=document.getElementById('status')!, user=document.getElementById('user')!;
let context:AnyHiveContext, mounted:{instance:MountedInstance;module:RuntimeModule}|null=null, sequence=0;

const noEvents={publish(){},subscribe:()=>()=>{}};

function resolve(path:string):{module:RuntimeModule;route:RuntimeRoute;params:Record<string,string>}|null {
 const matches=context.modules.flatMap(module=>module.routes.map(route=>({module,route,params:matchRoute(route.path,path)})))
  .filter((m):m is {module:RuntimeModule;route:RuntimeRoute;params:Record<string,string>}=>m.params!==null)
  .sort((a,b)=>routeSpecificity(b.route.path)-routeSpecificity(a.route.path));
 return matches[0]??null;
}

async function show(path:string):Promise<void> {
 const target=resolve(path);
 status.removeAttribute('data-hive-error');
 // Protected routes are not disclosed to anonymous visitors, so an unknown path means "sign in" for them and "not found" otherwise.
 if(!target){await unmount();const anonymous=!context.authenticated;status.textContent=anonymous?'Sign in to continue':`No module serves ${path}`;status.setAttribute('data-hive-state',anonymous?'LOGIN_REQUIRED':'NOT_FOUND');return;}
 const access=routeAccess(target.route,target.module,context);
 if(access!=='ALLOWED'){await unmount();status.textContent=access==='LOGIN_REQUIRED'?'Sign in to open this page':'You are not permitted to open this page';status.setAttribute('data-hive-state',access);return;}
 const input={instanceId:mounted?.module.moduleKey===target.module.moduleKey?mounted.instance.instanceId:`i${++sequence}`,slotId:'main',route:path,params:target.params,
  locale:context.locale,direction:context.direction,context,permissions:scopedPermissions(context,target.module.applicationKey),events:noEvents,basePath:'/',navigate:(to:string)=>go(to)};
 try{
  if(mounted&&mounted.module.moduleKey===target.module.moduleKey){await mounted.instance.update(input);}
  else{await unmount();mounted={instance:await runtime.mount(slot,target.module,input),module:target.module};}
  status.textContent=`${target.module.moduleKey} · ${target.route.key}`;status.setAttribute('data-hive-state','MOUNTED');
 }catch(error){
  const diagnostic=toDiagnostic(error,'MOUNT_FAILED','host');diagnostics.push(diagnostic);
  status.textContent=`${diagnostic.code}: ${diagnostic.message}`;status.setAttribute('data-hive-state','ERROR');status.setAttribute('data-hive-error',diagnostic.code);
 }
}

async function unmount():Promise<void> {if(mounted){const current=mounted;mounted=null;await current.instance.unmount();}}

function go(path:string):void {history.pushState(null,'',path);void show(path);}

function renderChrome():void {
 nav.replaceChildren(...context.modules.flatMap(module=>module.routes.filter(r=>r.navigation).map(route=>{
  const link=document.createElement('a');link.href=route.path;link.textContent=route.navigation!.label;link.setAttribute('data-route',`${module.moduleKey}:${route.key}`);
  link.addEventListener('click',event=>{event.preventDefault();go(route.path);});return link;
 })));
 const button=document.createElement('button');
 if(context.authenticated){user.textContent=context.identity.displayName+' ';button.textContent='Sign out';button.onclick=async()=>{await auth.logout();location.assign('/');};}
 else{user.textContent='';button.textContent='Sign in';button.onclick=()=>auth.login(location.pathname);}
 button.setAttribute('data-testid','auth-button');user.appendChild(button);
}

async function start():Promise<void> {
 context=await auth.currentContext();
 renderChrome();
 addEventListener('popstate',()=>void show(location.pathname));
 await show(location.pathname);
}

Object.assign(window,{hiveHost:{diagnostics,go,unmount,get mounted(){return mounted?{moduleKey:mounted.module.moduleKey,instanceId:mounted.instance.instanceId}:null;},get context(){return context;}}});
start().catch(error=>{status.textContent=String(error);status.setAttribute('data-hive-error','HOST_START_FAILED');});
