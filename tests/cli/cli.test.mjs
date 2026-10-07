// CLI acceptance: version, validate, scaffolding with a real build, doctor (never PASS for unexecuted checks),
// register + doctor against a live Hive Core.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {main} from '../../cli/src/main.mjs';
import {startStack} from '../support/stack.mjs';
import {startOidcProvider} from '../support/oidc-fixture.mjs';
import {startUpstream} from '../support/upstream-fixture.mjs';
import {startGateway} from '../../tools/dev-gateway.mjs';

async function hive(args,env=process.env){const out=[],err=[];const code=await main(args,{out:s=>out.push(s),err:s=>err.push(s),env});return {code,out:out.join('\n'),err:err.join('\n')};}
const work=resolve('.local/cli');

test('version reports platform, contracts and compatibility',async()=>{
 const r=await hive(['version','--json']);assert.equal(r.code,0);
 const v=JSON.parse(r.out);assert.equal(v.platform,JSON.parse(readFileSync('package.json','utf8')).version);assert.equal(v.contracts,'1.1.0');assert.equal(v.compatibility.contractVersion,'1.1.0');
 assert.equal((await hive([])).code,2);assert.equal((await hive(['nonsense'])).code,2);
});

test('validate accepts the examples and rejects broken, tampered and inconsistent manifests',async()=>{
 const good=await hive(['validate','examples/minimal-consumer/dist/modules','examples/react-tailwind-consumer/dist/modules']);
 assert.equal(good.code,0,good.out);assert.equal(good.out.match(/^PASS/gm).length,6);assert.equal(good.out.match(/artifact SRI verified/g).length,3);
 const dir=join(work,'validate');rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true});
 cpSync('examples/minimal-consumer/dist/modules/finance-example',join(dir,'tampered'),{recursive:true});
 writeFileSync(join(dir,'tampered/entry.js'),readFileSync(join(dir,'tampered/entry.js'),'utf8')+'\n// injected');
 const tampered=await hive(['validate',join(dir,'tampered')]);assert.equal(tampered.code,1);assert.match(tampered.out,/ARTIFACT_INTEGRITY_MISMATCH/);
 mkdirSync(join(dir,'broken'),{recursive:true});
 const mf=JSON.parse(readFileSync('examples/minimal-consumer/dist/modules/finance-example/mf-manifest.json','utf8'));
 writeFileSync(join(dir,'broken/mf-manifest.json'),JSON.stringify({...mf,contractVersion:'2.0.0',resources:[],routes:[{key:'x',path:'/a/../b',access:'PUBLIC',resource:'r',action:'view'}]}));
 writeFileSync(join(dir,'broken/resource-manifest.json'),JSON.stringify({schemaVersion:'1.0.0',manifestVersion:'1.0.0',applicationKey:'app',moduleKey:'m',routes:[],
  resources:[{key:'p',type:'PAGE',parentKey:'app',name:'Page'},{key:'d',type:'MODULE',parentKey:'app',name:'Dup',actions:['manage']},{key:'d',type:'MODULE',parentKey:'app',name:'Dup'}]}));
 const broken=await hive(['validate',join(dir,'broken')]);assert.equal(broken.code,1);
 for(const code of ['VERSION_MAJOR_UNSUPPORTED','authorization field \'resources\'','path must be absolute','PUBLIC route x','frontend field \'routes\'','Duplicate resource d','cannot have a APPLICATION parent','\'manage\' is implicit'])
  assert.ok(broken.out.includes(code),`reports ${code}\n${broken.out}`);
 mkdirSync(join(dir,'mismatch'),{recursive:true});
 cpSync('examples/minimal-consumer/dist/modules/finance-example/resource-manifest.json',join(dir,'mismatch/resource-manifest.json'));
 writeFileSync(join(dir,'mismatch/mf-manifest.json'),JSON.stringify({...mf,routes:[{key:'x',path:'/x',access:'AUTHENTICATED',resource:'finance-example.payments',action:'refund'}]}));
 const mismatch=await hive(['validate',join(dir,'mismatch')]);assert.equal(mismatch.code,1);assert.match(mismatch.out,/ROUTE_RESOURCE_UNDECLARED: Route x references finance-example.payments\/refund/);
});

test('doctor never reports PASS for checks it could not run',async()=>{
 const empty=await hive(['doctor','--json'],{});
 const results=JSON.parse(empty.out);assert.ok(results.length>=10);assert.ok(results.every(r=>r.status==='NOT EXECUTED'&&r.detail),empty.out);assert.equal(empty.code,0);
 const down=await hive(['doctor','--json','--bff','http://127.0.0.1:1','--postgres','127.0.0.1:1','--redis','127.0.0.1:1'],{});
 const failed=JSON.parse(down.out).filter(r=>r.status==='FAIL').map(r=>r.check);
 assert.deepEqual(failed.sort(),['BFF readiness','Contract and runtime compatibility of active modules','PostgreSQL','Redis']);assert.equal(down.code,1);
});

test('scaffold, build, validate, register and doctor against a live Hive Core',{timeout:400000},async t=>{
 const solution=join(work,`campus-${Date.now()}`);
 assert.equal((await hive(['create','solution',solution,'--application','notes-app','--name','Notes'])).code,0);
 assert.equal((await hive(['create','solution',solution,'--application','notes-app'])).code,1,'refuses to overwrite');
 assert.equal((await hive(['add','mfe','notes-example','--solution',solution,'--route','/notes','--public'])).code,0);
 assert.equal((await hive(['add','mfe','Bad Key','--solution',solution])).code,1);
 const upstream=await startUpstream({port:30285});t.after(()=>upstream.close());
 assert.equal((await hive(['add','service','notes','--solution',solution,'--url',upstream.origin,'--prefix','/notes'])).code,0);
 const service=JSON.parse(readFileSync(join(solution,'services/notes.json'),'utf8'));service.operations=[{key:'list',method:'GET',pathPattern:'/**',access:'PUBLIC'}];
 writeFileSync(join(solution,'services/notes.json'),JSON.stringify(service));
 execFileSync(process.execPath,['build.mjs'],{cwd:solution,stdio:'pipe'});
 const validated=await hive(['validate',join(solution,'dist/modules')]);assert.equal(validated.code,0,validated.out);
 assert.equal((await hive(['upgrade','--check','--solution',solution])).code,0);

 const idp=await startOidcProvider({port:30280});t.after(()=>idp.close());
 const stack=await startStack(t,{suite:'cli',base:30200,authorizationEnv:{HIVE_TARGET_ALLOW_HTTP:'true'},bffEnv:{HIVE_PROXY_ALLOWED_ORIGINS:upstream.origin,HIVE_PROXY_ALLOW_HTTP:'true'}});
 const gateway=await startGateway({port:30290,bff:stack.urls.bff,mounts:{'/modules/':join(solution,'dist/modules')}});t.after(()=>gateway.close());
 const env={...process.env,HIVE_PROVISIONING_PASSWORD:stack.credentials.provisioning};
 const registered=await hive(['register','--solution',solution,'--authorization',stack.urls.authorization],env);assert.equal(registered.code,0,registered.err);
 assert.match(registered.out,/applied  activate notes-example@1\.0\.0/);
 const again=await hive(['register','--solution',solution,'--authorization',stack.urls.authorization],env);assert.equal(again.code,0,again.err+again.out);assert.match(again.out,/kept  application notes-app/);
 assert.equal((await hive(['register','--solution',solution,'--authorization',stack.urls.authorization],{...process.env,HIVE_PROVISIONING_PASSWORD:'wrong-password-wrong-password-0000'})).code,1);
 assert.equal((await fetch(`${stack.urls.bff}/api/routes/notes/anything`)).status,200,'registered public route works');

 const report=await hive(['doctor','--json','--bff',stack.urls.bff,'--authorization',stack.urls.authorization,'--openfga',stack.urls.fga,'--postgres',`127.0.0.1:${stack.ports.db}`,
  '--redis',`127.0.0.1:${stack.ports.redis}`,'--issuer',idp.issuer,'--origin',gateway.origin,'--manifest',join(solution,'dist/modules')],env);
 const statuses=Object.fromEntries(JSON.parse(report.out).map(r=>[r.check,r.status]));
 assert.ok(Object.values(statuses).every(s=>s==='PASS'),report.out);assert.equal(report.code,0);
 // Tampering with the served artifact is detected by doctor's remote-entry check.
 writeFileSync(join(solution,'dist/modules/notes-example/entry.js'),'export default {};');
 const tampered=JSON.parse((await hive(['doctor','--json','--bff',stack.urls.bff,'--origin',gateway.origin],env)).out);
 assert.match(tampered.find(r=>r.check.startsWith('Remote entries')).detail,/notes-example: integrity mismatch/);
});
