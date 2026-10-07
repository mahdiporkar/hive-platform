// Phase 4: resource catalog, access administration, OpenFGA projection, decisions, platform roles, cache invalidation.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startStack,pause} from '../support/stack.mjs';

const bootstrapIssuer='https://idp.fixture.test',bootstrapSubject='first-admin';
test('authorization control plane: catalog rules, grants, inheritance, revocation, platform roles and graph recovery',{timeout:300000},async t=>{
 const stack=await startStack(t,{suite:'authorization',base:29400,bff:false,
  authorizationEnv:{HIVE_AUTHZ_CACHE_ENABLED:'true',HIVE_BOOTSTRAP_ADMIN_ISSUER:bootstrapIssuer,HIVE_BOOTSTRAP_ADMIN_SUBJECT:bootstrapSubject}});
 const call=async(path,{method='GET',body,actor,principal}={})=>{
  const response=await stack.service(path,{method,body,principal:principal??(actor?'bff':'provisioner'),headers:actor?{'X-Hive-Actor':actor}:{}});
  const text=await response.text();return {status:response.status,body:text?JSON.parse(text):null};
 };
 const ok=async(path,options)=>{const r=await call(path,options);assert.ok(r.status>=200&&r.status<300,`${options?.method??'GET'} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);return r.body;};
 const check=async(userId,checks)=>(await ok('/internal/authorization/check',{method:'POST',principal:'bff',body:{userId,checks}}));
 const decision=async(userId,resourceKey,action,applicationKey='fixture-app')=>(await check(userId,[{applicationKey,resourceKey,action}]))[0];

 // Clean core: no applications or business data, graph store recorded, first administrator bootstrapped from configuration only.
 assert.deepEqual(await ok('/admin/applications'),[]);
 assert.equal(stack.sql('select count(*) from graph_store'),'1');
 let admin;for(let i=0;i<40&&!admin;i++){admin=stack.sql(`select user_id from external_identity where issuer='${bootstrapIssuer}' and subject='${bootstrapSubject}'`);if(!admin)await pause(250);}
 assert.match(admin,/^[0-9a-f-]{36}$/);
 assert.equal(stack.sql("select count(*) from platform_bootstrap where bootstrap_key='first-administrator'"),'1');
 assert.deepEqual(await ok(`/internal/authorization/platform-roles?userId=${admin}`,{principal:'bff'}),['SUPER_ADMIN','OPERATOR','SECURITY_ADMIN','INTEGRATION_ADMIN','AUDITOR']);

 // Applications and catalog rules (acting as the bootstrapped super administrator through the runtime channel).
 await ok('/admin/applications',{method:'POST',actor:admin,body:{key:'fixture-app',displayName:'Fixture application'}});
 await ok('/admin/applications',{method:'POST',actor:admin,body:{key:'other-app',displayName:'Other application'}});
 assert.equal((await call('/admin/applications',{method:'POST',actor:admin,body:{key:'fixture-app',displayName:'Again'}})).status,409);
 assert.equal((await call('/admin/applications',{method:'POST',actor:admin,body:{key:'Bad Key',displayName:'x'}})).status,400);
 const resources=[
  {key:'records',type:'MODULE',parentKey:'fixture-app',displayName:'Records module',actions:[{key:'view'}]},
  {key:'records.list',type:'PAGE',parentKey:'records',displayName:'Records list',actions:[{key:'view'},{key:'export'}]},
  {key:'records.list.table',type:'UI_COMPONENT',parentKey:'records.list',displayName:'Table',actions:[{key:'view'}]},
  {key:'records.api',type:'API_RESOURCE',parentKey:'records',displayName:'Records API',actions:[{key:'read'},{key:'write'}]},
 ];
 for(const resource of resources)await ok('/admin/applications/fixture-app/resources',{method:'POST',actor:admin,body:resource});
 const invalid=async(body,expected=400)=>assert.equal((await call('/admin/applications/fixture-app/resources',{method:'POST',actor:admin,body})).status,expected,JSON.stringify(body));
 await invalid({key:'bad.page',type:'PAGE',parentKey:'fixture-app',displayName:'Page under application'});
 await invalid({key:'records',type:'MODULE',parentKey:'fixture-app',displayName:'Duplicate'},409);
 await invalid({key:'orphan',type:'MODULE',parentKey:'missing',displayName:'Unknown parent'});
 await invalid({key:'cross',type:'MODULE',parentKey:'other-app',displayName:'Cross-application parent'});
 await invalid({key:'bad.action',type:'MODULE',parentKey:'fixture-app',displayName:'x',actions:[{key:'manage'}]});
 await invalid({key:'dup.action',type:'MODULE',parentKey:'fixture-app',displayName:'x',actions:[{key:'view'},{key:'view'}]});
 await invalid({key:'root2',type:'APPLICATION',parentKey:'fixture-app',displayName:'Second root'});
 // Cycle: move the module under its own descendant (type rules also forbid it; use two modules to reach the cycle check).
 await ok('/admin/applications/fixture-app/resources',{method:'POST',actor:admin,body:{key:'outer',type:'MODULE',parentKey:'fixture-app',displayName:'Outer'}});
 await ok('/admin/applications/fixture-app/resources',{method:'POST',actor:admin,body:{key:'inner',type:'MODULE',parentKey:'outer',displayName:'Inner'}});
 const outer=(await ok('/admin/applications/fixture-app/resources')).find(r=>r.key==='outer');
 const cycle=await call('/admin/applications/fixture-app/resources/outer',{method:'PUT',actor:admin,body:{type:'MODULE',parentKey:'inner',displayName:'Outer',actions:[],revision:outer.revision}});
 assert.equal(cycle.status,400);assert.match(cycle.body.message,/cycle/);
 assert.equal((await call('/admin/applications/fixture-app/resources/outer',{method:'PUT',actor:admin,body:{type:'MODULE',parentKey:'fixture-app',displayName:'Outer',actions:[],revision:outer.revision+5}})).status,409,'stale revision');

 // Users, groups and roles.
 const alice=(await ok('/admin/users',{method:'POST',actor:admin,body:{displayName:'Alice Fixture',identities:[{issuer:bootstrapIssuer,subject:'alice'}]}})).id;
 const bob=(await ok('/admin/users',{method:'POST',actor:admin,body:{displayName:'Bob Fixture'}})).id;
 assert.equal((await call('/admin/users',{method:'POST',actor:admin,body:{displayName:'Dup',identities:[{issuer:bootstrapIssuer,subject:'alice'}]}})).status,409,'identity binding is unique');
 await ok('/admin/groups',{method:'POST',actor:admin,body:{key:'readers',displayName:'Readers'}});
 await ok('/admin/groups/readers/members',{method:'POST',actor:admin,body:{userId:bob}});
 await ok('/admin/roles',{method:'POST',actor:admin,body:{key:'record-reader',displayName:'Record reader'}});
 await ok('/admin/roles/record-reader/assignments',{method:'POST',actor:admin,body:{subject:'group:readers'}});
 const roleGrant=await ok('/admin/grants',{method:'POST',actor:admin,body:{subject:'role:record-reader',applicationKey:'fixture-app',resourceKey:'records.list',action:'view'}});
 assert.equal((await call('/admin/grants',{method:'POST',actor:admin,body:{subject:'role:record-reader',applicationKey:'fixture-app',resourceKey:'records.list',action:'delete'}})).status,400,'undeclared action cannot be granted');
 assert.equal((await call('/admin/grants',{method:'POST',actor:admin,body:{subject:'role:record-reader',applicationKey:'fixture-app',resourceKey:'records.list',action:'view'}})).status,409,'duplicate active grant');

 // Decisions: default deny, group->role->grant chain, manage inheritance down the tree, explicit reasons.
 assert.equal((await decision(alice,'records.list','view')).reason,'NO_RELATIONSHIP');
 assert.equal((await decision(bob,'records.list','view')).allowed,true);
 assert.equal((await decision(bob,'records.list','export')).allowed,false);
 assert.equal((await decision(bob,'records.list.table','view')).allowed,false,'view is not inherited by children');
 assert.equal((await decision(bob,'records.list','delete')).reason,'ACTION_UNDECLARED');
 assert.equal((await decision(bob,'missing','view')).reason,'RESOURCE_UNKNOWN');
 assert.equal((await decision('00000000-0000-0000-0000-000000000000','records.list','view')).reason,'USER_UNKNOWN_OR_INACTIVE');
 const manage=await ok('/admin/grants',{method:'POST',actor:admin,body:{subject:`user:${alice}`,applicationKey:'fixture-app',resourceKey:'records',action:'manage'}});
 for(const [resource,action] of [['records','view'],['records.list','export'],['records.list.table','view'],['records.api','write'],['records.list','manage']])
  assert.equal((await decision(alice,resource,action)).allowed,true,`manage on module confers ${action} on ${resource}`);
 assert.equal((await decision(alice,'outer','view')).allowed,false,'sibling subtree not affected');

 // Cache invalidation: a cached ALLOW must not survive revocation.
 assert.equal((await decision(bob,'records.list','view')).allowed,true);
 assert.ok(Number(stack.redis('GET','hive:authz:epoch'))>0,'decision cache active');
 await ok(`/admin/grants/${roleGrant.id}`,{method:'DELETE',actor:admin});
 assert.equal((await decision(bob,'records.list','view')).allowed,false,'revocation is immediately effective despite cache');
 await ok(`/admin/grants/${manage.id}`,{method:'DELETE',actor:admin});
 assert.equal((await decision(alice,'records.list.table','view')).allowed,false);
 const history=await ok('/admin/grants?includeRevoked=true');assert.equal(history.filter(g=>g.revokedAt).length,2,'revoked grants retained as history');

 // Archive semantics: no destructive delete, children first, archived resources deny.
 const directGrant=await ok('/admin/grants',{method:'POST',actor:admin,body:{subject:`user:${bob}`,applicationKey:'fixture-app',resourceKey:'records.list.table',action:'view'}});
 assert.equal((await decision(bob,'records.list.table','view')).allowed,true);
 let list=await ok('/admin/applications/fixture-app/resources');const page=list.find(r=>r.key==='records.list');
 assert.equal((await call('/admin/applications/fixture-app/resources/records.list/archive',{method:'POST',actor:admin,body:{archived:true,revision:page.revision}})).status,409,'active children block archive');
 const table=list.find(r=>r.key==='records.list.table');
 await ok('/admin/applications/fixture-app/resources/records.list.table/archive',{method:'POST',actor:admin,body:{archived:true,revision:table.revision}});
 assert.equal((await decision(bob,'records.list.table','view')).reason,'RESOURCE_ARCHIVED');
 assert.equal(stack.sql(`select count(*) from permission_grant where id='${directGrant.id}' and revoked_at is null`),'1','grant history survives archive');

 // User deactivation denies immediately.
 await ok(`/admin/grants`,{method:'POST',actor:admin,body:{subject:`user:${bob}`,applicationKey:'fixture-app',resourceKey:'records.api',action:'read'}});
 assert.equal((await decision(bob,'records.api','read')).allowed,true);
 await ok(`/admin/users/${bob}`,{method:'PUT',actor:admin,body:{active:false}});
 assert.equal((await decision(bob,'records.api','read')).reason,'USER_UNKNOWN_OR_INACTIVE');

 // Platform roles separate control-plane duties; business grants never confer them.
 assert.equal((await call('/admin/applications',{actor:alice})).status,403,'business user is not a platform reader');
 await ok('/admin/platform-roles',{method:'POST',actor:admin,body:{role:'OPERATOR',subject:`user:${alice}`}});
 assert.equal((await call('/admin/applications',{method:'POST',actor:alice,body:{key:'operator-app',displayName:'Operator app'}})).status,200,'operator manages applications');
 assert.equal((await call('/admin/grants',{method:'POST',actor:alice,body:{subject:`user:${alice}`,applicationKey:'fixture-app',resourceKey:'records',action:'manage'}})).status,403,'operator cannot self-grant');
 assert.equal((await call('/admin/platform-roles',{method:'POST',actor:alice,body:{role:'SUPER_ADMIN',subject:`user:${alice}`}})).status,403,'operator cannot escalate');
 assert.equal((await call('/admin/audit',{actor:alice})).status,403,'operator is not an auditor');
 const superAssignment=(await ok('/admin/platform-roles')).find(a=>a.role==='SUPER_ADMIN');
 assert.equal((await call(`/admin/platform-roles/${superAssignment.id}`,{method:'DELETE',actor:admin})).status,409,'last super administrator protected');
 assert.equal((await call('/admin/applications',{actor:'not-a-uuid'})).status,403);

 // Audit trail with actors, denials and correlation.
 const audit=await ok('/admin/audit?limit=200',{actor:admin});
 for(const type of ['application.created','resource.created','grant.created','grant.revoked','group.member.added','role.assigned','platform-role.assigned','admin.denied','user.deactivated','resource.archived','platform-role.bootstrap'])
  assert.ok(audit.some(e=>e.eventType===type),`audit contains ${type}`);
 assert.ok(audit.some(e=>e.eventType==='grant.created'&&e.actorId===`user:${admin}`));
 assert.ok(audit.every(e=>e.correlationId));

 // Only this service writes the graph; the outbox drains completely.
 const status=await ok('/admin/diagnostics/graph',{actor:admin});
 assert.deepEqual({ready:status.ready,pending:status.pending,deadLettered:status.deadLettered},{ready:true,pending:0,deadLettered:0});

 // Graph data loss: delete the OpenFGA store; the service detects it, creates a new store and replays PostgreSQL state.
 const before=stack.sql('select store_id from graph_store');
 assert.equal((await fetch(`${stack.urls.fga}/stores/${before}`,{method:'DELETE'})).status,204);
 // OpenFGA soft-deletes stores (checks keep answering); Hive must notice, create a new store and replay PostgreSQL state.
 let replaced=false;
 for(let i=0;i<40&&!replaced;i++){await pause(500);replaced=stack.sql('select store_id from graph_store')!==before;}
 assert.ok(replaced,'new store resolved after deletion');
 // Reactivate bob (a relational change) and expect his surviving grant to come back through replay into the new store.
 await ok(`/admin/users/${bob}`,{method:'PUT',actor:admin,body:{active:true}});
 let restored=false;
 for(let i=0;i<60&&!restored;i++){restored=(await decision(bob,'records.api','read')).allowed===true;if(!restored)await pause(500);}
 assert.ok(restored,'relationships replayed into the recreated store');
 assert.notEqual(stack.sql('select store_id from graph_store'),before);
 assert.ok((await ok('/admin/audit?eventType=graph.replayed',{actor:admin})).length>=1);
});
