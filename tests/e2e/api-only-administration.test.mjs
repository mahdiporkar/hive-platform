// E2E 12 / spec §22: complete platform administration through the API only — no Operator Console, no browser.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {startStack,cookieClient} from '../support/stack.mjs';
import {startOidcProvider,login} from '../support/oidc-fixture.mjs';
import {startUpstream} from '../support/upstream-fixture.mjs';

const modules='examples/minimal-consumer/dist/modules';
test('API-only administration: application → module → manifest → role → user → grant → target → route → operation → runtime',{timeout:400000},async t=>{
 const idp=await startOidcProvider({port:30080});t.after(()=>idp.close());
 const upstream=await startUpstream({port:30085});t.after(()=>upstream.close());
 const stack=await startStack(t,{suite:'e2e-api-admin',base:30000,
  authorizationEnv:{HIVE_PRIMARY_ISSUER:idp.issuer,HIVE_BOOTSTRAP_ADMIN_ISSUER:idp.issuer,HIVE_BOOTSTRAP_ADMIN_SUBJECT:'operator',HIVE_TARGET_ALLOW_HTTP:'true'},
  bffEnv:{HIVE_IDENTITY_ENABLED:'true',HIVE_OIDC_ISSUER:idp.issuer,HIVE_OIDC_CLIENT_ID:idp.clientId,HIVE_OIDC_CLIENT_SECRET:idp.clientSecret,HIVE_OIDC_ALLOW_LOCAL_HTTP:'true',
   HIVE_PROXY_ALLOWED_ORIGINS:upstream.origin,HIVE_PROXY_ALLOW_HTTP:'true'}});

 // A scripted operator session over the public BFF admin API (cookie + CSRF), exactly what automation would use.
 const operator=cookieClient(stack.urls.bff);
 await login(operator,idp,{subject:'operator',name:'Automation Operator'});
 const call=async(method,path,body)=>{
  const response=await operator('/api/admin'+path,{method,headers:{'Content-Type':'application/json',...(method==='GET'?{}:await operator.csrf())},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const text=await response.text();assert.ok(response.status<300,`${method} ${path} -> ${response.status} ${text}`);return text?JSON.parse(text):null;
 };

 assert.deepEqual(await call('GET','/applications'),[],'starts with zero consumer applications');
 await call('POST','/applications',{key:'campus-example',displayName:'Campus example'});
 await call('POST','/modules',{applicationKey:'campus-example',moduleKey:'finance-example',displayName:'Finance example',definitionMode:'MANIFEST'});
 const resources=JSON.parse(readFileSync(`${modules}/finance-example/resource-manifest.json`,'utf8'));
 const draft=await call('POST','/modules/finance-example/resource-manifests',resources);assert.equal(draft.revision.status,'DRAFT');
 assert.equal((await call('GET','/modules/finance-example/resource-manifests/1.0.0/diff')).changes.length,3);
 await call('POST','/modules/finance-example/resource-manifests/1.0.0/publish');
 const mf=JSON.parse(readFileSync(`${modules}/finance-example/mf-manifest.json`,'utf8'));
 await call('POST','/modules/finance-example/artifacts',mf);
 await call('POST','/modules/finance-example/artifacts/1.0.0/activate');
 await call('POST','/roles',{key:'finance-reader',displayName:'Finance reader'});
 const user=await call('POST','/users',{displayName:'Erin Example',identities:[{issuer:idp.issuer,subject:'erin'}]});
 await call('POST','/roles/finance-reader/assignments',{subject:`user:${user.id}`});
 for(const [resourceKey,action] of [['finance-example.payments','view'],['finance-example.api','read']])
  await call('POST','/grants',{subject:'role:finance-reader',applicationKey:'campus-example',resourceKey,action});
 await call('POST','/service-targets',{key:'finance-svc',displayName:'Finance service',baseUrl:upstream.origin});
 await call('POST','/proxy-routes',{key:'finance',applicationKey:'campus-example',moduleKey:'finance-example',pathPrefix:'/finance',targetKey:'finance-svc',authentication:'FORWARD_TOKEN'});
 await call('POST','/proxy-routes/finance/operations',{key:'payments',method:'GET',pathPattern:'/payments',access:'AUTHENTICATED',resourceKey:'finance-example.api',action:'read'});
 await call('POST','/proxy-routes/finance/operations',{key:'pay',method:'POST',pathPattern:'/payments',access:'AUTHENTICATED',resourceKey:'finance-example.payments',action:'pay'});

 // Runtime behavior for the provisioned user.
 const erin=cookieClient(stack.urls.bff);
 await login(erin,idp,{subject:'erin',name:'Erin Example'});
 const context=await (await erin('/api/me/context')).json();
 assert.equal(context.identity.id,user.id,'identity binding resolved the canonical user');
 assert.deepEqual(context.applications.map(a=>a.key),['campus-example']);
 const finance=context.modules.find(m=>m.moduleKey==='finance-example');
 assert.deepEqual(finance.routes.filter(r=>r.navigation).map(r=>r.navigation.label),['Finance info','Payments']);
 assert.deepEqual(context.permissions['campus-example:finance-example.payments'],['view']);
 let response=await erin('/api/routes/finance/payments?record=R-1');assert.equal(response.status,200);
 assert.equal((await response.json()).payments[0].id,'P-R-1-1');
 assert.equal(upstream.last().headers.authorization,`Bearer ${idp.tokensOf('erin').at(-1).access}`);
 response=await erin('/api/routes/finance/payments',{method:'POST',headers:{'Content-Type':'application/json',...await erin.csrf()},body:'{}'});
 assert.equal(response.status,403,'server-side authorization denies the unpermitted operation');
 // Erin is a business user: no administration.
 assert.equal((await erin('/api/admin/applications')).status,403);

 // Audit and API logs record the automated administration and the runtime calls.
 const audit=await call('GET','/audit?limit=200');
 const operatorId=(await call('GET','/platform-roles')).find(a=>a.role==='SUPER_ADMIN').subject;
 for(const type of ['application.created','module.registered','manifest.resources.published','manifest.artifact.activated','role.created','user.created','role.assigned','grant.created','service-target.created','proxy-route.created','route-operation.created'])
  assert.ok(audit.some(e=>e.eventType===type&&e.actorId===operatorId),type);
 let logs=[];for(let i=0;i<40&&!logs.some(l=>l.outcome==='DENIED');i++){logs=await call('GET','/api-logs?routeKey=finance');await new Promise(r=>setTimeout(r,250));}
 assert.deepEqual(new Set(logs.map(l=>`${l.operationKey}:${l.outcome}`)),new Set(['payments:SUCCESS','pay:DENIED']));
});
