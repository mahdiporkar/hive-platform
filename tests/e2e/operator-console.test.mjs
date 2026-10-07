// E2E 11: the Operator Console drives real administrative flows against the real control plane.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {startStack} from '../support/stack.mjs';
import {startOidcProvider} from '../support/oidc-fixture.mjs';
import {startUpstream} from '../support/upstream-fixture.mjs';
import {startGateway} from '../../tools/dev-gateway.mjs';
import {adminApi,browserChannel} from '../support/solution.mjs';

const modules='examples/minimal-consumer/dist/modules';
test('operator console administers applications, manifests, identities, grants, routes and logs through the admin API',{timeout:600000},async t=>{
 const gatewayPort=29990,origin=`http://127.0.0.1:${gatewayPort}`;
 const idp=await startOidcProvider({port:29980});t.after(()=>idp.close());
 const upstream=await startUpstream({port:29985});t.after(()=>upstream.close());
 const stack=await startStack(t,{suite:'e2e-console',base:29900,
  authorizationEnv:{HIVE_PRIMARY_ISSUER:idp.issuer,HIVE_BOOTSTRAP_ADMIN_ISSUER:idp.issuer,HIVE_BOOTSTRAP_ADMIN_SUBJECT:'operator',HIVE_TARGET_ALLOW_HTTP:'true'},
  bffEnv:{HIVE_IDENTITY_ENABLED:'true',HIVE_OIDC_ISSUER:idp.issuer,HIVE_OIDC_CLIENT_ID:idp.clientId,HIVE_OIDC_CLIENT_SECRET:idp.clientSecret,HIVE_OIDC_ALLOW_LOCAL_HTTP:'true',
   HIVE_PROXY_ALLOWED_ORIGINS:upstream.origin,HIVE_PROXY_ALLOW_HTTP:'true'}});
 const gateway=await startGateway({port:gatewayPort,bff:stack.urls.bff,mounts:{'/console/':'apps/operator-console/dist','/modules/':modules},spa:{'/console':'apps/operator-console/dist/index.html'}});
 t.after(()=>gateway.close());
 const api=adminApi(stack);

 const browser=await chromium.launch({headless:true,...browserChannel});t.after(()=>browser.close());
 const context=await browser.newContext();const page=await context.newPage();
 const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
 let promptAnswer='';page.on('dialog',dialog=>dialog.type()==='prompt'?dialog.accept(promptAnswer):dialog.accept());
 const nav=async section=>{await page.click(`[data-testid=nav-${section}]`);};
 const fill=async(testId,value)=>{await page.fill(`[data-testid=${testId}]`,value);};
 const select=async(label,value)=>{await page.getByLabel(label,{exact:true}).click();await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option',{hasText:value}).first().click();};
 const submit=async prefix=>{await page.click(`[data-testid=${prefix}-submit]`);await page.waitForSelector(`[data-testid=${prefix}-submit]`,{state:'detached',timeout:15000}).catch(async()=>{throw new Error(await page.locator(`[data-testid=${prefix}-error]`).textContent().catch(()=>'no error shown'));});};
 const row=async(table,text)=>page.waitForSelector(`[data-testid=${table}-table] tr:has-text("${text}")`,{timeout:15000});

 // Sign in as the bootstrapped first administrator.
 idp.next={subject:'operator',name:'Olivia Operator'};
 await page.goto(origin+'/console/');
 await page.waitForSelector('[data-testid=role-SUPER_ADMIN]',{timeout:30000});
 assert.equal(await page.locator('[data-testid=operator-name]').textContent(),'Olivia Operator');

 // Application.
 await nav('applications');await page.click('[data-testid=applications-create]');
 await fill('applications-create-key','campus-example');await fill('applications-create-displayName','Campus example');await submit('applications-create');
 await row('applications','campus-example');

 // Module, resource manifest draft, diff, publish; artifact registration and activation.
 await nav('modules');await page.click('[data-testid=modules-create]');
 await fill('modules-create-applicationKey','campus-example');await fill('modules-create-moduleKey','finance-example');await fill('modules-create-displayName','Finance example');
 await submit('modules-create');
 await page.click('[data-testid=module-link-finance-example]');
 await page.fill('[data-testid=resource-manifest-json]',readFileSync(`${modules}/finance-example/resource-manifest.json`,'utf8'));
 await page.click('[data-testid=resource-manifest-submit]');
 await row('revisions','DRAFT');
 await page.click('[data-testid=diff-1\\.0\\.0]');await page.waitForSelector('[data-testid=diff-change]');
 assert.deepEqual((await page.locator('[data-testid=diff-change]').allTextContents()).map(t=>t.split(' ')[0]),['ADDED','ADDED','ADDED']);
 await page.click('[data-testid=publish-1\\.0\\.0]');await row('revisions','PUBLISHED');
 await page.getByRole('tab',{name:'Artifacts'}).click();
 await page.fill('[data-testid=mf-manifest-json]',readFileSync(`${modules}/finance-example/mf-manifest.json`,'utf8'));
 await page.click('[data-testid=mf-manifest-submit]');
 await page.click('[data-testid=activate-artifact-1\\.0\\.0]');
 await page.waitForSelector('[data-testid=artifacts-table] .ant-tag:has-text("active")');
 // An incompatible manifest is rejected with an actionable message shown in the console.
 const incompatible=JSON.parse(readFileSync(`${modules}/finance-example/mf-manifest.json`,'utf8'));incompatible.manifestVersion='2.0.0';incompatible.contractVersion='2.0.0';
 await page.fill('[data-testid=mf-manifest-json]',JSON.stringify(incompatible));await page.click('[data-testid=mf-manifest-submit]');
 assert.match(await page.locator('[data-testid=mf-manifest-error]').textContent(),/VERSION_MAJOR_UNSUPPORTED: contractVersion: supported major 1, received 2/);

 // Resource tree.
 await nav('applications');await page.click('[data-testid=application-link-campus-example]');
 await page.waitForSelector('.ant-tree-title:has-text("finance-example.payments")',{timeout:10000}).catch(async e=>{throw new Error('tree: '+await page.evaluate(()=>document.querySelector('[data-testid=resources-page]')?.innerText??document.body.innerText.slice(0,2000)));});

 // Identity, role, grant, role assignment, platform role.
 await nav('users');await page.click('[data-testid=users-create]');
 await fill('users-create-displayName','Carol Clerk');await fill('users-create-issuer',idp.issuer);await fill('users-create-subject','carol');await submit('users-create');
 await row('users','Carol Clerk');
 const carol=(await api.ok('/admin/users?query=Carol')).find(u=>u.displayName==='Carol Clerk').id;
 await nav('roles');await page.click('[data-testid=roles-create]');
 await fill('roles-create-key','payments-viewer');await fill('roles-create-displayName','Payments viewer');await submit('roles-create');
 promptAnswer=`user:${carol}`;await page.click('[data-testid=role-assign-payments-viewer]');
 await nav('grants');await page.click('[data-testid=grants-create]');
 await fill('grants-create-subject','role:payments-viewer');await fill('grants-create-applicationKey','campus-example');
 await fill('grants-create-resourceKey','finance-example.payments');await fill('grants-create-action','view');await submit('grants-create');
 await row('grants','role:payments-viewer');
 await nav('platform-roles');await page.click('[data-testid=platform-roles-create]');
 await select('Role','AUDITOR');await fill('platform-roles-create-subject',`user:${carol}`);await submit('platform-roles-create');
 await row('platform-roles','AUDITOR');

 // Service target, forward-token route and a protected operation; routing preview.
 await nav('service-targets');await page.click('[data-testid=targets-create]');
 await fill('targets-create-key','finance-svc');await fill('targets-create-displayName','Finance service');await fill('targets-create-baseUrl',upstream.origin);await submit('targets-create');
 await row('targets','finance-svc');
 await nav('routes');await page.click('[data-testid=routes-create]');
 await fill('routes-create-key','finance');await fill('routes-create-applicationKey','campus-example');await fill('routes-create-pathPrefix','/finance');await fill('routes-create-targetKey','finance-svc');
 await submit('routes-create');await row('routes','finance');
 await page.click('[data-testid=route-operations-finance]');
 await page.click('[data-testid=operation-create-finance]');
 await fill('operation-create-finance-key','payments');await select('Method','GET');await fill('operation-create-finance-pathPattern','/payments');
 await select('Access','AUTHENTICATED');await fill('operation-create-finance-resourceKey','finance-example.api');await fill('operation-create-finance-action','read');
 await submit('operation-create-finance');
 await page.waitForSelector('[data-testid=operations-finance] tr:has-text("/payments")');
 await page.fill('[data-testid=preview-path]','/finance/payments');await page.click('[data-testid=preview-run]');
 assert.match(await page.locator('[data-testid=preview-result]').textContent(),/"operation":"payments"/);

 // Feature flag and diagnostics.
 await nav('feature-flags');await page.click('[data-testid=flags-create]');
 await fill('flags-create-key','workspaceSplitView');await fill('flags-create-description','Allow split workspaces');await select('Exposure','PUBLIC');await submit('flags-create');
 await page.click('[data-testid=flag-toggle-workspaceSplitView]');await page.waitForSelector('[data-testid=flags-table] tr:has-text("workspaceSplitView") .ant-tag:has-text("on")');
 await nav('diagnostics');await page.waitForSelector('[data-testid=graph-ready]');
 assert.equal(await page.locator('[data-testid=graph-ready]').textContent(),'true');
 assert.match(await page.locator('[data-testid=active-modules]').textContent(),/finance-example@1\.0\.0/);

 // Audit and API logs pages show real records attributed to the operator.
 await nav('audit');await page.fill('[data-testid=audit-filter]','application.');await page.press('[data-testid=audit-filter]','Enter');
 await page.waitForSelector('[data-testid=audit-table] tr:has-text("application.created")');
 const operator=(await api.ok('/admin/platform-roles')).find(a=>a.role==='SUPER_ADMIN').subject;
 assert.ok(await page.locator(`[data-testid=audit-table] tr:has-text("${operator}")`).count()>0,'actions attributed to the operator');
 await nav('api-logs');await page.waitForSelector('[data-testid=api-logs-page]');

 // Everything the console did is visible through the API (no console-private state).
 const audit=await api.ok('/admin/audit?limit=300');
 for(const type of ['application.created','module.registered','manifest.resources.published','manifest.artifact.activated','user.created','role.created','role.assigned','grant.created','platform-role.assigned','service-target.created','proxy-route.created','route-operation.created','feature-flag.updated'])
  assert.ok(audit.some(e=>e.eventType===type&&e.actorId===operator),`${type} by operator`);
 const decision=(await stack.service('/internal/authorization/check',{method:'POST',principal:'bff',body:{userId:carol,checks:[{applicationKey:'campus-example',resourceKey:'finance-example.payments',action:'view'}]}}).then(r=>r.json()))[0];
 assert.equal(decision.allowed,true,'role assignment + grant made in the console are effective');

 // Users without a platform role get no console, and the API refuses them regardless of the UI.
 await api.ok('/admin/users',{method:'POST',body:{displayName:'Dave Business',identities:[{issuer:idp.issuer,subject:'dave'}]}});
 const other=await browser.newContext();const davePage=await other.newPage();
 idp.next={subject:'dave',name:'Dave Business'};
 await davePage.goto(origin+'/console/');await davePage.waitForSelector('[data-testid=no-platform-role]',{timeout:30000});
 assert.equal(await davePage.evaluate(async()=>(await fetch('/api/admin/applications')).status),403);
 assert.deepEqual(pageErrors,[]);
});
