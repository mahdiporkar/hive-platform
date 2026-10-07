/**
 * @hive-platform/mfe-runtime — loads ES-module micro-app artifacts and hosts their instances, without knowing any UI
 * framework. Each step fails with its own diagnostic code, so a version problem is never reported as a loading problem:
 *
 *   MANIFEST_INCOMPATIBLE → ARTIFACT_NETWORK_FAILURE / ARTIFACT_HTTP_ERROR → ARTIFACT_INTEGRITY_* →
 *   ARTIFACT_MODULE_FORMAT → MICRO_APP_CONTRACT_INVALID / MICRO_APP_CONTRACT_MISMATCH → MOUNT_* / UPDATE_* / UNMOUNT_*
 *
 * One artifact load is shared by any number of independent instances (create() per mount).
 */
import type {HiveMicroApp, HiveMicroAppInstance, HiveMountContext, RuntimeDiagnostic, RuntimeModule} from '@hive-platform/contracts';
import {checkCompatibility, CompatibilityError, parseVersion} from '@hive-platform/contracts';
import {HiveRuntimeError, RUNTIME_VERSION, diagnostic, toDiagnostic} from '@hive-platform/core';

export type ModuleImporter = (source:string, url:string) => Promise<unknown>;

export interface MfeRuntimeOptions {
 fetch?:typeof fetch;
 /** Evaluates verified artifact source. The default imports it from a Blob URL (CSP needs `script-src blob:`). */
 importModule?:ModuleImporter;
 subtle?:SubtleCrypto;
 /** Mount/unmount/update deadline. */
 lifecycleTimeoutMs?:number;
 onDiagnostic?:(diagnostic:RuntimeDiagnostic)=>void;
}

export type MountContextInput = Omit<HiveMountContext,'contractVersion'|'moduleKey'|'applicationKey'|'signal'>;

export interface MountedInstance {
 readonly instanceId:string;
 readonly moduleKey:string;
 /** The container the micro-app owns (inside a shadow root for SHADOW_DOM modules). */
 readonly container:HTMLElement;
 update(context:MountContextInput):Promise<void>;
 unmount():Promise<void>;
}

const COMPONENT='mfe-runtime';
const SUPPORTED_DIGESTS:Record<string,string>={sha256:'SHA-256',sha384:'SHA-384',sha512:'SHA-512'};

export class MfeRuntime {
 private readonly cache=new Map<string,Promise<HiveMicroApp>>();
 private readonly fetchImpl:typeof fetch;
 private readonly importModule:ModuleImporter;
 private readonly subtle:SubtleCrypto;
 private readonly timeoutMs:number;
 private readonly report:(diagnostic:RuntimeDiagnostic)=>void;

 constructor(options:MfeRuntimeOptions={}) {
  this.fetchImpl=options.fetch??globalThis.fetch.bind(globalThis);
  this.importModule=options.importModule??blobImporter;
  this.subtle=options.subtle??globalThis.crypto.subtle;
  this.timeoutMs=options.lifecycleTimeoutMs??15000;
  this.report=options.onDiagnostic??(()=>{});
 }

 /** Loads (once per artifact URL + integrity) and validates a module's micro-app. */
 load(module:RuntimeModule):Promise<HiveMicroApp> {
  const key=`${module.artifact.url}#${module.artifact.integrity}`;
  let pending=this.cache.get(key);
  if(!pending){
   pending=this.loadUncached(module);
   this.cache.set(key,pending);
   // Failed loads are not cached, so a fixed deployment or network recovers without a page reload.
   pending.catch(()=>this.cache.delete(key));
  }
  return pending;
 }

 private async loadUncached(module:RuntimeModule):Promise<HiveMicroApp> {
  const context={moduleKey:module.moduleKey};
  try{
   const warnings=checkCompatibility(module);
   warnings.forEach(w=>this.report({...w,moduleKey:module.moduleKey}));
  }catch(error){
   const cause=error instanceof CompatibilityError?error.diagnostic:undefined;
   throw new HiveRuntimeError(diagnostic('MANIFEST_INCOMPATIBLE',`Module ${module.moduleKey} is incompatible with runtime ${RUNTIME_VERSION}: ${cause?.message??String(error)}`,COMPONENT,
    {...context,details:{reason:cause?.code??'UNKNOWN'}}));
  }
  if(module.artifact?.format!=='ES_MODULE')throw new HiveRuntimeError(diagnostic('ARTIFACT_MODULE_FORMAT',`Module ${module.moduleKey} artifact format ${String(module.artifact?.format)} is not ES_MODULE`,COMPONENT,context));
  let response:Response;
  try{response=await this.fetchImpl(module.artifact.url,{credentials:'same-origin',cache:'no-cache'});}
  catch(error){throw new HiveRuntimeError(diagnostic('ARTIFACT_NETWORK_FAILURE',`Artifact for ${module.moduleKey} could not be fetched (network): ${error instanceof Error?error.message:String(error)}`,COMPONENT,context));}
  if(!response.ok)throw new HiveRuntimeError(diagnostic('ARTIFACT_HTTP_ERROR',`Artifact for ${module.moduleKey} returned HTTP ${response.status}`,COMPONENT,{...context,details:{status:response.status}}));
  const bytes=new Uint8Array(await response.arrayBuffer());
  await this.verifyIntegrity(module,bytes);
  let exports:unknown;
  try{exports=await this.importModule(new TextDecoder().decode(bytes),module.artifact.url);}
  catch(error){throw new HiveRuntimeError(diagnostic('ARTIFACT_MODULE_FORMAT',`Artifact for ${module.moduleKey} is not a loadable ES module: ${error instanceof Error?error.message:String(error)}`,COMPONENT,context));}
  const app=((exports as {default?:unknown})?.default??(exports as {microApp?:unknown})?.microApp) as Partial<HiveMicroApp>|undefined;
  if(!app||typeof app.create!=='function'||typeof app.contractVersion!=='string')
   throw new HiveRuntimeError(diagnostic('MICRO_APP_CONTRACT_INVALID',`Artifact for ${module.moduleKey} must default-export {contractVersion, create()}`,COMPONENT,context));
  let declared:readonly number[],registered:readonly number[];
  try{declared=parseVersion(app.contractVersion,'contractVersion');registered=parseVersion(module.contractVersion,'contractVersion');}
  catch(error){throw new HiveRuntimeError(diagnostic('MICRO_APP_CONTRACT_INVALID',`Artifact for ${module.moduleKey} declares an invalid contractVersion`,COMPONENT,context));}
  if(declared[0]!==registered[0]||declared[1]!==registered[1])
   throw new HiveRuntimeError(diagnostic('MICRO_APP_CONTRACT_MISMATCH',`Artifact for ${module.moduleKey} implements contract ${app.contractVersion} but its manifest declares ${module.contractVersion}`,COMPONENT,context));
  return app as HiveMicroApp;
 }

 private async verifyIntegrity(module:RuntimeModule, bytes:Uint8Array):Promise<void> {
  const candidates=(module.artifact.integrity??'').trim().split(/\s+/).filter(Boolean).map(v=>/^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/.exec(v)).filter((m):m is RegExpExecArray=>m!==null);
  if(candidates.length===0)throw new HiveRuntimeError(diagnostic('ARTIFACT_INTEGRITY_UNSUPPORTED',`Artifact for ${module.moduleKey} has no usable SRI value`,COMPONENT,{moduleKey:module.moduleKey}));
  for(const [,algorithm,expected] of candidates){
   const digest=await this.subtle.digest(SUPPORTED_DIGESTS[algorithm!]!,bytes as unknown as ArrayBuffer);
   if(base64(new Uint8Array(digest))===expected)return;
  }
  throw new HiveRuntimeError(diagnostic('ARTIFACT_INTEGRITY_MISMATCH',`Artifact for ${module.moduleKey} does not match its registered integrity; refusing to execute it`,COMPONENT,{moduleKey:module.moduleKey}));
 }

 /**
  * Mounts a new, independent instance into `host`. The micro-app receives its own container (inside a shadow root
  * for SHADOW_DOM modules) and never the host itself, so unmount can always clean up completely.
  */
 async mount(host:HTMLElement, module:RuntimeModule, input:MountContextInput):Promise<MountedInstance> {
  const app=await this.load(module);
  const lifetime=new AbortController();
  const document=host.ownerDocument;
  let root:HTMLElement|ShadowRoot=host;
  if(module.styleIsolation==='SHADOW_DOM')root=host.shadowRoot??host.attachShadow({mode:'open'});
  const container=document.createElement('div');
  container.className='hive-mfe-root';
  container.setAttribute('data-hive-module',module.moduleKey);
  container.setAttribute('data-hive-instance',input.instanceId);
  root.appendChild(container);
  const contextOf=(value:MountContextInput):HiveMountContext=>({...value,contractVersion:module.contractVersion,moduleKey:module.moduleKey,applicationKey:module.applicationKey,signal:lifetime.signal});
  let instance:HiveMicroAppInstance;
  try{
   instance=app.create();
   if(!instance||typeof instance.mount!=='function'||typeof instance.unmount!=='function')throw new Error('create() must return {mount, unmount}');
  }catch(error){container.remove();throw new HiveRuntimeError(diagnostic('MICRO_APP_CONTRACT_INVALID',`Module ${module.moduleKey} create() failed: ${error instanceof Error?error.message:String(error)}`,COMPONENT,{moduleKey:module.moduleKey,instanceId:input.instanceId}));}
  try{await this.deadline(instance.mount(container,contextOf(input)),'MOUNT',module,input.instanceId);}
  catch(error){
   lifetime.abort();
   try{await instance.unmount();}catch{/* best effort after failed mount */}
   container.remove();
   throw new HiveRuntimeError(toDiagnostic(error,'MOUNT_FAILED',COMPONENT,{moduleKey:module.moduleKey,instanceId:input.instanceId}));
  }
  let mounted=true;
  return {
   instanceId:input.instanceId, moduleKey:module.moduleKey, container,
   update:async next=>{
    if(!mounted)return;
    if(!instance.update)return;
    try{await this.deadline(instance.update(contextOf(next)),'UPDATE',module,input.instanceId);}
    catch(error){const d=toDiagnostic(error,'UPDATE_FAILED',COMPONENT,{moduleKey:module.moduleKey,instanceId:input.instanceId});this.report(d);throw new HiveRuntimeError(d);}
   },
   unmount:async()=>{
    if(!mounted)return;
    mounted=false;lifetime.abort();
    try{await this.deadline(instance.unmount(),'UNMOUNT',module,input.instanceId);}
    catch(error){this.report(toDiagnostic(error,'UNMOUNT_FAILED',COMPONENT,{moduleKey:module.moduleKey,instanceId:input.instanceId}));}
    finally{container.remove();}
   },
  };
 }

 private async deadline(work:void|Promise<void>, phase:'MOUNT'|'UPDATE'|'UNMOUNT', module:RuntimeModule, instanceId:string):Promise<void> {
  let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new HiveRuntimeError(diagnostic(`${phase}_TIMEOUT`,`Module ${module.moduleKey} ${phase.toLowerCase()} exceeded ${this.timeoutMs} ms`,COMPONENT,{moduleKey:module.moduleKey,instanceId}))),this.timeoutMs);});
  try{
   await Promise.race([Promise.resolve(work).catch(error=>{throw new HiveRuntimeError(toDiagnostic(error,`${phase}_FAILED`,COMPONENT,{moduleKey:module.moduleKey,instanceId}));}),timeout]);
  }finally{clearTimeout(timer);}
 }
}

/** Default importer: evaluate the verified bytes, never re-fetch them, so SRI covers exactly what runs. */
export const blobImporter:ModuleImporter=async source=>{
 const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
 try{return await import(/* @vite-ignore */ /* webpackIgnore: true */ url);}
 finally{URL.revokeObjectURL(url);}
};

function base64(bytes:Uint8Array):string {
 let binary='';
 for(const byte of bytes)binary+=String.fromCharCode(byte);
 return btoa(binary);
}

/** Computes an SRI value for artifact bytes (used by tooling such as `hive validate`). */
export async function integrityOf(bytes:Uint8Array, algorithm:'sha256'|'sha384'|'sha512'='sha384', subtle:SubtleCrypto=globalThis.crypto.subtle):Promise<string> {
 return `${algorithm}-${base64(new Uint8Array(await subtle.digest(SUPPORTED_DIGESTS[algorithm]!,bytes as unknown as ArrayBuffer)))}`;
}
