import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Signal,Lifetime,matchRoute,routeSpecificity,ExtensionRegistry,HiveRuntimeError} from '@hive-platform/core';
import {createHttpClient,HiveHttpError} from '@hive-platform/http-client';
import {createAuth,isSafeReturnUrl} from '@hive-platform/auth';
import {permissionsOf,routeAccess,scopedPermissions} from '@hive-platform/authorization';
import {fakeDocument} from './support.mjs';

const authenticated={authenticated:true,permissions:{'app:records':['view'],'app:admin':['manage']},platformRoles:[]};
const anonymous={authenticated:false};

test('core: signals, lifetimes and route matching',async()=>{
 const signal=new Signal(1);const seen=[];const off=signal.subscribe(v=>seen.push(v));signal.set(2);signal.set(2);off();signal.set(3);assert.deepEqual(seen,[2]);
 const order=[];const lifetime=new Lifetime();lifetime.add(()=>order.push('a'));lifetime.add(()=>{throw new Error('x');});lifetime.add(()=>order.push('c'));
 const failures=await lifetime.dispose();assert.deepEqual(order,['c','a']);assert.equal(failures.length,1);assert.ok(lifetime.signal.aborted);assert.deepEqual(await lifetime.dispose(),[]);
 assert.deepEqual(matchRoute('/records/:id','/records/42?x=1'),{id:'42'});
 assert.deepEqual(matchRoute('/records/*','/records/a/b'),{'*':'a/b'});
 assert.equal(matchRoute('/records/:id','/records'),null);assert.equal(matchRoute('/records','/records/x'),null);
 assert.deepEqual(matchRoute('/x/:name','/x/a%20b'),{name:'a b'});
 assert.ok(routeSpecificity('/records/new')>routeSpecificity('/records/:id'));
});

test('core: extension registry validates, filters by permission and isolates failures',()=>{
 const errors=[];const registry=new ExtensionRegistry(d=>errors.push(d));
 const base={version:'1.0.0',contractVersion:'1.1.0',point:'HEADER'};
 registry.register({...base,key:'banner',order:2,render:el=>{el.textContent='banner';}});
 registry.register({...base,key:'admin-link',order:1,requires:['app:admin:configure'],render:el=>{el.textContent='admin';}});
 registry.register({...base,key:'broken',order:3,render:()=>{throw new Error('broken');}});
 assert.throws(()=>registry.register({...base,key:'banner',render(){}}),HiveRuntimeError);
 assert.throws(()=>registry.register({...base,key:'future',contractVersion:'2.0.0',render(){}}),/contract major 2/);
 assert.deepEqual(registry.list('HEADER',anonymous).map(e=>e.key),['banner','broken']);
 assert.deepEqual(registry.list('HEADER',authenticated).map(e=>e.key),['admin-link','banner','broken'],'manage implies configure');
 const host=fakeDocument().createElement('header');const dispose=registry.render('HEADER',host,authenticated);
 assert.deepEqual(host.children.map(c=>c.textContent),['admin','banner']);assert.equal(errors[0].code,'EXTENSION_FAILED');
 dispose();assert.equal(host.children.length,0);
});

test('authorization helpers are UI hints over context permissions',()=>{
 assert.equal(permissionsOf(authenticated).can('app','records','view'),true);
 assert.equal(permissionsOf(authenticated).can('app','records','export'),false);
 assert.equal(permissionsOf(authenticated).can('app','admin','anything'),true);
 assert.equal(permissionsOf(anonymous).can('app','records','view'),false);
 const module={applicationKey:'app'};
 assert.equal(routeAccess({access:'PUBLIC'},module,anonymous),'ALLOWED');
 assert.equal(routeAccess({access:'HYBRID'},module,anonymous),'ALLOWED');
 assert.equal(routeAccess({access:'AUTHENTICATED'},module,anonymous),'LOGIN_REQUIRED');
 assert.equal(routeAccess({access:'AUTHENTICATED',resource:'records',action:'view'},module,authenticated),'ALLOWED');
 assert.equal(routeAccess({access:'AUTHENTICATED',resource:'records',action:'delete'},module,authenticated),'DENIED');
 assert.equal(scopedPermissions(authenticated,'app').can('records','view'),true);
});

test('http client: same-origin credentials, CSRF on unsafe methods, correlation ids, PlatformError',async()=>{
 const calls=[];let csrfIssued=0;let rejectOnce=true;
 const fetchStub=async(url,init={})=>{
  calls.push({url,init});
  if(url==='/auth/csrf'){csrfIssued++;return Response.json({headerName:'X-CSRF-TOKEN',token:'t'+csrfIssued});}
  if(url==='/api/fail')return new Response(JSON.stringify({code:'ACCESS_DENIED',message:'nope',correlationId:'c-1'}),{status:403,headers:{'Content-Type':'application/json'}});
  if(url==='/api/csrf-stale'&&rejectOnce){rejectOnce=false;return new Response('',{status:403});}
  if(url==='/api/empty')return new Response(null,{status:204});
  return Response.json({ok:true,method:init.method});
 };
 const http=createHttpClient({fetch:fetchStub,correlationId:()=>'corr-1'});
 assert.deepEqual(await http.get('/api/x'),{ok:true,method:'GET'});
 assert.equal(calls[0].init.credentials,'same-origin');assert.equal(calls[0].init.headers['X-Correlation-Id'],'corr-1');assert.equal(calls[0].init.headers['X-CSRF-TOKEN'],undefined);
 await http.post('/api/x',{a:1});const post=calls.at(-1);assert.equal(post.init.headers['X-CSRF-TOKEN'],'t1');assert.equal(post.init.body,'{"a":1}');
 await http.put('/api/x',{});assert.equal(csrfIssued,1,'token cached');
 await http.post('/api/csrf-stale');assert.equal(csrfIssued,2,'stale token refreshed once and retried');
 assert.equal(await http.delete('/api/empty'),undefined);
 await assert.rejects(http.get('/api/fail'),e=>e instanceof HiveHttpError&&e.status===403&&e.code==='ACCESS_DENIED'&&e.error.correlationId==='c-1');
 const offline=createHttpClient({fetch:async()=>{throw new TypeError('down');}});
 await assert.rejects(offline.get('/x'),e=>e.code==='NETWORK_FAILURE');
 const slow=createHttpClient({fetch:(url,init)=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason))),timeoutMs:20});
 await assert.rejects(slow.get('/x'),e=>e.code==='REQUEST_TIMEOUT');
});

test('auth: safe return URLs, login URL, context fallbacks',async()=>{
 for(const good of ['/','/news/123','/a?b=c'])assert.equal(isSafeReturnUrl(good),true,good);
 for(const bad of ['//evil.test','https://evil.test','/\\evil','/%2F%2Fevil','/a/../b','/auth/login','/login/oauth2/code/x','/x#y','relative'])assert.equal(isSafeReturnUrl(bad),false,bad);
 const navigated=[];
 const http=createHttpClient({fetch:async url=>url==='/api/me/context'?new Response('',{status:401}):Response.json({authenticated:false,modules:[]})});
 const auth=createAuth(http,{navigate:url=>navigated.push(url)});
 assert.equal(await auth.context(),null);
 assert.equal((await auth.currentContext()).authenticated,false);
 auth.login('//evil.test',{provider:'corp'});auth.login('/news/1');
 assert.deepEqual(navigated,['/auth/login?returnUrl=%2F&provider=corp','/auth/login?returnUrl=%2Fnews%2F1']);
});
