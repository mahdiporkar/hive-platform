// Spec §61 Golden Path: one repeatable scenario from a completely clean Hive installation, with a real Keycloak,
// the default shell, framework-neutral micro-apps, a business service and a real browser. Step numbers follow the spec.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {startStack,ready,pause} from '../support/stack.mjs';
import {startUpstream} from '../support/upstream-fixture.mjs';
import {startGateway} from '../../tools/dev-gateway.mjs';
import {browserChannel} from '../support/solution.mjs';

const keycloakPort=30710,gatewayPort=30790,origin=`http://127.0.0.1:${gatewayPort}`,realm='hive-golden';
const issuer=`http://127.0.0.1:${keycloakPort}/realms/${realm}`;
const operatorId=randomUUID(),learnerId=randomUUID();
const modules='examples/minimal-consumer/dist/modules';

test('golden path: clean install → administration → login → runtime → events → restore → logout',{timeout:900000},async t=>{
 // Identity provider: a real Keycloak with a generated realm (not part of Hive Core).
 const realmDir=resolve('.local/golden/realm');mkdirSync(realmDir,{recursive:true});
 writeFileSync(`${realmDir}/realm.json`,JSON.stringify({realm,enabled:true,sslRequired:'none',
  clients:[{clientId:'hive-bff',enabled:true,publicClient:false,secret:'golden-client-secret-0001',standardFlowEnabled:true,directAccessGrantsEnabled:false,
   redirectUris:[`${origin}/login/oauth2/code/primary`],attributes:{'pkce.code.challenge.method':'S256','post.logout.redirect.uris':`${origin}/*`}}],
  users:[['operator',operatorId,'Olivia','Operator'],['learner',learnerId,'Lee','Learner']].map(([username,id,firstName,lastName])=>({id,username,enabled:true,email:`${username}@example.test`,
   emailVerified:true,firstName,lastName,credentials:[{type:'password',value:'golden-password',temporary:false}],requiredActions:[]}))}));
 const container=`hive-golden-keycloak-${Date.now()}`;
 const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000});
 t.after(()=>{try{docker('rm','-f',container);}catch{}});
 docker('run','-d','--name',container,'-p',`127.0.0.1:${keycloakPort}:8080`,'-e','KC_BOOTSTRAP_ADMIN_USERNAME=bootstrap','-e','KC_BOOTSTRAP_ADMIN_PASSWORD=bootstrap-only',
  '--mount',`type=bind,source=${realmDir},target=/opt/keycloak/data/import,readonly`,'quay.io/keycloak/keycloak:26.3.3','start-dev','--import-realm');
 const upstream=await startUpstream({port:30785});t.after(()=>upstream.close());

 // 1. Start fresh Hive (empty databases, new graph store) with the first administrator from configuration only.
 const stack=await startStack(t,{suite:'golden',base:30700,
  authorizationEnv:{HIVE_PRIMARY_ISSUER:issuer,HIVE_BOOTSTRAP_ADMIN_SUBJECT:operatorId,HIVE_TARGET_ALLOW_HTTP:'true',HIVE_AUTHZ_CACHE_ENABLED:'true'},
  bffEnv:{HIVE_IDENTITY_ENABLED:'true',HIVE_OIDC_ISSUER:issuer,HIVE_OIDC_CLIENT_ID:'hive-bff',HIVE_OIDC_CLIENT_SECRET:'golden-client-secret-0001',HIVE_OIDC_ALLOW_LOCAL_HTTP:'true',
   HIVE_PROXY_ALLOWED_ORIGINS:upstream.origin,HIVE_PROXY_ALLOW_HTTP:'true',HIVE_BRANDING_NAME:'Golden Path'},
  beforeBff:()=>ready(`${issuer}/.well-known/openid-configuration`,{attempts:400})});
 const gateway=await startGateway({port:gatewayPort,bff:stack.urls.bff,mounts:{'/':'apps/default-shell/dist','/modules/':modules},spa:{'/':'apps/default-shell/dist/index.html'}});
 t.after(()=>gateway.close());

 // 2. Zero consumer applications.
 assert.equal(stack.sql('select count(*) from application'),'0');
 assert.deepEqual((await (await fetch(origin+'/api/public/context')).json()).modules,[]);

 const browser=await chromium.launch({headless:true,...browserChannel});t.after(()=>browser.close());
 const keycloakLogin=async(page,username)=>{await page.waitForURL(u=>u.href.startsWith(issuer));await page.waitForSelector('#username',{timeout:15000}).catch(async()=>{throw new Error('Keycloak page: '+page.url()+' :: '+(await page.locator('body').innerText()).slice(0,300));});await page.fill('#username',username);await page.fill('#password','golden-password');await page.click('#kc-login');};

 // The operator administers through the admin API from an authenticated browser session (no console needed).
 const operatorContext=await browser.newContext();const operator=await operatorContext.newPage();
 await operator.goto(origin+'/auth/login?returnUrl=%2F');await keycloakLogin(operator,'operator');await operator.waitForURL(origin+'/');
 const admin=(method,path,body)=>operator.evaluate(async({method,path,body})=>{
  const headers={'Content-Type':'application/json'};
  if(method!=='GET'){const c=await(await fetch('/auth/csrf')).json();headers[c.headerName]=c.token;}
  const r=await fetch('/api/admin'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  const text=await r.text();return {status:r.status,body:text?JSON.parse(text):null};
 },{method,path,body});
 const ok=async(method,path,body)=>{const r=await admin(method,path,body);assert.ok(r.status<300,`${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);return r.body;};
 assert.deepEqual(await ok('GET','/applications'),[]);
 const file=(module,name)=>JSON.parse(readFileSync(`${modules}/${module}/${name}`,'utf8'));

 // 3. Create an application.
 await ok('POST','/applications',{key:'campus-example',displayName:'Campus example'});
 for(const module of ['finance-example','directory-example']){
  // 4. Register a Micro App.
  await ok('POST','/modules',{applicationKey:'campus-example',moduleKey:module,displayName:module,definitionMode:'MANIFEST'});
  // 5. Import its Resource Manifest.
  const resources=file(module,'resource-manifest.json');
  assert.equal((await ok('POST',`/modules/${module}/resource-manifests`,resources)).revision.status,'DRAFT');
  // 6. Validate the Manifest (micro-frontend manifest against the server's rules).
  assert.equal((await ok('POST','/manifests/validate',{kind:'MICRO_FRONTEND',document:file(module,'mf-manifest.json')})).valid,true);
  // 7. Publish the Manifest; register and activate the artifact.
  await ok('POST',`/modules/${module}/resource-manifests/1.0.0/publish`);
  await ok('POST',`/modules/${module}/artifacts`,file(module,'mf-manifest.json'));
  await ok('POST',`/modules/${module}/artifacts/1.0.0/activate`);
 }
 // 8. Create a user bound to the external identity.
 const learner=await ok('POST','/users',{displayName:'Lee Learner',identities:[{issuer,subject:learnerId}]});
 // 9. Create a role. 10. Assign the role.
 await ok('POST','/roles',{key:'finance-viewer',displayName:'Finance viewer'});
 await ok('POST','/roles/finance-viewer/assignments',{subject:`user:${learner.id}`});
 // 11. Grant PAGE:view (plus the directory page and the API read the page needs).
 for(const [resourceKey,action] of [['finance-example.payments','view'],['finance-example.api','read'],['directory-example','view']])
  await ok('POST','/grants',{subject:'role:finance-viewer',applicationKey:'campus-example',resourceKey,action});
 // 12. Register a Service Target. 13. Register a Forward Token Proxy Route. 14. Register Route Operations.
 await ok('POST','/service-targets',{key:'finance-svc',displayName:'Finance service',baseUrl:upstream.origin});
 await ok('POST','/proxy-routes',{key:'finance',applicationKey:'campus-example',moduleKey:'finance-example',pathPrefix:'/finance',targetKey:'finance-svc',authentication:'FORWARD_TOKEN'});
 await ok('POST','/proxy-routes/finance/operations',{key:'payments',method:'GET',pathPattern:'/payments',access:'AUTHENTICATED',resourceKey:'finance-example.api',action:'read'});
 await ok('POST','/proxy-routes/finance/operations',{key:'pay',method:'POST',pathPattern:'/payments',access:'AUTHENTICATED',resourceKey:'finance-example.payments',action:'pay'});

 // 15. Login (real Keycloak form, PKCE, server-side code exchange).
 const context=await browser.newContext();const page=await context.newPage();
 const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
 await page.goto(origin+'/auth/login?returnUrl=%2Ffinance%2Frecords%2FR-9');await keycloakLogin(page,'learner');
 await page.waitForURL(origin+'/finance/records/R-9');await page.waitForSelector('body[data-hive-ready=true]');
 // 16. Retrieve the authenticated context.
 const me=await page.evaluate(async()=>(await fetch('/api/me/context')).json());
 assert.equal(me.identity.id,learner.id);assert.equal(me.identity.issuer,issuer);
 // 17. The application appears. 18. Navigation appears.
 assert.deepEqual(me.applications.map(a=>a.key),['campus-example']);
 assert.deepEqual(await page.locator('[data-testid=navigation] a[data-route]').allTextContents(),['Directory','Finance info','Payments']);
 // 19. Mount the Micro App (from the return URL).
 const slots=()=>page.evaluate(()=>window.hiveShell.engine.workspace.slots.map(s=>({id:s.slotId,module:s.moduleKey,status:s.status,route:s.route})));
 const waitFor=async(predicate,label)=>{for(let i=0;i<150;i++){const v=await slots();if(predicate(v))return v;await pause(150);}throw new Error(`${label}: ${JSON.stringify(await slots())}`);};
 await waitFor(s=>s.length===1&&s[0].module==='finance-example'&&s[0].status==='MOUNTED','finance mounted');
 // 20. Invoke a backend operation (the micro-app loads payments through the Hive route).
 const financeRoot=()=>page.locator('[data-module=finance-example] [data-hive-slot-host]').first();
 await page.waitForFunction(()=>document.querySelector('[data-module=finance-example] [data-hive-slot-host]')?.shadowRoot?.querySelector('[data-testid=payments]')?.textContent.includes('P-R-9-1'));
 const call=upstream.requests.findLast(r=>r.path==='/payments');
 assert.match(call.headers.authorization,/^Bearer eyJ/,'Keycloak access token forwarded server-side');assert.equal(call.headers['x-hive-user-id'],learner.id);
 const browserVisible=JSON.stringify([await page.content(),await page.evaluate(()=>document.cookie),me]);
 assert.ok(!browserVisible.includes(call.headers.authorization.slice(7,60)),'the access token never reaches the browser');
 // 21. Server-side authorization: the role grants view/read but not pay.
 const denied=await page.evaluate(async()=>{const c=await(await fetch('/auth/csrf')).json();const r=await fetch('/api/routes/finance/payments',{method:'POST',headers:{[c.headerName]:c.token}});return {status:r.status,body:await r.json()};});
 assert.equal(denied.status,403);assert.equal(denied.body.code,'ACCESS_DENIED');
 // 22. Audit entry. 23. API log entry.
 let audit=[],logs=[];
 // Wait for everything asserted below: audit and API log are read separately, so a batch can land between the two reads.
 for(let i=0;i<60&&!(audit.some(e=>e.eventType==='route.invoked')&&audit.some(e=>e.eventType==='route.denied')&&logs.some(l=>l.outcome==='DENIED'));i++){
  audit=await ok('GET','/audit?eventType=route.&limit=50');logs=await ok('GET','/api-logs?routeKey=finance&limit=50');await pause(250);
 }
 assert.ok(audit.some(e=>e.eventType==='route.invoked'&&e.actorId===`user:${learner.id}`),'audit: protected call');
 assert.ok(audit.some(e=>e.eventType==='route.denied'&&e.actorId===`user:${learner.id}`),'audit: denial');
 assert.ok(logs.some(l=>l.operationKey==='payments'&&l.outcome==='SUCCESS'&&l.pathTemplate==='/finance/payments'));
 assert.ok(logs.some(l=>l.operationKey==='pay'&&l.outcome==='DENIED'&&l.status===403));
 // 24. Open a second Micro App. 25. Both coexist.
 await page.click('[data-layout-button=SPLIT]');
 await page.click('[data-open-new="directory-example:list"]');
 await waitFor(s=>s.length===2&&s.every(x=>x.status==='MOUNTED'),'both mounted');
 // 26. Emit a Workspace Event. 27. The receiving Micro App handles it (and calls its backend again).
 await page.click('button[data-record=R-2]');
 await page.waitForFunction(()=>document.querySelector('[data-module=finance-example] [data-hive-slot-host]')?.shadowRoot?.querySelector('[data-testid=selected-record]')?.textContent==='Selected record: R-2');
 await page.waitForFunction(()=>document.querySelector('[data-module=finance-example] [data-hive-slot-host]')?.shadowRoot?.querySelector('[data-testid=payments]')?.textContent.includes('P-R-2-1'));
 // 28. Refresh the browser. 29. Workspace restoration.
 const before=await slots();await page.reload();await page.waitForSelector('body[data-hive-ready=true]');
 const after=await waitFor(s=>s.length===2&&s.every(x=>x.status==='MOUNTED'),'restored');
 assert.deepEqual(after.map(s=>[s.id,s.module,s.route]),before.map(s=>[s.id,s.module,s.route]));
 assert.equal(await page.getAttribute('[data-hive-workspace]','data-layout'),'SPLIT');
 // 30. Logout. 31. The session is invalidated (also for a replayed cookie).
 const session=(await context.cookies()).find(c=>c.name==='HIVE_SESSION');
 // Full sign-out: Hive's session, then Keycloak's own (RP-initiated logout), which returns to this deployment's root.
 const providerLogout=page.waitForRequest(r=>r.url().startsWith(`${issuer}/protocol/openid-connect/logout?`));
 await page.click('[data-testid=sign-out]');
 assert.match((await providerLogout).url(),/id_token_hint=/);
 await page.waitForURL(u=>u.href===origin+'/',{timeout:30000});
 await page.waitForFunction(()=>window.hiveShell?.engine?.workspace);
 await waitFor(s=>s.every(x=>x.status==='LOGIN_REQUIRED'),'protected slots require login');
 assert.equal(await page.evaluate(async()=>(await fetch('/api/me/context')).status),401);
 const replay=await fetch(`${stack.urls.bff}/api/me/context`,{headers:{Cookie:`HIVE_SESSION=${session.value}`}});
 assert.equal(replay.status,401,'old session cookie no longer works');
 assert.equal(stack.redis('KEYS','hive:vault:*').split('\n').filter(Boolean).length,1,'only the operator session holds a vault record');
 // Keycloak's session has ended too: signing in again asks for credentials.
 await page.goto(origin+'/auth/login');
 await page.waitForSelector('#username',{timeout:30000});
 assert.deepEqual(pageErrors,[]);
});
