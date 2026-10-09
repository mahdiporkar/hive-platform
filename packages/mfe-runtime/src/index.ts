/**
 * @hive-platform/mfe-runtime — loads micro-app artifacts and hosts their instances, without knowing any UI framework.
 * Each step fails with its own diagnostic code, so a version problem is never reported as a loading problem:
 *
 *   MANIFEST_INCOMPATIBLE → ARTIFACT_NETWORK_FAILURE / ARTIFACT_HTTP_ERROR → ARTIFACT_INTEGRITY_* →
 *   ARTIFACT_MODULE_FORMAT / FEDERATION_* → MICRO_APP_CONTRACT_INVALID / MICRO_APP_CONTRACT_MISMATCH → MOUNT_* / UPDATE_* / UNMOUNT_*
 *
 * Loading is delegated to one {@link MicroFrontendLoader} per artifact format (ES module, webpack and Vite Module
 * Federation). Whatever the format, the loaded code must provide the same {contractVersion, create()} micro-app, so the
 * mount contract does not depend on how an artifact is packaged. One artifact load is shared by any number of
 * independent instances (create() per mount).
 */
import type {ArtifactFormat, HiveMicroApp, HiveMicroAppInstance, HiveMountContext, RuntimeDiagnostic, RuntimeModule} from '@hive-platform/contracts';
import {checkCompatibility, CompatibilityError, parseVersion} from '@hive-platform/contracts';
import {HiveRuntimeError, RUNTIME_VERSION, diagnostic, toDiagnostic} from '@hive-platform/core';

export type ModuleImporter = (source:string, url:string) => Promise<unknown>;
/** Imports an ES module by URL (Vite federation containers import their chunks relative to their own URL). */
export type UrlImporter = (url:string) => Promise<unknown>;

/** What a loader may use; the runtime owns fetching and integrity so every format is verified the same way. */
export interface LoaderContext {
 /** Fetches the artifact entry and verifies it against its registered SRI; throws the ARTIFACT_* diagnostics. */
 fetchVerified(module:RuntimeModule):Promise<Uint8Array>;
 importModule:ModuleImporter;
 importUrl:UrlImporter;
 document:Document|undefined;
 /** Module Federation share scope handed to every container's init() (containers fall back to their own copies). */
 shareScope:Record<string,unknown>;
 timeoutMs:number;
}

/** Loads the code of one artifact format and returns the module namespace that carries the micro-app. */
export interface MicroFrontendLoader {
 readonly format:ArtifactFormat;
 load(module:RuntimeModule, context:LoaderContext):Promise<unknown>;
}

export interface MfeRuntimeOptions {
 fetch?:typeof fetch;
 /** Evaluates verified artifact source. The default imports it from a Blob URL (CSP needs `script-src blob:`). */
 importModule?:ModuleImporter;
 /** Imports a module by URL (Vite federation). The default is native dynamic import(). */
 importUrl?:UrlImporter;
 subtle?:SubtleCrypto;
 /** Document used to attach webpack federation container scripts (defaults to the global document). */
 document?:Document;
 /** Loaders replacing or adding to the built-in ones, keyed by their format. */
 loaders?:readonly MicroFrontendLoader[];
 shareScope?:Record<string,unknown>;
 /** Mount/unmount/update deadline (and script load deadline). */
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
 private readonly subtle:SubtleCrypto;
 private readonly timeoutMs:number;
 private readonly report:(diagnostic:RuntimeDiagnostic)=>void;
 private readonly loaders=new Map<string,MicroFrontendLoader>();
 private readonly context:LoaderContext;

 constructor(options:MfeRuntimeOptions={}) {
  this.fetchImpl=options.fetch??globalThis.fetch.bind(globalThis);
  this.subtle=options.subtle??globalThis.crypto.subtle;
  this.timeoutMs=options.lifecycleTimeoutMs??15000;
  this.report=options.onDiagnostic??(()=>{});
  for(const loader of [new HiveEsModuleLoader(),new WebpackFederationLoader(),new ViteFederationLoader(),...(options.loaders??[])])this.loaders.set(loader.format,loader);
  this.context={fetchVerified:module=>this.fetchVerified(module),importModule:options.importModule??blobImporter,importUrl:options.importUrl??urlImporter,
   document:options.document??(globalThis as {document?:Document}).document,shareScope:options.shareScope??{},timeoutMs:this.timeoutMs};
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
  const loader=this.loaders.get(module.artifact?.format);
  if(!loader)throw new HiveRuntimeError(diagnostic('ARTIFACT_MODULE_FORMAT',`Module ${module.moduleKey} artifact format ${String(module.artifact?.format)} is not supported (${[...this.loaders.keys()].join(', ')})`,COMPONENT,context));
  const exports=await loader.load(module,this.context);
  const app=((exports as {default?:unknown})?.default??(exports as {microApp?:unknown})?.microApp) as Partial<HiveMicroApp>|undefined;
  if(!app||typeof app.create!=='function'||typeof app.contractVersion!=='string')
   throw new HiveRuntimeError(diagnostic('MICRO_APP_CONTRACT_INVALID',`Artifact for ${module.moduleKey} must ${module.artifact.format==='ES_MODULE'?'default-export':`expose (${module.artifact.exposedModule}) a module default-exporting`} {contractVersion, create()}`,COMPONENT,context));
  let declared:readonly number[],registered:readonly number[];
  try{declared=parseVersion(app.contractVersion,'contractVersion');registered=parseVersion(module.contractVersion,'contractVersion');}
  catch(error){throw new HiveRuntimeError(diagnostic('MICRO_APP_CONTRACT_INVALID',`Artifact for ${module.moduleKey} declares an invalid contractVersion`,COMPONENT,context));}
  if(declared[0]!==registered[0]||declared[1]!==registered[1])
   throw new HiveRuntimeError(diagnostic('MICRO_APP_CONTRACT_MISMATCH',`Artifact for ${module.moduleKey} implements contract ${app.contractVersion} but its manifest declares ${module.contractVersion}`,COMPONENT,context));
  return app as HiveMicroApp;
 }

 private async fetchVerified(module:RuntimeModule):Promise<Uint8Array> {
  const context={moduleKey:module.moduleKey};
  let response:Response;
  try{response=await this.fetchImpl(module.artifact.url,{credentials:'same-origin',cache:'no-cache'});}
  catch(error){throw new HiveRuntimeError(diagnostic('ARTIFACT_NETWORK_FAILURE',`Artifact for ${module.moduleKey} could not be fetched (network): ${error instanceof Error?error.message:String(error)}`,COMPONENT,context));}
  if(!response.ok){
   // The artifact gateway answers with a PlatformError naming the precise cause (unreachable host, integrity, version).
   let cause='';try{const body=await response.clone().json() as {code?:string;message?:string};if(body?.code)cause=` (${body.code}: ${body.message??''})`;}catch{/* not a PlatformError */}
   throw new HiveRuntimeError(diagnostic('ARTIFACT_HTTP_ERROR',`Artifact for ${module.moduleKey} returned HTTP ${response.status}${cause}`,COMPONENT,{...context,details:{status:response.status}}));
  }
  const bytes=new Uint8Array(await response.arrayBuffer());
  await this.verifyIntegrity(module,bytes);
  return bytes;
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

/** Default URL importer: native dynamic import, so a container's relative chunk imports resolve against its own URL. */
export const urlImporter:UrlImporter=url=>import(/* @vite-ignore */ /* webpackIgnore: true */ url);

const fail=(code:string,message:string,module:RuntimeModule)=>new HiveRuntimeError(diagnostic(code,message,COMPONENT,{moduleKey:module.moduleKey}));
const reason=(error:unknown)=>error instanceof Error?error.message:String(error);

/** Hive ES module: the verified bytes themselves are evaluated (Blob URL), so integrity covers exactly what runs. */
export class HiveEsModuleLoader implements MicroFrontendLoader {
 readonly format='ES_MODULE' as const;
 async load(module:RuntimeModule, context:LoaderContext):Promise<unknown> {
  const bytes=await context.fetchVerified(module);
  try{return await context.importModule(new TextDecoder().decode(bytes),module.artifact.url);}
  catch(error){throw fail('ARTIFACT_MODULE_FORMAT',`Artifact for ${module.moduleKey} is not a loadable ES module: ${reason(error)}`,module);}
 }
}

interface FederationContainer {init?(shareScope:unknown):unknown; get(exposedModule:string):unknown}

/** Initializes a Module Federation container and resolves the module it exposes under the registered key. */
async function exposedModule(module:RuntimeModule, container:unknown, context:LoaderContext):Promise<unknown> {
 const key=module.artifact.exposedModule!;
 if(!container||typeof (container as FederationContainer).get!=='function')
  throw fail('FEDERATION_CONTAINER_INVALID',`Artifact for ${module.moduleKey} did not provide a Module Federation container (get/init)${module.artifact.remoteName?` as '${module.artifact.remoteName}'`:''}`,module);
 const federation=container as FederationContainer;
 try{await federation.init?.(context.shareScope);}
 catch(error){if(!/already been initialized|already initialized/i.test(reason(error)))throw fail('FEDERATION_INIT_FAILED',`Container of ${module.moduleKey} failed to initialize: ${reason(error)}`,module);}
 let factory:unknown;
 try{factory=await federation.get(key);}
 catch(error){throw fail('FEDERATION_MODULE_NOT_FOUND',`Container of ${module.moduleKey} does not expose ${key}: ${reason(error)}`,module);}
 if(typeof factory!=='function')throw fail('FEDERATION_MODULE_NOT_FOUND',`Container of ${module.moduleKey} does not expose ${key}`,module);
 try{return await (factory as ()=>unknown)();}
 catch(error){throw fail('ARTIFACT_MODULE_FORMAT',`Exposed module ${key} of ${module.moduleKey} failed to evaluate: ${reason(error)}`,module);}
}

/**
 * webpack Module Federation: the container is a classic script that assigns a global (remoteName) and loads its
 * chunks relative to its own URL (publicPath 'auto'), so it is attached by URL with the registered SRI; the browser
 * enforces that integrity on the executed bytes. The runtime additionally pre-fetches and verifies the entry, which
 * turns network, HTTP and integrity failures into precise diagnostics.
 */
export class WebpackFederationLoader implements MicroFrontendLoader {
 readonly format='WEBPACK_FEDERATION' as const;
 private readonly containers=new Map<string,Promise<unknown>>();
 async load(module:RuntimeModule, context:LoaderContext):Promise<unknown> {
  const {remoteName,exposedModule:key,url,integrity}=module.artifact;
  if(!remoteName||!key)throw fail('ARTIFACT_MODULE_FORMAT',`Module ${module.moduleKey} is WEBPACK_FEDERATION but declares no remoteName/exposedModule`,module);
  await context.fetchVerified(module);
  const document=context.document;
  if(!document)throw fail('ARTIFACT_MODULE_FORMAT',`WEBPACK_FEDERATION artifacts need a DOM document to attach ${remoteName}`,module);
  const cacheKey=`${url}#${integrity}`;
  let pending=this.containers.get(cacheKey);
  if(!pending){
   pending=attachScript(document,module,context.timeoutMs).then(()=>((document.defaultView??globalThis) as unknown as Record<string,unknown>)[remoteName]);
   this.containers.set(cacheKey,pending);
   pending.catch(()=>this.containers.delete(cacheKey));
  }
  return exposedModule(module,await pending,context);
 }
}

function attachScript(document:Document, module:RuntimeModule, timeoutMs:number):Promise<void> {
 return new Promise((resolve,reject)=>{
  const script=document.createElement('script');
  script.src=module.artifact.url;script.async=true;
  if(module.artifact.integrity){script.integrity=module.artifact.integrity;script.crossOrigin='anonymous';}
  script.setAttribute('data-hive-remote',module.artifact.remoteName!);
  const timer=setTimeout(()=>{script.remove();reject(fail('FEDERATION_SCRIPT_FAILED',`Container script of ${module.moduleKey} did not load within ${timeoutMs} ms`,module));},timeoutMs);
  script.onload=()=>{clearTimeout(timer);resolve();};
  script.onerror=()=>{clearTimeout(timer);script.remove();reject(fail('FEDERATION_SCRIPT_FAILED',`Container script of ${module.moduleKey} was refused (integrity, Content-Security-Policy or network)`,module));};
  document.head.appendChild(script);
 });
}

/**
 * Vite Module Federation (@originjs/vite-plugin-federation style): the entry is an ES module exporting get/init that
 * imports its chunks relative to its own URL, so it is imported by URL. Its bytes are verified first; the artifact
 * gateway serves the entry only when it matches the registered integrity, which covers the module that is imported.
 */
export class ViteFederationLoader implements MicroFrontendLoader {
 readonly format='VITE_FEDERATION' as const;
 async load(module:RuntimeModule, context:LoaderContext):Promise<unknown> {
  if(!module.artifact.exposedModule)throw fail('ARTIFACT_MODULE_FORMAT',`Module ${module.moduleKey} is VITE_FEDERATION but declares no exposedModule`,module);
  await context.fetchVerified(module);
  let namespace:unknown;
  try{namespace=await context.importUrl(module.artifact.url);}
  catch(error){throw fail('ARTIFACT_MODULE_FORMAT',`Artifact for ${module.moduleKey} is not a loadable ES module container: ${reason(error)}`,module);}
  const candidate=namespace as {get?:unknown;default?:unknown}|undefined;
  return exposedModule(module,typeof candidate?.get==='function'?candidate:candidate?.default,context);
 }
}

function base64(bytes:Uint8Array):string {
 let binary='';
 for(const byte of bytes)binary+=String.fromCharCode(byte);
 return btoa(binary);
}

/** Computes an SRI value for artifact bytes (used by tooling such as `hive validate`). */
export async function integrityOf(bytes:Uint8Array, algorithm:'sha256'|'sha384'|'sha512'='sha384', subtle:SubtleCrypto=globalThis.crypto.subtle):Promise<string> {
 return `${algorithm}-${base64(new Uint8Array(await subtle.digest(SUPPORTED_DIGESTS[algorithm]!,bytes as unknown as ArrayBuffer)))}`;
}
