// A micro-frontend server on its own address (e.g. 127.0.0.1:3004), as a solution team would run it: an entry file plus
// chunks, a stylesheet and the two manifests. Three packagings of the same Hive micro-app contract:
//  - webpack: a classic container script assigning a global, loading chunk + CSS relative to its own URL (publicPath 'auto'),
//  - vite:    an ES module exporting get/init that imports its exposed chunk relative to import.meta.url,
//  - es:      a single Hive ES module (export default {contractVersion, create}).
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';

export const sri=text=>'sha384-'+createHash('sha384').update(text).digest('base64');

export function reportResources(moduleKey,applicationKey,label){
 return [
  {key:moduleKey,type:'MODULE',parentKey:applicationKey,name:label,actions:['view']},
  {key:`${moduleKey}.dashboard`,type:'PAGE',parentKey:moduleKey,name:'Dashboard',actions:['view']},
  {key:`${moduleKey}.sales-dashboard`,type:'PAGE',parentKey:`${moduleKey}.dashboard`,name:'Sales Dashboard',actions:['view','export','print']},
  {key:`${moduleKey}.finance-dashboard`,type:'PAGE',parentKey:`${moduleKey}.dashboard`,name:'Finance Dashboard',actions:['view','export']},
  {key:`${moduleKey}.reports`,type:'PAGE',parentKey:moduleKey,name:'Reports',actions:['view']},
  {key:`${moduleKey}.daily-reports`,type:'PAGE',parentKey:`${moduleKey}.reports`,name:'Daily Reports',actions:['view','download']},
  {key:`${moduleKey}.monthly-reports`,type:'PAGE',parentKey:`${moduleKey}.reports`,name:'Monthly Reports',actions:['view','download']},
  {key:`${moduleKey}.settings`,type:'PAGE',parentKey:moduleKey,name:'Settings',actions:['view','edit']},
 ];
}

export function reportRoutes(moduleKey){
 return [
  {key:'sales',path:`/${moduleKey}/sales`,access:'AUTHENTICATED',resource:`${moduleKey}.sales-dashboard`,action:'view',navigation:{label:'Sales Dashboard',order:1}},
  {key:'daily',path:`/${moduleKey}/daily`,access:'AUTHENTICATED',resource:`${moduleKey}.daily-reports`,action:'view',navigation:{label:'Daily Reports',order:2}},
  {key:'settings',path:`/${moduleKey}/settings`,access:'AUTHENTICATED',resource:`${moduleKey}.settings`,action:'view',navigation:{label:'Settings',order:3}},
 ];
}

const microApp=(moduleKey,label)=>`{contractVersion:'1.1.0',create:function(){var el;return{
 mount:function(element,context){el=element;var d=document.createElement('div');d.className='fixture-banner-${moduleKey}';d.setAttribute('data-testid','mfe-${moduleKey}');
  d.textContent=${JSON.stringify(label)}+' '+context.route;element.appendChild(d);},
 unmount:function(){el.textContent='';}};}}`;

/**
 * @param {{port:number, flavor?:'webpack'|'vite'|'es', moduleKey?:string, applicationKey?:string, label?:string, version?:string,
 *   resourcesVersion?:string|null, resources?:object[], routes?:object[], remoteName?:string, manifests?:boolean, host?:string}} options
 */
export async function startMfeFixture({port,flavor='webpack',moduleKey='reports',applicationKey='reporting',label='Reports',version='1.0.0',resourcesVersion='1.0.0',
 resources,routes,remoteName=`${moduleKey.replace(/-/g,'_')}_remote`,manifests=true,host='127.0.0.1'}) {
 const origin=`http://${host}:${port}`;
 const state={label,tampered:false,requests:[]};
 const files=()=>{
  const css=`.fixture-banner-${moduleKey}{color:rgb(10, 20, 30);font-weight:700}`;
  if(flavor==='es')return {'/remoteEntry.js':`export default ${microApp(moduleKey,state.label)};`};
  if(flavor==='vite')return {
   '/remoteEntry.js':`const moduleMap={"./plugin":()=>import('./assets/expose.js').then(m=>()=>m)};
export const get=(module)=>moduleMap[module]?moduleMap[module]():Promise.reject(new Error('Module '+module+' does not exist in container.'));
export const init=(scope)=>{globalThis.__hive_fixture_scope=scope;};`,
   '/assets/expose.js':`const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./style.css',import.meta.url).href;document.head.appendChild(link);
export default ${microApp(moduleKey,state.label)};`,
   '/assets/style.css':css};
  return {
   '/remoteEntry.js':`var ${remoteName};
(function(){
 var __webpack_require__={p:document.currentScript.src.replace(/[^\\/]*$/,'')};
 function load(tag,url){return new Promise(function(resolve,reject){var el=document.createElement(tag);if(tag==='script')el.src=url;else{el.rel='stylesheet';el.href=url;}
  el.onload=resolve;el.onerror=function(){reject(new Error('Loading chunk failed: '+url));};document.head.appendChild(el);});}
 var moduleMap={"./plugin":function(){return Promise.all([load('script',__webpack_require__.p+'assets/chunk.js'),load('link',__webpack_require__.p+'assets/style.css')])
  .then(function(){return function(){return self.__hive_fixture_${moduleKey.replace(/-/g,'_')};};});}};
 ${remoteName}={get:function(module){return moduleMap[module]?moduleMap[module]():Promise.reject(new Error('Module '+module+' does not exist in container.'));},
  init:function(scope){self.__hive_fixture_scope=scope;}};
})();`,
   '/assets/chunk.js':`self.__hive_fixture_${moduleKey.replace(/-/g,'_')}={default:${microApp(moduleKey,state.label)}};`,
   '/assets/style.css':css};
 };
 const entry=()=>files()['/remoteEntry.js'];
 const mfManifest=()=>({schemaVersion:'1.0.0',manifestVersion:version,contractVersion:'1.1.0',runtimeVersion:'1.0.0',applicationKey,moduleKey,displayName:label,
  ...(resourcesVersion?{resourceManifestVersion:resourcesVersion}:{}),
  artifact:{url:`${origin}/remoteEntry.js`,integrity:sri(entry()),format:{webpack:'WEBPACK_FEDERATION',vite:'VITE_FEDERATION',es:'ES_MODULE'}[flavor],
   ...(flavor==='es'?{}:{exposedModule:'./plugin'}),...(flavor==='webpack'?{remoteName}:{})},
  styleIsolation:'SCOPED',routes:routes??reportRoutes(moduleKey)});
 const resourceManifest=()=>({schemaVersion:'1.0.0',manifestVersion:resourcesVersion??'1.0.0',applicationKey,moduleKey,resources:resources??reportResources(moduleKey,applicationKey,label)});
 const server=createServer((req,res)=>{
  const path=new URL(req.url,origin).pathname;state.requests.push(path);
  if(manifests&&path==='/mf-manifest.json'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify(mfManifest()));}
  if(manifests&&path==='/resource-manifest.json'&&resourcesVersion){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify(resourceManifest()));}
  if(path==='/plain.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end("console.log('not a micro-frontend');");}
  let body=files()[path];
  if(body===undefined){res.writeHead(404,{'Content-Type':'text/plain'});return res.end('Not found');}
  if(path==='/remoteEntry.js'&&state.tampered)body+='\n/* tampered */';
  res.writeHead(200,{'Content-Type':path.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-cache'});
  res.end(body);
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
 return {origin,url:`${origin}/remoteEntry.js`,state,entry,integrity:()=>sri(entry()),mfManifest,resourceManifest,remoteName,
  tamper(on=true){state.tampered=on;},
  close:()=>new Promise(r=>{server.closeAllConnections?.();server.close(()=>r());})};
}
