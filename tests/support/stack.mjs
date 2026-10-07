// Shared harness for integration and E2E suites: isolated Compose dependencies plus Java services as host processes.
// Every suite gets its own Compose project, random credentials and port block; logs land in ignored .local/<suite>/.
import {spawn,execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdirSync,openSync,closeSync} from 'node:fs';
import {resolve} from 'node:path';

export const pause=ms=>new Promise(r=>setTimeout(r,ms));
export const secret=(bytes=24)=>randomBytes(bytes).toString('hex');

export async function ready(url,{attempts=150,log}={}) {
 // A fetch stalled on Docker's port proxy holds no referenced handle; keep the event loop alive while polling.
 const keepAlive=setInterval(()=>{},1000);
 try{
  for(let n=0;n<attempts;n++){try{if((await fetch(url,{signal:AbortSignal.timeout(1500)})).ok)return;}catch{}await pause(400);}
  throw new Error(`Readiness deadline exceeded: ${url}${log?'; inspect '+log:''}`);
 }finally{clearInterval(keepAlive);}
}

/**
 * Starts PostgreSQL, OpenFGA and Redis through Compose and optionally the authorization service and BFF.
 * Ports: base+0 Postgres, +1 OpenFGA, +2 Redis, +3 authorization, +4 BFF.
 */
export async function startStack(t,{suite,base,authorization=true,bff=true,authorizationEnv={},bffEnv={},beforeBff}) {
 const ports={db:base,fga:base+1,redis:base+2,authorization:base+3,bff:base+4};
 const credentials={db:secret(),graph:secret(),redis:secret(),internal:secret(),provisioning:secret(),vault:randomBytes(32).toString('base64')};
 const project=`hive-${suite}-${Date.now()}`;
 const composeEnv={...process.env,HIVE_DB_PASSWORD:credentials.db,HIVE_GRAPH_PASSWORD:credentials.graph,HIVE_REDIS_PASSWORD:credentials.redis,HIVE_DB_PORT:String(ports.db),HIVE_FGA_PORT:String(ports.fga),HIVE_REDIS_PORT:String(ports.redis)};
 const compose=(...args)=>execFileSync('docker',['compose','-p',project,'-f','infra/docker-compose/compose.yml',...args],{env:composeEnv,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:180000});
 const logDir=`.local/${suite}`;mkdirSync(logDir,{recursive:true});
 const children=[],fds=[];
 const stack={ports,credentials,compose,logDir,
  urls:{fga:`http://127.0.0.1:${ports.fga}`,authorization:`http://127.0.0.1:${ports.authorization}`,bff:`http://127.0.0.1:${ports.bff}`},
  sql:statement=>compose('exec','-T','postgres','psql','-U','hive','-d','hive','-At','-c',statement).trim(),
  redis:(...args)=>compose('exec','-T','-e',`REDISCLI_AUTH=${credentials.redis}`,'redis','redis-cli','--raw',...args).trim(),
  java(service,env){
   const fd=openSync(`${logDir}/${service}.log`,'w');fds.push(fd);
   const child=spawn('java',['-jar',resolve(`services/${service}/target/${service}-0.1.0-SNAPSHOT.jar`)],{windowsHide:true,stdio:['ignore',fd,fd],env:{...process.env,...env}});
   children.push(child);return child;
  },
  async stop(child){child.kill();await new Promise(r=>{if(child.exitCode!==null)return r();child.once('exit',r);setTimeout(r,5000).unref();});},
 };
 t.after(async()=>{
  for(const child of children.reverse())await stack.stop(child);
  for(const fd of fds)closeSync(fd);
  try{compose('down','--volumes','--remove-orphans');}catch(error){console.error('compose down failed',error.message);}
 });
 compose('up','-d','--wait','postgres','graph-db','redis');
 compose('up','-d','openfga');
 await ready(stack.urls.fga+'/healthz');
 stack.authorizationEnv={
  HIVE_PROFILE:'development',HIVE_AUTHORIZATION_PORT:String(ports.authorization),HIVE_DB_URL:`jdbc:postgresql://127.0.0.1:${ports.db}/hive`,HIVE_DB_USER:'hive',HIVE_DB_PASSWORD:credentials.db,
  HIVE_OPENFGA_URL:stack.urls.fga,HIVE_INTERNAL_PASSWORD:credentials.internal,HIVE_PROVISIONING_PASSWORD:credentials.provisioning,
  HIVE_REDIS_HOST:'127.0.0.1',HIVE_REDIS_PORT:String(ports.redis),HIVE_REDIS_PASSWORD:credentials.redis,...authorizationEnv};
 if(authorization){
  stack.authorizationProcess=stack.java('authorization',stack.authorizationEnv);
  await ready(stack.urls.authorization+'/actuator/health/readiness',{log:`${logDir}/authorization.log`});
 }
 stack.bffEnv={
  HIVE_PROFILE:'development',HIVE_BFF_PORT:String(ports.bff),HIVE_AUTHORIZATION_URL:stack.urls.authorization,HIVE_INTERNAL_PASSWORD:credentials.internal,HIVE_CONTROL_ALLOW_HTTP:'true',
  HIVE_REDIS_HOST:'127.0.0.1',HIVE_REDIS_PORT:String(ports.redis),HIVE_REDIS_PASSWORD:credentials.redis,HIVE_VAULT_KEY:credentials.vault,...bffEnv};
 if(bff){
  if(beforeBff)await beforeBff();
  stack.bffProcess=stack.java('bff',stack.bffEnv);
  await ready(stack.urls.bff+'/actuator/health/readiness',{log:`${logDir}/bff.log`});
 }
 /** Machine-authenticated call to the authorization service (provisioner or bff runtime principal). */
 stack.service=async(path,{method='GET',body,principal='provisioner',headers={}}={})=>fetch(stack.urls.authorization+path,{method,headers:{'Content-Type':'application/json',
  ...(principal?{Authorization:'Basic '+Buffer.from(`${principal}:${principal==='bff'?credentials.internal:credentials.provisioning}`).toString('base64')}:{}),...headers},
  ...(body===undefined?{}:{body:JSON.stringify(body)})});
 return stack;
}

/** Minimal manual cookie jar for HTTP-level tests that do not need a browser. */
export function cookieClient(origin) {
 const jar=new Map();
 const client=async(path,options={})=>{
  const cookie=[...jar].map(([k,v])=>`${k}=${v}`).join('; ');
  const response=await fetch(new URL(path,origin),{...options,redirect:'manual',headers:{...(cookie?{Cookie:cookie}:{}),...options.headers}});
  for(const value of response.headers.getSetCookie()){const [pair]=value.split(';');const i=pair.indexOf('=');const name=pair.slice(0,i),v=pair.slice(i+1);if(/Max-Age=0/i.test(value)||v==='')jar.delete(name);else jar.set(name,v);}
  return response;
 };
 client.jar=jar;
 client.csrf=async()=>{const token=await(await client('/auth/csrf')).json();return {[token.headerName]:token.token};};
 return client;
}
