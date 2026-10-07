/**
 * @hive-platform/core — the small, stable kernel shared by Hive's headless packages. Deliberately limited to primitives
 * that every runtime piece needs; feature logic lives in its own package.
 */
import type {AnyHiveContext, ExtensionPoint, ExtensionRegistration, RuntimeDiagnostic} from '@hive-platform/contracts';
import {parseVersion} from '@hive-platform/contracts';

export const RUNTIME_VERSION = '1.0.0' as const;

// ---- diagnostics -----------------------------------------------------------------------------------------------

export class HiveRuntimeError extends Error {
 constructor(public readonly diagnostic:RuntimeDiagnostic, options?:{cause?:unknown}) {super(diagnostic.message, options);this.name='HiveRuntimeError';}
}

export function diagnostic(code:string, message:string, component:string, extra:Partial<RuntimeDiagnostic>={}):RuntimeDiagnostic {
 return {code, message, component, severity:'ERROR', ...extra};
}

export function toDiagnostic(error:unknown, fallbackCode:string, component:string, extra:Partial<RuntimeDiagnostic>={}):RuntimeDiagnostic {
 if(error instanceof HiveRuntimeError)return {...error.diagnostic, ...extra};
 const candidate=error as {diagnostic?:RuntimeDiagnostic};
 if(candidate?.diagnostic?.code)return {...candidate.diagnostic, ...extra};
 return diagnostic(fallbackCode, error instanceof Error?error.message:String(error), component, extra);
}

// ---- observable values -----------------------------------------------------------------------------------------

/** Minimal observable value; listeners are isolated from each other's failures. */
export class Signal<T> {
 private listeners=new Set<(value:T)=>void>();
 constructor(private current:T) {}
 get():T {return this.current;}
 set(value:T):void {
  if(Object.is(value,this.current))return;
  this.current=value;
  for(const listener of [...this.listeners]){try{listener(value);}catch(error){reportListenerError(error);}}
 }
 subscribe(listener:(value:T)=>void):()=>void {this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}
}

let reportListenerError:(error:unknown)=>void=error=>{console.error('[hive] listener failed',error);};
export function onListenerError(handler:(error:unknown)=>void):void {reportListenerError=handler;}

// ---- lifetimes -------------------------------------------------------------------------------------------------

/** Collects cleanup callbacks; dispose() runs them once, in reverse order, and reports every failure. */
export class Lifetime {
 private disposers:(()=>unknown)[]=[];
 private disposed=false;
 readonly controller=new AbortController();
 get signal():AbortSignal {return this.controller.signal;}
 get isDisposed():boolean {return this.disposed;}
 add(disposer:()=>unknown):()=>void {
  if(this.disposed){void Promise.resolve().then(disposer);return ()=>{};}
  this.disposers.push(disposer);
  return ()=>{this.disposers=this.disposers.filter(d=>d!==disposer);};
 }
 async dispose():Promise<unknown[]> {
  if(this.disposed)return [];
  this.disposed=true;this.controller.abort();
  const failures:unknown[]=[];
  for(const disposer of this.disposers.reverse()){try{await disposer();}catch(error){failures.push(error);}}
  this.disposers=[];
  return failures;
 }
}

// ---- route matching --------------------------------------------------------------------------------------------

/**
 * Matches manifest route paths: literal segments, `:param` segments and an optional trailing `/*`.
 * Returns decoded params (with `*` holding the remainder) or null.
 */
export function matchRoute(pattern:string, path:string):Record<string,string>|null {
 const clean=(value:string)=>value.split('?')[0]!.split('#')[0]!.replace(/\/+$/,'')||'/';
 const expected=clean(pattern).split('/').filter(Boolean), actual=clean(path).split('/').filter(Boolean);
 const params:Record<string,string>={};
 for(let i=0;i<expected.length;i++){
  const segment=expected[i]!;
  if(segment==='*'&&i===expected.length-1){params['*']=actual.slice(i).map(safeDecode).join('/');return params;}
  const value=actual[i];
  if(value===undefined)return null;
  if(segment.startsWith(':'))params[segment.slice(1)]=safeDecode(value);
  else if(segment!==value)return null;
 }
 return actual.length===expected.length?params:null;
}

/** Specificity used to choose between matching routes: literals beat params beat wildcards. */
export function routeSpecificity(pattern:string):number {
 return pattern.split('/').filter(Boolean).reduce((score,s)=>score+(s==='*'?0:s.startsWith(':')?1:10),0);
}

function safeDecode(value:string):string {try{return decodeURIComponent(value);}catch{return value;}}

// ---- extension registry ----------------------------------------------------------------------------------------

/**
 * Consumers extend Hive surfaces (header, navigation, dashboard, ...) by registering framework-neutral extensions;
 * no Hive source changes. Registration validates the contract major; rendering isolates failures per extension.
 */
export class ExtensionRegistry {
 private readonly extensions=new Map<string,ExtensionRegistration>();
 constructor(private readonly onError:(diagnostic:RuntimeDiagnostic)=>void=d=>console.error('[hive]',d.message)) {}

 register(extension:ExtensionRegistration):()=>void {
  if(!extension||!/^[a-z][a-z0-9.-]{1,79}$/.test(extension.key))throw new HiveRuntimeError(diagnostic('EXTENSION_INVALID','Extension key must match [a-z][a-z0-9.-]{1,79}','extensions'));
  const [major]=parseVersion(extension.contractVersion,'contractVersion');
  if(major!==1)throw new HiveRuntimeError(diagnostic('EXTENSION_INCOMPATIBLE',`Extension ${extension.key} implements contract major ${major}; this runtime supports 1`,'extensions'));
  parseVersion(extension.version,'version');
  if(this.extensions.has(extension.key))throw new HiveRuntimeError(diagnostic('EXTENSION_DUPLICATE',`Extension ${extension.key} is already registered`,'extensions'));
  if(typeof extension.render!=='function')throw new HiveRuntimeError(diagnostic('EXTENSION_INVALID',`Extension ${extension.key} has no render function`,'extensions'));
  this.extensions.set(extension.key,extension);
  return ()=>{this.extensions.delete(extension.key);};
 }

 list(point:ExtensionPoint, context:AnyHiveContext):ExtensionRegistration[] {
  return [...this.extensions.values()].filter(e=>e.point===point&&(e.requires??[]).every(r=>holds(context,r)))
   .sort((a,b)=>(a.order??0)-(b.order??0)||a.key.localeCompare(b.key));
 }

 /** Renders every visible extension of a point into its own child element; returns a disposer. */
 render(point:ExtensionPoint, host:HTMLElement, context:AnyHiveContext):()=>void {
  const cleanups:(()=>void)[]=[];
  for(const extension of this.list(point,context)){
   const element=host.ownerDocument.createElement('div');
   element.setAttribute('data-hive-extension',extension.key);
   host.appendChild(element);
   try{const cleanup=extension.render(element,context);if(typeof cleanup==='function')cleanups.push(cleanup);}
   catch(error){element.remove();this.onError(toDiagnostic(error,'EXTENSION_FAILED','extensions',{details:{extension:extension.key}}));}
   cleanups.push(()=>element.remove());
  }
  return ()=>{for(const cleanup of cleanups.reverse()){try{cleanup();}catch(error){this.onError(toDiagnostic(error,'EXTENSION_FAILED','extensions'));}}};
 }
}

function holds(context:AnyHiveContext, requirement:string):boolean {
 if(!context.authenticated)return false;
 const parts=requirement.split(':');
 if(parts.length!==3)return false;
 const actions=context.permissions[`${parts[0]}:${parts[1]}`]??[];
 return actions.includes(parts[2]!)||actions.includes('manage');
}
