import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MfeRuntime} from '@hive-platform/mfe-runtime';
import {HiveRuntimeError} from '@hive-platform/core';
import {fakeDocument,sri,fakeFetch,runtimeModule} from './support.mjs';

// The exposed module of a federated remote must still provide the framework-neutral micro-app contract.
const microApp=label=>({default:{contractVersion:'1.1.0',create(){let el;return{mount(element){el=element;element.textContent=label;},unmount(){el.textContent='';}};}}});
const mountInput=id=>({instanceId:id,slotId:'s-'+id,route:'/reports',params:{},locale:'en',direction:'ltr',context:{authenticated:false},permissions:{can:()=>false},
 events:{publish(){},subscribe:()=>()=>{}},basePath:'/reports',navigate(){}});
const code=async promise=>{try{await promise;return 'OK';}catch(error){assert.ok(error instanceof HiveRuntimeError,String(error));return error.diagnostic.code;}};
const ENTRY='/api/mfe/reports/1.0.0/remoteEntry.js';
const SOURCE='// container entry bytes';

/** A DOM whose <script> elements "execute" by invoking a callback, like a browser running the container script. */
function scriptDocument(onScript){
 const document=fakeDocument();const window={};document.defaultView=window;document.head=document.createElement('head');
 const append=document.head.appendChild.bind(document.head);
 document.head.appendChild=element=>{append(element);if(element.tagName==='script')queueMicrotask(()=>onScript(element,window));return element;};
 return {document,window};
}

async function federated(format,{artifact={},importUrl,document,source=SOURCE}={}){
 const integrity=await sri(source);
 const module=runtimeModule({moduleKey:'reports',artifact:{url:ENTRY,integrity,format,exposedModule:'./plugin',...artifact}});
 const calls=[];
 const runtime=new MfeRuntime({fetch:fakeFetch({[ENTRY]:{body:SOURCE,headers:{'Content-Type':'text/javascript'}}},calls),importUrl,document,lifecycleTimeoutMs:500});
 return {runtime,module,calls};
}

test('Vite federation: the container is imported by URL, initialized with the share scope and its exposed module mounted',async()=>{
 const seen={};
 const importUrl=async url=>{seen.url=url;return {init(scope){seen.scope=scope;},get:async key=>{seen.key=key;return ()=>microApp('vite remote');}};};
 const {runtime,module}=await federated('VITE_FEDERATION',{importUrl});
 const host=fakeDocument().createElement('div');
 const instance=await runtime.mount(host,module,mountInput('v1'));
 assert.equal(host.children[0].textContent,'vite remote');
 assert.deepEqual([seen.url,seen.key,typeof seen.scope],[ENTRY,'./plugin','object']);
 await instance.unmount();
});

test('Vite federation diagnostics: unknown exposed module, missing container and failed import',async()=>{
 const notExposed=await federated('VITE_FEDERATION',{importUrl:async()=>({init(){},get:async key=>{throw new Error(`Module ${key} does not exist in container.`);}})});
 assert.equal(await code(notExposed.runtime.load(notExposed.module)),'FEDERATION_MODULE_NOT_FOUND');
 const noContainer=await federated('VITE_FEDERATION',{importUrl:async()=>({something:1})});
 assert.equal(await code(noContainer.runtime.load(noContainer.module)),'FEDERATION_CONTAINER_INVALID');
 const broken=await federated('VITE_FEDERATION',{importUrl:async()=>{throw new SyntaxError('Unexpected token');}});
 assert.equal(await code(broken.runtime.load(broken.module)),'ARTIFACT_MODULE_FORMAT');
 const wrongContract=await federated('VITE_FEDERATION',{importUrl:async()=>({init(){},get:async()=>()=>({default:{render(){}}})})});
 assert.equal(await code(wrongContract.runtime.load(wrongContract.module)),'MICRO_APP_CONTRACT_INVALID');
});

test('webpack federation: the container script is attached with SRI and its global container provides the exposed module',async()=>{
 const {document,window}=scriptDocument((script,win)=>{win[script.getAttribute('data-hive-remote')]={init(){},get:async()=>()=>microApp('webpack remote')};script.onload();});
 const {runtime,module}=await federated('WEBPACK_FEDERATION',{artifact:{remoteName:'reports_remote'},document});
 const host=document.createElement('div');
 await runtime.mount(host,module,mountInput('w1'));
 assert.equal(host.children[0].textContent,'webpack remote');
 const script=document.head.children[0];
 assert.equal(script.src,ENTRY);assert.equal(script.integrity,module.artifact.integrity);assert.equal(script.crossOrigin,'anonymous');
 assert.ok(window.reports_remote);
 await runtime.mount(document.createElement('div'),module,mountInput('w2'));
 assert.equal(document.head.children.length,1,'one container script serves every instance');
});

test('webpack federation diagnostics: refused script, missing global, missing descriptor and integrity checked before attaching',async()=>{
 const refused=scriptDocument(script=>script.onerror());
 const a=await federated('WEBPACK_FEDERATION',{artifact:{remoteName:'r'},document:refused.document});
 assert.equal(await code(a.runtime.load(a.module)),'FEDERATION_SCRIPT_FAILED');
 const silent=scriptDocument(script=>script.onload());
 const b=await federated('WEBPACK_FEDERATION',{artifact:{remoteName:'r'},document:silent.document});
 assert.equal(await code(b.runtime.load(b.module)),'FEDERATION_CONTAINER_INVALID');
 const c=await federated('WEBPACK_FEDERATION',{document:silent.document});
 assert.equal(await code(c.runtime.load(c.module)),'ARTIFACT_MODULE_FORMAT');
 const tampered=scriptDocument(()=>assert.fail('a tampered entry must never be attached'));
 const d=await federated('WEBPACK_FEDERATION',{artifact:{remoteName:'r'},document:tampered.document,source:'other bytes'});
 assert.equal(await code(d.runtime.load(d.module)),'ARTIFACT_INTEGRITY_MISMATCH');
 assert.equal(tampered.document.head.children.length,0);
});

test('unknown formats are rejected and custom loaders can be registered per format',async()=>{
 const {runtime,module}=await federated('SYSTEMJS');
 assert.equal(await code(runtime.load(module)),'ARTIFACT_MODULE_FORMAT');
 const custom=new MfeRuntime({loaders:[{format:'SYSTEMJS',load:async()=>microApp('custom')}]});
 const app=await custom.load(module);
 assert.equal(app.contractVersion,'1.1.0');
});
