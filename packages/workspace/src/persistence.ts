import type {WorkspaceLayout, WorkspaceState} from '@hive-platform/contracts';

export interface WorkspacePersistence {load():WorkspaceState|null; save(state:WorkspaceState):void; clear():void}

export const WORKSPACE_SCHEMA_VERSION='1.0.0' as const;
const LAYOUTS:readonly WorkspaceLayout[]=['SINGLE','TABS','SPLIT','DASHBOARD'];
const ID=/^[A-Za-z0-9_-]{1,64}$/, MODULE=/^[a-z][a-z0-9-]{1,79}$/;

/**
 * Validates untrusted persisted state. Only layout, slot ids, module keys and local route paths survive; anything
 * else (unknown schema, foreign origins, oversized or malformed entries) is dropped rather than guessed.
 */
export function sanitizeState(value:unknown):WorkspaceState|null {
 if(!value||typeof value!=='object')return null;
 const state=value as Record<string,unknown>;
 if(state['schemaVersion']!==WORKSPACE_SCHEMA_VERSION)return null;
 const layout=state['layout'];
 if(!LAYOUTS.includes(layout as WorkspaceLayout))return null;
 const slots=Array.isArray(state['slots'])?state['slots'].slice(0,12):[];
 const clean=slots.flatMap(slot=>{
  const s=slot as Record<string,unknown>;
  const route=String(s['route']??'');
  if(!ID.test(String(s['slotId']))||!ID.test(String(s['instanceId']))||!MODULE.test(String(s['moduleKey'])))return [];
  if(!route.startsWith('/')||route.startsWith('//')||route.length>512||/[\\\u0000-\u001f]/.test(route))return [];
  return [{slotId:String(s['slotId']),instanceId:String(s['instanceId']),moduleKey:String(s['moduleKey']),route}];
 });
 const active=typeof state['activeSlotId']==='string'&&clean.some(s=>s.slotId===state['activeSlotId'])?state['activeSlotId']:clean[0]?.slotId??null;
 return {schemaVersion:WORKSPACE_SCHEMA_VERSION,layout:layout as WorkspaceLayout,activeSlotId:active,slots:clean};
}

/** Per-tab persistence (survives reloads, not shared across tabs or with the server). */
export function sessionPersistence(key:string, storage:Storage|undefined=globalThis.sessionStorage):WorkspacePersistence {
 return {
  load:()=>{try{const raw=storage?.getItem(key);return raw?sanitizeState(JSON.parse(raw)):null;}catch{return null;}},
  save:state=>{try{storage?.setItem(key,JSON.stringify(state));}catch{/* storage unavailable: workspace still works */}},
  clear:()=>{try{storage?.removeItem(key);}catch{/* ignore */}},
 };
}

export function memoryPersistence():WorkspacePersistence & {value:WorkspaceState|null} {
 const holder={value:null as WorkspaceState|null,load:()=>holder.value?sanitizeState(JSON.parse(JSON.stringify(holder.value))):null,save:(s:WorkspaceState)=>{holder.value=s;},clear:()=>{holder.value=null;}};
 return holder;
}
