import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceEngine,HiveEventHub,memoryPersistence,sanitizeState,renderDomWorkspace} from '@hive-platform/workspace';
import {fakeDocument} from './support.mjs';

const route=(key,path,extra={})=>({key,path,access:'AUTHENTICATED',...extra});
const module=(moduleKey,routes)=>({applicationKey:'app',moduleKey,displayName:moduleKey,schemaVersion:'1.0.0',manifestVersion:'1.0.0',contractVersion:'1.1.0',runtimeVersion:'1.0.0',
 artifact:{url:`/m/${moduleKey}.js`,integrity:'sha384-x',format:'ES_MODULE'},styleIsolation:'SCOPED',routes});
const modules=[
 module('directory',[route('list','/directory',{resource:'directory',action:'view'})]),
 module('finance',[route('overview','/finance',{resource:'finance',action:'view'}),route('record','/finance/records/:id',{resource:'finance',action:'view'}),route('about','/finance/about',{access:'PUBLIC'})]),
 module('broken',[route('home','/broken',{access:'PUBLIC'})]),
];
const signedIn=(permissions={'app:directory':['view'],'app:finance':['view']})=>({authenticated:true,locale:'en',direction:'ltr',modules,permissions,platformRoles:[],features:[],applications:[],branding:{name:'x'},revision:1,contractVersion:'1.1.0',identity:{id:'u'},session:{}});
const anonymous=()=>({authenticated:false,locale:'en',direction:'ltr',modules:modules.map(m=>({...m,routes:m.routes.filter(r=>r.access!=='AUTHENTICATED')})).filter(m=>m.routes.length),features:[],applications:[],branding:{name:'x'},revision:1,contractVersion:'1.1.0'});

/** Fake runtime recording lifecycle calls; module "broken" fails to mount. */
function fakeRuntime(){
 const log=[];const instances=new Map();
 return {log,instances,mount:async(element,module,input)=>{
  if(module.moduleKey==='broken'){const error=new Error('boom');error.diagnostic={code:'ARTIFACT_INTEGRITY_MISMATCH',message:'tampered',component:'mfe-runtime',severity:'ERROR'};throw error;}
  const container=element.ownerDocument.createElement('div');element.appendChild(container);container.textContent=`${module.moduleKey}:${input.route}`;
  const received=[];const off=input.events.subscribe('campus:record-selected',e=>received.push(e.payload));
  const instance={instanceId:input.instanceId,moduleKey:module.moduleKey,container,received,input,events:input.events,
   update:async next=>{log.push(['update',input.instanceId,next.route]);container.textContent=`${module.moduleKey}:${next.route}`;instance.input=next;},
   unmount:async()=>{log.push(['unmount',input.instanceId]);off();container.remove();instances.delete(input.instanceId);}};
  log.push(['mount',input.instanceId,module.moduleKey,input.route]);instances.set(input.instanceId,instance);return instance;
 }};
}
const tick=()=>new Promise(r=>setTimeout(r,0));

test('split workspace mounts two modules independently; events cross between them; errors stay in their slot',async()=>{
 const runtime=fakeRuntime();const diagnostics=[];
 const engine=new WorkspaceEngine({runtime,context:signedIn(),onDiagnostic:d=>diagnostics.push(d)});
 await engine.setLayout('SPLIT');
 const document=fakeDocument();
 const left=engine.open('/directory'),right=engine.open('/finance');
 await engine.attach(left,document.createElement('div'));await engine.attach(right,document.createElement('div'));
 assert.deepEqual(engine.workspace.slots.map(s=>[s.moduleKey,s.status,s.authorization]),[['directory','MOUNTED','ALLOWED'],['finance','MOUNTED','ALLOWED']]);
 const [directory,finance]=[...runtime.instances.values()];
 directory.events.publish('campus:record-selected',{recordId:'R-2'});
 await tick();
 assert.deepEqual(finance.received,[{recordId:'R-2'}],'cross-module delivery');assert.deepEqual(directory.received,[],'no echo to sender');
 // Same module twice: independent instances with distinct ids.
 await engine.setLayout('DASHBOARD');
 const second=engine.open('/finance/records/7');await engine.attach(second,document.createElement('div'));
 const financeInstances=[...runtime.instances.values()].filter(i=>i.moduleKey==='finance');
 assert.equal(financeInstances.length,2);assert.notEqual(financeInstances[0].instanceId,financeInstances[1].instanceId);
 assert.equal(financeInstances[1].input.params.id,'7');
 directory.events.publish('campus:record-selected',{recordId:'R-3'});await tick();
 assert.ok(financeInstances.every(i=>i.received.some(p=>p.recordId==='R-3')),'every subscriber instance receives');
 // A failing module only fails its own slot.
 const broken=engine.open('/broken');await engine.attach(broken,document.createElement('div'));
 const states=Object.fromEntries(engine.workspace.slots.map(s=>[s.slotId,s.status]));
 assert.equal(states[broken],'ERROR');assert.equal(engine.workspace.slots.find(s=>s.slotId===broken).error.code,'ARTIFACT_INTEGRITY_MISMATCH');
 assert.equal(Object.values(states).filter(s=>s==='MOUNTED').length,3);
 assert.equal(diagnostics.at(-1).code,'ARTIFACT_INTEGRITY_MISMATCH');
 // Navigation within a module updates; across modules remounts.
 await engine.navigate(right,'/finance/records/9');assert.deepEqual(runtime.log.at(-1).slice(0,1),['update']);
 await engine.navigate(right,'/directory');assert.equal(engine.workspace.slots.find(s=>s.slotId===right).moduleKey,'directory');
 // Closing unmounts and releases every subscription.
 for(const slot of engine.workspace.slots)await engine.close(slot.slotId);
 assert.equal(runtime.instances.size,0);assert.equal(engine.hub.size,0,'no leaked subscriptions');
});

test('per-slot authorization state follows the context; logout unmounts protected slots',async()=>{
 const runtime=fakeRuntime();const engine=new WorkspaceEngine({runtime,context:signedIn({'app:directory':['view']})});
 await engine.setLayout('TABS');const doc=fakeDocument();
 const a=engine.open('/directory'),b=engine.open('/finance'),c=engine.open('/finance/about');
 for(const id of [a,b,c])await engine.attach(id,doc.createElement('div'));
 assert.deepEqual(engine.workspace.slots.map(s=>s.status),['MOUNTED','DENIED','MOUNTED']);
 await engine.setContext(signedIn());
 assert.deepEqual(engine.workspace.slots.map(s=>s.status),['MOUNTED','MOUNTED','MOUNTED'],'grant takes effect without reopening');
 await engine.setContext(anonymous());
 assert.deepEqual(engine.workspace.slots.map(s=>[s.status,s.authorization]),[['LOGIN_REQUIRED','LOGIN_REQUIRED'],['LOGIN_REQUIRED','LOGIN_REQUIRED'],['MOUNTED','ALLOWED']]);
 assert.deepEqual([...runtime.instances.values()].map(i=>i.moduleKey),['finance'],'only the public slot stays mounted');
});

test('layouts enforce capacity; SINGLE keeps the active slot; persistence stores routes only and restores',async()=>{
 const runtime=fakeRuntime();const persistence=memoryPersistence();
 const engine=new WorkspaceEngine({runtime,context:signedIn(),persistence,id:'main'});
 await engine.setLayout('SPLIT');
 const ids=[engine.open('/directory'),engine.open('/finance'),engine.open('/finance/records/1'),engine.open('/finance/records/2')];
 assert.throws(()=>engine.open('/finance/about'),/at most 4/);
 engine.focus(ids[2]);
 assert.deepEqual(Object.keys(persistence.value).sort(),['activeSlotId','layout','schemaVersion','slots']);
 assert.deepEqual(Object.keys(persistence.value.slots[0]).sort(),['instanceId','moduleKey','route','slotId']);
 const restored=new WorkspaceEngine({runtime,context:signedIn(),persistence,id:'main'});
 assert.equal(restored.restore(),true);
 assert.equal(restored.workspace.layout,'SPLIT');assert.equal(restored.workspace.activeSlotId,ids[2]);
 assert.deepEqual(restored.workspace.slots.map(s=>s.route),['/directory','/finance','/finance/records/1','/finance/records/2']);
 assert.deepEqual(restored.workspace.slots.map(s=>s.instanceId),engine.workspace.slots.map(s=>s.instanceId),'logical instance ids survive');
 await restored.setLayout('SINGLE');
 assert.deepEqual(restored.workspace.slots.map(s=>s.slotId),[ids[2]]);
 const single=restored.open('/directory');assert.equal(single,ids[2],'SINGLE replaces content');
 assert.equal(sanitizeState({schemaVersion:'9.0.0',layout:'SPLIT',slots:[]}),null);
 const hostile=sanitizeState({schemaVersion:'1.0.0',layout:'TABS',activeSlotId:'x',slots:[{slotId:'a',instanceId:'i',moduleKey:'finance',route:'//evil.test/'},{slotId:'b',instanceId:'j',moduleKey:'finance',route:'/ok',token:'secret'},{slotId:'c',instanceId:'k',moduleKey:'BAD KEY',route:'/x'}]});
 assert.deepEqual(hostile.slots,[{slotId:'b',instanceId:'j',moduleKey:'finance',route:'/ok'}]);assert.equal(hostile.activeSlotId,'b');
});

test('event hub: namespacing, scopes, isolation, payload copies',async()=>{
 const errors=[];const hub=new HiveEventHub(d=>errors.push(d));
 const a=hub.port({instanceId:'a',workspaceId:'w1',applicationKey:'app'}),b=hub.port({instanceId:'b',workspaceId:'w1',applicationKey:'app'});
 const c=hub.port({instanceId:'c',workspaceId:'w1',applicationKey:'other'}),d=hub.port({instanceId:'d',workspaceId:'w2',applicationKey:'app'});
 const got={b:[],c:[],d:[]};
 b.subscribe('x:evt',e=>{got.b.push(e.scope);e.payload.mutated=true;});c.subscribe('x:evt',e=>got.c.push(e.scope));d.subscribe('x:evt',e=>got.d.push(e.scope));
 b.subscribe('x:evt',()=>{throw new Error('listener bug');});
 const payload={n:1};
 a.publish('x:evt',payload);a.publish('x:evt',payload,{scope:'APPLICATION'});a.publish('x:evt',payload,{scope:'GLOBAL'});
 await tick();
 assert.deepEqual(got,{b:['WORKSPACE','APPLICATION','GLOBAL'],c:['WORKSPACE','GLOBAL'],d:['GLOBAL']});
 assert.deepEqual(payload,{n:1},'receivers get copies');assert.equal(errors.length,3);assert.equal(errors[0].code,'EVENT_LISTENER_FAILED');
 assert.throws(()=>a.publish('unnamespaced',{}),/namespaced/);assert.throws(()=>a.publish('x:big',{s:'x'.repeat(70000)}),/exceeds/);
 assert.throws(()=>a.publish('x:fn',{f:BigInt(1)}),/JSON/);
 b.release();assert.equal(hub.size,2);
});

test('plain DOM renderer keeps slot elements stable and reflects states',async()=>{
 const runtime=fakeRuntime();const engine=new WorkspaceEngine({runtime,context:signedIn({'app:directory':['view']})});
 await engine.setLayout('TABS');const doc=fakeDocument();const root=doc.createElement('main');
 const dispose=renderDomWorkspace(engine,root);
 const a=engine.open('/directory');const b=engine.open('/finance');await tick();await tick();
 const frames=root.children.filter(c=>c.attributes['data-slot-id']);
 assert.deepEqual(frames.map(f=>[f.attributes['data-slot-id'],f.attributes['data-status'],f.hidden]),[[a,'MOUNTED',true],[b,'DENIED',false]]);
 const body=frames[0].children[2];engine.focus(a);await tick();
 assert.equal(root.children.filter(c=>c.attributes['data-slot-id'])[0].children[2],body,'same element after re-render');
 assert.equal(runtime.log.filter(e=>e[0]==='mount').length,1,'focus does not remount');
 dispose();await tick();assert.equal(runtime.instances.size,0);
});
