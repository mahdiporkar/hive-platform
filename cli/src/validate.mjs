// Offline manifest validation, mirroring the control plane's rules (services/authorization ManifestDocuments,
// ResourceCatalog) so solution teams can fail fast in CI. The server remains authoritative.
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,statSync,readdirSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {checkCompatibility,CompatibilityError,parseVersion} from '@hive-platform/contracts';

const FRONTEND_FIELDS=['routes','route','path','artifact','remoteEntry','remoteEntryUrl','component','navigation','menu','menus','icon','url','integrity','exposedModule','contractVersion','runtimeVersion'];
const AUTHORIZATION_FIELDS=['resources','grants','permissions','roles'];
const TYPES=['MODULE','PAGE','UI_COMPONENT','FIELD','BUSINESS_RESOURCE','EXTERNAL_RESOURCE','API_RESOURCE','DATA_RESOURCE','DATA_GOVERNANCE_RESOURCE'];
const PARENTS={MODULE:['APPLICATION','MODULE'],PAGE:['MODULE','PAGE'],UI_COMPONENT:['PAGE','UI_COMPONENT'],FIELD:['PAGE','UI_COMPONENT','DATA_RESOURCE','BUSINESS_RESOURCE'],
 BUSINESS_RESOURCE:['APPLICATION','MODULE','BUSINESS_RESOURCE'],EXTERNAL_RESOURCE:['APPLICATION','MODULE','EXTERNAL_RESOURCE'],API_RESOURCE:['APPLICATION','MODULE','API_RESOURCE'],
 DATA_RESOURCE:['APPLICATION','MODULE','BUSINESS_RESOURCE','DATA_RESOURCE'],DATA_GOVERNANCE_RESOURCE:['APPLICATION','DATA_RESOURCE','DATA_GOVERNANCE_RESOURCE']};
const KEY=/^[a-z][a-z0-9._-]{0,159}$/,ACTION=/^[a-z][a-z0-9_-]{0,79}$/,APP=/^[a-z][a-z0-9-]{1,79}$/,ROUTE_KEY=/^[a-z][a-z0-9-]{0,79}$/;
const ROUTE_PATH=/^\/(?:(?:[A-Za-z0-9._~-]+|:[a-zA-Z][a-zA-Z0-9]*)(?:\/(?:[A-Za-z0-9._~-]+|:[a-zA-Z][a-zA-Z0-9]*))*(?:\/\*)?)?$/;
const SRI=/^sha(256|384|512)-[A-Za-z0-9+/]+={0,2}$/;

/** @returns {{kind:'RESOURCE'|'MICRO_FRONTEND'|'UNKNOWN', errors:{code:string,message:string}[], warnings:{code:string,message:string}[], document:any}} */
export function validateDocument(document,{artifactFile}={}) {
 const errors=[],warnings=[];
 const error=(code,message)=>errors.push({code,message});
 if(!document||typeof document!=='object'||Array.isArray(document))return {kind:'UNKNOWN',errors:[{code:'MANIFEST_INVALID',message:'Manifest must be a JSON object'}],warnings,document};
 const kind=Array.isArray(document.resources)&&!('artifact' in document)?'RESOURCE':'artifact' in document||'routes' in document?'MICRO_FRONTEND':'UNKNOWN';
 if(kind==='UNKNOWN'){error('MANIFEST_KIND_UNKNOWN','Neither a resource manifest (resources) nor a micro-frontend manifest (artifact, routes)');return {kind,errors,warnings,document};}
 const version=(field,check)=>{try{check();}catch(e){error(e instanceof CompatibilityError?e.diagnostic.code:'VERSION_INVALID',e.message);}};
 for(const field of ['applicationKey','moduleKey'])if(typeof document[field]!=='string'||!APP.test(document[field]))error('MANIFEST_INVALID',`${field} must match ${APP}`);
 if(kind==='RESOURCE'){
  for(const field of FRONTEND_FIELDS)if(field in document)error('MANIFEST_INVALID',`Resource manifest must not contain frontend field '${field}'`);
  version('schemaVersion',()=>{const [major,minor]=parseVersion(document.schemaVersion,'schemaVersion');if(major!==1)throw new CompatibilityError({code:'VERSION_MAJOR_UNSUPPORTED',message:`schemaVersion: supported major 1, received ${major}`,severity:'ERROR',component:'cli'});if(minor>0)throw new CompatibilityError({code:'VERSION_MINOR_UNSUPPORTED',message:`schemaVersion: supported through 1.0.x, received ${document.schemaVersion}`,severity:'ERROR',component:'cli'});});
  version('manifestVersion',()=>parseVersion(document.manifestVersion,'manifestVersion'));
  const resources=document.resources;
  if(resources.length===0||resources.length>2000)error('MANIFEST_INVALID','resources must contain 1..2000 entries');
  const byKey=new Map();
  for(const r of resources){
   if(!r||typeof r!=='object'){error('MANIFEST_INVALID','resource entries must be objects');continue;}
   for(const field of FRONTEND_FIELDS)if(field in r)error('MANIFEST_INVALID',`Resource ${r.key} must not contain frontend field '${field}'`);
   if(typeof r.key!=='string'||!KEY.test(r.key)){error('MANIFEST_INVALID',`Resource key ${r.key} must match ${KEY}`);continue;}
   if(byKey.has(r.key))error('MANIFEST_INVALID',`Duplicate resource ${r.key}`);
   byKey.set(r.key,r);
   if(!TYPES.includes(r.type))error('MANIFEST_INVALID',`Resource ${r.key} has invalid type ${r.type}${r.type==='APPLICATION'?' (APPLICATION nodes belong to the application)':''}`);
   if(typeof r.name!=='string'||!r.name.trim()||r.name.length>255)error('MANIFEST_INVALID',`Resource ${r.key} requires a name`);
   if(typeof r.parentKey!=='string')error('MANIFEST_INVALID',`Resource ${r.key} requires parentKey`);
   const actions=(r.actions??[]).map(a=>typeof a==='string'?a:a?.key);
   if(actions.length>50)error('MANIFEST_INVALID',`Resource ${r.key} declares more than 50 actions`);
   for(const a of actions){if(typeof a!=='string'||!ACTION.test(a))error('MANIFEST_INVALID',`Resource ${r.key} action ${a} must match ${ACTION}`);if(a==='manage')error('MANIFEST_INVALID',`'manage' is implicit on ${r.key}`);}
   if(new Set(actions).size!==actions.length)error('MANIFEST_INVALID',`Resource ${r.key} declares duplicate actions`);
  }
  for(const r of byKey.values()){
   const parent=byKey.get(r.parentKey);
   const parentType=parent?parent.type:r.parentKey===document.applicationKey?'APPLICATION':null;
   if(parentType===null)warnings.push({code:'PARENT_EXTERNAL',message:`Resource ${r.key} attaches to ${r.parentKey}; it must already exist and belong to this module`});
   else if(PARENTS[r.type]&&!PARENTS[r.type].includes(parentType))error('VALIDATION_FAILED',`Resource ${r.key} of type ${r.type} cannot have a ${parentType} parent; allowed: ${PARENTS[r.type].join(', ')}`);
  }
  for(const start of byKey.keys()){const seen=new Set();for(let k=start;byKey.has(k);k=byKey.get(k).parentKey){if(seen.has(k)){error('VALIDATION_FAILED',`Resource hierarchy contains a cycle at ${start}`);break;}seen.add(k);}}
  return {kind,errors,warnings,document};
 }
 for(const field of AUTHORIZATION_FIELDS)if(field in document)error('MANIFEST_INVALID',`Micro-frontend manifest must not contain authorization field '${field}'`);
 try{warnings.push(...checkCompatibility(document).map(w=>({code:w.code,message:w.message})));}catch(e){error(e.diagnostic?.code??'VERSION_INVALID',e.message);}
 if(typeof document.displayName!=='string'||!document.displayName.trim())error('MANIFEST_INVALID','displayName is required');
 const artifact=document.artifact??{};
 if(!['ES_MODULE','WEBPACK_FEDERATION','VITE_FEDERATION'].includes(artifact.format))error('MODULE_FORMAT_UNSUPPORTED',`artifact.format must be ES_MODULE, WEBPACK_FEDERATION or VITE_FEDERATION, received ${artifact.format}`);
 else if(artifact.format==='ES_MODULE'){if(artifact.remoteName!==undefined||artifact.exposedModule!==undefined)error('MANIFEST_INVALID','artifact.remoteName and artifact.exposedModule apply only to Module Federation formats');}
 else {
  if(artifact.format==='WEBPACK_FEDERATION'&&!/^[A-Za-z_$][A-Za-z0-9_$]{0,79}$/.test(artifact.remoteName??''))error('MANIFEST_INVALID','artifact.remoteName (the webpack container global) is required for WEBPACK_FEDERATION');
  if(!/^\.\/[A-Za-z0-9._/-]{1,200}$/.test(artifact.exposedModule??'')||artifact.exposedModule.includes('..'))error('MANIFEST_INVALID',`artifact.exposedModule (e.g. ./plugin) is required for ${artifact.format}`);
 }
 if(typeof artifact.url!=='string')error('MANIFEST_INVALID','artifact.url is required');
 else if(artifact.url.startsWith('/')){if(artifact.url.startsWith('//')||!artifact.url.toLowerCase().endsWith('.js')||/[\\?#]|\/\.\.?\/|%2e|%2f|%5c/i.test(artifact.url))error('MANIFEST_INVALID','artifact.url path must be a normalized same-origin .js path');}
 else if(!/^https?:\/\/[^/@\s]+\/\S+\.js$/i.test(artifact.url))error('ARTIFACT_LOCATION_REJECTED','artifact.url must be an HTTP(S) URL (or a same-origin path) ending in .js; network policy is applied by the server');
 else if(artifact.url.startsWith('http:'))warnings.push({code:'ARTIFACT_HTTP',message:'artifact.url uses plain HTTP: accepted only where the artifact network policy allows it (browsers load it through the same-origin artifact gateway)'});
 if(typeof artifact.integrity!=='string')error('INTEGRITY_REQUIRED','artifact.integrity (SRI) is required');
 else if(!SRI.test(artifact.integrity))error('MANIFEST_INVALID','artifact.integrity must be a sha256/384/512 SRI value');
 if(document.styleIsolation!==undefined&&!['SCOPED','SHADOW_DOM'].includes(document.styleIsolation))error('MANIFEST_INVALID','styleIsolation must be SCOPED or SHADOW_DOM');
 const routes=Array.isArray(document.routes)?document.routes:(error('MANIFEST_INVALID','routes must be an array'),[]);
 const keys=new Set(),paths=new Set();
 for(const route of routes){
  if(!ROUTE_KEY.test(route?.key??''))error('MANIFEST_INVALID',`Route key ${route?.key} must match ${ROUTE_KEY}`);
  if(!ROUTE_PATH.test(route?.path??'')||route.path.length>512||route.path.split('/').some(s=>s==='.'||s==='..'))error('MANIFEST_INVALID',`Route ${route?.key} path must be absolute literal/:param segments with optional trailing /*`);
  if(!['PUBLIC','HYBRID','AUTHENTICATED'].includes(route?.access))error('MANIFEST_INVALID',`Route ${route?.key} access must be PUBLIC, HYBRID or AUTHENTICATED`);
  if(keys.has(route?.key))error('MANIFEST_INVALID',`Duplicate route key ${route.key}`);keys.add(route?.key);
  if(paths.has(route?.path))error('MANIFEST_INVALID',`Duplicate route path ${route.path}`);paths.add(route?.path);
  if((route?.resource===undefined)!==(route?.action===undefined))error('MANIFEST_INVALID',`Route ${route?.key} must declare both resource and action or neither`);
  if(route?.access==='PUBLIC'&&route.resource!==undefined)error('MANIFEST_INVALID',`PUBLIC route ${route.key} cannot require a resource permission`);
 }
 if(artifactFile&&typeof artifact.integrity==='string'&&SRI.test(artifact.integrity)){
  const [algorithm,expected]=artifact.integrity.split('-');
  const actual=createHash(algorithm).update(readFileSync(artifactFile)).digest('base64');
  if(actual!==expected)error('ARTIFACT_INTEGRITY_MISMATCH',`${basename(artifactFile)} does not match artifact.integrity (actual ${algorithm}-${actual})`);
 }
 return {kind,errors,warnings,document};
}

/** Cross-checks a micro-frontend manifest's routes against the resource manifest of the same module. */
export function crossCheck(mf,resources) {
 const declared=new Map(resources.resources.map(r=>[r.key,new Set(['manage',...(r.actions??[]).map(a=>typeof a==='string'?a:a.key)])]));
 const errors=[];
 if(mf.resourceManifestVersion&&mf.resourceManifestVersion!==resources.manifestVersion)
  errors.push({code:'RESOURCE_MANIFEST_VERSION_MISMATCH',message:`micro-frontend manifest requires resource manifest ${mf.resourceManifestVersion}, found ${resources.manifestVersion}`});
 for(const route of mf.routes??[])if(route.resource&&!declared.get(route.resource)?.has(route.action))
  errors.push({code:'ROUTE_RESOURCE_UNDECLARED',message:`Route ${route.key} references ${route.resource}/${route.action}, not declared by the resource manifest`});
 return errors;
}

/** Validates files or directories (all *.json manifests). Artifacts next to a manifest are verified against its SRI. */
export function validatePaths(paths) {
 const results=[];
 const manifests=paths.flatMap(path=>statSync(path).isDirectory()?readdirSync(path,{recursive:true}).filter(f=>String(f).endsWith('manifest.json')).map(f=>join(path,String(f))):[path]);
 const byDir=new Map();
 for(const file of manifests){
  let document;
  try{document=JSON.parse(readFileSync(file,'utf8'));}catch(e){results.push({file,kind:'UNKNOWN',errors:[{code:'MANIFEST_NOT_JSON',message:e.message}],warnings:[]});continue;}
  const artifactName=typeof document?.artifact?.url==='string'?basename(document.artifact.url):null;
  const artifactFile=artifactName&&existsSync(join(dirname(file),artifactName))?join(dirname(file),artifactName):undefined;
  const result={file,...validateDocument(document,{artifactFile}),artifactChecked:Boolean(artifactFile)};
  results.push(result);
  const group=byDir.get(dirname(resolve(file)))??{};group[result.kind]=result;byDir.set(dirname(resolve(file)),group);
 }
 for(const group of byDir.values())if(group.RESOURCE&&group.MICRO_FRONTEND&&group.RESOURCE.errors.length===0&&group.MICRO_FRONTEND.errors.length===0)
  group.MICRO_FRONTEND.errors.push(...crossCheck(group.MICRO_FRONTEND.document,group.RESOURCE.document));
 return results;
}
