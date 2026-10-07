// `hive register`: applies a built solution through the control-plane admin API with the deployment's machine
// provisioning credential (HIVE_PROVISIONING_PASSWORD). Idempotent: existing objects and identical manifests are kept.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {load} from './scaffold.mjs';

export async function register(dir,{authorization,password,log=()=>{}}) {
 if(!authorization||!password)throw new Error('register needs --authorization <url> and HIVE_PROVISIONING_PASSWORD');
 const auth='Basic '+Buffer.from(`provisioner:${password}`).toString('base64');
 const call=async(method,path,body,{allow=[]}={})=>{
  const response=await fetch(authorization+path,{method,headers:{Authorization:auth,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const text=await response.text();const value=text?JSON.parse(text):null;
  if(response.status>=300&&!allow.includes(response.status))throw new Error(`${method} ${path}: ${response.status} ${value?.code??''} ${value?.message??''}`.trim());
  return {status:response.status,value};
 };
 const solution=load(dir);
 const steps=[];
 const step=(name,result)=>{steps.push({name,status:result.status});log(`${result.status<300?'applied':'kept'}  ${name}`);};
 step(`application ${solution.applicationKey}`,await call('POST','/admin/applications',{key:solution.applicationKey,displayName:solution.displayName},{allow:[409]}));
 for(const key of solution.modules){
  const dist=join(dir,'dist/modules',key);
  step(`module ${key}`,await call('POST','/admin/modules',{applicationKey:solution.applicationKey,moduleKey:key,displayName:key,definitionMode:'MANIFEST'},{allow:[409]}));
  const resources=JSON.parse(readFileSync(join(dist,'resource-manifest.json'),'utf8'));
  step(`resource manifest ${key}@${resources.manifestVersion}`,await call('POST',`/admin/modules/${key}/resource-manifests`,resources));
  const revision=(await call('GET',`/admin/modules/${key}/resource-manifests/${resources.manifestVersion}`)).value;
  if(revision.status==='DRAFT')step(`publish ${key}@${resources.manifestVersion}`,await call('POST',`/admin/modules/${key}/resource-manifests/${resources.manifestVersion}/publish`));
  const mf=JSON.parse(readFileSync(join(dist,'mf-manifest.json'),'utf8'));
  step(`artifact ${key}@${mf.manifestVersion}`,await call('POST',`/admin/modules/${key}/artifacts`,mf));
  step(`activate ${key}@${mf.manifestVersion}`,await call('POST',`/admin/modules/${key}/artifacts/${mf.manifestVersion}/activate`));
 }
 for(const key of solution.services){
  const service=JSON.parse(readFileSync(join(dir,'services',`${key}.json`),'utf8'));
  step(`service target ${service.target.key}`,await call('POST','/admin/service-targets',service.target,{allow:[409]}));
  step(`route ${service.route.key}`,await call('POST','/admin/proxy-routes',service.route,{allow:[409]}));
  for(const operation of service.operations)step(`operation ${service.route.key}.${operation.key}`,await call('POST',`/admin/proxy-routes/${service.route.key}/operations`,operation,{allow:[409]}));
 }
 return steps;
}
