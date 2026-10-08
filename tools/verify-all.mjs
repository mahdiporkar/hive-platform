// Runs the complete verification suite in order and writes .local/verification.json + a summary table.
// Every check is reported PASS or FAIL with its duration; checks not run are reported NOT EXECUTED with a reason.
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

const npm=process.platform==='win32'?'npm.cmd':'npm';
const steps=[
 ['npm clean install',[npm,'ci','--no-audit','--no-fund']],
 ['npm build',[npm,'run','build']],
 ['typecheck',[npm,'run','typecheck']],
 ['npm tests (architecture, contracts, packages)',[npm,'test']],
 ['Maven verify',[process.platform==='win32'?resolve('mvnw.cmd'):'./mvnw','-B','verify']],
 ['build examples',[npm,'run','build:examples']],
 ['build default shell',[npm,'run','build:shell']],
 ['build operator console',[npm,'run','build:console']],
 ['OpenFGA model (DSL = JSON)',[npm,'run','test:model']],
 ['fresh DB, Flyway, OpenFGA bootstrap, health',[npm,'run','test:bootstrap']],
 ['identity (OIDC, session, vault, providers)',[npm,'run','test:identity']],
 ['Keycloak interoperability',[npm,'run','test:keycloak']],
 ['authorization control plane',[npm,'run','test:authorization']],
 ['manifest governance',[npm,'run','test:manifests']],
 ['dynamic routing (forward token, legacy)',[npm,'run','test:routing']],
 ['request bodies (multipart, forms, JSON, raw)',[npm,'run','test:multipart']],
 ['Superset integration',[npm,'run','test:superset']],
 ['production hardening',[npm,'run','test:hardening']],
 ['E2E MFE runtime',[npm,'run','test:e2e:mfe']],
 ['E2E workspace',[npm,'run','test:e2e:workspace']],
 ['E2E operator console',[npm,'run','test:e2e:console']],
 ['E2E API-only administration',[npm,'run','test:e2e:api-admin']],
 ['E2E public / hybrid / authenticated',[npm,'run','test:e2e:public-hybrid']],
 ['E2E golden path',[npm,'run','test:e2e:golden']],
 ['E2E browser multipart upload',[npm,'run','test:e2e:multipart']],
 ['CLI',[npm,'run','test:cli']],
 ['CLI up/down with images',[npm,'run','test:cli:up']],
 ['Docker Compose config validation',[npm,'run','verify:compose']],
 ['branding, domain leakage and forbidden dependency scans',[npm,'run','test:architecture']],
 ['log secrecy scan',[npm,'run','test:log-scan']],
];
const only=process.argv.slice(2);
const results=[];
for(const [name,[command,...args]] of steps){
 if(only.length&&!only.some(o=>name.toLowerCase().includes(o.toLowerCase()))){results.push({name,status:'NOT EXECUTED',detail:'filtered out by command-line selection',seconds:0});continue;}
 const started=Date.now();
 const run=spawnSync(command,args,{encoding:'utf8',shell:process.platform==='win32',maxBuffer:256*1024*1024,timeout:3600000});
 const output=(run.stdout??'')+(run.stderr??'');
 const tail=output.split('\n').filter(l=>/^# (pass|fail)|Tests run:.*Fail|BUILD|error/i.test(l)).slice(-4).join(' | ');
 results.push({name,status:run.status===0?'PASS':'FAIL',detail:run.error?String(run.error):tail.slice(0,300),seconds:Math.round((Date.now()-started)/1000)});
 console.log(`${results.at(-1).status.padEnd(12)} ${name} (${results.at(-1).seconds}s) ${results.at(-1).status==='FAIL'?results.at(-1).detail:''}`);
}
mkdirSync('.local',{recursive:true});
writeFileSync('.local/verification.json',JSON.stringify({at:new Date().toISOString(),results},null,2));
process.exitCode=results.some(r=>r.status==='FAIL')?1:0;
