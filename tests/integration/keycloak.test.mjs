// Interoperability with a real Keycloak server (reference IdP); Keycloak is never part of Hive Core.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {startStack,ready} from '../support/stack.mjs';

const base=29300,keycloakPort=29310,issuer=`http://127.0.0.1:${keycloakPort}/realms/hive-test`;
test('Keycloak authorization code + PKCE through a real browser yields a token-free Hive session',{timeout:400000},async t=>{
 const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000});
 const container=`hive-keycloak-${Date.now()}`;
 t.after(()=>{try{docker('rm','-f',container);}catch{}});
 docker('run','-d','--name',container,'-p',`127.0.0.1:${keycloakPort}:8080`,'-e','KC_BOOTSTRAP_ADMIN_USERNAME=bootstrap','-e','KC_BOOTSTRAP_ADMIN_PASSWORD=test-only-bootstrap',
  '--mount',`type=bind,source=${resolve('tests/fixtures/keycloak')},target=/opt/keycloak/data/import,readonly`,
  'quay.io/keycloak/keycloak:26.3.3','start-dev','--import-realm','--hostname-strict=false');
 await ready(`${issuer}/.well-known/openid-configuration`,{attempts:300});
 const stack=await startStack(t,{suite:'keycloak',base,
  authorizationEnv:{HIVE_PRIMARY_ISSUER:issuer},
  bffEnv:{HIVE_IDENTITY_ENABLED:'true',HIVE_OIDC_ISSUER:issuer,HIVE_OIDC_CLIENT_ID:'hive-bff',HIVE_OIDC_CLIENT_SECRET:'test-only-keycloak-client-secret-0001',HIVE_OIDC_ALLOW_LOCAL_HTTP:'true'}});
 const origin=stack.urls.bff;
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 try{
  const context=await browser.newContext();const page=await context.newPage();const seen=[];
  page.on('response',r=>seen.push(r.url()));
  await page.goto(origin+'/auth/login?returnUrl=/workspace');
  assert.equal(new URL(page.url()).origin,`http://127.0.0.1:${keycloakPort}`,'browser is sent to Keycloak');
  await page.fill('#username','fixture.operator');await page.fill('#password','test-only-password');
  const landing=page.waitForRequest(r=>new URL(r.url()).pathname==='/workspace');
  await Promise.all([page.click('#kc-login').catch(()=>{}),landing]);
  const probe=await context.newPage();await probe.goto(origin+'/actuator/health/liveness');
  const session=await probe.evaluate(async()=>{const r=await fetch('/api/me/session');return {status:r.status,body:await r.text()};});
  assert.equal(session.status,200,session.body);
  const identity=JSON.parse(session.body).identity;
  assert.equal(identity.issuer,issuer);assert.match(identity.id,/^[0-9a-f-]{36}$/);assert.equal(identity.displayName,'Fixture Operator');
  assert.ok(!/eyJ[A-Za-z0-9_-]{10,}\./.test(session.body),'no JWT reaches browser JavaScript');
  // Cookies are not port-scoped; Keycloak's own cookies live under /realms/. Hive issues exactly one root cookie.
  const hiveCookies=(await context.cookies()).filter(c=>c.path==='/');assert.deepEqual(hiveCookies.map(c=>c.name),['HIVE_SESSION']);assert.ok(hiveCookies[0].httpOnly&&hiveCookies[0].secure);
  assert.equal(await probe.evaluate(()=>document.cookie),'','no session material is readable by JavaScript');
  assert.ok(!seen.some(u=>u.includes('/protocol/openid-connect/token')),'token exchange happens server-side only');
  assert.equal(stack.sql(`select count(*) from external_identity where issuer='${issuer}'`),'1','canonical identity synchronized');
  assert.equal(await probe.evaluate(async()=>{const c=await(await fetch('/auth/csrf')).json();return (await fetch('/auth/logout',{method:'POST',headers:{[c.headerName]:c.token}})).status;}),204);
  assert.equal(await probe.evaluate(async()=>(await fetch('/api/me/session')).status),401);
  assert.equal(stack.redis('KEYS','hive:vault:*'),'');
 }finally{await browser.close();}
});
