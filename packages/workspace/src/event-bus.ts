import type {EventPort, HiveEventEnvelope, Json, RuntimeDiagnostic} from '@hive-platform/contracts';
import {diagnostic} from '@hive-platform/core';

export type EventScope = 'WORKSPACE'|'APPLICATION'|'GLOBAL';
const NAME=/^[a-z][a-z0-9-]{0,39}:[a-z][a-zA-Z0-9.-]{0,79}$/;
const MAX_PAYLOAD=64*1024;

interface Subscription {name:string; instanceId:string; workspaceId:string; applicationKey:string; listener:(event:HiveEventEnvelope)=>void}

/**
 * Explicit event hub. Events are namespaced (`namespace:name`), payloads are JSON values copied per delivery (no shared
 * mutable objects between micro-apps), delivery is asynchronous and failure-isolated. Scope decides the audience:
 * WORKSPACE (default) — instances of the same workspace; APPLICATION — same workspace and application; GLOBAL — every
 * workspace attached to this hub. There is no implicit global hub: hosts create one and pass it to engines.
 */
export class HiveEventHub {
 private subscriptions=new Set<Subscription>();
 constructor(private readonly onError:(diagnostic:RuntimeDiagnostic)=>void=d=>console.error('[hive]',d.message)) {}

 /** Event port for one mounted instance; `release()` drops every subscription it created. */
 port(owner:{instanceId:string; workspaceId:string; applicationKey:string}):EventPort & {release():void} {
  const owned=new Set<Subscription>();
  return {
   publish:(name,payload,options)=>this.publish(owner,name,payload as Json,options?.scope??'WORKSPACE'),
   subscribe:<T extends Json>(name:string, listener:(event:HiveEventEnvelope<T>)=>void)=>{
    if(!NAME.test(name))throw new TypeError(`Event names must be namespaced like "namespace:event-name": ${name}`);
    const subscription:Subscription={name,...owner,listener:listener as (event:HiveEventEnvelope)=>void};
    this.subscriptions.add(subscription);owned.add(subscription);
    return ()=>{this.subscriptions.delete(subscription);owned.delete(subscription);};
   },
   release:()=>{for(const s of owned)this.subscriptions.delete(s);owned.clear();},
  };
 }

 /** Number of live subscriptions, for diagnostics and leak tests. */
 get size():number {return this.subscriptions.size;}

 private publish(source:{instanceId:string; workspaceId:string; applicationKey:string}, name:string, payload:Json, scope:EventScope):void {
  if(!NAME.test(name))throw new TypeError(`Event names must be namespaced like "namespace:event-name": ${name}`);
  let serialized:string;
  try{serialized=JSON.stringify(payload??null);}catch{throw new TypeError('Event payload must be JSON-serializable');}
  if(serialized.length>MAX_PAYLOAD)throw new RangeError(`Event payload exceeds ${MAX_PAYLOAD} bytes`);
  const sentAt=new Date().toISOString();
  for(const subscription of [...this.subscriptions]){
   if(subscription.name!==name||subscription.instanceId===source.instanceId)continue;
   if(scope!=='GLOBAL'&&subscription.workspaceId!==source.workspaceId)continue;
   if(scope==='APPLICATION'&&subscription.applicationKey!==source.applicationKey)continue;
   const envelope:HiveEventEnvelope={name,payload:JSON.parse(serialized) as Json,sourceInstanceId:source.instanceId,workspaceId:source.workspaceId,scope,sentAt};
   queueMicrotask(()=>{
    if(!this.subscriptions.has(subscription))return;
    try{subscription.listener(envelope);}
    catch(error){this.onError(diagnostic('EVENT_LISTENER_FAILED',`Listener for ${name} in ${subscription.instanceId} failed: ${error instanceof Error?error.message:String(error)}`,'workspace',{instanceId:subscription.instanceId}));}
   });
  }
 }
}
