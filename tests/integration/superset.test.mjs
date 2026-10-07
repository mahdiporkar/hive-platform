// Phase 12: optional Superset integration — registry, asset grants, authorized same-origin tunnel, SSRF/TLS checks,
// server-side service credential, health, independent lifecycle.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startStack,cookieClient,pause} from '../support/stack.mjs';
import {startOidcProvider,login} from '../support/oidc-fixture.mjs';
import {startSupersetFixture} from '../support/superset-fixture.mjs';
import {request as httpRequest} from 'node:http';

test('Superset integration through the authorized tunnel',{timeout:400000},async t=>{
 const idp=await startOidcProvider({port:30480});t.after(()=>idp.close());
 const superset=await startSupersetFixture({port:30485});t.after(()=>superset.close());
 const stack=await startStack(t,{suite:'superset',base:30400,authorizationEnv:{HIVE_PRIMARY_ISSUER:idp.issuer,HIVE_TARGET_ALLOW_HTTP:'true'},
  bffEnv:{HIVE_IDENTITY_ENABLED:'true',HIVE_OIDC_ISSUER:idp.issuer,HIVE_OIDC_CLIENT_ID:idp.clientId,HIVE_OIDC_CLIENT_SECRET:idp.clientSecret,HIVE_OIDC_ALLOW_LOCAL_HTTP:'true',
   HIVE_PROXY_ALLOWED_ORIGINS:superset.origin,HIVE_PROXY_ALLOW_HTTP:'true',HIVE_SECRET_SUPERSET_BI:JSON.stringify({username:'hive-service',password:'service-password'})}});
 const admin=async(path,{method='GET',body}={})=>{const r=await stack.service(path,{method,body});const text=await r.text();return {status:r.status,body:text?JSON.parse(text):null};};
 const ok=async(path,options)=>{const r=await admin(path,options);assert.ok(r.status<300,`${path} -> ${r.status} ${JSON.stringify(r.body)}`);return r.body;};

 // Hive Core runs without any Superset configuration.
 assert.deepEqual(await ok('/admin/integrations/superset'),[]);
 await ok('/admin/applications',{method:'POST',body:{key:'analytics',displayName:'Analytics'}});
 const base={key:'bi',applicationKey:'analytics',displayName:'BI',credentialReference:'env:HIVE_SECRET_SUPERSET_BI'};
 assert.equal((await admin('/admin/integrations/superset',{method:'POST',body:{...base,baseUrl:superset.origin}})).body.code,'TLS_REQUIRED','TLS is the default');
 assert.equal((await admin('/admin/integrations/superset',{method:'POST',body:{...base,baseUrl:'http://169.254.169.254',tlsRequired:false}})).body.code,'TARGET_LOCATION_REJECTED');
 assert.equal((await admin('/admin/integrations/superset',{method:'POST',body:{...base,baseUrl:superset.origin,tlsRequired:false,credentialReference:'service-password'}})).status,400);
 await ok('/admin/integrations/superset',{method:'POST',body:{...base,baseUrl:superset.origin,tlsRequired:false}});
 for(const [assetType,assetId] of [['DASHBOARD','12'],['DASHBOARD','99'],['CHART','7']])
  await ok('/admin/integrations/superset/bi/assets',{method:'POST',body:{assetType,assetId,displayName:`${assetType} ${assetId}`}});
 const alice=(await ok('/admin/users',{method:'POST',body:{displayName:'Alice Analyst',identities:[{issuer:idp.issuer,subject:'alice'}]}})).id;
 await ok('/admin/users',{method:'POST',body:{displayName:'Bob',identities:[{issuer:idp.issuer,subject:'bob'}]}});
 await ok('/admin/grants',{method:'POST',body:{subject:`user:${alice}`,applicationKey:'analytics',resourceKey:'superset-bi',action:'access'}});
 await ok('/admin/grants',{method:'POST',body:{subject:`user:${alice}`,applicationKey:'analytics',resourceKey:'superset-bi.dashboard.12',action:'view'}});

 const anonymous=cookieClient(stack.urls.bff);
 assert.equal((await anonymous('/api/integrations/superset/bi/api/v1/dashboard/12')).status,401);
 const browser=cookieClient(stack.urls.bff);await login(browser,idp,{subject:'alice',name:'Alice Analyst'});
 const tunnel=p=>browser(`/api/integrations/superset/bi${p}`);

 // Granted dashboard: tunneled with the server-held service token; no cookies either way; token never returned.
 let response=await tunnel('/api/v1/dashboard/12');const text=await response.text();
 assert.equal(response.status,200,text);assert.equal(JSON.parse(text).result.dashboard_title,'Dashboard 12');
 const seen=superset.requests.at(-1);assert.match(seen.headers.authorization,/^Bearer ey/);assert.equal(seen.headers.cookie,undefined,'browser cookies never forwarded');
 assert.ok(!response.headers.getSetCookie().some(c=>c.startsWith('session=')),'Superset cookies never relayed');
 for(const token of superset.tokens)assert.ok(!text.includes(token));
 assert.equal((await tunnel('/api/v1/dashboard/12/charts')).status,200);
 const csrf=await browser.csrf();
 const post=(body,headers=csrf)=>browser('/api/integrations/superset/bi/api/v1/chart/data',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 assert.equal((await post({form_data:{dashboardId:'12'},queries:[{}]})).status,200,'chart data authorized via the dashboard in the body');
 // Default deny: other assets, unidentified chart data, non-allowlisted APIs; Superset is never contacted.
 const before=superset.requests.length;
 for(const [label,promise,reason] of [['ungranted dashboard',tunnel('/api/v1/dashboard/99'),'ASSET_NO_RELATIONSHIP'],['ungranted chart',tunnel('/api/v1/chart/7'),'ASSET_NO_RELATIONSHIP'],
  ['chart data for ungranted chart',post({queries:[{slice_id:7}]}),'ASSET_NO_RELATIONSHIP'],['unidentified chart data',post({queries:[{}]}),'ASSET_UNIDENTIFIED'],
  ['admin API',tunnel('/api/v1/database/'),'OPERATION_NOT_ALLOWED'],['unregistered asset',tunnel('/api/v1/dashboard/500'),'ASSET_RESOURCE_UNKNOWN']]){
  const r=await promise;const b=await r.json();assert.equal(r.status,403,label);assert.equal(b.message,`Not permitted: ${reason}`,label);
 }
 assert.equal((await post({form_data:{dashboardId:'12'}},{})).status,403,'CSRF required for tunneled POST');
 assert.equal(superset.requests.length,before,'denied requests never reach Superset');
 // Raw request (fetch would normalize the encoded traversal before sending it).
 const raw=await new Promise((resolve,reject)=>{const u=new URL(stack.urls.bff);const r=httpRequest({host:u.hostname,port:u.port,path:'/api/integrations/superset/bi/api/v1/%2e%2e/admin',headers:{Cookie:[...browser.jar].map(([k,v])=>k+'='+v).join('; ')}},res=>{res.resume();resolve(res.statusCode);});r.on('error',reject);r.end();});
 assert.equal(raw,400);

 // One login per integration revision, cached encrypted; upstream rejection drops the cached token.
 assert.equal(superset.logins,1);
 const keys=stack.redis('KEYS','hive:integration:superset:*').split('\n').filter(Boolean);assert.deepEqual(keys,['hive:integration:superset:bi:0']);
 const envelope=stack.redis('GET',keys[0]);for(const token of superset.tokens)assert.ok(!envelope.includes(token));
 superset.revokeTokens();assert.equal((await tunnel('/api/v1/dashboard/12')).status,401);
 assert.equal((await tunnel('/api/v1/dashboard/12')).status,200);assert.equal(superset.logins,2);

 // Health is recorded in the registry.
 assert.equal((await tunnel('/health')).status,200);
 assert.equal((await ok('/admin/integrations/superset'))[0].healthStatus,'ACTIVE');

 // Users without the integration grant are refused.
 const bob=cookieClient(stack.urls.bff);await login(bob,idp,{subject:'bob'});
 assert.equal((await (await bob('/api/integrations/superset/bi/api/v1/dashboard/12')).json()).message,'Not permitted: INTEGRATION_NO_RELATIONSHIP');

 // Independent lifecycle: disabling the integration closes the tunnel without affecting anything else.
 const current=(await ok('/admin/integrations/superset'))[0];
 await ok('/admin/integrations/superset/bi',{method:'PUT',body:{enabled:false,revision:current.revision}});
 assert.equal((await tunnel('/api/v1/dashboard/12')).status,404);
 assert.equal((await browser('/api/me/context')).status,200);

 // Observability.
 let logs=[];for(let i=0;i<40&&!logs.some(l=>l.outcome==='DENIED');i++){logs=await ok('/admin/api-logs?routeKey=superset:bi');await pause(250);}
 assert.ok(logs.some(l=>l.outcome==='SUCCESS')&&logs.some(l=>l.outcome==='DENIED'));
 let audit=[];for(let i=0;i<40&&!audit.some(e=>e.eventType==='integration.superset.token.acquired');i++){audit=await ok('/admin/audit?limit=300');await pause(250);}
 for(const type of ['superset.integration.created','superset.asset.registered','integration.superset.token.acquired','superset.integration.disabled'])assert.ok(audit.some(e=>e.eventType===type),type);
 assert.ok(!JSON.stringify(audit).includes('service-password'));
});
