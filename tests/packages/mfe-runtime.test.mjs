import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MfeRuntime,integrityOf} from '@hive-platform/mfe-runtime';
import {HiveRuntimeError} from '@hive-platform/core';
import {fakeDocument,dataImporter,sri,fakeFetch,runtimeModule} from './support.mjs';

// A framework-neutral micro-app written directly against the lifecycle contract.
const APP=`let created=0;
export default {contractVersion:'1.1.0',create(){const id=++created;let el;return{
 mount(element,context){el=element;element.textContent='mounted '+id+' '+context.route+' '+context.instanceId;element.setAttribute('data-locale',context.locale);},
 update(context){el.textContent='updated '+id+' '+context.route;},
 unmount(){el.textContent='';}}}};`;

const mountInput=(instanceId,route='/records')=>({instanceId,slotId:'s-'+instanceId,route,params:{},locale:'en',direction:'ltr',context:{authenticated:false},permissions:{can:()=>false},
 events:{publish(){},subscribe:()=>()=>{}},basePath:'/records',navigate(){}});

async function setup(source=APP,overrides={},fetchRoutes){
 const integrity=overrides.integrity??await sri(source);
 const module=runtimeModule({artifact:{url:'https://cdn.example.test/records.js',integrity,format:'ES_MODULE'},...overrides.module});
 const calls=[];const diagnostics=[];
 const runtime=new MfeRuntime({fetch:fakeFetch(fetchRoutes??{[module.artifact.url]:{body:source,headers:{'Content-Type':'text/javascript'}}},calls),importModule:dataImporter,onDiagnostic:d=>diagnostics.push(d),lifecycleTimeoutMs:300});
 return {runtime,module,calls,diagnostics};
}
const code=async(promise)=>{try{await promise;return 'OK';}catch(error){assert.ok(error instanceof HiveRuntimeError,String(error));return error.diagnostic.code;}};

test('mount, update and unmount through the framework-neutral contract',async()=>{
 const {runtime,module}=await setup();const document=fakeDocument();const host=document.createElement('section');
 const instance=await runtime.mount(host,module,mountInput('i1'));
 assert.equal(host.children.length,1);const container=host.children[0];
 assert.equal(container.getAttribute('data-hive-module'),'records');assert.equal(container.getAttribute('data-hive-instance'),'i1');
 assert.match(container.textContent,/^mounted 1 \/records i1$/);assert.equal(container.getAttribute('data-locale'),'en');
 await instance.update(mountInput('i1','/records/42'));assert.equal(container.textContent,'updated 1 /records/42');
 await instance.unmount();assert.equal(host.children.length,0,'container removed');
 await instance.unmount();// idempotent
});

test('one artifact load serves multiple independent instances of the same module',async()=>{
 const {runtime,module,calls}=await setup();const document=fakeDocument();
 const a=document.createElement('div'),b=document.createElement('div');
 const [first,second]=await Promise.all([runtime.mount(a,module,mountInput('a')),runtime.mount(b,module,mountInput('b'))]);
 assert.equal(calls.length,1,'artifact fetched once');
 assert.match(a.children[0].textContent,/^mounted \d i?a?/);assert.notEqual(a.children[0].textContent.split(' ')[1],b.children[0].textContent.split(' ')[1],'independent instances');
 await first.unmount();assert.equal(b.children.length,1,'unmounting one instance leaves the other');await second.unmount();
});

test('shadow DOM isolation mounts inside a shadow root',async()=>{
 const {runtime,module}=await setup(APP,{module:{styleIsolation:'SHADOW_DOM'}});const host=fakeDocument().createElement('div');
 const instance=await runtime.mount(host,module,mountInput('s'));
 assert.equal(host.children.length,0);assert.equal(host.shadowRoot.children.length,1);
 await instance.unmount();assert.equal(host.shadowRoot.children.length,0);
});

test('every failure class has its own diagnostic',async()=>{
 const host=()=>fakeDocument().createElement('div');
 // Version problems are detected before anything is fetched.
 let s=await setup(APP,{module:{contractVersion:'2.0.0'}});assert.equal(await code(s.runtime.mount(host(),s.module,mountInput('x'))),'MANIFEST_INCOMPATIBLE');assert.equal(s.calls.length,0,'nothing fetched');
 s=await setup(APP,{module:{runtimeVersion:'1.5.0'}});assert.equal(await code(s.runtime.load(s.module)),'MANIFEST_INCOMPATIBLE');
 s=await setup(APP,{},{});assert.equal(await code(s.runtime.load(s.module)),'ARTIFACT_NETWORK_FAILURE');
 s=await setup(APP,{},{'https://cdn.example.test/records.js':{status:404,body:'missing'}});assert.equal(await code(s.runtime.load(s.module)),'ARTIFACT_HTTP_ERROR');
 s=await setup(APP,{integrity:await sri('something else')});assert.equal(await code(s.runtime.load(s.module)),'ARTIFACT_INTEGRITY_MISMATCH');
 s=await setup(APP,{integrity:'md5-abc'});assert.equal(await code(s.runtime.load(s.module)),'ARTIFACT_INTEGRITY_UNSUPPORTED');
 s=await setup('this is not javascript {');assert.equal(await code(s.runtime.load(s.module)),'ARTIFACT_MODULE_FORMAT');
 s=await setup('export const nothing=1;');assert.equal(await code(s.runtime.load(s.module)),'MICRO_APP_CONTRACT_INVALID');
 s=await setup(APP.replace("contractVersion:'1.1.0'","contractVersion:'1.0.0'"));assert.equal(await code(s.runtime.load(s.module)),'MICRO_APP_CONTRACT_MISMATCH');
 s=await setup(APP.replace("element.textContent='mounted","throw new Error('boom');element.textContent='mounted"));const h=host();assert.equal(await code(s.runtime.mount(h,s.module,mountInput('x'))),'MOUNT_FAILED');assert.equal(h.children.length,0,'failed mount cleaned up');
 s=await setup(APP.replace('mount(element,context){','mount(element,context){return new Promise(()=>{});'));assert.equal(await code(s.runtime.mount(host(),s.module,mountInput('x'))),'MOUNT_TIMEOUT');
});

test('deprecated contracts load with a warning; failed loads are retried',async()=>{
 const source=APP.replace("contractVersion:'1.1.0'","contractVersion:'1.0.0'");
 const {runtime,module,diagnostics}=await setup(source,{module:{contractVersion:'1.0.0'}});
 await runtime.load(module);assert.equal(diagnostics[0].code,'VERSION_DEPRECATED');
 let attempts=0;const integrity=await sri(APP);const url='https://cdn.example.test/flaky.js';
 const flaky=new MfeRuntime({importModule:dataImporter,fetch:async()=>{if(++attempts===1)throw new TypeError('offline');return new Response(APP);}});
 const m=runtimeModule({artifact:{url,integrity,format:'ES_MODULE'}});
 assert.equal(await code(flaky.load(m)),'ARTIFACT_NETWORK_FAILURE');assert.equal(await code(flaky.load(m)),'OK','not cached after failure');
});

test('integrityOf produces SRI values the runtime accepts',async()=>{
 const value=await integrityOf(new TextEncoder().encode(APP),'sha512');assert.match(value,/^sha512-/);
 const {runtime,module}=await setup(APP,{integrity:value});await runtime.load(module);
});
