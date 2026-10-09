// E2E: an operator registers a micro-frontend by IP and port entirely in the Operator Console (no Nginx change, no
// rebuild, no per-MFE configuration), manages its resource tree visually, grants access from the tree, and the default
// shell loads the module through the same-origin artifact gateway under the production Content-Security-Policy.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {startStack} from '../support/stack.mjs';
import {startOidcProvider} from '../support/oidc-fixture.mjs';
import {startUpstream} from '../support/upstream-fixture.mjs';
import {startMfeFixture} from '../support/mfe-fixture.mjs';
import {startGateway} from '../../tools/dev-gateway.mjs';
import {adminApi,browserChannel} from '../support/solution.mjs';

const MFE_PORT=Number(process.env.HIVE_TEST_MFE_PORT??3004);
const base=31200,gatewayPort=base+90,origin=`http://127.0.0.1:${gatewayPort}`;
// The deployment CSP of infra/nginx/hive-gateway.conf.template, applied verbatim to the shell and console documents.
const CSP=/add_header Content-Security-Policy "([^"]+)"/.exec(readFileSync('infra/nginx/hive-gateway.conf.template','utf8'))[1];

test('register an MFE by IP:port in the console, manage its resource tree, grant access and load it in the shell',{timeout:900000},async t=>{
 const idp=await startOidcProvider({port:base+80});t.after(()=>idp.close());
 const upstream=await startUpstream({port:base+85});t.after(()=>upstream.close());
 const mfe=await startMfeFixture({port:MFE_PORT,flavor:'webpack'});t.after(()=>mfe.close());
 const stack=await startStack(t,{suite:'e2e-mfe-registration',base,
  authorizationEnv:{HIVE_PRIMARY_ISSUER:idp.issuer,HIVE_BOOTSTRAP_ADMIN_ISSUER:idp.issuer,HIVE_BOOTSTRAP_ADMIN_SUBJECT:'operator',HIVE_ARTIFACT_NETWORK_POLICY:'UNRESTRICTED',
   HIVE_ARTIFACT_ALLOW_HTTP:'true',HIVE_TARGET_ALLOW_HTTP:'true'},
  bffEnv:{HIVE_IDENTITY_ENABLED:'true',HIVE_OIDC_ISSUER:idp.issuer,HIVE_OIDC_CLIENT_ID:idp.clientId,HIVE_OIDC_CLIENT_SECRET:idp.clientSecret,HIVE_OIDC_ALLOW_LOCAL_HTTP:'true',
   HIVE_MFE_NETWORK_POLICY:'UNRESTRICTED',HIVE_MFE_ALLOW_HTTP:'true',HIVE_PROXY_ALLOWED_ORIGINS:upstream.origin,HIVE_PROXY_ALLOW_HTTP:'true'}});
 const gateway=await startGateway({port:gatewayPort,bff:stack.urls.bff,headers:{'Content-Security-Policy':CSP},
  mounts:{'/console/':'apps/operator-console/dist','/':'apps/default-shell/dist'},spa:{'/console':'apps/operator-console/dist/index.html','/':'apps/default-shell/dist/index.html'}});
 t.after(()=>gateway.close());
 const api=adminApi(stack);

 const browser=await chromium.launch({headless:true,...browserChannel});t.after(()=>browser.close());
 const console_=await browser.newContext();const page=await console_.newPage();
 const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
 const byTestId=id=>page.locator(`[data-testid="${id}"]`);
 const choose=async(locator,text)=>{await locator.click();await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option',{hasText:text}).first().click();};

 // ---- Operator signs in and creates the application ---------------------------------------------------------
 idp.next={subject:'operator',name:'Olivia Operator'};
 await page.goto(origin+'/console/');
 await page.waitForSelector('[data-testid=role-SUPER_ADMIN]',{timeout:30000});
 await page.click('[data-testid=nav-applications]');await page.click('[data-testid=applications-create]');
 await page.fill('[data-testid=applications-create-key]','reporting');await page.fill('[data-testid=applications-create-displayName]','Reporting');
 await page.click('[data-testid=applications-create-submit]');
 await page.waitForSelector('[data-testid=applications-table] tr:has-text("reporting")');

 // ---- Scenario 1: register by IP and port in the wizard --------------------------------------------------------
 await page.click('[data-testid=nav-modules]');
 await page.click('[data-testid=mfe-wizard-open]');
 await choose(page.getByLabel('Application',{exact:true}),'Reporting');
 await page.fill('[data-testid=wizard-moduleKey]','reports');
 await page.fill('[data-testid=wizard-displayName]','Reports Management');
 await page.fill('[data-testid=wizard-description]','Operational and financial reports');
 await page.click('[data-testid=wizard-next]');
 await page.fill('[data-testid=wizard-host]','127.0.0.1');
 // A wrong port is diagnosed in the console before anything is registered.
 await page.fill('[data-testid=wizard-port]',String(base+87));
 await page.click('[data-testid=probe-run]');
 await page.waitForSelector('[data-testid=probe-check-reachability][data-status=FAIL]');
 assert.match(await byTestId('probe-check-reachability').textContent(),/CONNECTION_REFUSED.*offline or the port is wrong/);
 await page.click('[data-testid=wizard-next]');
 await page.waitForSelector('[data-testid=wizard-error]');
 // The right port: connection, compatibility and manifest discovery.
 await page.fill('[data-testid=wizard-port]',String(MFE_PORT));
 await page.click('[data-testid=probe-manifests]');
 await page.waitForSelector('[data-testid=probe-check-mfManifest][data-status=PASS]');
 for(const key of ['address','policy','reachability','http','format','integrity','resourceManifest'])
  assert.notEqual(await byTestId(`probe-check-${key}`).getAttribute('data-status'),'FAIL',key);
 assert.match(await byTestId('probe-check-format').textContent(),/WEBPACK_FEDERATION/);
 await page.click('[data-testid=wizard-next]');
 assert.equal(await byTestId('wizard-integrity').textContent(),mfe.integrity(),'integrity computed by Hive, not by the operator');
 await page.click('[data-testid=wizard-next]');
 await page.waitForSelector('[data-testid=wizard-resource-preview] .ant-tree-title:has-text("reports.sales-dashboard")');
 await page.click('[data-testid=wizard-next]');
 await page.click('[data-testid=wizard-validate]');
 await page.waitForSelector('[data-testid=wizard-validation] [data-testid=probe-check-artifact]');
 const validation=await page.locator('[data-testid=wizard-validation] [data-status]').evaluateAll(items=>items.map(i=>[i.getAttribute('data-testid'),i.getAttribute('data-status')]));
 assert.ok(validation.every(([,status])=>status==='PASS'),JSON.stringify(validation));
 await page.click('[data-testid=wizard-activate]');
 await page.waitForSelector('[data-testid=wizard-done]',{timeout:30000}).catch(async e=>{throw new Error(await page.locator('[data-testid=mfe-wizard]').innerText());});
 const steps=await page.locator('[data-testid=wizard-log-entry]').evaluateAll(items=>items.map(i=>i.getAttribute('data-status')));
 assert.deepEqual(steps,['ok','ok','ok','ok','ok'],'register, import, publish, artifact, activate');
 await page.click('[data-testid=wizard-close]');
 await page.waitForSelector('[data-testid=modules-table] tr:has-text("reports")');
 const registered=await api.ok('/admin/modules/reports');
 assert.deepEqual([registered.definitionMode,registered.activeArtifactVersion,registered.entryUrl],['HYBRID','1.0.0',`http://127.0.0.1:${MFE_PORT}/remoteEntry.js`]);

 // ---- Scenario 2: visual resource tree -------------------------------------------------------------------------
 await page.click('[data-testid=nav-resources]');
 await page.waitForSelector('[data-testid=resource-management]');
 await choose(byTestId('rm-module'),'Reports Management');
 await page.waitForSelector('[data-testid="resource-node-reports.dashboard"]');
 assert.equal(await byTestId('resource-node-reports.sales-dashboard').count(),0,'nested nodes start collapsed');
 await page.locator('.ant-tree-treenode:has([data-testid="resource-node-reports.dashboard"]) .ant-tree-switcher').click();
 await page.click('[data-testid="resource-node-reports.sales-dashboard"]');
 await page.waitForSelector('[data-testid=resource-details]');
 assert.equal(await byTestId('resource-details-key').textContent(),'reports.sales-dashboard');
 assert.deepEqual(await page.locator('[data-testid=resource-actions] .ant-tag').allTextContents(),['manage','export','print','view']);
 assert.match(await byTestId('resource-details').innerText(),/sales[\s\S]*\/reports\/sales/,'linked route shown');
 // HYBRID: a manual child under a manifest node; persisted across a reload.
 await page.click('[data-testid="resource-node-reports.dashboard"]');
 await page.click('[data-testid=resource-add-child]');
 await page.fill('[data-testid=resource-editor-key]','reports.management-report');
 await page.fill('[data-testid=resource-editor-displayName]','Management Report');
 await page.click('[data-testid=resource-editor-save]');
 await page.waitForSelector('[data-testid=resource-details-name]:has-text("Management Report")');
 await page.reload();
 await page.waitForSelector('[data-testid=resource-management]');
 await page.fill('[data-testid=resource-search]','management');
 await page.waitForSelector('[data-testid="resource-node-reports.management-report"]');
 assert.match(await byTestId('resource-node-reports.management-report').innerText(),/MANUAL/);
 await page.fill('[data-testid=resource-search]','');

 // ---- Scenario 3: grant user A from the tree; user B has nothing ---------------------------------------------------
 const alice=await api.ok('/admin/users',{method:'POST',body:{displayName:'Alice Analyst',identities:[{issuer:idp.issuer,subject:'alice'}]}});
 await api.ok('/admin/users',{method:'POST',body:{displayName:'Bob Outsider',identities:[{issuer:idp.issuer,subject:'bob'}]}});
 await api.ok('/admin/service-targets',{method:'POST',body:{key:'reports-svc',displayName:'Reports service',baseUrl:upstream.origin}});
 await api.ok('/admin/proxy-routes',{method:'POST',body:{key:'reports-api',applicationKey:'reporting',moduleKey:'reports',pathPrefix:'/reports-api',targetKey:'reports-svc',authentication:'FORWARD_TOKEN'}});
 await api.ok('/admin/proxy-routes/reports-api/operations',{method:'POST',body:{key:'sales',method:'GET',pathPattern:'/sales',access:'AUTHENTICATED',resourceKey:'reports.sales-dashboard',action:'view'}});
 await api.ok('/admin/proxy-routes/reports-api/operations',{method:'POST',body:{key:'export',method:'POST',pathPattern:'/sales/export',access:'AUTHENTICATED',resourceKey:'reports.sales-dashboard',action:'export'}});
 await page.reload();await page.waitForSelector('[data-testid=resource-management]');
 await page.fill('[data-testid=resource-search]','sales');
 await page.click('[data-testid="resource-node-reports.sales-dashboard"]');
 await page.click('[data-testid=resource-access-tab]');
 await choose(byTestId('grant-subject-kind'),'User');
 await choose(byTestId('grant-subject'),'Alice Analyst');
 await page.click('[data-testid=grant-action-view]');
 await page.click('[data-testid=grant-submit]');
 await page.waitForSelector(`[data-testid="grant-user:${alice.id}-view"]`);
 // Effective permissions come from the authorization engine (OpenFGA) once the grant is projected.
 await page.click('[data-testid=resource-inspect-tab]');
 await choose(byTestId('inspect-user'),'Alice Analyst');
 for(let i=0;i<40&&await byTestId('decision-view').textContent().catch(()=>'')!=='ALLOWED';i++){await page.waitForTimeout(250);await page.click('[data-testid=inspect-run]');}
 assert.equal(await byTestId('decision-view').textContent(),'ALLOWED');
 assert.equal(await byTestId('decision-export').textContent(),'DENIED');
 assert.deepEqual(pageErrors,[],'console without page errors');

 // User A in the shell: navigation shows the granted page; the module loads through /api/mfe with its chunk and CSS.
 const shell=await browser.newContext();const alicePage=await shell.newPage();
 const shellErrors=[];alicePage.on('pageerror',e=>shellErrors.push(e.message));
 const requests=[];alicePage.on('request',r=>requests.push(r.url()));
 const cspViolations=[];alicePage.on('console',m=>{if(/Content Security Policy/i.test(m.text()))cspViolations.push(m.text());});
 await alicePage.goto(origin+'/');await alicePage.waitForSelector('body[data-hive-ready=true]');
 idp.next={subject:'alice',name:'Alice Analyst'};
 await alicePage.click('[data-testid=sign-in]');
 await alicePage.waitForSelector('[data-testid=user]:has-text("Alice Analyst")',{timeout:30000});
 await alicePage.waitForSelector('[data-testid=navigation] a[data-route="reports:sales"]');
 assert.deepEqual(await alicePage.locator('[data-testid=navigation] a[data-route^="reports:"]').allTextContents(),['Sales Dashboard'],'only the permitted page is in the navigation');
 await alicePage.click('[data-testid=navigation] a[data-route="reports:sales"]');
 await alicePage.waitForSelector('[data-testid=mfe-reports]',{timeout:30000}).catch(async()=>{throw new Error(JSON.stringify(await alicePage.evaluate(()=>({slots:window.hiveShell.engine.workspace.slots,diagnostics:window.hiveShell.diagnostics}))));});
 assert.equal(await alicePage.locator('[data-testid=mfe-reports]').textContent(),'Reports /reports/sales');
 assert.equal(await alicePage.locator('[data-testid=mfe-reports]').evaluate(e=>getComputedStyle(e).color),'rgb(10, 20, 30)','the micro-frontend stylesheet loaded through the gateway');
 for(const asset of ['/api/mfe/reports/1.0.0/remoteEntry.js','/api/mfe/reports/1.0.0/assets/chunk.js','/api/mfe/reports/1.0.0/assets/style.css'])
  assert.ok(requests.includes(origin+asset),asset);
 assert.ok(!requests.some(u=>u.includes(`:${MFE_PORT}/`)),'the browser never contacts the MFE host');
 assert.deepEqual(cspViolations,[]);
 assert.equal(await alicePage.evaluate(async()=>(await fetch('/api/routes/reports-api/sales')).status),200);
 const csrf=await alicePage.evaluate(async()=>(await fetch('/auth/csrf')).json());
 assert.equal(await alicePage.evaluate(async c=>(await fetch('/api/routes/reports-api/sales/export',{method:'POST',headers:{'Content-Type':'application/json',[c.headerName]:c.token},body:'{}'})).status,csrf),403,'server denies the ungranted action');
 // A route the user is not granted is denied in its slot.
 await alicePage.evaluate(()=>window.hiveShell.engine.navigate(window.hiveShell.engine.workspace.activeSlotId,'/reports/daily'));
 await alicePage.waitForFunction(()=>window.hiveShell.engine.workspace.slots.some(s=>s.route==='/reports/daily'&&s.status==='DENIED'));
 assert.deepEqual(shellErrors,[]);

 // User B: no navigation entry, the protected page does not mount, the gateway and the API refuse.
 const other=await browser.newContext();const bobPage=await other.newPage();
 await bobPage.goto(origin+'/');await bobPage.waitForSelector('body[data-hive-ready=true]');
 idp.next={subject:'bob',name:'Bob Outsider'};
 await bobPage.click('[data-testid=sign-in]');
 await bobPage.waitForSelector('[data-testid=user]:has-text("Bob Outsider")',{timeout:30000});
 assert.equal(await bobPage.locator('[data-testid=navigation] a[data-route^="reports:"]').count(),0);
 await bobPage.goto(origin+'/reports/sales');await bobPage.waitForSelector('body[data-hive-ready=true]');
 await bobPage.waitForTimeout(1000);
 assert.equal(await bobPage.locator('[data-testid=mfe-reports]').count(),0,'protected page is not accessible');
 assert.equal(await bobPage.evaluate(async()=>(await fetch('/api/mfe/reports/1.0.0/remoteEntry.js')).status),404);
 assert.equal(await bobPage.evaluate(async()=>(await fetch('/api/routes/reports-api/sales')).status),403);

 // An administrative change reaches the open session without a new login: deactivation removes the module.
 await api.ok('/admin/modules/reports/deactivate',{method:'POST'});
 await alicePage.evaluate(()=>window.hiveShell.refresh());
 await alicePage.waitForFunction(()=>!document.querySelector('[data-testid=navigation] a[data-route^="reports:"]'));
});
