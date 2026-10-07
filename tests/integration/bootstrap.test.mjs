import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdirSync,openSync,closeSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {authorizationModel} from '../../tools/openfga-model.mjs';
const project=`hive-test-${Date.now()}`;
const internalSecret=randomBytes(24).toString('hex');
const env={...process.env,HIVE_REDIS_PASSWORD:randomBytes(24).toString('hex'),HIVE_DB_PASSWORD:randomBytes(24).toString('hex'),HIVE_GRAPH_PASSWORD:randomBytes(24).toString('hex'),HIVE_DB_PORT:'25432',HIVE_FGA_PORT:'28080'};
const compose=(...args)=>execFileSync('docker',['compose','-p',project,'-f','infra/docker-compose/compose.yml',...args],{env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function healthy(url) {
 for(let attempt=0;attempt<90;attempt++) {
  try { const result=await fetch(url,{signal:AbortSignal.timeout(1500)}); if(result.ok)return; } catch {}
  await delay(500);
 }
 throw new Error(`Readiness deadline exceeded: ${url}; inspect .local/bootstrap logs`);
}
async function json(url,body) {
 const result=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
 assert.equal(result.ok,true,`HTTP ${result.status}: ${await result.clone().text()}`);
 return result.json();
}
test('fresh zero-consumer Core: Flyway, durable OpenFGA, BFF and authorization readiness', {timeout:240000}, async t => {
 const processes=[],logs=[];
 mkdirSync('.local/bootstrap',{recursive:true});
 t.after(async()=>{
  for(const child of processes) { child.kill(); await new Promise(r=>{ if(child.exitCode!==null)return r(); child.once('exit',r); setTimeout(r,5000).unref(); }); }
  for(const fd of logs)closeSync(fd);
  compose('down','--volumes','--remove-orphans');
 });
 compose('config','--quiet');
 compose('up','-d','--wait','postgres','graph-db');
 compose('up','-d','openfga');
 await healthy('http://127.0.0.1:28080/healthz');
 const store=await json('http://127.0.0.1:28080/stores',{name:'hive-bootstrap'});
 const model=await json(`http://127.0.0.1:28080/stores/${store.id}/authorization-models`,authorizationModel());
 const denied=await json(`http://127.0.0.1:28080/stores/${store.id}/check`,{authorization_model_id:model.authorization_model_id,tuple_key:{user:'user:unknown',relation:'allowed',object:'action:unregistered.view'}});
 assert.equal(denied.allowed,false);
 compose('restart','openfga');
 await healthy('http://127.0.0.1:28080/healthz');
 const retained=await fetch(`http://127.0.0.1:28080/stores/${store.id}/authorization-models/${model.authorization_model_id}`);
 assert.equal(retained.status,200,'model survives OpenFGA restart');
 for(const [service,port] of [['authorization','28082'],['bff','28081']]) {
  const fd=openSync(`.local/bootstrap/${service}.log`,'w');logs.push(fd);
  const child=spawn('java',['-jar',resolve(`services/${service}/target/${service}-0.1.0-SNAPSHOT.jar`)],{windowsHide:true,stdio:['ignore',fd,fd],env:{...env,HIVE_PROFILE:'development',HIVE_AUTHORIZATION_PORT:'28082',HIVE_BFF_PORT:'28081',HIVE_DB_URL:'jdbc:postgresql://127.0.0.1:25432/hive',HIVE_DB_USER:'hive',HIVE_OPENFGA_URL:'http://127.0.0.1:28080',HIVE_AUTHORIZATION_URL:'http://127.0.0.1:28082',HIVE_CONTROL_ALLOW_HTTP:'true',HIVE_INTERNAL_PASSWORD:internalSecret}});
  processes.push(child);
  await healthy(`http://127.0.0.1:${port}/actuator/health/readiness`);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/admin/applications`)).status,401);
 }
 const sql=statement=>compose('exec','-T','postgres','psql','-U','hive','-d','hive','-At','-c',statement).trim();
 // Every packaged migration applied, in order, from an empty database.
 const migrations=readdirSync('services/authorization/src/main/resources/db/migration').map(f=>/^V(\d+)__/.exec(f)?.[1]).filter(Boolean).sort((a,b)=>a-b).join(',');
 assert.equal(sql("select string_agg(version,',' order by installed_rank) from flyway_schema_history where success"),migrations);
 // Zero-consumer core: every table is empty except the graph store binding (runtime infrastructure, not business data).
 const tables=sql("select string_agg(table_name,',') from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and table_name not in ('flyway_schema_history','graph_store')").split(',');
 assert.ok(tables.length>=25,'schema present');
 for(const table of tables)assert.equal(sql(`select count(*) from ${table}`),'0',table);
 assert.equal(sql('select count(*) from graph_store'),'1');
 compose('stop','openfga');
 const down=await fetch('http://127.0.0.1:28082/actuator/health/readiness');
 assert.equal(down.status,503,'readiness reflects actual unavailable graph dependency');
 assert.equal((await fetch('http://127.0.0.1:28082/actuator/health/liveness')).status,200);
});