// Phase 8 E2E: multi-micro-app workspace in a real browser, without the default shell.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {startStack} from '../support/stack.mjs';
import {startOidcProvider} from '../support/oidc-fixture.mjs';
import {startUpstream} from '../support/upstream-fixture.mjs';
import {startGateway} from '../../tools/dev-gateway.mjs';
import {adminApi,registerModule,browserChannel} from '../support/solution.mjs';

const dist='examples/minimal-consumer/dist';
test('workspace engine: split/tabs/single/dashboard, events, isolation, authorization, restore, logout',{timeout:400000},async t=>{
 const gatewayPort=29890,origin=`http://127.0.0.1:${gatewayPort}`;
 const idp=await startOidcProvider({port:29880});t.after(()=>idp.close());
 const upstream=await startUpstream({port:29885});t.after(()=>upstream.close());
 const stack=await startStack(t,{suite:'e2e-workspace',base:29800,authorizationEnv:{HIVE_PRIMARY_ISSUER:idp.issuer,HIVE_TARGET_ALLOW_HTTP:'true'},
  bffEnv:{HIVE_IDENTITY_ENABLED:'true',HIVE_OIDC_ISSUER:idp.issuer,HIVE_OIDC_CLIENT_ID:idp.clientId,HIVE_OIDC_CLIENT_SECRET:idp.clientSecret,HIVE_OIDC_ALLOW_LOCAL_HTTP:'true',
   HIVE_PROXY_ALLOWED_ORIGINS:upstream.origin,HIVE_PROXY_ALLOW_HTTP:'true'}});
 const gateway=await startGateway({port:gatewayPort,bff:stack.urls.bff,mounts:{'/modules/':`${dist}/modules`,'/host/':`${dist}/host`},spa:{'/':`${dist}/workspace.html`}});t.after(()=>gateway.close());
 const api=adminApi(stack);
 for(const moduleKey of ['directory-example','finance-example'])await registerModule(api,{applicationKey:'campus-example',displayName:'Campus example',moduleKey,distDir:`${dist}/modules/${moduleKey}`});
 await api.ok('/admin/service-targets',{method:'POST',body:{key:'finance-svc',displayName:'Finance fixture',baseUrl:upstream.origin}});
 await api.ok('/admin/proxy-routes',{method:'POST',body:{key:'finance',applicationKey:'campus-example',moduleKey:'finance-example',pathPrefix:'/finance',targetKey:'finance-svc',authentication:'FORWARD_TOKEN'}});
 await api.ok('/admin/proxy-routes/finance/operations',{method:'POST',body:{key:'payments',method:'GET',pathPattern:'/payments',access:'AUTHENTICATED',resourceKey:'finance-example.api',action:'read'}});
 const alice=(await api.ok('/admin/users',{method:'POST',body:{displayName:'Alice Example',identities:[{issuer:idp.issuer,subject:'alice'}]}})).id;
 for(const [resourceKey,action] of [['directory-example','view'],['finance-example.payments','view'],['finance-example.api','read']])
  await api.ok('/admin/grants',{method:'POST',body:{subject:`user:${alice}`,applicationKey:'campus-example',resourceKey,action}});

 const browser=await chromium.launch({headless:true,...browserChannel});t.after(()=>browser.close());
 const context=await browser.newContext();const page=await context.newPage();
 const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
 const slots=()=>page.evaluate(()=>window.hiveWorkspace.engine.workspace.slots.map(s=>({id:s.slotId,module:s.moduleKey,status:s.status,instance:s.instanceId,route:s.route,error:s.error?.code??null})));
 const waitFor=async(predicate,label)=>{for(let i=0;i<100;i++){const value=await slots();if(predicate(value))return value;await page.waitForTimeout(150);}throw new Error(`${label}: ${JSON.stringify(await slots())}`);};

 // Sign in first (the workspace restores per tab, so start clean after login).
 idp.next={subject:'alice',name:'Alice Example'};
 await page.goto(origin+'/directory');await page.waitForSelector('body[data-hive-ready=true]');
 await Promise.all([page.waitForURL(origin+'/directory'),page.click('[data-testid=auth-button]')]);
 await page.waitForSelector('body[data-hive-ready=true]');
 await page.evaluate(()=>sessionStorage.clear());await page.reload();await page.waitForSelector('body[data-hive-ready=true]');

 // SPLIT: two different micro-apps mounted simultaneously.
 await page.fill('input[name=path]','/finance');await page.click('#open button');
 let state=await waitFor(s=>s.length===2&&s.every(x=>x.status==='MOUNTED'),'split mounted');
 assert.deepEqual(state.map(s=>s.module),['directory-example','finance-example']);
 assert.equal(await page.getAttribute('#workspace','data-layout'),'SPLIT');
 assert.equal(await page.locator('[data-testid=directory-example]').count(),1);
 assert.equal(await page.locator('[data-testid=finance-example]').count(),1,'shadow DOM content is reachable to tests');

 // Cross-micro-app event → receiving micro-app reacts and calls its backend through a Hive dynamic route.
 await page.click('button[data-record=R-2]');
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-module=finance-example]')].some(f=>f.querySelector('.hive-slot-body').shadowRoot?.querySelector('[data-testid=selected-record]')?.textContent==='Selected record: R-2'));
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-module=finance-example]')].some(f=>f.querySelector('.hive-slot-body').shadowRoot?.querySelector('[data-testid=payments]')?.textContent.includes('P-R-2-1')));
 const paymentsCall=upstream.requests.find(r=>r.path==='/payments');
 assert.equal(paymentsCall.query,'?record=R-2');assert.match(paymentsCall.headers.authorization,/^Bearer fixture-access-/);assert.equal(paymentsCall.headers['x-hive-user-id'],alice);

 // DASHBOARD: same micro-app twice (independent instances), a denied slot and a failing slot, all isolated.
 await page.click('[data-layout-button=DASHBOARD]');
 for(const path of ['/finance/records/7','/finance/about','/unknown-path'])await (async()=>{await page.fill('input[name=path]',path);await page.click('#open button');})();
 state=await waitFor(s=>s.length===5&&s.filter(x=>x.status==='MOUNTED').length===4,'dashboard');
 const finance=state.filter(s=>s.module==='finance-example');
 assert.equal(finance.length,3);assert.equal(new Set(finance.map(s=>s.instance)).size,3,'independent instances');
 assert.deepEqual(state.at(-1).status,'ERROR');assert.equal(state.at(-1).error,'ROUTE_NOT_FOUND');
 await page.click('button[data-record=R-3]');
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-module=finance-example]')].every(f=>f.querySelector('.hive-slot-body').shadowRoot?.querySelector('[data-testid=selected-record]')?.textContent==='Selected record: R-3'),null,{timeout:10000});
 // Revoke a grant on the server: re-evaluation on context change denies that slot only.
 const grants=await api.ok('/admin/grants?subject='+encodeURIComponent(`user:${alice}`));
 await api.ok(`/admin/grants/${grants.find(g=>g.resourceKey==='directory-example').id}`,{method:'DELETE'});
 await page.evaluate(async()=>{const r=await fetch('/api/me/context');await window.hiveWorkspace.engine.setContext(await r.json());});
 state=await waitFor(s=>s[0].status==='DENIED','directory denied');
 assert.equal(state.filter(s=>s.status==='MOUNTED').length,3,'other slots unaffected');
 assert.equal(await page.locator('[data-testid=directory-example]').count(),0,'denied slot unmounted');
 await api.ok('/admin/grants',{method:'POST',body:{subject:`user:${alice}`,applicationKey:'campus-example',resourceKey:'directory-example',action:'view'}});
 await page.evaluate(async()=>{const r=await fetch('/api/me/context');await window.hiveWorkspace.engine.setContext(await r.json());});
 await waitFor(s=>s[0].status==='MOUNTED','directory restored');

 // TABS keeps instances mounted but shows only the active one.
 await page.click('[data-layout-button=TABS]');
 await page.click(`[data-slot-tab="${state[1].id}"]`);
 assert.deepEqual(await page.$$eval('.hive-slot',frames=>frames.map(f=>f.hidden)),[true,false,true,true,true]);
 assert.equal((await slots()).filter(s=>s.status==='MOUNTED').length,4);

 // Refresh: the workspace restores layout, slots, routes, active slot and logical instance ids.
 const before=await slots();const persisted=await page.evaluate(()=>sessionStorage.getItem('hive.workspace.example'));
 assert.ok(!persisted.includes('fixture-access')&&!persisted.includes(alice)&&!persisted.includes('Alice'),'persisted state holds routes only');
 await page.reload();await page.waitForSelector('body[data-hive-ready=true]');
 const after=await waitFor(s=>s.length===5&&s.filter(x=>x.status==='MOUNTED').length===4,'restored');
 assert.deepEqual(after.map(s=>[s.id,s.module,s.route,s.instance]),before.map(s=>[s.id,s.module,s.route,s.instance]));
 assert.equal(await page.getAttribute('#workspace','data-layout'),'TABS');
 assert.equal(await page.evaluate(()=>window.hiveWorkspace.engine.workspace.activeSlotId),before[1].id);

 // SINGLE keeps only the active slot.
 await page.click('[data-layout-button=SINGLE]');
 assert.deepEqual((await waitFor(s=>s.length===1,'single')).map(s=>s.id),[before[1].id]);

 // Logout: protected slots require login again; public routes keep working.
 await page.click('[data-layout-button=SPLIT]');
 await page.fill('input[name=path]','/finance/about');await page.click('#open button');
 await waitFor(s=>s.length===2&&s.every(x=>x.status==='MOUNTED'),'split again');
 await page.click('[data-testid=auth-button]');
 state=await waitFor(s=>s.some(x=>x.status==='LOGIN_REQUIRED'),'logged out');
 assert.deepEqual(state.map(s=>s.status),['LOGIN_REQUIRED','MOUNTED']);
 assert.equal(await page.evaluate(async()=>(await fetch('/api/me/context')).status),401,'session invalidated');
 assert.deepEqual(pageErrors,[]);
});
