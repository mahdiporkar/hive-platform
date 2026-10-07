// Phase 13: production profile fails closed, clean production starts, forwarded headers from a trusted proxy.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {startStack,ready,cookieClient} from '../support/stack.mjs';
import {startOidcProvider} from '../support/oidc-fixture.mjs';

const exited=child=>new Promise(resolve=>{if(child.exitCode!==null)return resolve(child.exitCode);child.once('exit',code=>resolve(code));});

test('production profile refuses unsafe configuration and accepts a clean one',{timeout:400000},async t=>{
 const stack=await startStack(t,{suite:'hardening',base:30500,authorization:false,bff:false});
 const production={...stack.authorizationEnv,HIVE_PROFILE:'production'};

 const unsafe=stack.java('authorization',{...production,HIVE_ARTIFACT_NETWORK_POLICY:'DEVELOPMENT',HIVE_IDP_ALLOW_LOCAL_HTTP:'true',HIVE_ARTIFACT_REQUIRE_INTEGRITY:'false'});
 assert.notEqual(await exited(unsafe),0,'authorization refused to start');
 let log=readFileSync(`${stack.logDir}/authorization.log`,'utf8');
 assert.match(log,/refuses to start in the production profile: HIVE_IDP_ALLOW_LOCAL_HTTP must be false; HIVE_ARTIFACT_NETWORK_POLICY must not be DEVELOPMENT; HIVE_ARTIFACT_REQUIRE_INTEGRITY must be true/);
 assert.ok(!log.includes(stack.credentials.db)&&!log.includes(stack.credentials.internal),'no secret values in the refusal');

 const clean=stack.java('authorization',production);
 await ready(stack.urls.authorization+'/actuator/health/readiness',{log:`${stack.logDir}/authorization.log`});
 log=readFileSync(`${stack.logDir}/authorization.log`,'utf8');
 assert.match(log,/Hive authorization service ready: profile=production .*provisioningCredential=enabled firstAdministrator=not configured/);

 const bffProduction={...stack.bffEnv,HIVE_PROFILE:'production'};
 const idp=await startOidcProvider({port:30580});t.after(()=>idp.close());
 const unsafeBff=stack.java('bff',{...bffProduction,HIVE_IDENTITY_ENABLED:'true',HIVE_OIDC_ISSUER:idp.issuer,HIVE_OIDC_CLIENT_ID:idp.clientId,HIVE_OIDC_CLIENT_SECRET:idp.clientSecret,HIVE_OIDC_ALLOW_LOCAL_HTTP:'true',HIVE_VAULT_KEY:''});
 assert.notEqual(await exited(unsafeBff),0,'BFF refused to start');
 assert.match(readFileSync(`${stack.logDir}/bff.log`,'utf8'),/refuses to start in the production profile: HIVE_OIDC_ALLOW_LOCAL_HTTP must be false; HIVE_VAULT_KEY is required/);
 const cleanBff=stack.java('bff',bffProduction);
 await ready(stack.urls.bff+'/actuator/health/readiness',{log:`${stack.logDir}/bff.log`});
 assert.match(readFileSync(`${stack.logDir}/bff.log`,'utf8'),/Hive BFF ready: profile=production identity=disabled/);
 await stack.stop(cleanBff);await stack.stop(clean);
});

test('forwarded headers from a trusted proxy produce public HTTPS redirect URIs and secure cookies',{timeout:300000},async t=>{
 const idp=await startOidcProvider({port:30680});t.after(()=>idp.close());
 const stack=await startStack(t,{suite:'hardening-proxy',base:30600,authorizationEnv:{HIVE_PRIMARY_ISSUER:idp.issuer},
  bffEnv:{HIVE_IDENTITY_ENABLED:'true',HIVE_OIDC_ISSUER:idp.issuer,HIVE_OIDC_CLIENT_ID:idp.clientId,HIVE_OIDC_CLIENT_SECRET:idp.clientSecret,HIVE_OIDC_ALLOW_LOCAL_HTTP:'true'}});
 const viaProxy=cookieClient(stack.urls.bff);
 const headers={'X-Forwarded-Proto':'https','X-Forwarded-Host':'portal.example.test'};
 let response=await viaProxy('/auth/login?returnUrl=/x',{headers});assert.equal(response.status,302);
 response=await viaProxy(response.headers.get('location'),{headers});
 const authorize=new URL(response.headers.get('location'));
 assert.equal(authorize.searchParams.get('redirect_uri'),'https://portal.example.test/login/oauth2/code/primary');
 assert.ok(response.headers.getSetCookie().every(c=>!c.startsWith('HIVE_SESSION')||/;\s*Secure/i.test(c)));
});
