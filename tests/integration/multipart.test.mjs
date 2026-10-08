// RuntimeProxy request bodies: standard browser multipart/form-data must reach an ordinary downstream Spring Boot
// service (@RequestPart MultipartFile) byte for byte through the real BFF and authorization service, together with
// the existing guarantees for JSON, form-urlencoded and raw bodies, both credential modes, identity propagation,
// header allowlists, CSRF and request-size limits.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {startStack,cookieClient} from '../support/stack.mjs';
import {startOidcProvider,login} from '../support/oidc-fixture.mjs';
import {startMultipartService} from '../support/multipart-service.mjs';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
/** A binary payload that exercises every byte value, CR/LF sequences and a fake boundary-looking line. */
const binary=size=>{const b=Buffer.alloc(size);for(let i=0;i<size;i++)b[i]=i%256;Buffer.from('\r\n--fake-boundary\r\n').copy(b,size>>1);return b;};

test('RuntimeProxy forwards multipart, form, JSON and raw bodies intact',{timeout:600000},async t=>{
 const idp=await startOidcProvider({port:31080});t.after(()=>idp.close());
 const service=await startMultipartService(t,{port:31090,suite:'multipart'});
 const stack=await startStack(t,{suite:'multipart',base:31000,
  authorizationEnv:{HIVE_PRIMARY_ISSUER:idp.issuer,HIVE_TARGET_ALLOW_HTTP:'true'},
  bffEnv:{HIVE_IDENTITY_ENABLED:'true',HIVE_OIDC_ISSUER:idp.issuer,HIVE_OIDC_CLIENT_ID:idp.clientId,HIVE_OIDC_CLIENT_SECRET:idp.clientSecret,HIVE_OIDC_ALLOW_LOCAL_HTTP:'true',
   HIVE_PROXY_ALLOWED_ORIGINS:service.origin,HIVE_PROXY_ALLOW_HTTP:'true',HIVE_SECRET_LEGACY_UPLOADS:JSON.stringify({username:'svc-account',password:'svc-password'})}});
 const ok=async(path,body,method='POST')=>{const r=await stack.service(path,{method,body});const text=await r.text();assert.ok(r.status<300,`${path} -> ${r.status} ${text}`);return text?JSON.parse(text):null;};

 await ok('/admin/applications',{key:'upload-app',displayName:'Uploads'});
 await ok('/admin/applications/upload-app/resources',{key:'uploads.api',type:'API_RESOURCE',parentKey:'upload-app',displayName:'Uploads API',actions:[{key:'write'}]});
 const alice=(await ok('/admin/users',{displayName:'Alice',identities:[{issuer:idp.issuer,subject:'alice'}]})).id;
 await ok('/admin/grants',{subject:`user:${alice}`,applicationKey:'upload-app',resourceKey:'uploads.api',action:'write'});
 await ok('/admin/service-targets',{key:'uploads-svc',displayName:'Uploads',baseUrl:service.origin,maxRequestBytes:8*1024*1024});
 await ok('/admin/service-targets',{key:'uploads-small',displayName:'Uploads (small limit)',baseUrl:service.origin,maxRequestBytes:64*1024});
 await ok('/admin/legacy-auth-profiles',{key:'uploads-legacy',targetKey:'uploads-svc',tokenEndpointPath:'/legacy/oauth/token',requestFormat:'JSON',
  credentialReference:'env:HIVE_SECRET_LEGACY_UPLOADS',tokenPointer:'/data/accessToken',expiresInPointer:'/data/expiresIn',tokenTypePointer:'/data/type'});
 await ok('/admin/proxy-routes',{key:'uploads',applicationKey:'upload-app',pathPrefix:'/uploads',targetKey:'uploads-svc',authentication:'FORWARD_TOKEN'});
 await ok('/admin/proxy-routes',{key:'uploads-legacy',applicationKey:'upload-app',pathPrefix:'/uploads-legacy',targetKey:'uploads-svc',authentication:'LEGACY',legacyProfileKey:'uploads-legacy'});
 await ok('/admin/proxy-routes',{key:'uploads-public',applicationKey:'upload-app',pathPrefix:'/uploads-public',targetKey:'uploads-small',authentication:'NONE'});
 const operation=(route,key,method,pathPattern,auth=true)=>ok(`/admin/proxy-routes/${route}/operations`,
  {key,method,pathPattern,...(auth?{access:'AUTHENTICATED',resourceKey:'uploads.api',action:'write'}:{access:'PUBLIC'})});
 await operation('uploads','upload','POST','/uploads');
 await operation('uploads','json','POST','/json');
 await operation('uploads','form-post','POST','/forms');
 await operation('uploads','form-put','PUT','/forms');
 await operation('uploads','raw','POST','/raw');
 await operation('uploads-legacy','upload','POST','/uploads');
 await operation('uploads-public','upload','POST','/uploads',false);

 const browser=cookieClient(stack.urls.bff);
 const anonymous=cookieClient(stack.urls.bff);
 await login(browser,idp,{subject:'alice',name:'Alice'});
 const send=async(client,path,body,{method='POST',headers={}}={})=>{
  const response=await client(`/api/routes${path}`,{method,body,headers:{...await client.csrf(),Accept:'application/json',...headers}});
  const text=await response.text();
  return {status:response.status,body:text?JSON.parse(text):null};
 };
 const form=(...entries)=>{const f=new FormData();for(const [name,value,filename] of entries)filename?f.append(name,value,filename):f.append(name,value);return f;};

 await t.test('1. single binary file with filename and MIME type', async()=>{
  const bytes=binary(200*1024);
  const r=await send(browser,'/uploads/uploads',form(['file',new Blob([bytes],{type:'application/pdf'}),'evidence.pdf']));
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(r.body.files.length,1);
  assert.deepEqual(r.body.files[0],{name:'file',filename:'evidence.pdf',contentType:'application/pdf',size:bytes.length,sha256:sha256(bytes)});
 });

 await t.test('2. file plus text fields', async()=>{
  const r=await send(browser,'/uploads/uploads',form(['file',new Blob(['hello'],{type:'text/plain'}),'note.txt'],['description','Scanned national ID'],['category','IDENTITY']));
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.deepEqual(r.body.fields,{description:'Scanned national ID',category:'IDENTITY'});
  assert.equal(r.body.files[0].filename,'note.txt');
 });

 await t.test('3. multiple files arrive independently', async()=>{
  const a=randomBytes(5000),b=randomBytes(7000);
  const r=await send(browser,'/uploads/uploads',form(['file',new Blob([a],{type:'image/png'}),'front.png'],['file',new Blob([b],{type:'image/jpeg'}),'back.jpg']));
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.deepEqual(r.body.files.map(f=>[f.filename,f.contentType,f.sha256]),[['front.png','image/png',sha256(a)],['back.jpg','image/jpeg',sha256(b)]]);
 });

 await t.test('4. binary integrity: SHA-256 before and after proxying', async()=>{
  const bytes=Buffer.concat([randomBytes(1024*1024),binary(4096)]);
  const r=await send(browser,'/uploads/uploads',form(['file',new Blob([bytes],{type:'application/octet-stream'}),'payload.bin']));
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(r.body.files[0].sha256,sha256(bytes));
  assert.equal(r.body.files[0].size,bytes.length);
 });

 await t.test('5. boundary preserved: downstream receives a parseable multipart Content-Type', async()=>{
  const r=await send(browser,'/uploads/uploads',form(['file',new Blob(['x'],{type:'text/plain'}),'x.txt']));
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.match(r.body.headers['content-type'],/^multipart\/form-data; ?boundary=[^;\s]+$/);
 });

 await t.test('6/7. authenticated FORWARD_TOKEN route: identity and Hive headers propagate, cookies do not', async()=>{
  const r=await send(browser,'/uploads/uploads',form(['file',new Blob(['id'],{type:'text/plain'}),'id.txt']),{headers:{'X-Hive-User-Id':'forged',Authorization:'Bearer browser'}});
  assert.equal(r.status,200,JSON.stringify(r.body));
  const h=r.body.headers;
  assert.equal(h['x-hive-user-id'],alice);
  assert.ok(h['x-hive-tenant-id']);
  assert.equal(h['x-hive-route'],'uploads');
  assert.equal(h['x-hive-operation'],'upload');
  assert.ok(h['x-correlation-id']);
  assert.equal(h.authorization,'Bearer <present>','the user token is injected by the BFF');
  assert.equal(h.cookie,undefined,'browser cookies (the Hive session) never reach the service');
 });

 await t.test('6. anonymous and unauthorized uploads are rejected before reaching the service', async()=>{
  const anon=await send(anonymous,'/uploads/uploads',form(['file',new Blob(['x']),'x.txt']));
  assert.equal(anon.status,401);
  assert.equal(anon.body.code,'AUTHENTICATION_REQUIRED');
  const noCsrf=await browser('/api/routes/uploads/uploads',{method:'POST',body:form(['file',new Blob(['x']),'x.txt'])});
  assert.ok([401,403].includes(noCsrf.status),'multipart is no CSRF bypass');
 });

 await t.test('8. LEGACY route: the legacy token is injected and multipart arrives intact', async()=>{
  const bytes=randomBytes(30000);
  const r=await send(browser,'/uploads-legacy/uploads',form(['file',new Blob([bytes],{type:'application/zip'}),'archive.zip'],['description','legacy']));
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(r.body.files[0].sha256,sha256(bytes));
  assert.equal(r.body.fields.description,'legacy');
  assert.equal(r.body.headers.authorization,'Bearer <present>');
  assert.equal(r.body.headers['x-hive-route'],'uploads-legacy');
 });

 await t.test('UTF-8 filenames and field values', async()=>{
  const r=await send(browser,'/uploads/uploads',form(['file',new Blob(['مرحبا'],{type:'text/plain'}),'هوية-مستمسك.txt'],['description','تصويب اسم الجد — Ünïcödé ✓']));
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(r.body.files[0].filename,'هوية-مستمسك.txt');
  assert.equal(r.body.fields.description,'تصويب اسم الجد — Ünïcödé ✓');
  assert.equal(r.body.files[0].sha256,sha256(Buffer.from('مرحبا')));
 });

 await t.test('public route: multipart works anonymously and gains no identity', async()=>{
  const r=await send(anonymous,'/uploads-public/uploads',form(['file',new Blob(['p'],{type:'text/plain'}),'p.txt']));
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(r.body.headers['x-hive-user-id'],undefined);
  assert.equal(r.body.headers.authorization,undefined);
 });

 await t.test('9. multipart larger than maxRequestBytes is rejected with REQUEST_TOO_LARGE', async()=>{
  const r=await send(anonymous,'/uploads-public/uploads',form(['file',new Blob([randomBytes(100*1024)],{type:'application/octet-stream'}),'big.bin']));
  assert.equal(r.status,413);
  assert.equal(r.body.code,'REQUEST_TOO_LARGE');
 });

 await t.test('10. JSON regression', async()=>{
  const r=await send(browser,'/uploads/json',JSON.stringify({name:'Zahraa',values:[1,2,3],note:'مرحبا'}),{headers:{'Content-Type':'application/json'}});
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.deepEqual(r.body.body,{name:'Zahraa',values:[1,2,3],note:'مرحبا'});
 });

 await t.test('11. application/x-www-form-urlencoded regression (POST and PUT)', async()=>{
  for(const method of ['POST','PUT']){
   const r=await send(browser,'/uploads/forms',new URLSearchParams({description:'form value',category:'تصنيف'}).toString(),{method,headers:{'Content-Type':'application/x-www-form-urlencoded'}});
   assert.equal(r.status,200,`${method} ${JSON.stringify(r.body)}`);
   assert.deepEqual(r.body.fields,{description:'form value',category:'تصنيف'},method);
  }
 });

 await t.test('CSRF on runtime routes comes only from the header: a form-body _csrf never passes (and never consumes the body)', async()=>{
  const token=await browser.csrf();
  const [, value]=Object.entries(token)[0];
  const before=await browser('/api/routes/uploads/forms',{method:'POST',body:new URLSearchParams({_csrf:value,description:'x'}).toString(),headers:{'Content-Type':'application/x-www-form-urlencoded'}});
  assert.equal(before.status,403,'token in the body is not accepted on /api/routes/**');
  const withHeader=await send(browser,'/uploads/forms',new URLSearchParams({_csrf:value,description:'x'}).toString(),{headers:{'Content-Type':'application/x-www-form-urlencoded'}});
  assert.equal(withHeader.status,200,JSON.stringify(withHeader.body));
  assert.deepEqual(withHeader.body.fields,{_csrf:value,description:'x'},'the whole body is forwarded untouched');
 });

 await t.test('raw binary regression', async()=>{
  const bytes=randomBytes(50000);
  const r=await send(browser,'/uploads/raw',bytes,{headers:{'Content-Type':'application/octet-stream'}});
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(r.body.sha256,sha256(bytes));
  assert.equal(r.body.size,bytes.length);
 });
});
