// Phase 7 E2E: framework-neutral micro-app loaded by the headless MFE runtime in a real browser.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {startStack} from '../support/stack.mjs';
import {startOidcProvider} from '../support/oidc-fixture.mjs';
import {startGateway} from '../../tools/dev-gateway.mjs';
import {adminApi,registerModule,browserChannel} from '../support/solution.mjs';

const dist='examples/minimal-consumer/dist';
test('plain TypeScript micro-app runs through the headless runtime: public, login, mount, update, unmount, isolation',{timeout:400000},async t=>{
 const gatewayPort=29790,origin=`http://127.0.0.1:${gatewayPort}`;
 const idp=await startOidcProvider({port:29780});t.after(()=>idp.close());
 const stack=await startStack(t,{suite:'e2e-mfe',base:29700,authorizationEnv:{HIVE_PRIMARY_ISSUER:idp.issuer},
  bffEnv:{HIVE_IDENTITY_ENABLED:'true',HIVE_OIDC_ISSUER:idp.issuer,HIVE_OIDC_CLIENT_ID:idp.clientId,HIVE_OIDC_CLIENT_SECRET:idp.clientSecret,HIVE_OIDC_ALLOW_LOCAL_HTTP:'true'}});
 const gateway=await startGateway({port:gatewayPort,bff:stack.urls.bff,mounts:{'/modules/':`${dist}/modules`,'/host/':`${dist}/host`},spa:{'/':`${dist}/runtime.html`}});t.after(()=>gateway.close());
 const api=adminApi(stack);
 await registerModule(api,{applicationKey:'campus-example',displayName:'Campus example',moduleKey:'finance-example',distDir:`${dist}/modules/finance-example`});
 const alice=(await api.ok('/admin/users',{method:'POST',body:{displayName:'Alice Example',identities:[{issuer:idp.issuer,subject:'alice'}]}})).id;
 await api.ok('/admin/grants',{method:'POST',body:{subject:`user:${alice}`,applicationKey:'campus-example',resourceKey:'finance-example.payments',action:'view'}});
 // A second module whose artifact bytes do not match its registered integrity.
 const broken=JSON.parse(readFileSync(`${dist}/modules/finance-example/mf-manifest.json`,'utf8'));
 await api.ok('/admin/modules',{method:'POST',body:{applicationKey:'campus-example',moduleKey:'tampered-example',displayName:'Tampered',definitionMode:'MANUAL'}});
 await api.ok('/admin/modules/tampered-example/artifacts',{method:'POST',body:{...broken,moduleKey:'tampered-example',displayName:'Tampered',resourceManifestVersion:undefined,
  artifact:{...broken.artifact,integrity:'sha384-'+Buffer.alloc(48,7).toString('base64')},routes:[{key:'home',path:'/tampered',access:'PUBLIC',navigation:{label:'Tampered'}}]}});
 await api.ok('/admin/modules/tampered-example/artifacts/1.0.0/activate',{method:'POST'});

 const browser=await chromium.launch({headless:true,...browserChannel});t.after(()=>browser.close());
 const context=await browser.newContext();const page=await context.newPage();
 const pageErrors=[],consoleLines=[];page.on('pageerror',e=>pageErrors.push(e.message));page.on('console',m=>consoleLines.push(m.type()+': '+m.text()));
 const waitState=async expected=>{try{await page.waitForFunction(v=>document.getElementById('status').dataset.hiveState===v,expected,{timeout:15000});}catch(error){throw new Error(`expected ${expected}; status=${await page.locator('#status').textContent()} errors=${pageErrors} console=${consoleLines.join(' | ')} diagnostics=${JSON.stringify(await page.evaluate(()=>window.hiveHost?.diagnostics))} context=${JSON.stringify(await page.evaluate(()=>{const c=window.hiveHost?.context;return c&&{auth:c.authenticated,modules:c.modules.map(m=>m.moduleKey+":"+m.routes.map(r=>r.key)),permissions:c.permissions};}))}`);}};
 const state=()=>page.locator('#status').getAttribute('data-hive-state');

 // Anonymous: the public route mounts; the public context exposes no protected routes.
 await page.goto(origin+'/finance/about');
 await waitState('MOUNTED');
 assert.equal(await page.locator('[data-testid=viewer]').textContent(),'Anonymous visitor');
 assert.ok(await page.evaluate(()=>!!document.getElementById('slot').shadowRoot),'SHADOW_DOM isolation requested by the manifest');
 const publicRoutes=await page.evaluate(()=>window.hiveHost.context.modules.flatMap(m=>m.routes.map(r=>r.access)));
 assert.ok(publicRoutes.length>0&&!publicRoutes.includes('AUTHENTICATED'),'public context has no protected routes');
 assert.deepEqual(await page.locator('nav a').allTextContents(),['Finance info','Tampered']);
 await page.evaluate(()=>window.hiveHost.go('/finance'));
 await waitState('LOGIN_REQUIRED');
 assert.equal(await page.locator('[data-testid=finance-example]').count(),0,'protected route not mounted for anonymous users');

 // Login through the host's button returns to the protected route and mounts it.
 idp.next={subject:'alice',name:'Alice Example'};
 await Promise.all([page.waitForURL(origin+'/finance'),page.click('[data-testid=auth-button]')]);
 await waitState('MOUNTED');
 assert.equal(await page.locator('[data-testid=viewer]').textContent(),'Signed in as Alice Example');
 assert.equal(await page.locator('[data-testid=pay]').isHidden(),true,'pay hidden without permission');
 assert.deepEqual(await page.locator('nav a').allTextContents(),['Finance info','Payments','Tampered']);
 const firstInstance=await page.evaluate(()=>window.hiveHost.mounted.instanceId);

 // Navigation within the module updates the same instance with new params.
 await page.evaluate(()=>window.hiveHost.go('/finance/records/42'));
 await page.waitForFunction(()=>document.getElementById('slot').shadowRoot?.querySelector('[data-testid=selected-record]')?.textContent==='Selected record: 42');
 assert.equal(await page.evaluate(()=>window.hiveHost.mounted.instanceId),firstInstance,'update, not remount');
 assert.match(await page.locator('[data-testid=route]').textContent(),/Route \/finance\/records\/42/);

 // Integrity failure is diagnosed precisely and does not break the host or other modules.
 await page.evaluate(()=>window.hiveHost.go('/tampered'));
 await page.waitForFunction(()=>document.getElementById('status').dataset.hiveError);
 assert.equal(await page.locator('#status').getAttribute('data-hive-error'),'ARTIFACT_INTEGRITY_MISMATCH');
 assert.equal(await page.evaluate(()=>window.hiveHost.mounted),null,'previous instance was unmounted before the failed load');
 await page.evaluate(()=>window.hiveHost.go('/finance'));
 await waitState('MOUNTED');
 assert.notEqual(await page.evaluate(()=>window.hiveHost.mounted.instanceId),firstInstance,'fresh instance after remount');

 // Explicit unmount removes everything the micro-app rendered.
 await page.evaluate(()=>window.hiveHost.unmount());
 assert.equal(await page.evaluate(()=>document.getElementById('slot').shadowRoot.childElementCount),0);

 // Permissions are UI hints derived from server decisions: a new grant shows the pay action after reload.
 await api.ok('/admin/grants',{method:'POST',body:{subject:`user:${alice}`,applicationKey:'campus-example',resourceKey:'finance-example.payments',action:'pay'}});
 await page.reload();await waitState('MOUNTED');
 assert.equal(await page.locator('[data-testid=pay]').isVisible(),true);

 // The browser never held a token: no JS-readable cookies, no token in context.
 assert.equal(await page.evaluate(()=>document.cookie),'');
 const serialized=JSON.stringify(await page.evaluate(()=>window.hiveHost.context));
 for(const secret of idp.secrets())assert.ok(!serialized.includes(secret));
 assert.deepEqual(pageErrors,[],'no uncaught page errors');
});
