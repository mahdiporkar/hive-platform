import type {AnyHiveContext, RuntimeDiagnostic, RuntimeModule, RuntimeRoute, Workspace, WorkspaceEvent, WorkspaceLayout, WorkspaceSlot, WorkspaceState} from '@hive-platform/contracts';
import {routeAccess, scopedPermissions} from '@hive-platform/authorization';
import {Signal, diagnostic, matchRoute, routeSpecificity, toDiagnostic} from '@hive-platform/core';
import type {MfeRuntime, MountContextInput, MountedInstance} from '@hive-platform/mfe-runtime';
import {HiveEventHub} from './event-bus.js';
import {WORKSPACE_SCHEMA_VERSION, type WorkspacePersistence} from './persistence.js';

export interface Resolution {module:RuntimeModule; route:RuntimeRoute; params:Record<string,string>}

export interface WorkspaceEngineOptions {
 runtime:Pick<MfeRuntime,'mount'>;
 context:AnyHiveContext;
 id?:string;
 hub?:HiveEventHub;
 persistence?:WorkspacePersistence;
 onDiagnostic?:(diagnostic:RuntimeDiagnostic)=>void;
}

/** Maximum simultaneously open slots per layout. */
export const LAYOUT_CAPACITY:Readonly<Record<WorkspaceLayout,number>>={SINGLE:1,TABS:12,SPLIT:4,DASHBOARD:12};

interface SlotRuntime {
 slot:WorkspaceSlot;
 element:HTMLElement|null;
 instance:MountedInstance|null;
 moduleKey:string|null;
 port:ReturnType<HiveEventHub['port']>|null;
 queue:Promise<void>;
}

/**
 * Headless workspace engine: owns the workspace model, slot lifecycle, authorization state per slot, inter-app
 * events and persistence. Renderers (plain DOM, React, Angular, ...) only provide an element per slot via attach().
 * Every slot is isolated: a failure sets that slot's error and never affects other slots.
 */
export class WorkspaceEngine {
 readonly id:string;
 readonly hub:HiveEventHub;
 readonly state:Signal<Workspace>;
 private context:AnyHiveContext;
 private readonly slots=new Map<string,SlotRuntime>();
 private readonly listeners=new Set<(event:WorkspaceEvent)=>void>();
 private layout:WorkspaceLayout='SINGLE';
 private activeSlotId:string|null=null;
 private counter=0;
 private disposed=false;

 constructor(private readonly options:WorkspaceEngineOptions) {
  this.id=options.id??'workspace';
  this.context=options.context;
  this.hub=options.hub??new HiveEventHub(d=>this.report(d));
  this.state=new Signal<Workspace>(this.snapshot());
 }

 get workspace():Workspace {return this.state.get();}

 on(listener:(event:WorkspaceEvent)=>void):()=>void {this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}

 /** Most specific route of the current context matching a local path. */
 resolve(path:string):Resolution|null {
  const matches:Resolution[]=[];
  for(const module of this.context.modules)for(const route of module.routes){const params=matchRoute(route.path,path);if(params)matches.push({module,route,params});}
  matches.sort((a,b)=>routeSpecificity(b.route.path)-routeSpecificity(a.route.path));
  return matches[0]??null;
 }

 /** Opens a path in a new slot (or replaces the only slot in SINGLE layout). Returns the slot id. */
 open(path:string, options:{slotId?:string; focus?:boolean; instanceId?:string}={}):string {
  this.assertAlive();
  if(this.layout==='SINGLE'&&this.slots.size>=1&&!options.slotId){
   const only=[...this.slots.keys()][0]!;void this.navigate(only,path);return only;
  }
  if(this.slots.size>=LAYOUT_CAPACITY[this.layout])throw Object.assign(new Error(`${this.layout} workspaces hold at most ${LAYOUT_CAPACITY[this.layout]} slots`),{diagnostic:diagnostic('WORKSPACE_FULL',`Layout ${this.layout} is full`,'workspace')});
  const slotId=options.slotId??`slot-${++this.counter}`;
  if(this.slots.has(slotId))throw new Error(`Slot ${slotId} already exists`);
  const resolution=this.resolve(path);
  const moduleKey=resolution?.module.moduleKey??'unresolved';
  this.slots.set(slotId,{slot:{slotId,moduleKey,instanceId:options.instanceId??this.instanceId(moduleKey),route:path,status:'IDLE',loading:false,error:null,authorization:'UNKNOWN'},element:null,instance:null,moduleKey:null,port:null,queue:Promise.resolve()});
  if(options.focus!==false||!this.activeSlotId)this.activeSlotId=slotId;
  this.changed({type:'SLOT_OPENED',workspaceId:this.id,slotId,detail:{route:path}});
  return slotId;
 }

 /** The renderer hands over the element for a slot; the engine mounts when access allows. */
 attach(slotId:string, element:HTMLElement):Promise<void> {
  const slot=this.require(slotId);
  if(slot.element===element)return slot.queue;
  return this.enqueue(slot,async()=>{
   if(slot.element&&slot.element!==element)await this.unmountSlot(slot);
   slot.element=element;
   await this.reconcile(slot);
  });
 }

 detach(slotId:string):Promise<void> {
  const slot=this.slots.get(slotId);
  if(!slot)return Promise.resolve();
  return this.enqueue(slot,async()=>{await this.unmountSlot(slot);slot.element=null;this.setSlot(slot,{status:'IDLE',loading:false});});
 }

 navigate(slotId:string, path:string):Promise<void> {
  const slot=this.require(slotId);
  return this.enqueue(slot,async()=>{
   this.setSlot(slot,{route:path});
   this.emit({type:'ROUTE_CHANGED',workspaceId:this.id,slotId,detail:{route:path}});
   await this.reconcile(slot);
  });
 }

 async close(slotId:string):Promise<void> {
  const slot=this.slots.get(slotId);
  if(!slot)return;
  await this.enqueue(slot,async()=>{await this.unmountSlot(slot);});
  this.slots.delete(slotId);
  if(this.activeSlotId===slotId)this.activeSlotId=[...this.slots.keys()].at(-1)??null;
  this.changed({type:'SLOT_CLOSED',workspaceId:this.id,slotId});
 }

 focus(slotId:string):void {
  this.require(slotId);
  if(this.activeSlotId===slotId)return;
  this.activeSlotId=slotId;
  this.changed({type:'ACTIVE_CHANGED',workspaceId:this.id,slotId});
 }

 /** Changes layout; slots beyond the new capacity are closed, keeping the active slot. */
 async setLayout(layout:WorkspaceLayout):Promise<void> {
  this.assertAlive();
  if(!(layout in LAYOUT_CAPACITY))throw new Error(`Unknown layout ${layout}`);
  const keep=new Set<string>([...(this.activeSlotId?[this.activeSlotId]:[]),...this.slots.keys()].slice(0,LAYOUT_CAPACITY[layout]));
  for(const slotId of [...this.slots.keys()])if(!keep.has(slotId))await this.close(slotId);
  this.layout=layout;
  this.changed({type:'LAYOUT_CHANGED',workspaceId:this.id,detail:{layout}});
 }

 /** New context (e.g. after login, logout or permission change): re-evaluate and update every slot. */
 async setContext(context:AnyHiveContext):Promise<void> {
  this.context=context;
  await Promise.all([...this.slots.values()].map(slot=>this.enqueue(slot,()=>this.reconcile(slot))));
 }

 /** Restores persisted slots and layout (validated); returns false when nothing usable was stored. */
 restore():boolean {
  const saved=this.options.persistence?.load();
  if(!saved||saved.slots.length===0)return false;
  this.layout=saved.layout;
  for(const slot of saved.slots.slice(0,LAYOUT_CAPACITY[saved.layout])){
   const counter=Number(/^slot-(\d+)$/.exec(slot.slotId)?.[1]??0);this.counter=Math.max(this.counter,counter);
   this.open(slot.route,{slotId:slot.slotId,instanceId:slot.instanceId,focus:false});
  }
  this.activeSlotId=saved.activeSlotId&&this.slots.has(saved.activeSlotId)?saved.activeSlotId:[...this.slots.keys()][0]??null;
  this.changed({type:'LAYOUT_CHANGED',workspaceId:this.id,detail:{layout:this.layout,restored:true}});
  return true;
 }

 async dispose():Promise<void> {
  if(this.disposed)return;
  for(const slot of this.slots.values())await this.enqueue(slot,()=>this.unmountSlot(slot));
  this.disposed=true;this.listeners.clear();
 }

 /** Serializable state: layout, slot ids, module keys and local routes only — never module state or identity. */
 serialize():WorkspaceState {
  return {schemaVersion:WORKSPACE_SCHEMA_VERSION,layout:this.layout,activeSlotId:this.activeSlotId,
   slots:[...this.slots.values()].map(({slot})=>({slotId:slot.slotId,moduleKey:slot.moduleKey,instanceId:slot.instanceId,route:slot.route}))};
 }

 // ---- internals -----------------------------------------------------------------------------------------------

 private async reconcile(slot:SlotRuntime):Promise<void> {
  if(this.disposed)return;
  const resolution=this.resolve(slot.slot.route);
  if(!resolution){
   await this.unmountSlot(slot);
   const anonymous=!this.context.authenticated;
   this.setSlot(slot,anonymous?{status:'LOGIN_REQUIRED',authorization:'LOGIN_REQUIRED',error:null,loading:false}
    :{status:'ERROR',authorization:'UNKNOWN',loading:false,error:diagnostic('ROUTE_NOT_FOUND',`No module serves ${slot.slot.route}`,'workspace',{instanceId:slot.slot.instanceId})});
   return;
  }
  const {module,route,params}=resolution;
  const access=routeAccess(route,module,this.context);
  if(access!=='ALLOWED'){
   await this.unmountSlot(slot);
   this.setSlot(slot,{moduleKey:module.moduleKey,status:access==='DENIED'?'DENIED':'LOGIN_REQUIRED',authorization:access==='DENIED'?'DENIED':'LOGIN_REQUIRED',error:null,loading:false});
   return;
  }
  if(!slot.element){this.setSlot(slot,{moduleKey:module.moduleKey,authorization:'ALLOWED',status:'IDLE'});return;}
  const input=this.mountInput(slot,module,route,params);
  if(slot.instance&&slot.moduleKey===module.moduleKey){
   try{await slot.instance.update(input);this.setSlot(slot,{status:'MOUNTED',authorization:'ALLOWED',error:null,loading:false});}
   catch(error){this.fail(slot,error,'UPDATE_FAILED');}
   return;
  }
  await this.unmountSlot(slot);
  if(slot.slot.moduleKey!==module.moduleKey)slot.slot={...slot.slot,instanceId:this.instanceId(module.moduleKey)};
  this.setSlot(slot,{moduleKey:module.moduleKey,status:'LOADING',loading:true,authorization:'ALLOWED',error:null});
  const port=this.hub.port({instanceId:slot.slot.instanceId,workspaceId:this.id,applicationKey:module.applicationKey});
  try{
   const instance=await this.options.runtime.mount(slot.element,module,{...this.mountInput(slot,module,route,params),events:port});
   slot.instance=instance;slot.moduleKey=module.moduleKey;slot.port=port;
   this.setSlot(slot,{status:'MOUNTED',loading:false,error:null});
  }catch(error){port.release();this.fail(slot,error,'MOUNT_FAILED');}
 }

 private mountInput(slot:SlotRuntime, module:RuntimeModule, route:RuntimeRoute, params:Record<string,string>):MountContextInput {
  return {instanceId:slot.slot.instanceId,slotId:slot.slot.slotId,route:slot.slot.route,params,locale:this.context.locale,direction:this.context.direction,
   context:this.context,permissions:scopedPermissions(this.context,module.applicationKey),events:slot.port??this.hub.port({instanceId:slot.slot.instanceId,workspaceId:this.id,applicationKey:module.applicationKey}),
   basePath:route.path.split('/:')[0]!.replace(/\/\*$/,'')||'/',navigate:path=>{void this.navigate(slot.slot.slotId,path);}};
 }

 private async unmountSlot(slot:SlotRuntime):Promise<void> {
  const instance=slot.instance;
  slot.instance=null;slot.moduleKey=null;
  slot.port?.release();slot.port=null;
  if(instance)await instance.unmount();
 }

 private fail(slot:SlotRuntime, error:unknown, code:string):void {
  const d=toDiagnostic(error,code,'workspace',{instanceId:slot.slot.instanceId,moduleKey:slot.slot.moduleKey});
  this.report(d);
  this.setSlot(slot,{status:'ERROR',loading:false,error:d});
 }

 private enqueue(slot:SlotRuntime, work:()=>Promise<void>):Promise<void> {
  const next=slot.queue.then(work,work);
  slot.queue=next.catch(error=>this.report(toDiagnostic(error,'WORKSPACE_OPERATION_FAILED','workspace')));
  return next;
 }

 private setSlot(slot:SlotRuntime, patch:Partial<WorkspaceSlot>):void {
  const before=slot.slot.status;
  slot.slot={...slot.slot,...patch};
  this.state.set(this.snapshot());
  this.persist();
  if(patch.status&&patch.status!==before)this.emit({type:'SLOT_STATUS',workspaceId:this.id,slotId:slot.slot.slotId,detail:{status:patch.status}});
 }

 private changed(event:WorkspaceEvent):void {this.state.set(this.snapshot());this.persist();this.emit(event);}

 private snapshot():Workspace {
  return {id:this.id,layout:this.layout,activeSlotId:this.activeSlotId,slots:[...(this.slots?.values()??[])].map(s=>s.slot)};
 }

 private persist():void {if(!this.disposed)this.options.persistence?.save(this.serialize());}

 private emit(event:WorkspaceEvent):void {for(const listener of [...this.listeners]){try{listener(event);}catch(error){this.report(toDiagnostic(error,'WORKSPACE_LISTENER_FAILED','workspace'));}}}

 private report(d:RuntimeDiagnostic):void {this.options.onDiagnostic?.(d);}

 private instanceId(moduleKey:string):string {return `${moduleKey}-${(globalThis.crypto?.randomUUID?.()??String(Math.random()).slice(2)).slice(0,8)}`.replace(/[^A-Za-z0-9_-]/g,'');}

 private require(slotId:string):SlotRuntime {const slot=this.slots.get(slotId);if(!slot)throw new Error(`Unknown slot ${slotId}`);return slot;}
 private assertAlive():void {if(this.disposed)throw new Error('Workspace disposed');}
}
