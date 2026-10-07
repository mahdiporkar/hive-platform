// Phase 10 E2E (spec E2E 2, 4, 5, 6 and §36–§40, §52, §53): default shell with a React + Tailwind micro-app and plain
// TypeScript micro-apps; PUBLIC, HYBRID and AUTHENTICATED routes; public context secrecy; login return URL; extensions;
// cross-framework events; restore; a server-rendered public site on Hive's public APIs.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {startStack} from '../support/stack.mjs';
import {startOidcProvider} from '../support/oidc-fixture.mjs';
import {startUpstream} from '../support/upstream-fixture.mjs';
import {startGateway} from '../../tools/dev-gateway.mjs';
import {adminApi,registerModule,browserChannel} from '../support/solution.mjs';
import {startPublicWeb} from '../../examples/react-tailwind-consumer/public-web/server.mjs';

test('public, hybrid and authenticated runtime with the default shell and the React + Tailwind consumer',{timeout:600000},async t=>{
 const gatewayPort=30190,origin=`http://127.0.0.1:${gatewayPort}`;
 const idp=await startOidcProvider({port:30180});t.after(()=>idp.close());
 const upstream=await startUpstream({port:30185});t.after(()=>upstream.close());
 const stack=await startStack(t,{suite:'e2e-public-hybrid',base:30100,authorizationEnv:{HIVE_PRIMARY_ISSUER:idp.issuer,HIVE_TARGET_ALLOW_HTTP:'true',HIVE_ENVIRONMENT:'test'},
  bffEnv:{HIVE_IDENTITY_ENABLED:'true',HIVE_OIDC_ISSUER:idp.issuer,HIVE_OIDC_CLIENT_ID:idp.clientId,HIVE_OIDC_CLIENT_SECRET:idp.clientSecret,HIVE_OIDC_ALLOW_LOCAL_HTTP:'true',
   HIVE_PROXY_ALLOWED_ORIGINS:upstream.origin,HIVE_PROXY_ALLOW_HTTP:'true',HIVE_BRANDING_NAME:'Campus Example'}});
 const gateway=await startGateway({port:gatewayPort,bff:stack.urls.bff,mounts:{'/':'apps/default-shell/dist','/shell-extensions.js':'tests/fixtures/shell/shell-extensions.js',
  '/modules/student-example/':'examples/react-tailwind-consumer/dist/modules/student-example','/modules/':'examples/minimal-consumer/dist/modules'},spa:{'/':'apps/default-shell/dist/index.html'}});
 t.after(()=>gateway.close());
 const api=adminApi(stack);
 await registerModule(api,{applicationKey:'campus-example',displayName:'Campus example',moduleKey:'student-example',distDir:'examples/react-tailwind-consumer/dist/modules/student-example'});
 for(const moduleKey of ['finance-example','directory-example'])await registerModule(api,{applicationKey:'campus-example',displayName:'Campus example',moduleKey,distDir:`examples/minimal-consumer/dist/modules/${moduleKey}`});
 await api.ok('/admin/service-targets',{method:'POST',body:{key:'campus-svc',displayName:'Campus fixture API',baseUrl:upstream.origin+'/campus'}});
 await api.ok('/admin/proxy-routes',{method:'POST',body:{key:'students',applicationKey:'campus-example',moduleKey:'student-example',pathPrefix:'/students',targetKey:'campus-svc',authentication:'FORWARD_TOKEN'}});
 for(const op of [{key:'news',method:'GET',pathPattern:'/news',access:'PUBLIC'},{key:'courses',method:'GET',pathPattern:'/courses',access:'PUBLIC'},
  {key:'course',method:'GET',pathPattern:'/courses/{id}',access:'HYBRID'},{key:'enroll',method:'POST',pathPattern:'/courses/{id}/enrollments',access:'AUTHENTICATED',resourceKey:'student-example.api',action:'enroll'},
  {key:'students',method:'GET',pathPattern:'/students',access:'AUTHENTICATED',resourceKey:'student-example.api',action:'read'}])
  await api.ok('/admin/proxy-routes/students/operations',{method:'POST',body:op});
 for(const [key,exposure] of [['publicHybridRoutes','PUBLIC'],['newPermissionEditor','AUTHENTICATED'],['internalSwitch','INTERNAL']])
  await api.ok('/admin/feature-flags',{method:'POST',body:{key,description:key,exposure,enabled:true}});
 const alice=(await api.ok('/admin/users',{method:'POST',body:{displayName:'Alice Example',identities:[{issuer:idp.issuer,subject:'alice'}]}})).id;
 const bob=(await api.ok('/admin/users',{method:'POST',body:{displayName:'Bob Example',identities:[{issuer:idp.issuer,subject:'bob'}]}})).id;
 for(const [resourceKey,action] of [['student-example.list','view'],['student-example.list','annotate'],['student-example.api','read'],['student-example.courses','view'],['student-example.courses','enroll'],
  ['student-example.api','enroll'],['finance-example.payments','view'],['directory-example','view']])
  await api.ok('/admin/grants',{method:'POST',body:{subject:`user:${alice}`,applicationKey:'campus-example',resourceKey,action}});
 await api.ok('/admin/grants',{method:'POST',body:{subject:`user:${bob}`,applicationKey:'campus-example',resourceKey:'student-example.courses',action:'view'}});

 const browser=await chromium.launch({headless:true,...browserChannel});t.after(()=>browser.close());
 const context=await browser.newContext();const page=await context.newPage();
 const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
 const ready=()=>page.waitForSelector('body[data-hive-ready=true]');
 const slots=()=>page.evaluate(()=>window.hiveShell.engine.workspace.slots.map(s=>({id:s.slotId,module:s.moduleKey,status:s.status,route:s.route})));
 const waitFor=async(predicate,label)=>{for(let i=0;i<120;i++){const v=await slots();if(predicate(v))return v;await page.waitForTimeout(150);}throw new Error(`${label}: ${JSON.stringify(await slots())}`);};
 const navLabels=()=>page.locator('[data-testid=navigation] a[data-route]').allTextContents();

 // E2E 4 — PUBLIC: anonymous visitors use public pages; the shell shows only anonymous-capable navigation.
 await page.goto(origin+'/');await ready();
 assert.equal(await page.locator('[data-testid=brand]').textContent(),'Campus Example');
 assert.deepEqual(await navLabels(),['Campus','Courses','Finance info']);
 await page.waitForSelector('[data-testid=campus-title]');
 assert.equal(await page.locator('[data-testid=extension-banner]').textContent(),'Open day this Friday');
 assert.equal(await page.locator('[data-testid=extension-annotations]').count(),0,'permission-gated extension hidden');
 // CSS isolation: Tailwind (with Preflight) lives in the micro-app's shadow root only.
 const styles=await page.evaluate(()=>({hostSheets:[...document.styleSheets].map(s=>{try{return [...s.cssRules].map(r=>r.cssText).join('');}catch{return '';}}).join('').includes('tailwindcss'),
  signInBorder:getComputedStyle(document.querySelector('[data-testid=sign-in]')).borderTopWidth,
  mfeButton:getComputedStyle(document.querySelector('[data-module=student-example] [data-hive-slot-host]').shadowRoot.querySelector('[data-testid=browse-courses]')).backgroundColor}));
 assert.equal(styles.hostSheets,false,'no Tailwind in the host document');assert.notEqual(styles.signInBorder,'0px','host buttons keep their styles');
 assert.notEqual(styles.mfeButton,'rgba(0, 0, 0, 0)','micro-app is styled by its own Tailwind');
 // Public context secrecy (§37).
 const publicContext=await page.evaluate(async()=>(await fetch('/api/public/context')).text());
 const parsed=JSON.parse(publicContext);
 assert.equal(parsed.authenticated,false);for(const field of ['identity','permissions','platformRoles','session'])assert.equal(parsed[field],undefined,field);
 assert.ok(parsed.modules.flatMap(m=>m.routes).every(r=>r.access!=='AUTHENTICATED'&&!r.resource),'no protected routes or permissions');
 for(const secret of ['campus-svc',upstream.origin,'Bearer','HIVE_SECRET','students-example.api','internalSwitch','newPermissionEditor'])assert.ok(!publicContext.includes(secret),`public context leaks ${secret}`);
 assert.deepEqual(parsed.features,[{key:'publicHybridRoutes',enabled:true}]);
 assert.equal(await page.evaluate(async()=>(await fetch('/api/routes/students/news')).status),200,'public API operation');

 // E2E 6 — HYBRID anonymously: readable, with a sign-in invitation instead of the action.
 await page.locator('[data-testid=browse-courses]').click();
 await page.locator('[data-course=c-101]').click();
 await page.waitForSelector('[data-testid=course-title]');
 assert.equal(await page.locator('[data-testid=personalized]').count(),0);
 assert.equal(await page.locator('[data-testid=sign-in-to-enroll]').count(),1);
 assert.equal(upstream.requests.filter(r=>r.path==='/campus/courses/c-101').at(-1).headers.authorization,undefined,'anonymous HYBRID call carries no identity');
 assert.equal(new URL(page.url()).pathname,'/courses/c-101','URL mirrors the active route');

 // E2E 5 — AUTHENTICATED anonymously: rejected in the UI and by the API.
 assert.equal(await page.evaluate(async()=>(await fetch('/api/routes/students/students')).status),401);
 assert.equal(await page.evaluate(async()=>(await fetch('/api/routes/students/courses/c-101/enrollments',{method:'POST'})).status),403,'no CSRF, no session: rejected');
 // SINGLE layout: navigating replaces the slot content; the protected route asks for sign-in, then go back.
 await page.evaluate(()=>window.hiveShell.engine.navigate(window.hiveShell.engine.workspace.activeSlotId,'/students'));
 await waitFor(s=>s.length===1&&s[0].route==='/students'&&s[0].status==='LOGIN_REQUIRED','students requires login');
 assert.equal(await page.locator('[data-testid=slot-sign-in]').count(),1);
 await page.goBack();
 await page.waitForSelector('[data-testid=sign-in-to-enroll]');

 // Login from the HYBRID page returns to it (§38) and unlocks the authenticated capability.
 idp.next={subject:'alice',name:'Alice Example'};
 const visited=[];page.on('framenavigated',f=>{if(f===page.mainFrame())visited.push(f.url());});
 await Promise.all([page.waitForURL(origin+'/courses/c-101',{timeout:15000}).catch(e=>{throw new Error('visited '+visited.join(' -> ')+' now '+page.url());}),page.locator('[data-testid=sign-in-to-enroll]').click()]);
 await ready();
 await page.waitForSelector('[data-testid=personalized]');
 await page.locator('[data-testid=enroll]').click();
 await page.waitForSelector('[data-testid=enrollment-result]');
 assert.equal(await page.locator('[data-testid=enrollment-result]').textContent(),'ENROLLED');
 const enrollment=upstream.requests.findLast(r=>r.path==='/campus/courses/c-101/enrollments');
 assert.equal(enrollment.headers['x-hive-user-id'],alice);assert.match(enrollment.headers.authorization,/^Bearer fixture-access-/);
 assert.deepEqual(await navLabels(),['Campus','Courses','Students','Directory','Finance info','Payments']);
 assert.equal(await page.locator('[data-testid=extension-banner]').textContent(),'Welcome back, Alice Example');
 assert.equal(await page.locator('[data-testid=extension-annotations]').count(),1,'permission-gated extension shown');
 const me=await page.evaluate(async()=>(await fetch('/api/me/context')).json());
 assert.deepEqual(me.features.map(f=>f.key).sort(),['newPermissionEditor','publicHybridRoutes']);

 // E2E 2 + multi-framework workspace: React/Tailwind and plain TypeScript micro-apps side by side, talking via events.
 await page.click('[data-layout-button=SPLIT]');
 await page.locator('[data-route="student-example:students"]').click();
 await page.click('[data-open-new="finance-example:overview"]');
 await waitFor(s=>s.length===2&&s.every(x=>x.status==='MOUNTED')&&s.some(x=>x.module==='finance-example'),'split');
 await page.locator('[data-student=S-2]').click();
 await page.waitForFunction(()=>document.querySelector('[data-module=finance-example] [data-hive-slot-host]')?.shadowRoot?.querySelector('[data-testid=selected-record]')?.textContent==='Selected record: S-2');
 assert.equal(await page.locator('[data-testid=annotate-S-1]').count(),1,'permission-based action visible');
 await page.click('[data-layout-button=DASHBOARD]');assert.equal(await page.locator('[data-testid=extension-dashboard]').count(),1);
 await page.click('[data-layout-button=SPLIT]');

 // Workspace restoration after refresh (E2E 13 via the default shell).
 const before=await slots();await page.reload();await ready();
 const after=await waitFor(s=>s.length===before.length&&s.every(x=>x.status==='MOUNTED'),'restored');
 assert.deepEqual(after.map(s=>[s.module,s.route]),before.map(s=>[s.module,s.route]));

 // A signed-in user without the enroll permission: the UI hides the action and the API refuses it anyway.
 const bobContext=await browser.newContext();const bobPage=await bobContext.newPage();
 idp.next={subject:'bob',name:'Bob Example'};
 await bobPage.goto(origin+'/auth/login?returnUrl=%2Fcourses%2Fc-202');await bobPage.waitForSelector('body[data-hive-ready=true]');
 await bobPage.waitForSelector('[data-testid=cannot-enroll]');
 assert.equal(await bobPage.evaluate(async()=>{const c=await(await fetch('/auth/csrf')).json();return (await fetch('/api/routes/students/courses/c-202/enrollments',{method:'POST',headers:{[c.headerName]:c.token}})).status;}),403);

 // Logout: protected slots require sign-in again; public pages continue.
 await page.click('[data-testid=sign-out]');
 await waitFor(s=>s.every(x=>x.status==='LOGIN_REQUIRED'),'logged out');
 assert.equal(await page.evaluate(async()=>(await fetch('/api/me/context')).status),401);

 // SEO-compatible consumer (§40): server-rendered public site on public Hive APIs, without any session.
 const site=await startPublicWeb({port:30195,hive:origin,portal:origin});t.after(()=>site.close());
 const response=await fetch(site.origin+'/news');const html=await response.text();
 assert.equal(response.status,200);assert.equal(response.headers.get('set-cookie'),null);
 assert.match(html,/<html lang="en" dir="ltr">/);assert.match(html,/<title>Campus news · Campus Example<\/title>/);
 assert.match(html,/Semester opens/);assert.match(html,/class="[^"]*text-indigo-950/);
 assert.match(html,new RegExp(`href="${origin}/auth/login\\?returnUrl=%2Fstudents"`));
 const sitePage=await (await browser.newContext()).newPage();await sitePage.goto(site.origin+'/news');
 assert.notEqual(await sitePage.evaluate(()=>getComputedStyle(document.querySelector('h1')).fontWeight),'400','Tailwind applied to the SSR page');
 assert.deepEqual(pageErrors,[]);
});
