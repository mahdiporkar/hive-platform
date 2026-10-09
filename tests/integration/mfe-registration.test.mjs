// Dynamic micro-frontend registration by network address and the BFF artifact gateway, end to end through the real
// control plane, BFF, OpenFGA and PostgreSQL: probe diagnostics, registration, same-origin delivery with chunk/CSS
// resolution, per-user visibility, server-side authorization, hybrid governance with real impact, versioning and
// rollback, address change, integrity, route conflicts, unauthorized destinations and deactivation.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {startStack,cookieClient} from '../support/stack.mjs';
import {startOidcProvider,login} from '../support/oidc-fixture.mjs';
import {startUpstream} from '../support/upstream-fixture.mjs';
import {startMfeFixture,reportResources,sri} from '../support/mfe-fixture.mjs';
import {adminApi} from '../support/solution.mjs';

const MFE_PORT=Number(process.env.HIVE_TEST_MFE_PORT??3004);
const base=31100;

test('micro-frontend registration by IP and port, artifact gateway, governance and rollback',{timeout:600000},async t=>{
 const idp=await startOidcProvider({port:base+80});t.after(()=>idp.close());
 const upstream=await startUpstream({port:base+85});t.after(()=>upstream.close());
 const v1=await startMfeFixture({port:MFE_PORT,flavor:'webpack'});t.after(()=>v1.close());
 const stack=await startStack(t,{suite:'mfe-registration',base,
  authorizationEnv:{HIVE_PRIMARY_ISSUER:idp.issuer,HIVE_ARTIFACT_NETWORK_POLICY:'UNRESTRICTED',HIVE_ARTIFACT_ALLOW_HTTP:'true',HIVE_TARGET_ALLOW_HTTP:'true'},
  bffEnv:{HIVE_IDENTITY_ENABLED:'true',HIVE_OIDC_ISSUER:idp.issuer,HIVE_OIDC_CLIENT_ID:idp.clientId,HIVE_OIDC_CLIENT_SECRET:idp.clientSecret,HIVE_OIDC_ALLOW_LOCAL_HTTP:'true',
   HIVE_MFE_NETWORK_POLICY:'UNRESTRICTED',HIVE_MFE_ALLOW_HTTP:'true',HIVE_MFE_RESOLVE_TTL_MS:'0',HIVE_MFE_CACHE_TTL_SECONDS:'2',HIVE_PROXY_ALLOWED_ORIGINS:upstream.origin,HIVE_PROXY_ALLOW_HTTP:'true'}});
 const api=adminApi(stack);
 const expectCode=async(path,options,status,code)=>{const r=await api.call(path,options);assert.equal(r.status,status,`${path} ${JSON.stringify(r.body)}`);if(code)assert.equal(r.body.code,code,JSON.stringify(r.body));return r.body;};
 const check=(result,key)=>result.checks.find(c=>c.key===key);
 const probe=body=>api.ok('/admin/modules/probe',{method:'POST',body});

 // ---- Probe: address, policy, reachability, format, integrity and manifest discovery -------------------------------
 const inspected=await probe({protocol:'http',host:'127.0.0.1',port:MFE_PORT,entryPath:'/remoteEntry.js'});
 assert.equal(inspected.ok,true,JSON.stringify(inspected.checks));
 assert.equal(inspected.url,`http://127.0.0.1:${MFE_PORT}/remoteEntry.js`);
 assert.deepEqual([inspected.detectedFormat,inspected.remoteName,inspected.exposedModules],['WEBPACK_FEDERATION',v1.remoteName,['./plugin']]);
 assert.equal(inspected.integrity,v1.integrity(),'SRI computed from the served bytes');
 assert.equal(check(inspected,'mfManifest').status,'PASS');assert.equal(check(inspected,'resourceManifest').status,'PASS');
 const viaUrl=await probe({url:v1.url,fetchManifests:false});
 assert.equal(viaUrl.ok,true);assert.equal(viaUrl.mfManifest,undefined,'manifests are fetched only on request');
 assert.equal((await probe({url:v1.url,validateOnly:true})).checks.at(-1).key,'policy','validate-only stops before contacting the host');

 // Failure diagnostics: offline server, wrong port, unreachable IP, missing entry, incompatible bundle, blocked destinations.
 const offline=await startMfeFixture({port:base+86});await offline.close();
 assert.equal(check(await probe({url:offline.url}),'reachability').code,'CONNECTION_REFUSED','server offline');
 assert.equal(check(await probe({protocol:'http',host:'127.0.0.1',port:base+87}),'reachability').code,'CONNECTION_REFUSED','incorrect port');
 const unreachable=check(await probe({url:'http://10.255.255.1:3004/remoteEntry.js'}),'reachability');
 assert.ok(['HOST_UNREACHABLE','CONNECTION_REFUSED'].includes(unreachable.code),JSON.stringify(unreachable));
 assert.equal(check(await probe({url:`${v1.origin}/missing/remoteEntry.js`}),'http').code,'ENTRY_NOT_FOUND');
 assert.equal(check(await probe({url:`${v1.origin}/plain.js`}),'format').code,'FORMAT_UNRECOGNIZED');
 assert.equal(check(await probe({url:'http://169.254.169.254/latest/remoteEntry.js'}),'policy').code,'ADDRESS_BLOCKED','cloud metadata');
 assert.equal(check(await probe({url:`http://user:secret@127.0.0.1:${MFE_PORT}/remoteEntry.js`}),'policy').code,'ADDRESS_INVALID','credentials in URL');
 assert.equal(check(await probe({protocol:'ftp',host:'127.0.0.1'}),'address').code,'ADDRESS_INVALID');

 // ---- Registration (HYBRID) from the address: module, manifests fetched from the MFE, publish, activate ------------
 await api.ok('/admin/applications',{method:'POST',body:{key:'reporting',displayName:'Reporting'}});
 const registered=await api.ok('/admin/modules',{method:'POST',body:{applicationKey:'reporting',moduleKey:'reports',displayName:'Reports Management',definitionMode:'HYBRID',
  description:'Operational reports',icon:'report',environment:'production',entryUrl:inspected.url,mfManifestUrl:inspected.mfManifestUrl,resourceManifestUrl:inspected.resourceManifestUrl}});
 assert.deepEqual([registered.entryUrl,registered.icon,registered.environment],[inspected.url,'report','production']);
 await expectCode('/admin/modules',{method:'POST',body:{applicationKey:'reporting',moduleKey:'bad-entry',displayName:'x',entryUrl:'http://169.254.169.254/x.js'}},422,'ARTIFACT_LOCATION_REJECTED');
 await api.ok('/admin/modules/reports/resource-manifests/fetch',{method:'POST',body:{}});
 await api.ok('/admin/modules/reports/resource-manifests/1.0.0/publish',{method:'POST'});
 await api.ok('/admin/modules/reports/artifacts/fetch',{method:'POST',body:{}});
 const invalid=structuredClone(v1.mfManifest());invalid.manifestVersion='9.0.0';invalid.routes[0].path='reports/../x';
 await expectCode('/admin/modules/reports/artifacts',{method:'POST',body:invalid},422,'MANIFEST_INVALID');
 const identity=structuredClone(v1.mfManifest());identity.manifestVersion='9.0.1';identity.moduleKey='other';
 await expectCode('/admin/modules/reports/artifacts',{method:'POST',body:identity},422,'MANIFEST_IDENTITY_MISMATCH');
 const activated=await api.ok('/admin/modules/reports/artifacts/1.0.0/activate',{method:'POST'});
 assert.equal(activated.activeArtifactVersion,'1.0.0');
 const catalog=await api.ok('/admin/runtime/catalog');
 const runtimeModule=catalog.modules.find(m=>m.moduleKey==='reports');
 assert.deepEqual(runtimeModule.artifact,{url:'/api/mfe/reports/1.0.0/remoteEntry.js',integrity:v1.integrity(),format:'WEBPACK_FEDERATION',remoteName:v1.remoteName,exposedModule:'./plugin'});
 assert.ok(!JSON.stringify(catalog).includes(`127.0.0.1:${MFE_PORT}`),'the registered network address never reaches browsers');

 // Integrity pinning: a manifest without integrity gets the SRI of the bytes served at registration (operator-confirmed).
 const unpinned=structuredClone(v1.mfManifest());unpinned.manifestVersion='1.0.1';delete unpinned.artifact.integrity;
 await expectCode('/admin/modules/reports/artifacts',{method:'POST',body:unpinned},422,'INTEGRITY_REQUIRED');
 const pinned=await api.ok('/admin/modules/reports/artifacts?pinIntegrity=true',{method:'POST',body:unpinned});
 assert.equal(pinned.revision.integrity,v1.integrity());

 // ---- Users, roles and grants; backend route protected by the same resources ------------------------------------------
 const alice=await api.ok('/admin/users',{method:'POST',body:{displayName:'Alice Analyst',identities:[{issuer:idp.issuer,subject:'alice'}]}});
 const bob=await api.ok('/admin/users',{method:'POST',body:{displayName:'Bob Outsider',identities:[{issuer:idp.issuer,subject:'bob'}]}});
 await api.ok('/admin/roles',{method:'POST',body:{key:'report-viewer',displayName:'Report viewer'}});
 await api.ok('/admin/roles/report-viewer/assignments',{method:'POST',body:{subject:`user:${alice.id}`}});
 await api.ok('/admin/grants',{method:'POST',body:{subject:'role:report-viewer',applicationKey:'reporting',resourceKey:'reports.sales-dashboard',action:'view'}});
 await api.ok('/admin/grants',{method:'POST',body:{subject:'role:report-viewer',applicationKey:'reporting',resourceKey:'reports.monthly-reports',action:'view'}});
 await api.ok('/admin/service-targets',{method:'POST',body:{key:'reports-svc',displayName:'Reports service',baseUrl:upstream.origin}});
 await api.ok('/admin/proxy-routes',{method:'POST',body:{key:'reports-api',applicationKey:'reporting',moduleKey:'reports',pathPrefix:'/reports-api',targetKey:'reports-svc',authentication:'FORWARD_TOKEN'}});
 await api.ok('/admin/proxy-routes/reports-api/operations',{method:'POST',body:{key:'sales',method:'GET',pathPattern:'/sales',access:'AUTHENTICATED',resourceKey:'reports.sales-dashboard',action:'view'}});
 await api.ok('/admin/proxy-routes/reports-api/operations',{method:'POST',body:{key:'export',method:'POST',pathPattern:'/sales/export',access:'AUTHENTICATED',resourceKey:'reports.sales-dashboard',action:'export'}});

 const aliceClient=cookieClient(stack.urls.bff);await login(aliceClient,idp,{subject:'alice',name:'Alice Analyst'});
 const bobClient=cookieClient(stack.urls.bff);await login(bobClient,idp,{subject:'bob',name:'Bob Outsider'});
 const anonymous=cookieClient(stack.urls.bff);
 const contextOf=async client=>(await client('/api/me/context')).json();
 // Eventual consistency: grants reach OpenFGA through the outbox.
 for(let i=0;i<40&&!(await contextOf(aliceClient)).permissions['reporting:reports.sales-dashboard'];i++)await new Promise(r=>setTimeout(r,250));
 const aliceContext=await contextOf(aliceClient);
 assert.deepEqual(aliceContext.permissions['reporting:reports.sales-dashboard'],['view']);
 assert.equal(aliceContext.modules.find(m=>m.moduleKey==='reports').artifact.url,'/api/mfe/reports/1.0.0/remoteEntry.js');
 assert.equal((await contextOf(bobClient)).modules.some(m=>m.moduleKey==='reports'),false,'the module is not in the context of a user without access');

 // ---- Artifact gateway: same-origin entry, chunks and CSS; visibility follows the caller's context --------------------
 const entry=await aliceClient('/api/mfe/reports/1.0.0/remoteEntry.js');
 assert.equal(entry.status,200);assert.match(entry.headers.get('content-type'),/javascript/);
 assert.equal(await entry.text(),v1.entry());
 assert.equal(entry.headers.get('x-content-type-options'),'nosniff');assert.match(entry.headers.get('cache-control'),/no-cache/);
 const etag=entry.headers.get('etag');assert.ok(etag);
 assert.equal((await aliceClient('/api/mfe/reports/1.0.0/remoteEntry.js',{headers:{'If-None-Match':etag}})).status,304);
 assert.equal((await aliceClient('/api/mfe/reports/1.0.0/assets/chunk.js')).status,200,'chunk resolved below the entry directory');
 const css=await aliceClient('/api/mfe/reports/1.0.0/assets/style.css');assert.equal(css.status,200);assert.match(css.headers.get('content-type'),/^text\/css/);
 const gatewayCode=async(client,path)=>{const r=await client(path);return `${r.status} ${r.status===200?'':(await r.json().catch(()=>({}))).code??''}`.trim();};
 assert.equal(await gatewayCode(bobClient,'/api/mfe/reports/1.0.0/remoteEntry.js'),'404 MFE_MODULE_UNAVAILABLE');
 assert.equal(await gatewayCode(anonymous,'/api/mfe/reports/1.0.0/remoteEntry.js'),'404 MFE_MODULE_UNAVAILABLE');
 assert.equal(await gatewayCode(aliceClient,'/api/mfe/reports/0.9.0/remoteEntry.js'),'404 MFE_VERSION_NOT_ACTIVE');
 assert.equal(await gatewayCode(aliceClient,'/api/mfe/reports/1.0.0/assets/missing.js'),'404 MFE_ASSET_NOT_FOUND');
 // Raw paths (fetch would normalize dot segments): traversal and encoded separators never reach the MFE host.
 const raw=path=>new Promise((resolve,reject)=>{const req=httpRequest({host:'127.0.0.1',port:stack.ports.bff,path,headers:{Cookie:[...aliceClient.jar].map(([k,v])=>`${k}=${v}`).join('; ')}},
  res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
 for(const path of ['/api/mfe/reports/1.0.0/../../../etc/passwd.js','/api/mfe/reports/1.0.0/assets/%2e%2e/%2e%2e/passwd.js','/api/mfe/reports/1.0.0/assets%2f..%2fpasswd.js'])
  assert.ok([400,404].includes(await raw(path)),path);
 assert.equal(await gatewayCode(aliceClient,'/api/mfe/unknown-module/1.0.0/remoteEntry.js'),'404 MFE_MODULE_UNAVAILABLE');
 assert.ok(!v1.state.requests.some(p=>p.includes('passwd')),'nothing outside the registered directory reached the MFE host');

 // ---- Server-side authorization of backend operations ------------------------------------------------------------------
 assert.equal((await aliceClient('/api/routes/reports-api/sales')).status,200);
 assert.equal((await aliceClient('/api/routes/reports-api/sales/export',{method:'POST',headers:{'Content-Type':'application/json',...await aliceClient.csrf()},body:'{}'})).status,403,'export is not granted');
 assert.equal((await bobClient('/api/routes/reports-api/sales')).status,403);

 // ---- Resource tree, resource access and effective-permission inspection ---------------------------------------------
 const tree=await api.ok('/admin/applications/reporting/resource-tree');
 const node=key=>tree.resources.find(r=>r.key===key);
 assert.deepEqual([node('reporting').editability,node('reports.sales-dashboard').editability,node('reports.sales-dashboard').manifestVersion],['SYSTEM','MANIFEST_EXTENSIBLE','1.0.0']);
 assert.deepEqual(node('reports.sales-dashboard').actions.map(a=>a.key),['export','print','view']);
 assert.equal(node('reports.sales-dashboard').grantCount,1);
 assert.deepEqual(node('reports.sales-dashboard').routes.map(r=>[r.routeKey,r.status]),[['sales','OK']]);
 assert.deepEqual(tree.unreferencedPages.sort(),['reports.dashboard','reports.finance-dashboard','reports.monthly-reports','reports.reports'].sort());
 assert.deepEqual(node('reports.dashboard').allowedChildTypes.includes('PAGE'),true);
 const access=await api.ok('/admin/applications/reporting/resources/reports.sales-dashboard/access');
 assert.deepEqual(access.direct.map(g=>[g.subject,g.action]),[['role:report-viewer','view']]);
 assert.deepEqual(access.ancestry,['reports.sales-dashboard','reports.dashboard','reports','reporting']);
 const inspection=await api.ok('/admin/access/inspect',{method:'POST',body:{userId:alice.id,applicationKey:'reporting',resourceKey:'reports.sales-dashboard'}});
 const decision=action=>inspection.decisions.find(d=>d.action===action);
 assert.deepEqual([decision('view').allowed,decision('export').allowed,decision('print').allowed],[true,false,false]);
 assert.deepEqual(inspection.paths.filter(p=>p.action==='view').map(p=>[p.kind,p.grantSubject]),[['ROLE','role:report-viewer']]);
 assert.deepEqual(inspection.roles,['role:report-viewer']);
 const bobInspection=await api.ok('/admin/access/inspect',{method:'POST',body:{userId:bob.id,applicationKey:'reporting',resourceKey:'reports.sales-dashboard'}});
 assert.equal(bobInspection.decisions.find(d=>d.action==='view').reason,'NO_RELATIONSHIP');
 assert.equal((await api.ok('/admin/grants?resourceKey=reports.sales-dashboard')).length,1);

 // ---- Hybrid governance: manual extension survives a newer manifest; conflicts and grant impact are real ---------------
 await api.ok('/admin/applications/reporting/resources',{method:'POST',body:{key:'reports.management-report',type:'PAGE',parentKey:'reports.dashboard',displayName:'Management Report',actions:[{key:'view'}]}});
 await api.ok('/admin/applications/reporting/resources',{method:'POST',body:{key:'reports.custom-dashboard',type:'PAGE',parentKey:'reports',displayName:'Custom Dashboard',actions:[{key:'view'}]}});
 const v11=reportResources('reports','reporting','Reports').filter(r=>r.key!=='reports.monthly-reports')
  .map(r=>r.key==='reports.settings'?{...r,name:'Report Settings'}:r).concat([{key:'reports.audit-reports',type:'PAGE',parentKey:'reports.reports',name:'Audit Reports',actions:['view']}]);
 await api.ok('/admin/modules/reports/resource-manifests',{method:'POST',body:{schemaVersion:'1.0.0',manifestVersion:'1.1.0',applicationKey:'reporting',moduleKey:'reports',resources:v11}});
 const diff=await api.ok('/admin/modules/reports/resource-manifests/1.1.0/diff');
 assert.deepEqual(diff.changes.map(c=>`${c.kind} ${c.resourceKey}`).sort(),['ADDED reports.audit-reports','ARCHIVED reports.monthly-reports','RENAMED reports.settings'].sort());
 assert.equal(diff.conflicts,false);assert.deepEqual(diff.warnings,[]);
 assert.deepEqual(diff.impact,[{resourceKey:'reports.monthly-reports',action:'view',subject:'role:report-viewer',reason:'RESOURCE_ARCHIVED'}],'impact counts real active grants');
 // A version that claims a manually managed key or drops a node with manual children is refused at import (exact dry run).
 const claim=[...v11,{key:'reports.management-report',type:'PAGE',parentKey:'reports.dashboard',name:'Claimed',actions:['view']}];
 await expectCode('/admin/modules/reports/resource-manifests',{method:'POST',body:{schemaVersion:'1.0.0',manifestVersion:'1.2.0',applicationKey:'reporting',moduleKey:'reports',resources:claim}},409,'RESOURCE_OWNED');
 const orphaning=await expectCode('/admin/modules/reports/resource-manifests',{method:'POST',body:{schemaVersion:'1.0.0',manifestVersion:'1.2.0',applicationKey:'reporting',moduleKey:'reports',
  resources:v11.filter(r=>r.key!=='reports.dashboard'&&r.parentKey!=='reports.dashboard')}},409,'CONFLICT');
 assert.match(orphaning.message,/reports\.dashboard still has manual children/);
 // A conflict that appears after a draft was imported is shown in the diff and blocks publication.
 await api.ok('/admin/modules/reports/resource-manifests',{method:'POST',body:{schemaVersion:'1.0.0',manifestVersion:'1.2.0',applicationKey:'reporting',moduleKey:'reports',
  resources:[...v11.filter(r=>r.key!=='reports.daily-reports'),{key:'reports.extra-page',type:'PAGE',parentKey:'reports',name:'Extra',actions:['view']}]}});
 await api.ok('/admin/applications/reporting/resources',{method:'POST',body:{key:'reports.extra-page',type:'PAGE',parentKey:'reports',displayName:'Extra (manual)',actions:[{key:'view'}]}});
 const conflict=await api.ok('/admin/modules/reports/resource-manifests/1.2.0/diff');
 assert.equal(conflict.conflicts,true);assert.ok(conflict.changes.some(c=>c.kind==='CONFLICT'&&c.resourceKey==='reports.extra-page'),JSON.stringify(conflict.changes));
 assert.ok(conflict.warnings.some(w=>w.includes('reports.daily-reports')),'active routes that would break are reported');
 await expectCode('/admin/modules/reports/resource-manifests/1.2.0/publish',{method:'POST'},409,'RESOURCE_OWNED');
 await api.ok('/admin/modules/reports/resource-manifests/1.2.0',{method:'DELETE'});
 await api.ok('/admin/modules/reports/resource-manifests/1.1.0/publish',{method:'POST'});
 const after=await api.ok('/admin/applications/reporting/resource-tree?includeArchived=true');
 const afterNode=key=>after.resources.find(r=>r.key===key);
 assert.deepEqual([afterNode('reports.management-report').origin,afterNode('reports.management-report').archived],['MANUAL',false],'manual extension preserved');
 assert.equal(afterNode('reports.custom-dashboard').archived,false);
 assert.equal(afterNode('reports.monthly-reports').archived,true);
 assert.equal(afterNode('reports.settings').displayName,'Report Settings');

 // ---- Versioning and rollback; the new version lives at another address and uses another packaging (Vite) ------------
 const v2=await startMfeFixture({port:base+88,flavor:'vite',version:'2.0.0',resourcesVersion:'1.1.0',label:'Reports v2'});t.after(()=>v2.close());
 const inspectedV2=await probe({url:v2.url});
 assert.equal(inspectedV2.detectedFormat,'VITE_FEDERATION');
 const moduleNow=await api.ok('/admin/modules/reports');
 await api.ok('/admin/modules/reports',{method:'PUT',body:{revision:moduleNow.revision,entryUrl:v2.url,definitionMode:'HYBRID',mfManifestUrl:inspectedV2.mfManifestUrl,resourceManifestUrl:moduleNow.resourceManifestUrl}});
 await api.ok('/admin/modules/reports/artifacts/fetch',{method:'POST',body:{}});
 await api.ok('/admin/modules/reports/artifacts/2.0.0/activate',{method:'POST'});
 assert.equal((await contextOf(aliceClient)).modules.find(m=>m.moduleKey==='reports').artifact.url,'/api/mfe/reports/2.0.0/remoteEntry.js');
 const v2Entry=await aliceClient('/api/mfe/reports/2.0.0/remoteEntry.js');assert.equal(await v2Entry.text(),v2.entry(),'gateway follows the changed address');
 assert.equal((await aliceClient('/api/mfe/reports/2.0.0/assets/expose.js')).status,200);
 assert.equal(await gatewayCode(aliceClient,'/api/mfe/reports/1.0.0/remoteEntry.js'),'404 MFE_VERSION_NOT_ACTIVE','an inactive version is not served for new mounts');
 const rolledBack=await api.ok('/admin/modules/reports/artifacts/1.0.0/activate',{method:'POST'});
 assert.deepEqual([rolledBack.activeArtifactVersion,rolledBack.activeResourceVersion],['1.0.0','1.0.0'],'rollback re-activates the resource revision the artifact names');
 assert.equal(await (await aliceClient('/api/mfe/reports/1.0.0/remoteEntry.js')).text(),v1.entry());
 const rolledTree=await api.ok('/admin/applications/reporting/resource-tree?includeArchived=true');
 const rolled=key=>rolledTree.resources.find(r=>r.key===key);
 assert.deepEqual([rolled('reports.monthly-reports').archived,rolled('reports.audit-reports').archived,rolled('reports.management-report').archived],[false,true,false]);
 assert.ok(rolledTree.routes.filter(r=>r.moduleKey==='reports').every(r=>r.status==='OK'),'route references stay consistent after rollback');
 assert.equal((await api.ok('/admin/access/inspect',{method:'POST',body:{userId:alice.id,applicationKey:'reporting',resourceKey:'reports.sales-dashboard'}})).decisions.find(d=>d.action==='view').allowed,true);
 assert.deepEqual((await contextOf(aliceClient)).permissions['reporting:reports.monthly-reports'],['view'],'the grant on a restored resource is effective again');

 // ---- Integrity: a changed bundle at the registered address is refused by the gateway and by activation -------------
 v1.tamper();
 const cached=await aliceClient('/api/mfe/reports/1.0.0/remoteEntry.js');
 if(cached.status===200)assert.equal(await cached.text(),v1.entry(),'only bytes verified against the registered integrity are ever served');
 await new Promise(r=>setTimeout(r,2500));// asset cache TTL (2 s in this suite)
 assert.equal(await gatewayCode(aliceClient,'/api/mfe/reports/1.0.0/remoteEntry.js'),'502 ARTIFACT_INTEGRITY_MISMATCH');
 await api.ok('/admin/modules/reports/deactivate',{method:'POST'});
 await expectCode('/admin/modules/reports/artifacts/1.0.0/activate',{method:'POST'},409,'ARTIFACT_INTEGRITY_MISMATCH');
 v1.tamper(false);
 await api.ok('/admin/modules/reports/artifacts/1.0.0/activate',{method:'POST'});

 // ---- Route conflicts and unavailable hosts are diagnosed at activation ------------------------------------------
 await api.ok('/admin/modules',{method:'POST',body:{applicationKey:'reporting',moduleKey:'reports-copy',displayName:'Copy',definitionMode:'MANUAL'}});
 const copy=structuredClone(v1.mfManifest());copy.moduleKey='reports-copy';delete copy.resourceManifestVersion;copy.routes=copy.routes.map(r=>({key:r.key,path:r.path,access:'PUBLIC'}));
 await api.ok('/admin/modules/reports-copy/artifacts',{method:'POST',body:copy});
 await expectCode('/admin/modules/reports-copy/artifacts/1.0.0/activate',{method:'POST'},409,'ROUTE_CONFLICT');
 const gone=structuredClone(copy);gone.manifestVersion='1.0.1';gone.routes=[{key:'home',path:'/reports-copy',access:'PUBLIC'}];gone.artifact.url=offline.url;
 await api.ok('/admin/modules/reports-copy/artifacts',{method:'POST',body:gone});
 const unavailable=await api.call('/admin/modules/reports-copy/artifacts/1.0.1/activate',{method:'POST'});
 assert.equal(unavailable.status,502);assert.equal(unavailable.body.code,'CONNECTION_REFUSED');

 // ---- Deactivation removes the module from contexts and from the gateway ----------------------------------------
 await api.ok('/admin/modules/reports/deactivate',{method:'POST'});
 assert.equal((await contextOf(aliceClient)).modules.some(m=>m.moduleKey==='reports'),false);
 assert.equal(await gatewayCode(aliceClient,'/api/mfe/reports/1.0.0/remoteEntry.js'),'404 MFE_MODULE_UNAVAILABLE');

 // ---- Audit trail -----------------------------------------------------------------------------------------------
 const audit=(await api.ok('/admin/audit?limit=300')).map(e=>({...e,details:JSON.parse(e.details??'{}')}));
 const registeredEvent=audit.find(e=>e.eventType==='module.registered'&&e.details.module==='reports');
 assert.equal(registeredEvent?.details.entryUrl,inspected.url);
 assert.ok(audit.some(e=>e.eventType==='module.updated'&&e.details.entryUrl===v2.url),'address change audited');
 for(const type of ['manifest.artifact.registered','manifest.artifact.activated','manifest.resources.published','resource.created','grant.created','module.deactivated'])
  assert.ok(audit.some(e=>e.eventType===type),type);
 assert.equal(sri(v1.entry()),v1.integrity());
});
