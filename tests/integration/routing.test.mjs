// Phase 6: dynamic routing — trusted targets, route operations, per-operation access, FORWARD_TOKEN, LEGACY,
// limits, SSRF guards, header allowlists, API logs and audit.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startStack,cookieClient,pause} from '../support/stack.mjs';
import {startOidcProvider,login} from '../support/oidc-fixture.mjs';
import {startUpstream} from '../support/upstream-fixture.mjs';
import {request as httpRequest} from 'node:http';

const rawStatus=(origin,path)=>new Promise((resolve,reject)=>{const u=new URL(origin);const r=httpRequest({host:u.hostname,port:u.port,path,method:'GET'},res=>{res.resume();resolve(res.statusCode);});r.on('error',reject);r.end();});

test('dynamic routing with forward token and legacy authentication',{timeout:400000},async t=>{
 const idp=await startOidcProvider({port:29680});t.after(()=>idp.close());
 const upstream=await startUpstream({port:29690});t.after(()=>upstream.close());
 const rogue=await startUpstream({port:29691});t.after(()=>rogue.close());
 const legacySecret=JSON.stringify({username:'svc-account',password:'svc-password'});
 const stack=await startStack(t,{suite:'routing',base:29600,
  authorizationEnv:{HIVE_PRIMARY_ISSUER:idp.issuer,HIVE_TARGET_ALLOW_HTTP:'true'},
  bffEnv:{HIVE_IDENTITY_ENABLED:'true',HIVE_OIDC_ISSUER:idp.issuer,HIVE_OIDC_CLIENT_ID:idp.clientId,HIVE_OIDC_CLIENT_SECRET:idp.clientSecret,HIVE_OIDC_ALLOW_LOCAL_HTTP:'true',
   HIVE_PROXY_ALLOWED_ORIGINS:upstream.origin,HIVE_PROXY_ALLOW_HTTP:'true',HIVE_SECRET_LEGACY_FIXTURE:legacySecret}});
 const admin=async(path,{method='GET',body}={})=>{const r=await stack.service(path,{method,body});const text=await r.text();return {status:r.status,body:text?JSON.parse(text):null};};
 const ok=async(path,options)=>{const r=await admin(path,options);assert.ok(r.status<300,`${options?.method??'GET'} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);return r.body;};
 const code=async(path,options,status,expected)=>{const r=await admin(path,options);assert.equal(r.status,status,`${path} ${JSON.stringify(r.body)}`);if(expected)assert.equal(r.body.code,expected);};

 // Control plane: application, API resources, user, grants, targets, routes, operations.
 await ok('/admin/applications',{method:'POST',body:{key:'fixture-app',displayName:'Fixture'}});
 for(const resource of [{key:'records.api',type:'API_RESOURCE',parentKey:'fixture-app',displayName:'Records API',actions:[{key:'read'},{key:'write'}]},
  {key:'legacy.api',type:'API_RESOURCE',parentKey:'fixture-app',displayName:'Legacy API',actions:[{key:'read'}]}])
  await ok('/admin/applications/fixture-app/resources',{method:'POST',body:resource});
 const alice=(await ok('/admin/users',{method:'POST',body:{displayName:'Alice',identities:[{issuer:idp.issuer,subject:'alice'}]}})).id;
 await ok('/admin/grants',{method:'POST',body:{subject:`user:${alice}`,applicationKey:'fixture-app',resourceKey:'records.api',action:'read'}});
 await code('/admin/service-targets',{method:'POST',body:{key:'metadata',displayName:'x',baseUrl:'http://169.254.169.254'}},422,'TARGET_LOCATION_REJECTED');
 await code('/admin/service-targets',{method:'POST',body:{key:'creds',displayName:'x',baseUrl:'http://user:pass@127.0.0.1:1'}},422,'TARGET_LOCATION_REJECTED');
 await ok('/admin/service-targets',{method:'POST',body:{key:'records-svc',displayName:'Records service',baseUrl:upstream.origin+'/v1',responseTimeoutMs:1000,maxRequestBytes:1024,maxResponseBytes:65536}});
 await ok('/admin/service-targets',{method:'POST',body:{key:'legacy-svc',displayName:'Legacy service',baseUrl:upstream.origin}});
 await ok('/admin/service-targets',{method:'POST',body:{key:'rogue-svc',displayName:'Unapproved',baseUrl:rogue.origin}});
 await code('/admin/legacy-auth-profiles',{method:'POST',body:{key:'inline',targetKey:'legacy-svc',tokenEndpointPath:'/legacy/oauth/token',requestFormat:'JSON',credentialReference:'svc-password',tokenPointer:'/data/accessToken',expiresInPointer:'/data/expiresIn'}},400);
 await ok('/admin/legacy-auth-profiles',{method:'POST',body:{key:'legacy-fixture',targetKey:'legacy-svc',tokenEndpointPath:'/legacy/oauth/token',requestFormat:'JSON',
  credentialReference:'env:HIVE_SECRET_LEGACY_FIXTURE',tokenPointer:'/data/accessToken',expiresInPointer:'/data/expiresIn',tokenTypePointer:'/data/type',expirySkewSeconds:30}});
 await code('/admin/proxy-routes',{method:'POST',body:{key:'apikey',applicationKey:'fixture-app',pathPrefix:'/apikey',targetKey:'records-svc',authentication:'API_KEY'}},422,'AUTHENTICATION_MODE_UNSUPPORTED');
 await code('/admin/proxy-routes',{method:'POST',body:{key:'cross',applicationKey:'fixture-app',pathPrefix:'/cross',targetKey:'records-svc',authentication:'LEGACY',legacyProfileKey:'legacy-fixture'}},400);
 await ok('/admin/proxy-routes',{method:'POST',body:{key:'records',applicationKey:'fixture-app',pathPrefix:'/records',targetKey:'records-svc',authentication:'FORWARD_TOKEN'}});
 await ok('/admin/proxy-routes',{method:'POST',body:{key:'records-special',applicationKey:'fixture-app',pathPrefix:'/records/special',targetKey:'records-svc',authentication:'NONE',upstreamBasePath:'/special-api'}});
 await ok('/admin/proxy-routes',{method:'POST',body:{key:'legacy',applicationKey:'fixture-app',pathPrefix:'/legacy',targetKey:'legacy-svc',authentication:'LEGACY',legacyProfileKey:'legacy-fixture',upstreamBasePath:'/legacy/api'}});
 await ok('/admin/proxy-routes',{method:'POST',body:{key:'rogue',applicationKey:'fixture-app',pathPrefix:'/rogue',targetKey:'rogue-svc',authentication:'NONE'}});
 await code('/admin/proxy-routes',{method:'POST',body:{key:'dup-prefix',applicationKey:'fixture-app',pathPrefix:'/records',targetKey:'records-svc'}},409);
 const op=(route,body)=>ok(`/admin/proxy-routes/${route}/operations`,{method:'POST',body});
 await op('records',{key:'list',method:'GET',pathPattern:'/items',access:'AUTHENTICATED',resourceKey:'records.api',action:'read'});
 await op('records',{key:'item',method:'GET',pathPattern:'/items/{id}',access:'AUTHENTICATED',resourceKey:'records.api',action:'read'});
 await op('records',{key:'create',method:'POST',pathPattern:'/items',access:'AUTHENTICATED',resourceKey:'records.api',action:'write'});
 await op('records',{key:'public',method:'GET',pathPattern:'/public/**',access:'PUBLIC'});
 await op('records',{key:'public-post',method:'POST',pathPattern:'/public/feedback',access:'PUBLIC'});
 await op('records',{key:'catalog',method:'GET',pathPattern:'/catalog',access:'HYBRID'});
 await op('records',{key:'big',method:'GET',pathPattern:'/big',access:'PUBLIC'});
 await op('records',{key:'slow',method:'GET',pathPattern:'/slow',access:'PUBLIC'});
 await op('records',{key:'redirect',method:'GET',pathPattern:'/redirect',access:'PUBLIC'});
 await op('records-special',{key:'special',method:'GET',pathPattern:'/**',access:'PUBLIC'});
 await op('legacy',{key:'orders',method:'GET',pathPattern:'/orders',access:'AUTHENTICATED',resourceKey:'legacy.api',action:'read'});
 await op('rogue',{key:'any',method:'GET',pathPattern:'/**',access:'PUBLIC'});
 await code('/admin/proxy-routes/records/operations',{method:'POST',body:{key:'bad-public',method:'GET',pathPattern:'/x',access:'PUBLIC',resourceKey:'records.api',action:'read'}},400);
 await code('/admin/proxy-routes/records/operations',{method:'POST',body:{key:'bad-auth',method:'GET',pathPattern:'/y',access:'AUTHENTICATED'}},400);
 await code('/admin/proxy-routes/records/operations',{method:'POST',body:{key:'dup',method:'GET',pathPattern:'/items',access:'PUBLIC'}},409,'AMBIGUOUS_OPERATION');
 await code('/admin/proxy-routes/records/operations',{method:'POST',body:{key:'clash',method:'GET',pathPattern:'/items/*',access:'AUTHENTICATED',resourceKey:'records.api',action:'read'}},409,'AMBIGUOUS_OPERATION');
 await code('/admin/proxy-routes/records/operations',{method:'POST',body:{key:'regex',method:'GET',pathPattern:'/items/(.*)',access:'PUBLIC'}},400);
 assert.deepEqual(await ok('/admin/routing/preview?method=GET&path=/records/items/42'),{route:'records',operation:'item',access:'AUTHENTICATED',authentication:'FORWARD_TOKEN',target:'records-svc',upstreamPath:'/items/42',pathTemplate:'/records/items/{id}'});

 const browser=cookieClient(stack.urls.bff);
 const before=()=>upstream.requests.length;

 // Anonymous: PUBLIC passes without identity or credentials; header allowlists in both directions.
 let response=await browser('/api/routes/records/public/info?lang=en',{headers:{Authorization:'Bearer browser-supplied',Cookie:'other=1','X-Forwarded-Host':'evil.test','X-Hive-User-Id':'forged',Accept:'application/json'}});
 assert.equal(response.status,200);
 let seen=upstream.last();assert.equal(seen.path,'/v1/public/info');assert.equal(seen.query,'?lang=en');
 for(const header of ['authorization','cookie','x-forwarded-host','x-hive-user-id'])assert.equal(seen.headers[header],undefined,`${header} not forwarded`);
 assert.equal(seen.headers.accept,'application/json');assert.ok(seen.headers['x-correlation-id']);assert.equal(seen.headers['x-hive-route'],'records');
 assert.ok(!response.headers.getSetCookie().some(c=>c.includes('upstream_session')),'upstream cookies are not relayed');
 assert.equal(response.headers.get('x-internal-server'),null,'upstream internals are not relayed');
 // Anonymous on AUTHENTICATED: rejected before reaching the upstream.
 let count=before();response=await browser('/api/routes/records/items');assert.equal(response.status,401);assert.equal((await response.json()).code,'AUTHENTICATION_REQUIRED');assert.equal(before(),count);
 // HYBRID anonymous works without credentials.
 response=await browser('/api/routes/records/catalog');assert.equal(response.status,200);assert.equal(upstream.last().headers.authorization,undefined);
 // Default deny for unregistered paths/methods and non-canonical paths.
 count=before();
 for(const [method,path,status] of [['GET','/api/routes/records/unknown',[404]],['DELETE','/api/routes/records/items',[401,403]],['PUT','/api/routes/nowhere',[401,403]],]){
  const r=await browser(path,{method});assert.ok(status.includes(r.status),`${method} ${path} -> ${r.status}`);
 }
 assert.equal((await browser('/api/routes/records/items',{method:'DELETE',headers:await browser.csrf()})).status,404,'unregistered method');
 // Raw paths (fetch would normalize them client-side): encoded traversal, duplicate slashes, encoded slash, backslash.
 for(const raw of ['/api/routes/records/%2e%2e/admin','/api/routes/records/..%2fadmin','/api/routes/records//items','/api/routes/records/%2Fitems','/api/routes/records/a%5c..%5citems'])
  assert.equal(await rawStatus(stack.urls.bff,raw),400,raw);
 assert.equal(before(),count,'nothing reached the upstream');
 // Anonymous PUBLIC mutation still needs CSRF; with it, it passes.
 count=before();assert.ok([401,403].includes((await browser('/api/routes/records/public/feedback',{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}})).status),'CSRF-less mutation rejected');assert.equal(before(),count);
 assert.equal((await browser('/api/routes/records/public/feedback',{method:'POST',body:'{"a":1}',headers:{'Content-Type':'application/json',...await browser.csrf()}})).status,201);
 // Longest prefix wins over the general route; NONE sends no credentials.
 response=await browser('/api/routes/records/special/x');assert.equal(response.status,200);assert.equal(upstream.last().path,'/v1/special-api/x');
 // Limits: response size, timeout, request size; redirects are relayed as-is, never followed.
 assert.equal((await (await browser('/api/routes/records/big')).json()).code,'RESPONSE_TOO_LARGE');
 response=await browser('/api/routes/records/slow');assert.equal(response.status,504);assert.equal((await response.json()).code,'UPSTREAM_TIMEOUT');
 response=await browser('/api/routes/records/public/feedback',{method:'POST',body:'x'.repeat(5000),headers:{'Content-Type':'text/plain',...await browser.csrf()}});assert.equal(response.status,413);
 count=rogue.requests.length;response=await browser('/api/routes/records/redirect');assert.equal(response.status,302);assert.equal(response.headers.get('location'),null,'Location is not relayed');
 // Registered but not deployment-approved origin: refused without contacting it.
 response=await browser('/api/routes/rogue/x');assert.equal(response.status,502);assert.equal((await response.json()).code,'TARGET_NOT_APPROVED');assert.equal(rogue.requests.length,count);

 // FORWARD_TOKEN: the server-held user access token is forwarded; the browser never sees it.
 await login(browser,idp,{subject:'alice',name:'Alice'});
 response=await browser('/api/routes/records/items/42');const text=await response.text();assert.equal(response.status,200,text);
 seen=upstream.last();const aliceToken=idp.tokensOf('alice').at(-1).access;
 assert.equal(seen.headers.authorization,`Bearer ${aliceToken}`);assert.equal(seen.headers['x-hive-user-id'],alice);assert.equal(seen.headers.cookie,undefined);
 for(const secret of idp.secrets())assert.ok(!text.includes(secret)&&!JSON.stringify([...response.headers]).includes(secret),'token never returned to the browser');
 // Server-side authorization: alice may read but not write.
 count=before();response=await browser('/api/routes/records/items',{method:'POST',body:'{}',headers:{'Content-Type':'application/json',...await browser.csrf()}});
 assert.equal(response.status,403);assert.equal((await response.json()).code,'ACCESS_DENIED');assert.equal(before(),count,'denied operation never reaches the upstream');
 await ok('/admin/grants',{method:'POST',body:{subject:`user:${alice}`,applicationKey:'fixture-app',resourceKey:'records.api',action:'write'}});
 response=await browser('/api/routes/records/items',{method:'POST',body:'{"name":"n"}',headers:{'Content-Type':'application/json',...await browser.csrf()}});assert.equal(response.status,201);
 assert.equal(upstream.last().headers.authorization,`Bearer ${aliceToken}`);
 // HYBRID authenticated forwards identity.
 response=await browser('/api/routes/records/catalog');assert.equal(response.status,200);assert.equal(upstream.last().headers['x-hive-user-id'],alice);

 // LEGACY: token acquired server-side once, cached encrypted, reused, renewed after upstream rejection, never exposed.
 assert.equal((await browser('/api/routes/legacy/orders')).status,403,'needs legacy.api read');
 await ok('/admin/grants',{method:'POST',body:{subject:`user:${alice}`,applicationKey:'fixture-app',resourceKey:'legacy.api',action:'read'}});
 response=await browser('/api/routes/legacy/orders');let legacyBody=await response.text();assert.equal(response.status,200,legacyBody);
 assert.equal(upstream.legacy.acquisitions,1);assert.equal(upstream.last().headers.authorization,`Bearer ${upstream.legacy.current}`);
 assert.deepEqual(upstream.legacy.bodies,['password,username'],'credential sent only to the token endpoint');
 for(let i=0;i<3;i++)assert.equal((await browser('/api/routes/legacy/orders')).status,200);
 assert.equal(upstream.legacy.acquisitions,1,'cached token reused');
 const cacheKeys=stack.redis('KEYS','hive:legacy:*').split('\n').filter(Boolean);assert.deepEqual(cacheKeys,['hive:legacy:legacy-fixture:0']);
 const envelope=stack.redis('GET',cacheKeys[0]);assert.ok(!envelope.includes(upstream.legacy.current)&&envelope.startsWith('current.'),'cached token encrypted');
 stack.redis('DEL',cacheKeys[0]);
 const parallel=await Promise.all(Array.from({length:6},()=>browser('/api/routes/legacy/orders')));for(const r of parallel)assert.equal(r.status,200);
 assert.equal(upstream.legacy.acquisitions,2,'concurrent misses acquire exactly once');
 upstream.rotateLegacy();
 assert.equal((await browser('/api/routes/legacy/orders')).status,401,'upstream rejected stale token');
 assert.equal((await browser('/api/routes/legacy/orders')).status,200,'next call re-acquires');assert.equal(upstream.legacy.acquisitions,3);
 const profile=(await ok('/admin/legacy-auth-profiles')).find(p=>p.key==='legacy-fixture');
 await ok('/admin/legacy-auth-profiles/legacy-fixture',{method:'PUT',body:{...profile,expirySkewSeconds:10,revision:profile.revision}});
 assert.equal((await browser('/api/routes/legacy/orders')).status,200);assert.equal(upstream.legacy.acquisitions,4,'profile revision invalidates cached token');
 const everything=JSON.stringify(upstream.requests.filter(r=>!r.path.startsWith('/legacy/oauth')));
 assert.ok(!everything.includes('svc-password'),'legacy credential never sent to API endpoints');
 legacyBody=await (await browser('/api/routes/legacy/orders')).text();assert.ok(!legacyBody.includes('legacy-token-'),'legacy token never reaches the browser');

 // Logout: subsequent protected calls are anonymous again.
 assert.equal((await browser('/auth/logout',{method:'POST',headers:await browser.csrf()})).status,204);
 assert.equal((await browser('/api/routes/records/items')).status,401);

 // API log and audit (delivered asynchronously).
 let logs=[];for(let i=0;i<40;i++){logs=await ok('/admin/api-logs?limit=500');if(logs.some(l=>l.outcome==='UNAUTHENTICATED'&&l.status===401&&new Date(l.occurredAt)>new Date(Date.now()-5000)))break;await pause(250);}
 const outcomes=new Set(logs.map(l=>l.outcome));for(const o of ['SUCCESS','DENIED','UNAUTHENTICATED','NOT_FOUND','UPSTREAM_ERROR','REJECTED'])assert.ok(outcomes.has(o),`api log has ${o}: ${[...outcomes]}`);
 assert.ok(logs.some(l=>l.routeKey==='records'&&l.operationKey==='item'&&l.pathTemplate==='/records/items/{id}'&&l.actorId===`user:${alice}`));
 assert.ok(!JSON.stringify(logs).includes('lang=en'),'query strings are not logged');
 const audit=await ok('/admin/audit?limit=500');const types=new Set(audit.map(e=>e.eventType));
 for(const type of ['route.invoked','route.denied','legacy-token.acquired','legacy-token.invalidated','service-target.created','proxy-route.created','route-operation.created','legacy-profile.created'])assert.ok(types.has(type),type);
 assert.ok(!JSON.stringify(audit).includes(upstream.legacy.current),'tokens never audited');
 assert.ok(!JSON.stringify(audit).includes('svc-password'));
});
