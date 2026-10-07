// hive — command dispatcher.
import {readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compatibilityMatrix} from '@hive-platform/contracts';
import {validatePaths} from './validate.mjs';
import {doctor} from './doctor.mjs';
import {addMicroApp,addService,createSolution,load} from './scaffold.mjs';
import {register} from './register.mjs';
import {compose,ensureEnv} from './compose.mjs';

const cliRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const repoRoot=resolve(cliRoot,'..');
const pkg=path=>JSON.parse(readFileSync(path,'utf8'));

function parse(argv) {
 const positional=[],flags={};
 for(let i=0;i<argv.length;i++){
  const arg=argv[i];
  if(arg.startsWith('--')){const [key,inline]=arg.slice(2).split('=');const next=argv[i+1];
   if(inline!==undefined)flags[key]=inline;else if(next!==undefined&&!next.startsWith('--')){flags[key]=next;i++;}else flags[key]=true;
   if(key==='manifest'){flags.manifests=[...(flags.manifests??[]),flags[key]];}}
  else positional.push(arg);
 }
 return {positional,flags};
}

const HELP=`Usage: hive <command>

  version                               Platform, contracts and compatibility versions
  validate <file|dir>...                Validate resource and micro-frontend manifests (offline; verifies SRI of built artifacts)
  doctor [--bff url] [--authorization url] [--openfga url] [--postgres host:port] [--redis host:port]
         [--issuer url] [--origin url] [--manifest path] [--json]
                                        Run real diagnostics (PASS / FAIL / NOT EXECUTED)
  up [--profile ui] [--build] [--env-file f] [--http-port n] [--bff-port n] [--authorization-port n]
                                        Start Hive Core with Docker Compose (generates local secrets on first run)
  down [--volumes] [--env-file f]       Stop Hive Core
  create solution <dir> --application <key> [--name text]
  add mfe <moduleKey> [--solution dir] [--route /path] [--public]
  add service <key> --url <baseUrl> --prefix </path> [--solution dir] [--auth FORWARD_TOKEN|NONE]
  register [--solution dir] --authorization <url>   Apply a built solution (uses HIVE_PROVISIONING_PASSWORD)
  upgrade --check [--solution dir]      Check a solution's manifests against this CLI's platform line
`;

export async function main(argv,{out=s=>process.stdout.write(s+'\n'),err=s=>process.stderr.write(s+'\n'),env=process.env}={}) {
 const {positional:[command,...rest],flags}=parse(argv);
 try{
  switch(command){
   case 'version':{
    const platform=pkg(join(repoRoot,'package.json')).version, cli=pkg(join(cliRoot,'package.json')).version, contracts=pkg(join(repoRoot,'packages/contracts/package.json')).version;
    if(flags.json)out(JSON.stringify({platform,cli,contracts,compatibility:compatibilityMatrix}));
    else out(`hive ${cli}\nplatform ${platform}\ncontracts ${contracts}\ncompatibility contract ${compatibilityMatrix.contractVersion} (1.0.x deprecated), schema ${compatibilityMatrix.schemaVersion}, runtime ${compatibilityMatrix.runtimeVersion}, manifest content: any SemVer`);
    return 0;
   }
   case 'validate':{
    if(rest.length===0){err('validate needs at least one manifest file or directory');return 2;}
    const results=validatePaths(rest);
    if(results.length===0){err('no manifest files found');return 1;}
    for(const r of results){
     out(`${r.errors.length?'FAIL':'PASS'}  ${r.kind.padEnd(14)} ${r.file}${r.artifactChecked?' (artifact SRI verified)':''}`);
     for(const e of r.errors)out(`      error   ${e.code}: ${e.message}`);
     for(const w of r.warnings)out(`      warning ${w.code}: ${w.message}`);
    }
    return results.some(r=>r.errors.length)?1:0;
   }
   case 'doctor':{
    const options={bff:flags.bff??env.HIVE_BFF_URL,authorization:flags.authorization??env.HIVE_AUTHORIZATION_URL,openfga:flags.openfga??env.HIVE_OPENFGA_URL,
     postgres:flags.postgres??env.HIVE_POSTGRES_ADDRESS,redis:flags.redis??env.HIVE_REDIS_ADDRESS,issuer:flags.issuer??env.HIVE_OIDC_ISSUER,origin:flags.origin??env.HIVE_PUBLIC_ORIGIN,
     manifests:flags.manifests,provisioningPassword:env.HIVE_PROVISIONING_PASSWORD};
    const results=await doctor(options);
    if(flags.json)out(JSON.stringify(results));
    else for(const r of results)out(`${r.status.padEnd(13)} ${r.check} — ${r.detail}`);
    return results.some(r=>r.status==='FAIL')?1:0;
   }
   case 'up':{
    const envFile=resolve(flags['env-file']??join(repoRoot,'infra/docker-compose/.env'));
    const ports=Object.fromEntries([['http-port','HIVE_HTTP_PORT'],['bff-port','HIVE_BFF_PORT'],['authorization-port','HIVE_AUTHORIZATION_PORT']].filter(([flag])=>flags[flag]).map(([flag,name])=>[name,String(flags[flag])]));
    ensureEnv(envFile,ports);
    const profiles=flags.profile?[flags.profile]:[];
    if(flags.build)out(compose(repoRoot,['build'],{profiles,project:flags.project??'hive',envFile}));
    compose(repoRoot,['up','-d','--wait'],{profiles,project:flags.project??'hive',envFile});
    out(`Hive is up (project ${flags.project??'hive'}). Run "hive doctor" to verify.`);
    return 0;
   }
   case 'down':{
    const envFile=resolve(flags['env-file']??join(repoRoot,'infra/docker-compose/.env'));
    compose(repoRoot,['down','--remove-orphans',...(flags.volumes?['--volumes']:[])],{profiles:['ui'],project:flags.project??'hive',envFile});
    out('Hive is down.');return 0;
   }
   case 'create':{
    if(rest[0]!=='solution'||!rest[1]||!flags.application){err('usage: hive create solution <dir> --application <key>');return 2;}
    createSolution(resolve(rest[1]),{applicationKey:flags.application,displayName:typeof flags.name==='string'?flags.name:undefined});
    out(`Created solution ${flags.application} in ${rest[1]}`);return 0;
   }
   case 'add':{
    const dir=resolve(flags.solution??'.');
    if(rest[0]==='mfe'&&rest[1]){const r=addMicroApp(dir,{moduleKey:rest[1],route:flags.route,publicRoute:Boolean(flags.public)});out(`Added micro-app ${r.moduleKey} at ${r.path}`);return 0;}
    if(rest[0]==='service'&&rest[1]){addService(dir,{key:rest[1],url:flags.url,prefix:flags.prefix,authentication:flags.auth});out(`Added service ${rest[1]}`);return 0;}
    err('usage: hive add mfe <key> | hive add service <key> --url <baseUrl> --prefix </path>');return 2;
   }
   case 'register':{
    const steps=await register(resolve(flags.solution??'.'),{authorization:flags.authorization??env.HIVE_AUTHORIZATION_URL,password:env.HIVE_PROVISIONING_PASSWORD,log:out});
    out(`Registered ${steps.length} step(s).`);return 0;
   }
   case 'upgrade':{
    if(!flags.check){err('Only "hive upgrade --check" is available: it reports compatibility; it never rewrites a solution.');return 2;}
    const dir=resolve(flags.solution??'.');const solution=load(dir);
    const results=validatePaths(solution.modules.map(m=>join(dir,'modules',m,'manifests')));
    for(const r of results)out(`${r.errors.length?'INCOMPATIBLE':'COMPATIBLE'}  ${r.file}${r.errors.length?' — '+r.errors.map(e=>e.code).join(', '):''}`);
    return results.some(r=>r.errors.some(e=>e.code.startsWith('VERSION_')))?1:0;
   }
   case undefined: case 'help': case '--help':out(HELP);return command===undefined?2:0;
   default:err(`Unknown command ${command}\n\n${HELP}`);return 2;
  }
 }catch(error){err(`hive ${command}: ${error.message}`);return 1;}
}
