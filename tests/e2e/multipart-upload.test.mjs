// Real browser acceptance for multipart uploads: a user signs in through a real Keycloak, picks files in a real
// <input type="file">, and the page sends standard FormData (browser-generated boundary) through the gateway, the real
// BFF RuntimeProxy and a registered, authorized route to an ordinary Spring Boot service that receives
// @RequestPart MultipartFile. Proof: same filename, same MIME type, same SHA-256, same text fields, identity propagated.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {startStack,ready} from '../support/stack.mjs';
import {startMultipartService} from '../support/multipart-service.mjs';
import {startGateway} from '../../tools/dev-gateway.mjs';
import {browserChannel} from '../support/solution.mjs';

const keycloakPort=31110,gatewayPort=31195,origin=`http://127.0.0.1:${gatewayPort}`,realm='hive-multipart';
const issuer=`http://127.0.0.1:${keycloakPort}/realms/${realm}`;
const userId=randomUUID();
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

test('browser FormData upload through Hive reaches a Spring MultipartFile intact',{timeout:900000},async t=>{
 const realmDir=resolve('.local/e2e-multipart/realm');mkdirSync(realmDir,{recursive:true});
 writeFileSync(`${realmDir}/realm.json`,JSON.stringify({realm,enabled:true,sslRequired:'none',
  clients:[{clientId:'hive-bff',enabled:true,publicClient:false,secret:'multipart-client-secret-01',standardFlowEnabled:true,directAccessGrantsEnabled:false,
   redirectUris:[`${origin}/login/oauth2/code/primary`],attributes:{'pkce.code.challenge.method':'S256'}}],
  users:[{id:userId,username:'uploader',enabled:true,email:'uploader@example.test',emailVerified:true,firstName:'Uma',lastName:'Uploader',
   credentials:[{type:'password',value:'multipart-password',temporary:false}],requiredActions:[]}]}));
 const container=`hive-multipart-keycloak-${Date.now()}`;
 const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000});
 t.after(()=>{try{docker('rm','-f',container);}catch{}});
 docker('run','-d','--name',container,'-p',`127.0.0.1:${keycloakPort}:8080`,'-e','KC_BOOTSTRAP_ADMIN_USERNAME=bootstrap','-e','KC_BOOTSTRAP_ADMIN_PASSWORD=bootstrap-only',
  '--mount',`type=bind,source=${realmDir},target=/opt/keycloak/data/import,readonly`,'quay.io/keycloak/keycloak:26.3.3','start-dev','--import-realm');

 const service=await startMultipartService(t,{port:31190,suite:'e2e-multipart'});
 const stack=await startStack(t,{suite:'e2e-multipart',base:31100,
  authorizationEnv:{HIVE_PRIMARY_ISSUER:issuer,HIVE_TARGET_ALLOW_HTTP:'true'},
  bffEnv:{HIVE_IDENTITY_ENABLED:'true',HIVE_OIDC_ISSUER:issuer,HIVE_OIDC_CLIENT_ID:'hive-bff',HIVE_OIDC_CLIENT_SECRET:'multipart-client-secret-01',HIVE_OIDC_ALLOW_LOCAL_HTTP:'true',
   HIVE_PROXY_ALLOWED_ORIGINS:service.origin,HIVE_PROXY_ALLOW_HTTP:'true'},
  beforeBff:()=>ready(`${issuer}/.well-known/openid-configuration`,{attempts:400})});
 const ok=async(path,body)=>{const r=await stack.service(path,{method:'POST',body});const text=await r.text();assert.ok(r.status<300,`${path} -> ${r.status} ${text}`);return text?JSON.parse(text):null;};

 // Real route registration and authorization through the admin API.
 await ok('/admin/applications',{key:'upload-app',displayName:'Uploads'});
 await ok('/admin/applications/upload-app/resources',{key:'uploads.api',type:'API_RESOURCE',parentKey:'upload-app',displayName:'Uploads API',actions:[{key:'write'}]});
 const user=await ok('/admin/users',{displayName:'Uma Uploader',identities:[{issuer,subject:userId}]});
 await ok('/admin/grants',{subject:`user:${user.id}`,applicationKey:'upload-app',resourceKey:'uploads.api',action:'write'});
 await ok('/admin/service-targets',{key:'uploads-svc',displayName:'Uploads',baseUrl:service.origin,maxRequestBytes:8*1024*1024});
 await ok('/admin/proxy-routes',{key:'uploads',applicationKey:'upload-app',pathPrefix:'/uploads',targetKey:'uploads-svc',authentication:'FORWARD_TOKEN'});
 await ok('/admin/proxy-routes/uploads/operations',{key:'upload',method:'POST',pathPattern:'/uploads',access:'AUTHENTICATED',resourceKey:'uploads.api',action:'write'});

 const gateway=await startGateway({port:gatewayPort,bff:stack.urls.bff,mounts:{'/':'tests/fixtures/multipart-page'}});
 t.after(()=>gateway.close());

 const browser=await chromium.launch({headless:true,...browserChannel});t.after(()=>browser.close());
 const page=await (await browser.newContext()).newPage();
 const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
 await page.goto(origin+'/auth/login?returnUrl=%2F');
 await page.waitForURL(u=>u.href.startsWith(issuer));
 await page.fill('#username','uploader');await page.fill('#password','multipart-password');await page.click('#kc-login');
 await page.waitForURL(origin+'/');

 // A binary PDF-like file and a UTF-8 named image, chosen in the real file input.
 const pdf=Buffer.concat([Buffer.from('%PDF-1.7\n'),randomBytes(600*1024),Buffer.from('\r\n--not-a-boundary\r\n%%EOF')]);
 const png=Buffer.concat([Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),randomBytes(40*1024)]);
 const outgoing=[];
 page.on('request',r=>{if(r.url().endsWith('/api/routes/uploads/uploads'))outgoing.push(r.headers()['content-type']);});
 await page.setInputFiles('#file',[{name:'evidence.pdf',mimeType:'application/pdf',buffer:pdf},{name:'صورة-شخصية.png',mimeType:'image/png',buffer:png}]);
 await page.fill('#description','test upload');
 await page.fill('#category','وثائق');
 await page.click('#send');
 await page.waitForFunction(()=>document.getElementById('result').textContent.length>0,null,{timeout:30000});
 const {status,body}=JSON.parse(await page.textContent('#result'));

 assert.match(outgoing[0],/^multipart\/form-data; boundary=/,'the browser generated a standard multipart request');
 assert.equal(status,200,JSON.stringify(body));
 assert.deepEqual(body.files,[
  {name:'file',filename:'evidence.pdf',contentType:'application/pdf',size:pdf.length,sha256:sha256(pdf)},
  {name:'file',filename:'صورة-شخصية.png',contentType:'image/png',size:png.length,sha256:sha256(png)}]);
 assert.deepEqual(body.fields,{description:'test upload',category:'وثائق'});
 assert.match(body.headers['content-type'],/^multipart\/form-data; ?boundary=/);
 assert.equal(body.headers['x-hive-user-id'],user.id,'identity propagated');
 assert.equal(body.headers['x-hive-route'],'uploads');
 assert.equal(body.headers.authorization,'Bearer <present>','user token injected server-side');
 assert.equal(body.headers.cookie,undefined,'browser cookies are not forwarded');
 assert.deepEqual(pageErrors,[]);
});
