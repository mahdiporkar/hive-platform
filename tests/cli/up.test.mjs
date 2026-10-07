// `hive up` / `hive down` with real images: Hive Core plus the optional UI profile, verified with `hive doctor`.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {main} from '../../cli/src/main.mjs';

async function hive(args,env=process.env){const out=[],err=[];const code=await main(args,{out:s=>out.push(s),err:s=>err.push(s),env});return {code,out:out.join('\n'),err:err.join('\n')};}

test('hive up builds and starts Hive Core with the UI profile; doctor passes; hive down removes it',{timeout:1800000},async t=>{
 const dir=resolve('.local/cli-up');rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true});
 const envFile=resolve(dir,'.env'),project=`hive-up-${Date.now()}`;
 const common=['--project',project,'--env-file',envFile];
 t.after(async()=>{await hive(['down','--volumes',...common]);});
 const up=await hive(['up','--build','--profile','ui',...common,'--http-port','30390','--bff-port','30391','--authorization-port','30392']);
 assert.equal(up.code,0,up.err);
 const env=readFileSync(envFile,'utf8');
 for(const key of ['HIVE_DB_PASSWORD','HIVE_INTERNAL_PASSWORD','HIVE_VAULT_KEY','HIVE_PROVISIONING_PASSWORD'])assert.match(env,new RegExp(`^${key}=\\S{32,}$`,'m'),`${key} generated`);
 const provisioning=/^HIVE_PROVISIONING_PASSWORD=(.+)$/m.exec(env)[1];

 const report=await hive(['doctor','--json','--bff','http://127.0.0.1:30391','--authorization','http://127.0.0.1:30392','--origin','http://127.0.0.1:30390'],{...process.env,HIVE_PROVISIONING_PASSWORD:provisioning});
 const statuses=Object.fromEntries(JSON.parse(report.out).map(r=>[r.check,r.status]));
 assert.equal(statuses['BFF readiness'],'PASS');assert.equal(statuses['Authorization service readiness'],'PASS');
 assert.equal(statuses['Authorization graph projection'],'PASS');assert.equal(statuses['Contract and runtime compatibility of active modules'],'PASS');
 assert.equal(statuses['Remote entries reachable with matching integrity'],'NOT EXECUTED','zero consumers: nothing to verify');

 // Gateway: default shell with security headers, console behind it, Hive APIs on the same origin.
 const shell=await fetch('http://127.0.0.1:30390/');assert.equal(shell.status,200);assert.match(await shell.text(),/<div id="root">/);
 assert.match(shell.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(shell.headers.get('x-content-type-options'),'nosniff');assert.equal(shell.headers.get('x-frame-options'),'DENY');
 assert.match(await (await fetch('http://127.0.0.1:30390/console/')).text(),/Hive Operator Console/);
 const context=await (await fetch('http://127.0.0.1:30390/api/public/context')).json();
 assert.deepEqual([context.applications,context.modules],[[],[]],'fresh installation has zero consumer applications');
 assert.equal((await fetch('http://127.0.0.1:30390/api/admin/applications')).status,401);
 assert.equal((await fetch('http://127.0.0.1:30390/actuator/env')).status,404,'only readiness is exposed through the gateway');

 // Containers run as non-root.
 const uid=service=>execFileSync('docker',['compose','-p',project,'-f','infra/docker-compose/hive.yml','--env-file',envFile,'exec','-T',service,'id','-u'],{encoding:'utf8'}).trim();
 assert.notEqual(uid('authorization'),'0');assert.notEqual(uid('bff'),'0');

 const down=await hive(['down','--volumes',...common]);assert.equal(down.code,0,down.err);
 assert.equal(execFileSync('docker',['ps','-q','--filter',`label=com.docker.compose.project=${project}`],{encoding:'utf8'}).trim(),'','no containers left');
});
