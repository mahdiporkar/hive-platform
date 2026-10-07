import {test} from 'node:test';
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
const codes=new Map();
const tokens={access:'fixture-private-access-'+randomBytes(16).toString('hex'),refresh:'fixture-private-refresh-'+randomBytes(16).toString('hex')};
const counters={exchanges:0,pkce:0,refreshes:0};
const identity=createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,issuer);res.setHeader('Content-Type','application/json');
  if(url.pathname==='/.well-known/openid-configuration')return res.end(JSON.stringify({issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],token_endpoint_auth_methods_supported:['client_secret_basic'],scopes_supported:['openid','profile'],code_challenge_methods_supported:['S256']}));
  if(url.pathname==='/jwks')return res.end(JSON.stringify({keys:[jwk]}));
  if(url.pathname==='/authorize') {
   assert.equal(url.searchParams.get('client_id'),'hive-test');assert.equal(url.searchParams.get('redirect_uri'),origin+'/login/oauth2/code/primary');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
   const code=randomBytes(24).toString('hex');codes.set(code,{nonce:url.searchParams.get('nonce'),challenge:url.searchParams.get('code_challenge')});
   res.writeHead(302,{Location:origin+'/login/oauth2/code/primary?'+new URLSearchParams({code,state:url.searchParams.get('state')})});return res.end();
  }
  if(url.pathname==='/token') {
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
   const now=Math.floor(Date.now()/1000),unsigned=encode({alg:'RS256',kid:'fixture'})+'.'+encode({iss:issuer,sub:'fixture-user',aud:'hive-test',iat:now,exp:now+300,nonce:record.nonce,name:'Fixture User'});
   const id=unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),privateKey).toString('base64url');
   return res.end(JSON.stringify({access_token:tokens.access,refresh_token:tokens.refresh,token_type:'Bearer',expires_in:2,id_token:id}));
  }
  res.writeHead(404);res.end('{}');
 }catch(error){res.writeHead(400);res.end(JSON.stringify({error:'fixture_request_rejected'}));}
});
async function ready(url){for(let n=0;n<100;n++){try{if((await fetch(url,{signal:AbortSignal.timeout(1000)})).ok)return;}catch{}await pause(300);}throw new Error('Identity readiness timed out; inspect .local/identity.log');}
test('OIDC code+PKCE login stores only encrypted tokens and token-free session; CSRF logout cleans vault',{timeout:120000},async t=>{
 const container='hive-identity-'+Date.now(),password=randomBytes(24).toString('hex');let processHandle,fd;
 const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000});
 const redis=(...args)=>docker('exec','-e',`REDISCLI_AUTH=${password}`,container,'redis-cli','--raw',...args).trim();
 t.after(async()=>{if(processHandle){processHandle.kill();await new Promise(r=>{processHandle.once('exit',r);setTimeout(r,3000).unref();});}if(fd!==undefined)closeSync(fd);await new Promise(r=>identity.close(r));docker('rm','-f',container);});
 docker('run','--rm','-d','--name',container,'-p','127.0.0.1:26379:6379','redis:8.2.1-alpine','redis-server','--requirepass',password);
 await new Promise(r=>identity.listen(28180,'127.0.0.1',r));
 mkdirSync('.local',{recursive:true});fd=openSync('.local/identity.log','w');
 processHandle=spawn('java',['-jar','services/bff/target/bff-0.1.0-SNAPSHOT.jar'],{windowsHide:true,stdio:['ignore',fd,fd],env:{...process.env,HIVE_IDENTITY_ENABLED:'true',HIVE_BFF_PORT:'28181',HIVE_OIDC_ISSUER:issuer,HIVE_OIDC_CLIENT_ID:'hive-test',HIVE_OIDC_CLIENT_SECRET:'fixture-secret',HIVE_OIDC_ALLOW_LOCAL_HTTP:'true',HIVE_REDIS_HOST:'127.0.0.1',HIVE_REDIS_PORT:'26379',HIVE_REDIS_PASSWORD:password,HIVE_VAULT_KEY:randomBytes(32).toString('base64')}});
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
 response=await request('/api/me/session');assert.equal(response.status,200);const body=await response.text();assert.equal(JSON.parse(body).identity.subject,'fixture-user');assert.equal(counters.refreshes,1,'expiring token refreshed server-side');
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
});