// `hive doctor`: real diagnostics only. A check that cannot run is reported NOT EXECUTED with its reason — never PASS.
import {createHash} from 'node:crypto';
import {connect} from 'node:net';
import {checkCompatibility} from '@hive-platform/contracts';
import {validatePaths} from './validate.mjs';

const TIMEOUT=4000;

async function http(url,init={}) {
 const response=await fetch(url,{...init,signal:AbortSignal.timeout(TIMEOUT),redirect:'manual'});
 return response;
}

/** Opens a TCP connection, writes `probe` and resolves with the first bytes received. */
function tcpProbe(target,probe) {
 const [host,port]=target.split(':');
 return new Promise((resolve,reject)=>{
  const socket=connect({host,port:Number(port)});
  const timer=setTimeout(()=>{socket.destroy();reject(new Error('timed out'));},TIMEOUT);
  socket.once('connect',()=>socket.write(probe));
  socket.once('data',data=>{clearTimeout(timer);socket.destroy();resolve(data);});
  socket.once('error',error=>{clearTimeout(timer);reject(error);});
 });
}

const checks={
 async 'BFF readiness'(o){if(!o.bff)return skip('--bff / HIVE_BFF_URL not set');const r=await http(`${o.bff}/actuator/health/readiness`);return r.status===200?pass(`${o.bff} ready`):fail(`readiness HTTP ${r.status}`);},
 async 'Authorization service readiness'(o){if(!o.authorization)return skip('--authorization / HIVE_AUTHORIZATION_URL not set');const r=await http(`${o.authorization}/actuator/health/readiness`);return r.status===200?pass('ready (database, authorization graph)'):fail(`readiness HTTP ${r.status}`);},
 async 'OpenFGA'(o){if(!o.openfga)return skip('--openfga / HIVE_OPENFGA_URL not set');const r=await http(`${o.openfga}/healthz`);return r.status===200?pass('healthz OK'):fail(`healthz HTTP ${r.status}`);},
 async 'PostgreSQL'(o){
  if(!o.postgres)return skip('--postgres host:port not set');
  // SSLRequest: a PostgreSQL server answers with a single 'S' or 'N'; anything else is not PostgreSQL.
  const answer=await tcpProbe(o.postgres,Buffer.from([0,0,0,8,4,210,22,47]));
  return answer.length>=1&&(answer[0]===0x53||answer[0]===0x4e)?pass(`${o.postgres} speaks the PostgreSQL protocol`):fail('unexpected response to SSLRequest');
 },
 async 'Redis'(o){
  if(!o.redis)return skip('--redis host:port not set');
  const answer=(await tcpProbe(o.redis,'PING\r\n')).toString();
  return answer.startsWith('+PONG')||answer.startsWith('-NOAUTH')?pass(answer.startsWith('-NOAUTH')?'reachable (authentication required)':'PONG'):fail(`unexpected reply ${JSON.stringify(answer.slice(0,40))}`);
 },
 async 'Identity provider'(o){
  if(!o.issuer)return skip('--issuer / HIVE_OIDC_ISSUER not set');
  const r=await http(`${o.issuer.replace(/\/$/,'')}/.well-known/openid-configuration`);if(r.status!==200)return fail(`discovery HTTP ${r.status}`);
  const d=await r.json();return d.issuer===o.issuer.replace(/\/$/,'')||d.issuer===o.issuer?pass(`issuer ${d.issuer}`):fail(`discovery issuer ${d.issuer} differs from ${o.issuer}`);
 },
 async 'Contract and runtime compatibility of active modules'(o,state){
  if(!o.bff)return skip('--bff not set');
  const r=await http(`${o.bff}/api/public/context`);if(r.status!==200)return fail(`public context HTTP ${r.status}`);
  const context=await r.json();state.context=context;
  const problems=[];for(const module of context.modules){try{checkCompatibility(module);}catch(e){problems.push(`${module.moduleKey}: ${e.message}`);}}
  return problems.length?fail(problems.join('; ')):pass(`${context.modules.length} public module(s) compatible; context ${context.contractVersion}`);
 },
 async 'Remote entries reachable with matching integrity'(o,state){
  const origin=o.origin??o.bff;
  if(!origin)return skip('--origin (public gateway) or --bff not set');
  if(!state.context)return skip('public context unavailable');
  if(state.context.modules.length===0)return skip('no active public modules');
  const problems=[];
  for(const module of state.context.modules){
   const url=new URL(module.artifact.url,origin).href;
   try{
    const r=await http(url);if(r.status!==200){problems.push(`${module.moduleKey}: HTTP ${r.status}`);continue;}
    const [algorithm,expected]=module.artifact.integrity.split('-');
    const actual=createHash(algorithm).update(Buffer.from(await r.arrayBuffer())).digest('base64');
    if(actual!==expected)problems.push(`${module.moduleKey}: integrity mismatch`);
   }catch(e){problems.push(`${module.moduleKey}: ${e.cause?.code??e.message}`);}
  }
  return problems.length?fail(problems.join('; ')):pass(`${state.context.modules.length} artifact(s) verified`);
 },
 async 'Authorization graph projection'(o){
  if(!o.authorization||!o.provisioningPassword)return skip('needs --authorization and HIVE_PROVISIONING_PASSWORD');
  const r=await http(`${o.authorization}/admin/diagnostics/graph`,{headers:{Authorization:'Basic '+Buffer.from('provisioner:'+o.provisioningPassword).toString('base64')}});
  if(r.status!==200)return fail(`diagnostics HTTP ${r.status}`);
  const g=await r.json();return g.ready&&g.deadLettered===0?pass(`ready; pending ${g.pending}; dead-lettered 0`):fail(`ready=${g.ready}; dead-lettered ${g.deadLettered}`);
 },
 async 'Route configuration'(o){
  if(!o.authorization||!o.provisioningPassword)return skip('needs --authorization and HIVE_PROVISIONING_PASSWORD');
  const headers={Authorization:'Basic '+Buffer.from('provisioner:'+o.provisioningPassword).toString('base64')};
  const routes=await (await http(`${o.authorization}/admin/proxy-routes`,{headers})).json();
  const problems=[];
  for(const route of routes.filter(r=>!r.archived)){
   const operations=await (await http(`${o.authorization}/admin/proxy-routes/${route.key}/operations`,{headers})).json();
   if(!operations.some(op=>!op.archived))problems.push(`${route.key}: no active operations (every request would be denied)`);
  }
  return problems.length?fail(problems.join('; ')):pass(`${routes.length} route(s) have active operations`);
 },
 async 'Manifest validity'(o){
  if(!o.manifests?.length)return skip('--manifest <path> not given');
  const results=validatePaths(o.manifests);const bad=results.filter(r=>r.errors.length);
  return bad.length?fail(bad.map(r=>`${r.file}: ${r.errors[0].code}`).join('; ')):pass(`${results.length} manifest(s) valid`);
 },
};

const pass=detail=>({status:'PASS',detail}),fail=detail=>({status:'FAIL',detail}),skip=detail=>({status:'NOT EXECUTED',detail});

export async function doctor(options) {
 const state={},results=[];
 for(const [name,check] of Object.entries(checks)){
  try{results.push({check:name,...await check(options,state)});}
  catch(error){results.push({check:name,status:'FAIL',detail:error.cause?.code??error.code??error.message});}
 }
 return results;
}
