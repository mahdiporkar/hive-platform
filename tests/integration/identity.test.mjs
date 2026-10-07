import {test} from 'node:test';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {generateKeyPairSync,sign,randomBytes,createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {mkdirSync,openSync,closeSync} from 'node:fs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const issuer='http://127.0.0.1:28180',origin='http://127.0.0.1:28181';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'fixture',use:'sig',alg:'RS256'};
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const codes=new Map();let tokenFault=null;
const tokens={access:'fixture-private-access-'+randomBytes(16).toString('hex'),refresh:'fixture-private-refresh-'+randomBytes(16).toString('hex')};
const counters={exchanges:0,pkce:0,refreshes:0};
const identity=createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,issuer);res.setHeader('Content-Type','application/json');
  if(url.pathname==='/.well-known/openid-configuration')return res.end(JSON.stringify({issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],token_endpoint_auth_methods_supported:['client_secret_basic'],scopes_supported:['openid','profile'],code_challenge_methods_supported:['S256']}));
  if(url.pathname.endsWith('/jwks'))return res.end(JSON.stringify({keys:[jwk]}));
  if(url.pathname.endsWith('/authorize')) {
   assert.equal(url.searchParams.get('client_id'),'hive-test');const secondary=url.pathname.startsWith('/secondary/');const callback=origin+'/login/oauth2/code/'+(secondary?'secondary':'primary');assert.equal(url.searchParams.get('redirect_uri'),callback);assert.equal(url.searchParams.get('code_challenge_method'),'S256');
   const code=randomBytes(24).toString('hex');codes.set(code,{nonce:url.searchParams.get('nonce'),challenge:url.searchParams.get('code_challenge'),issuer:secondary?issuer+'/secondary':issuer});
   res.writeHead(302,{Location:callback+'?'+new URLSearchParams({code,state:url.searchParams.get('state')})});return res.end();
  }
  if(url.pathname.endsWith('/token')) {
   let body='';for await(const chunk of req)body+=chunk;
   const form=new URLSearchParams(body);
   if(form.get('grant_type')==='refresh_token') {
    assert.equal(req.headers.authorization,'Basic '+Buffer.from('hive-test:fixture-secret').toString('base64'));
    assert.equal(form.get('refresh_token'),tokens.refresh);counters.refreshes++;
    return res.end(JSON.stringify({access_token:tokens.access,refresh_token:tokens.refresh,token_type:'Bearer',expires_in:300}));
   }
   const record=codes.get(form.get('code'));codes.delete(form.get('code'));
   assert.equal(req.headers.authorization,'Basic '+Buffer.from('hive-test:fixture-secret').toString('base64'));assert.ok(record);
   assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'),record.challenge);counters.pkce++;counters.exchanges++;
   const now=Math.floor(Date.now()/1000),unsigned=encode({alg:'RS256',kid:'fixture'})+'.'+encode({iss:tokenFault==='issuer'?issuer+'/invalid':record.issuer,sub:'fixture-user',aud:tokenFault==='audience'?'wrong-client':'hive-test',iat:tokenFault==='expired'?now-600:now,exp:tokenFault==='expired'?now-300:now+300,nonce:tokenFault==='nonce'?'wrong-nonce':record.nonce,name:'Fixture User'});
   const id=unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),tokenFault==='signature'?generateKeyPairSync('rsa',{modulusLength:2048}).privateKey:privateKey).toString('base64url');
   return res.end(JSON.stringify({access_token:tokens.access,refresh_token:tokens.refresh,token_type:'Bearer',expires_in:2,id_token:id}));
  }
  res.writeHead(404);res.end('{}');
 }catch(error){res.writeHead(400);res.end(JSON.stringify({error:'fixture_request_rejected'}));}
});
async function ready(url){for(let n=0;n<100;n++){try{if((await fetch(url,{signal:AbortSignal.timeout(1000)})).ok)return;}catch{}await pause(300);}throw new Error('Identity readiness timed out; inspect .local/identity.log');}
test('OIDC code+PKCE login stores only encrypted tokens and token-free session; CSRF logout cleans vault',{timeout:120000},async t=>{
 const container='hive-identity-'+Date.now(),password=randomBytes(24).toString('hex');let processHandle,fd,authorizationProcess,authorizationLog;const project='hive-identity-core-'+Date.now();const machine=randomBytes(24).toString('hex'),provision=randomBytes(24).toString('hex');const coreEnv={...process.env,HIVE_REDIS_PASSWORD:randomBytes(24).toString('hex'),HIVE_DB_PASSWORD:randomBytes(24).toString('hex'),HIVE_GRAPH_PASSWORD:randomBytes(24).toString('hex'),HIVE_DB_PORT:'28432',HIVE_FGA_PORT:'28480'};
 const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000});
 const compose=(...args)=>execFileSync('docker',['compose','-p',project,'-f','infra/docker-compose/compose.yml',...args],{env:coreEnv,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000});
 const redis=(...args)=>docker('exec','-e',`REDISCLI_AUTH=${password}`,container,'redis-cli','--raw',...args).trim();
 t.after(async()=>{if(processHandle){processHandle.kill();await new Promise(r=>{processHandle.once('exit',r);setTimeout(r,3000).unref();});}if(fd!==undefined)closeSync(fd);if(authorizationProcess){authorizationProcess.kill();await new Promise(r=>{authorizationProcess.once('exit',r);setTimeout(r,3000).unref();});}if(authorizationLog!==undefined)closeSync(authorizationLog);compose('down','--volumes','--remove-orphans');await new Promise(r=>identity.close(r));docker('rm','-f',container);});
 docker('run','--rm','-d','--name',container,'-p','127.0.0.1:26379:6379','redis:8.2.1-alpine','redis-server','--requirepass',password);
 await new Promise(r=>identity.listen(28180,'127.0.0.1',r));
 mkdirSync('.local',{recursive:true});fd=openSync('.local/identity.log','w');
  compose('up','-d','--wait','postgres','graph-db');compose('up','-d','openfga');await ready('http://127.0.0.1:28480/healthz');
 authorizationLog=openSync('.local/identity-authorization.log','w');
 authorizationProcess=spawn('java',['-jar','services/authorization/target/authorization-0.1.0-SNAPSHOT.jar'],{windowsHide:true,stdio:['ignore',authorizationLog,authorizationLog],env:{...coreEnv,HIVE_AUTHORIZATION_PORT:'28482',HIVE_DB_URL:'jdbc:postgresql://127.0.0.1:28432/hive',HIVE_DB_USER:'hive',HIVE_OPENFGA_URL:'http://127.0.0.1:28480',HIVE_INTERNAL_PASSWORD:machine,HIVE_PROVISIONING_PASSWORD:provision,HIVE_PRIMARY_ISSUER:issuer,HIVE_IDP_ALLOWED_ORIGINS:issuer,HIVE_IDP_ALLOW_LOCAL_HTTP:'true'}});
 await ready('http://127.0.0.1:28482/actuator/health/readiness');
 const api=async(path,method='GET',body,role='provisioner')=>fetch('http://127.0.0.1:28482'+path,{method,headers:{'Content-Type':'application/json',...(role?{Authorization:'Basic '+Buffer.from(role+':'+(role==='bff'?machine:provision)).toString('base64')}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const providerDefinition={code:'secondary',name:'Secondary',issuer:issuer+'/secondary',tenantId:'default',domains:['fixture.test'],clientId:'hive-test',secretReference:'env:HIVE_IDP_FIXTURE',authorizationEndpoint:issuer+'/secondary/authorize',tokenEndpoint:issuer+'/secondary/token',jwksUri:issuer+'/secondary/jwks',enabled:true,revision:0};
 assert.equal((await api('/provisioning/identity/providers','GET',undefined,null)).status,401);
 assert.equal((await api('/provisioning/identity/providers','POST',providerDefinition,'bff')).status,403);
 assert.equal((await api('/internal/identity/login','POST',{},'provisioner')).status,403);
 assert.equal((await api('/provisioning/identity/providers','POST',{...providerDefinition,jwksUri:'https://unapproved.test/jwks'})).status,400);
 let created=await api('/provisioning/identity/providers','POST',providerDefinition);assert.equal(created.status,200,await created.clone().text());
 assert.equal((await api('/provisioning/identity/providers','POST',providerDefinition)).status,409);
 processHandle=spawn('java',['-jar','services/bff/target/bff-0.1.0-SNAPSHOT.jar'],{windowsHide:true,stdio:['ignore',fd,fd],env:{...process.env,HIVE_AUTHORIZATION_URL:'http://127.0.0.1:28482',HIVE_INTERNAL_PASSWORD:machine,HIVE_IDP_ALLOWED_ORIGINS:issuer,HIVE_IDP_FIXTURE:'fixture-secret',HIVE_IDENTITY_ENABLED:'true',HIVE_BFF_PORT:'28181',HIVE_OIDC_ISSUER:issuer,HIVE_OIDC_CLIENT_ID:'hive-test',HIVE_OIDC_CLIENT_SECRET:'fixture-secret',HIVE_OIDC_ALLOW_LOCAL_HTTP:'true',HIVE_REDIS_HOST:'127.0.0.1',HIVE_REDIS_PORT:'26379',HIVE_REDIS_PASSWORD:password,HIVE_VAULT_KEY:randomBytes(32).toString('base64')}});
 await ready(origin+'/actuator/health/readiness');
 let cookie='';const observed=[];
 const request=async(path,options={})=>{
  const response=await fetch(new URL(path,origin),{...options,redirect:'manual',headers:{...(cookie?{Cookie:cookie}:{}),...options.headers}});
  for(const value of response.headers.getSetCookie()){observed.push(value);if(value.startsWith('HIVE_SESSION='))cookie=value.split(';')[0];}
  return response;
 };
 assert.equal((await request('/api/me/session')).status,401);
 assert.equal((await request('/auth/login?returnUrl='+encodeURIComponent('//evil.test'))).status,400);
 let response=await request('/auth/login?returnUrl='+encodeURIComponent('/news/123'));
 assert.equal(response.status,302);response=await request(response.headers.get('location'));assert.equal(response.status,302);
 const before=cookie;
 const provider=await fetch(response.headers.get('location'),{redirect:'manual'});assert.equal(provider.status,302);
 response=await request(provider.headers.get('location'));assert.equal(response.status,302);assert.equal(new URL(response.headers.get('location'),origin).href,origin+'/news/123');assert.notEqual(cookie,before,'session fixation prevented');
 assert.equal(counters.pkce,1);assert.equal(counters.exchanges,1);
 assert.ok(observed.some(value=>/Secure/i.test(value)&&/HttpOnly/i.test(value)&&/SameSite=Lax/i.test(value)));
  // Concurrent requests on an expiring token must produce exactly one server-side refresh (Redis ownership lease).
 const concurrent=await Promise.all(Array.from({length:8},()=>request('/api/me/session')));for(const r of concurrent)assert.equal(r.status,200);
 response=concurrent[0];const body=await response.text();assert.equal(JSON.parse(body).identity.subject,'fixture-user');assert.equal(counters.refreshes,1,'expiring token refreshed server-side');
 for(const secret of Object.values(tokens)){assert.ok(!body.includes(secret));assert.ok(!observed.join().includes(secret));}
 const vaultKeys=redis('KEYS','hive:vault:*').split('\n').filter(Boolean);assert.equal(vaultKeys.length,1);
 const envelope=redis('GET',vaultKeys[0]);assert.match(envelope,/^current\./);for(const secret of Object.values(tokens))assert.ok(!envelope.includes(secret));
 for(const key of redis('KEYS','hive:session:sessions:*').split('\n').filter(Boolean)){
  const data=redis('HGETALL',key);for(const secret of Object.values(tokens))assert.ok(!data.includes(secret));assert.ok(!data.includes('DefaultOidcUser'));assert.ok(!data.includes('OidcUserAuthority'));
 }
 assert.equal((await request('/auth/logout',{method:'POST'})).status,403);
 const csrf=await(await request('/auth/csrf')).json();
 assert.equal((await request('/auth/logout',{method:'POST',headers:{[csrf.headerName]:csrf.token}})).status,204);
  assert.equal(redis('KEYS','hive:vault:*'),'');assert.equal((await request('/api/me/session')).status,401);
 const canonical=JSON.parse(body).identity.id;assert.match(canonical,/^[0-9a-f-]{36}$/);
 assert.equal((await api('/provisioning/identity/aliases','POST',{userId:canonical,providerCode:'secondary',issuer:issuer+'/secondary',subject:'fixture-user'})).status,200);
 response=await request('/auth/login?domain=fixture.test&tenant=default');assert.equal(response.status,302);assert.equal(response.headers.get('location'),'/oauth2/authorization/secondary');
 response=await request(response.headers.get('location'));const secondaryResponse=await fetch(response.headers.get('location'),{redirect:'manual'});assert.equal(secondaryResponse.status,302);
 response=await request(secondaryResponse.headers.get('location'));assert.equal(response.status,302);
 const secondarySession=await request('/api/me/session');assert.equal(secondarySession.status,200);assert.equal((await secondarySession.json()).identity.id,canonical,'explicit alias preserves canonical user across issuers');
 const logins=await Promise.all(Array.from({length:6},()=>api('/internal/identity/login','POST',{providerCode:'secondary',issuer:issuer+'/secondary',subject:'parallel-user',displayName:'Concurrent'},'bff').then(async r=>{assert.equal(r.status,200,await r.clone().text());return r.json();})));
 assert.equal(new Set(logins.map(v=>v.id)).size,1,'concurrent first-login is idempotent');
 assert.equal((await api('/internal/identity/login','POST',{providerCode:'secondary',issuer:issuer+'/wrong',subject:'fixture-user',displayName:'Wrong'},'bff')).status,403);
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 try {
  const context=await browser.newContext();const page=await context.newPage();const browserRequests=[];page.on('request',r=>browserRequests.push(r.url()));
  // The BFF serves no pages, so the browser lands on the returnUrl that a consumer would own; the BFF denies it.
  const landing=page.waitForRequest(r=>new URL(r.url()).pathname==='/news/123');
  await page.goto(origin+'/auth/login?returnUrl=/news/123').catch(()=>{});
  assert.equal(new URL((await landing).url()).origin,origin);
  // Probe from a fresh same-origin document in the same browser context (shares the HttpOnly cookie jar).
  const probe=await context.newPage();await probe.goto(origin+'/actuator/health/liveness');
  const browserSession=await probe.evaluate(async()=>{const r=await fetch('/api/me/session');return {status:r.status,body:await r.json(),cookie:document.cookie};});
  assert.equal(browserSession.status,200);assert.equal(browserSession.body.identity.id,canonical);assert.ok(!browserSession.cookie.includes('HIVE_SESSION'));
  const sessionCookie=(await context.cookies()).find(c=>c.name==='HIVE_SESSION');assert.ok(sessionCookie?.httpOnly&&sessionCookie?.secure);assert.equal(sessionCookie.sameSite,'Lax');
  assert.ok(!browserRequests.some(url=>new URL(url).pathname.endsWith('/token')),'browser never calls token endpoint');
  for(const secret of Object.values(tokens))assert.ok(!JSON.stringify(browserSession).includes(secret));
  assert.equal(await probe.evaluate(async()=>{const csrf=await(await fetch('/auth/csrf')).json();return (await fetch('/auth/logout',{method:'POST',headers:{[csrf.headerName]:csrf.token}})).status;}),204);
  await context.close();
  for(const fault of ['issuer','audience','expired','nonce','signature']) {
   tokenFault=fault;const context=await browser.newContext();const page=await context.newPage();
   const callback=page.waitForResponse(r=>new URL(r.url()).pathname==='/login/oauth2/code/primary');await page.goto(origin+'/auth/login').catch(()=>{});assert.equal((await callback).status(),401,`${fault} rejected`);
   const probe=await context.newPage();await probe.goto(origin+'/actuator/health/liveness');
   assert.equal(await probe.evaluate(async()=>(await fetch('/api/me/session')).status),401,`${fault} created no session`);
   await context.close();
  }
 }finally{tokenFault=null;await browser.close();}
 const cross={...providerDefinition,code:'other',issuer:issuer+'/other',tenantId:'other',domains:[]};assert.equal((await api('/provisioning/identity/providers','POST',cross)).status,200);
 assert.equal((await api('/provisioning/identity/aliases','POST',{userId:canonical,providerCode:'other',issuer:issuer+'/other',subject:'foreign-user'})).status,403);
 const disabled=await api('/provisioning/identity/providers/secondary','PUT',{...providerDefinition,enabled:false});assert.equal(disabled.status,200);
 assert.equal((await api('/provisioning/identity/providers/secondary','PUT',providerDefinition)).status,409,'stale revision rejected');
 assert.equal((await request('/auth/login?provider=secondary')).status,404,'disabled provider cannot be selected');
 const auditCount=compose('exec','-T','postgres','psql','-U','hive','-d','hive','-At','-c','select count(*) from audit_event').trim();assert.ok(Number(auditCount)>=5);
});