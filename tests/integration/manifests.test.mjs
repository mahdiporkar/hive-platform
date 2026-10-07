// Phase 5: manifest governance — import, validation, draft, diff, publish, immutability, versions, history, rollback,
// artifact activation, route validation, fetch error classification, definition modes and navigation overlays.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {startStack} from '../support/stack.mjs';

const fixturePort=29590,fixture=`http://127.0.0.1:${fixturePort}`;
const resources=(version,list)=>({schemaVersion:'1.0.0',manifestVersion:version,applicationKey:'fixture-app',moduleKey:'records',resources:list});
const v1=[
 {key:'records',type:'MODULE',parentKey:'fixture-app',name:'Records',actions:['view']},
 {key:'records.list',type:'PAGE',parentKey:'records',name:'List',actions:['view','export']},
 {key:'records.legacy',type:'PAGE',parentKey:'records',name:'Legacy page',actions:['view']},
];
const v2=[
 {key:'records',type:'MODULE',parentKey:'fixture-app',name:'Records',actions:['view']},
 {key:'records.list',type:'PAGE',parentKey:'records',name:'Record list',actions:['view','print']},
 {key:'records.detail',type:'PAGE',parentKey:'records.list',name:'Detail',actions:['view']},
];
const frontend=(version,overrides={})=>({schemaVersion:'1.0.0',manifestVersion:version,contractVersion:'1.1.0',runtimeVersion:'1.0.0',applicationKey:'fixture-app',moduleKey:'records',
 displayName:'Records',resourceManifestVersion:'1.0.0',artifact:{url:'/modules/records/entry.js',integrity:'sha384-'+'A'.repeat(64),format:'ES_MODULE'},
 routes:[{key:'list',path:'/records',access:'AUTHENTICATED',resource:'records.list',action:'view',navigation:{label:'Records',order:2}},
  {key:'about',path:'/records/about',access:'PUBLIC',navigation:{label:'About records',order:1}}],...overrides});

test('manifest governance lifecycle',{timeout:300000},async t=>{
 const served=new Map();
 const server=createServer((req,res)=>{
  if(req.url==='/redirect.json'){res.writeHead(302,{Location:fixture+'/records/resources.json'});return res.end();}
  if(req.url==='/html.json'){res.writeHead(200,{'Content-Type':'text/html'});return res.end('<html>');}
  const body=served.get(req.url);if(!body){res.writeHead(404);return res.end();}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(body));
 });
 await new Promise(r=>server.listen(fixturePort,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const stack=await startStack(t,{suite:'manifests',base:29500,bff:false,authorizationEnv:{HIVE_ARTIFACT_NETWORK_POLICY:'DEVELOPMENT',HIVE_ARTIFACT_ALLOW_HTTP:'true'}});
 const call=async(path,{method='GET',body}={})=>{const r=await stack.service(path,{method,body});const text=await r.text();return {status:r.status,body:text?JSON.parse(text):null};};
 const ok=async(path,options)=>{const r=await call(path,options);assert.ok(r.status<300,`${options?.method??'GET'} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);return r.body;};
 const expectCode=async(path,options,status,code)=>{const r=await call(path,options);assert.equal(r.status,status,`${path}: ${JSON.stringify(r.body)}`);if(code)assert.equal(r.body.code,code,JSON.stringify(r.body));return r.body;};
 const decision=async(userId,resourceKey,action)=>(await stack.service('/internal/authorization/check',{method:'POST',principal:'bff',body:{userId,checks:[{applicationKey:'fixture-app',resourceKey,action}]}}).then(r=>r.json()))[0];

 await ok('/admin/applications',{method:'POST',body:{key:'fixture-app',displayName:'Fixture'}});
 await ok('/admin/modules',{method:'POST',body:{applicationKey:'fixture-app',moduleKey:'records',displayName:'Records',definitionMode:'MANIFEST',resourceManifestUrl:fixture+'/records/resources.json'}});
 await expectCode('/admin/modules',{method:'POST',body:{applicationKey:'fixture-app',moduleKey:'records',displayName:'Again'}},409);
 const base='/admin/modules/records/resource-manifests';

 // Validation failures are rejected before any draft exists.
 await expectCode(base,{method:'POST',body:{...resources('0.9.0',v1),routes:[]}},422,'MANIFEST_INVALID');
 await expectCode(base,{method:'POST',body:{...resources('0.9.0',v1),schemaVersion:'2.0.0'}},422,'VERSION_MAJOR_UNSUPPORTED');
 await expectCode(base,{method:'POST',body:resources('0.9.0',[v1[0],v1[0]])},422,'MANIFEST_INVALID');
 await expectCode(base,{method:'POST',body:resources('0.9.0',[{key:'bad',type:'PAGE',parentKey:'fixture-app',name:'Page at root'}])},400,'VALIDATION_FAILED');
 await expectCode(base,{method:'POST',body:resources('0.9.0',[{key:'a',type:'MODULE',parentKey:'b',name:'A'},{key:'b',type:'MODULE',parentKey:'a',name:'B'}])},400,'VALIDATION_FAILED');
 await expectCode(base,{method:'POST',body:{...resources('0.9.0',v1),moduleKey:'other'}},422,'MANIFEST_IDENTITY_MISMATCH');
 assert.deepEqual(await ok(base),[],'no draft created by invalid imports');
 assert.equal(stack.sql("select count(*) from resource where resource_key like 'records%'"),'0','validation dry-run leaves no resources');

 // Draft, idempotent re-import, immutable version, diff, publish.
 const imported=await call(base,{method:'POST',body:resources('1.0.0',v1)});assert.equal(imported.status,201);assert.equal(imported.body.revision.status,'DRAFT');
 assert.equal((await call(base,{method:'POST',body:resources('1.0.0',v1)})).status,200,'identical re-import is idempotent');
 await expectCode(base,{method:'POST',body:resources('1.0.0',v2)},409,'MANIFEST_VERSION_IMMUTABLE');
 const diff1=await ok(`${base}/1.0.0/diff`);assert.deepEqual(diff1.changes.map(c=>c.kind).sort(),['ADDED','ADDED','ADDED']);assert.equal(diff1.conflicts,false);
 assert.equal(stack.sql("select count(*) from resource where resource_key like 'records%'"),'0','drafts do not change the catalog');
 const published=await ok(`${base}/1.0.0/publish`,{method:'POST'});assert.equal(published.status,'PUBLISHED');assert.equal(published.active,true);
 await expectCode(`${base}/1.0.0/publish`,{method:'POST'},409,'MANIFEST_ALREADY_PUBLISHED');
 await expectCode(`${base}/1.0.0`,{method:'DELETE'},409,'MANIFEST_VERSION_IMMUTABLE');
 assert.throws(()=>stack.sql("update resource_manifest_revision set document='{}'::jsonb where manifest_version='1.0.0'"),/immutable/,'database enforces immutability');
 assert.equal((await ok(`${base}/1.0.0`)).checksum,imported.body.revision.checksum);

 // Authorization uses the published vocabulary.
 const user=(await ok('/admin/users',{method:'POST',body:{displayName:'Manifest fixture user'}})).id;
 await ok('/admin/grants',{method:'POST',body:{subject:`user:${user}`,applicationKey:'fixture-app',resourceKey:'records.legacy',action:'view'}});
 await ok('/admin/grants',{method:'POST',body:{subject:`user:${user}`,applicationKey:'fixture-app',resourceKey:'records.list',action:'export'}});
 assert.equal((await decision(user,'records.legacy','view')).allowed,true);

 // Ownership and definition modes.
 await ok('/admin/modules',{method:'POST',body:{applicationKey:'fixture-app',moduleKey:'intruder',displayName:'Intruder',definitionMode:'MANIFEST'}});
 await expectCode('/admin/modules/intruder/resource-manifests',{method:'POST',body:{...resources('1.0.0',[{key:'records.list',type:'PAGE',parentKey:'fixture-app',name:'Takeover'}]),moduleKey:'intruder'}},409,'RESOURCE_OWNED');
 await expectCode('/admin/applications/fixture-app/resources',{method:'POST',body:{key:'manual.child',type:'PAGE',parentKey:'records',displayName:'Manual child'}},409,'DEFINITION_MODE');
 const recordsModule=await ok('/admin/modules/records');
 await ok('/admin/modules/records',{method:'PUT',body:{definitionMode:'HYBRID',resourceManifestUrl:recordsModule.resourceManifestUrl,revision:recordsModule.revision}});
 await ok('/admin/applications/fixture-app/resources',{method:'POST',body:{key:'manual.child',type:'PAGE',parentKey:'records',displayName:'Manual child'}});
 await ok('/admin/modules',{method:'POST',body:{applicationKey:'fixture-app',moduleKey:'manual-only',displayName:'Manual',definitionMode:'MANUAL'}});
 await expectCode('/admin/modules/manual-only/resource-manifests',{method:'POST',body:{...resources('1.0.0',v1),moduleKey:'manual-only'}},409,'DEFINITION_MODE');

 // Fetch with classified failures, then version 2 from the registered location.
 served.set('/records/resources.json',resources('2.0.0',v2));
 for(const [url,code] of [[fixture+'/missing.json','MANIFEST_HTTP_ERROR'],[fixture+'/redirect.json','MANIFEST_REDIRECT_REFUSED'],[fixture+'/html.json','MANIFEST_CONTENT_TYPE'],
  ['http://127.0.0.1:1/closed.json','MANIFEST_UNREACHABLE'],['http://169.254.169.254/latest.json','MANIFEST_LOCATION_REJECTED'],[fixture+'/x.txt','MANIFEST_LOCATION_REJECTED']])
  await expectCode(`${base}/fetch`,{method:'POST',body:{url}},url.includes('169.254')||url.endsWith('.txt')?422:502,code);
 const fetched=await call(`${base}/fetch`,{method:'POST'});assert.equal(fetched.status,201,JSON.stringify(fetched.body));assert.equal(fetched.body.revision.source,'FETCH');
 const diff2=await ok(`${base}/2.0.0/diff`);const kinds=diff2.changes.map(c=>`${c.kind}:${c.resourceKey}${c.detail?':'+c.detail:''}`);
 for(const expected of ['ADDED:records.detail:PAGE','RENAMED:records.list:List -> Record list','ACTION_ADDED:records.list:print','ACTION_ARCHIVED:records.list:export','ARCHIVED:records.legacy:PAGE'])
  assert.ok(kinds.includes(expected),`diff contains ${expected}: ${kinds}`);
 const v2published=await ok(`${base}/2.0.0/publish`,{method:'POST'});assert.equal(v2published.active,true);
 assert.equal((await decision(user,'records.legacy','view')).reason,'RESOURCE_ARCHIVED','removed resource archived, not deleted');
 assert.equal((await decision(user,'records.list','export')).reason,'ACTION_UNDECLARED','removed action archived');
 assert.equal(stack.sql('select count(*) from permission_grant where revoked_at is null'),'2','grants survive version change as history');

 // Rollback to 1.0.0 restores vocabulary and therefore the surviving grants; then roll forward again.
 await ok(`${base}/1.0.0/activate`,{method:'POST'});
 assert.equal((await decision(user,'records.legacy','view')).allowed,true,'rollback restores archived resource');
 assert.equal((await decision(user,'records.list','export')).allowed,true,'rollback restores archived action');
 await expectCode(`${base}/9.9.9/activate`,{method:'POST'},404);
 await ok(`${base}/2.0.0/activate`,{method:'POST'});
 assert.equal((await decision(user,'records.legacy','view')).reason,'RESOURCE_ARCHIVED');
 assert.deepEqual((await ok(base)).map(r=>[r.manifestVersion,r.status,r.active]),[['1.0.0','PUBLISHED',false],['2.0.0','PUBLISHED',true]]);

 // Micro-frontend manifests: immutable artifact revisions, compatibility, coordinated activation, route validation.
 const artifacts='/admin/modules/records/artifacts';
 const registered=await call(artifacts,{method:'POST',body:frontend('1.0.0')});assert.equal(registered.status,201);assert.deepEqual(registered.body.warnings,[]);
 await expectCode(artifacts,{method:'POST',body:frontend('1.0.0',{displayName:'Changed'})},409,'MANIFEST_VERSION_IMMUTABLE');
 const incompatible=await expectCode(artifacts,{method:'POST',body:frontend('9.0.0',{contractVersion:'2.0.0'})},422,'VERSION_MAJOR_UNSUPPORTED');
 assert.match(incompatible.message,/contractVersion: supported major 1, received 2/);
 await expectCode(artifacts,{method:'POST',body:frontend('9.0.1',{runtimeVersion:'1.3.0'})},422,'VERSION_MINOR_UNSUPPORTED');
 await expectCode(artifacts,{method:'POST',body:frontend('9.0.2',{artifact:{url:'/modules/records/entry.js',format:'ES_MODULE'}})},422,'INTEGRITY_REQUIRED');
 const deprecated=await call(artifacts,{method:'POST',body:frontend('1.0.1',{contractVersion:'1.0.0'})});assert.equal(deprecated.status,201);assert.equal(deprecated.body.warnings[0].code,'VERSION_DEPRECATED');
 const runtimeBefore=(await ok('/admin/runtime/catalog')).revision;
 assert.deepEqual((await ok('/admin/runtime/catalog')).modules,[],'no module is active before artifact activation');
 const activated=await ok(`${artifacts}/1.0.0/activate`,{method:'POST'});
 assert.equal(activated.activeArtifactVersion,'1.0.0');assert.equal(activated.activeResourceVersion,'1.0.0','artifact activation coordinates its resource revision');
 assert.equal((await decision(user,'records.legacy','view')).allowed,true);
 let catalog=await ok('/admin/runtime/catalog');assert.ok(catalog.revision>runtimeBefore);
 assert.deepEqual(catalog.modules.map(m=>[m.moduleKey,m.manifestVersion,m.routes.map(r=>r.key)]),[['records','1.0.0',['about','list']]]);
 await expectCode(artifacts,{method:'POST',body:frontend('2.0.0',{resourceManifestVersion:'2.0.0',routes:[{key:'list',path:'/records',access:'AUTHENTICATED',resource:'records.list',action:'export'}]})},201);
 await expectCode(`${artifacts}/2.0.0/activate`,{method:'POST'},409,'ROUTE_RESOURCE_UNDECLARED');
 assert.equal((await ok('/admin/modules/records')).activeResourceVersion,'1.0.0','failed activation rolled back entirely');
 await expectCode(artifacts,{method:'POST',body:frontend('2.1.0',{resourceManifestVersion:'7.7.7'})},201);
 await expectCode(`${artifacts}/2.1.0/activate`,{method:'POST'},409,'RESOURCE_MANIFEST_NOT_PUBLISHED');
 served.set('/records/mf.json',frontend('3.0.0',{resourceManifestVersion:'2.0.0',routes:[{key:'detail',path:'/records/:id',access:'AUTHENTICATED',resource:'records.detail',action:'view',navigation:{label:'Detail',order:3}},{key:'about',path:'/records/about',access:'PUBLIC'}]}));
 const fetchedArtifact=await call(`${artifacts}/fetch`,{method:'POST',body:{url:fixture+'/records/mf.json'}});assert.equal(fetchedArtifact.status,201,JSON.stringify(fetchedArtifact.body));
 await ok(`${artifacts}/3.0.0/activate`,{method:'POST'});
 assert.equal((await ok('/admin/modules/records')).activeResourceVersion,'2.0.0');

 // Route paths are unique across active modules.
 await ok('/admin/modules',{method:'POST',body:{applicationKey:'fixture-app',moduleKey:'shadow',displayName:'Shadow',definitionMode:'MANUAL'}});
 const shadow={...frontend('1.0.0'),moduleKey:'shadow',routes:[{key:'clash',path:'/records/about',access:'PUBLIC'}]};delete shadow.resourceManifestVersion;
 await ok('/admin/modules/shadow/artifacts',{method:'POST',body:shadow});
 await expectCode('/admin/modules/shadow/artifacts/1.0.0/activate',{method:'POST'},409,'ROUTE_CONFLICT');

 // Navigation overlays change presentation only.
 await ok('/admin/modules/records/navigation/about',{method:'PUT',body:{routeKey:'about',hidden:true,revision:0}});
 await ok('/admin/modules/records/navigation/detail',{method:'PUT',body:{routeKey:'detail',label:'Draft label',hidden:false,revision:0}});
 assert.equal((await ok('/admin/modules/records/navigation/detail',{method:'PUT',body:{routeKey:'detail',label:'Record detail',order:1,hidden:false,revision:0}})).revision,1);
 await expectCode('/admin/modules/records/navigation/detail',{method:'PUT',body:{routeKey:'detail',label:'Stale',hidden:false,revision:0}},409);
 catalog=await ok('/admin/runtime/catalog');const routes=Object.fromEntries(catalog.modules[0].routes.map(r=>[r.key,r]));
 assert.equal(routes.about.navigation,undefined,'hidden route has no navigation entry');assert.equal(routes.about.access,'PUBLIC','route itself still served');
 assert.equal(routes.detail.navigation.label,'Record detail');
 assert.equal((await decision(user,'records.detail','view')).reason,'NO_RELATIONSHIP','overlays never grant access');

 // History, audit and the runtime-plane projection over the service channel.
 const releases=(await ok('/admin/modules/records/releases')).map(r=>r.action);
 assert.deepEqual(releases,['RESOURCES_PUBLISHED','RESOURCES_PUBLISHED','RESOURCES_ACTIVATED','RESOURCES_ACTIVATED','RESOURCES_ACTIVATED','ARTIFACT_ACTIVATED','RESOURCES_ACTIVATED','ARTIFACT_ACTIVATED']);
 const audit=(await ok('/admin/audit?eventType=manifest.&limit=100')).map(e=>e.eventType);
 for(const type of ['manifest.resources.imported','manifest.resources.published','manifest.resources.activated','manifest.artifact.registered','manifest.artifact.activated'])assert.ok(audit.includes(type),type);
 assert.equal((await stack.service('/internal/runtime/catalog',{principal:'bff'})).status,200);
 assert.equal((await stack.service('/internal/runtime/catalog',{principal:'provisioner'})).status,403);
 const deactivated=await ok('/admin/modules/records/deactivate',{method:'POST'});assert.equal(deactivated.activeArtifactVersion,undefined);
 assert.deepEqual((await ok('/admin/runtime/catalog')).modules,[]);
});
