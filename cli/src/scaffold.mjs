// Solution scaffolding. Generated code depends only on public Hive packages; nothing is copied from Hive itself.
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';

const KEY=/^[a-z][a-z0-9-]{1,79}$/;

const write=(file,content)=>{mkdirSync(resolve(file,'..'),{recursive:true});writeFileSync(file,content);};

export function createSolution(dir,{applicationKey,displayName}) {
 if(!KEY.test(applicationKey))throw new Error(`Application key must match ${KEY}`);
 if(existsSync(join(dir,'hive.solution.json')))throw new Error(`${dir} already contains a Hive solution`);
 write(join(dir,'hive.solution.json'),JSON.stringify({schemaVersion:'1.0.0',applicationKey,displayName:displayName??applicationKey,modules:[],services:[]},null,2)+'\n');
 write(join(dir,'package.json'),JSON.stringify({name:`${applicationKey}-solution`,version:'0.1.0',private:true,type:'module',engines:{node:'>=22'},
  scripts:{build:'node build.mjs',validate:'hive validate dist/modules',register:'hive register'},
  dependencies:{'@hive-platform/contracts':'^1.1.0','@hive-platform/http-client':'^0.1.0'},devDependencies:{esbuild:'^0.25.10','@hive-platform/cli':'^0.1.0'}},null,2)+'\n');
 write(join(dir,'build.mjs'),`// Bundles every module in hive.solution.json into one ES module and writes its manifests with the computed SRI.
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {copyFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
const solution=JSON.parse(readFileSync(new URL('./hive.solution.json',import.meta.url),'utf8'));
for(const key of solution.modules){
 const out=\`dist/modules/\${key}\`;mkdirSync(out,{recursive:true});
 await build({entryPoints:[\`modules/\${key}/src/index.ts\`],outfile:\`\${out}/entry.js\`,bundle:true,format:'esm',platform:'browser',target:'es2022',logLevel:'warning'});
 const manifest=JSON.parse(readFileSync(\`modules/\${key}/manifests/mf-manifest.json\`,'utf8'));
 manifest.artifact.integrity='sha384-'+createHash('sha384').update(readFileSync(\`\${out}/entry.js\`)).digest('base64');
 writeFileSync(\`\${out}/mf-manifest.json\`,JSON.stringify(manifest,null,2));
 copyFileSync(\`modules/\${key}/manifests/resource-manifest.json\`,\`\${out}/resource-manifest.json\`);
 console.log(\`\${key}: \${manifest.artifact.integrity}\`);
}
`);
 write(join(dir,'README.md'),`# ${displayName??applicationKey}\n\nA Hive solution. Business code lives here; Hive provides identity, authorization, routing, manifests and runtime.\n\n- \`hive add mfe <key>\` — add a micro-app\n- \`hive add service <key> --url <base-url> --prefix /path\` — register a backend\n- \`npm run build\` — bundle modules and compute SRI\n- \`hive validate dist/modules\` — validate manifests offline\n- \`hive register --authorization <url>\` — apply to a Hive installation (uses HIVE_PROVISIONING_PASSWORD)\n`);
 return {dir,applicationKey};
}

export function addMicroApp(dir,{moduleKey,route,publicRoute=false}) {
 const solution=load(dir);
 if(!KEY.test(moduleKey))throw new Error(`Module key must match ${KEY}`);
 if(solution.modules.includes(moduleKey))throw new Error(`Module ${moduleKey} already exists`);
 const path=route??`/${moduleKey}`;
 write(join(dir,'modules',moduleKey,'src/index.ts'),`import type {HiveMicroApp, HiveMountContext} from '@hive-platform/contracts';

/** ${moduleKey}: replace the rendering with any framework; keep the lifecycle contract. */
const app: HiveMicroApp = {
  contractVersion: '1.1.0',
  create() {
    let root: HTMLElement | null = null;
    const render = (context: HiveMountContext) => {
      root!.textContent = \`${moduleKey} at \${context.route} (\${context.context.authenticated ? context.context.identity.displayName : 'anonymous'})\`;
    };
    return {
      mount(element, context) { root = element; render(context); },
      update(context) { render(context); },
      unmount() { root?.replaceChildren(); root = null; },
    };
  },
};
export default app;
`);
 write(join(dir,'modules',moduleKey,'manifests/resource-manifest.json'),JSON.stringify({schemaVersion:'1.0.0',manifestVersion:'1.0.0',applicationKey:solution.applicationKey,moduleKey,
  resources:[{key:moduleKey,type:'MODULE',parentKey:solution.applicationKey,name:moduleKey,actions:['view']}]},null,2)+'\n');
 write(join(dir,'modules',moduleKey,'manifests/mf-manifest.json'),JSON.stringify({schemaVersion:'1.0.0',manifestVersion:'1.0.0',contractVersion:'1.1.0',runtimeVersion:'1.0.0',
  applicationKey:solution.applicationKey,moduleKey,displayName:moduleKey,resourceManifestVersion:'1.0.0',
  artifact:{url:`/modules/${moduleKey}/entry.js`,integrity:'computed-at-build',format:'ES_MODULE'},styleIsolation:'SHADOW_DOM',
  routes:[publicRoute?{key:'home',path,access:'PUBLIC',navigation:{label:moduleKey,order:10}}:{key:'home',path,access:'AUTHENTICATED',resource:moduleKey,action:'view',navigation:{label:moduleKey,order:10}}]},null,2)+'\n');
 solution.modules.push(moduleKey);save(dir,solution);
 return {moduleKey,path};
}

export function addService(dir,{key,url,prefix,authentication='FORWARD_TOKEN'}) {
 const solution=load(dir);
 if(!KEY.test(key))throw new Error(`Service key must match ${KEY}`);
 if(!/^https?:\/\//.test(url??''))throw new Error('--url must be the service base URL');
 if(!/^\/[a-z0-9][a-z0-9/-]*$/.test(prefix??''))throw new Error('--prefix must be a path such as /records');
 if(!['FORWARD_TOKEN','NONE'].includes(authentication))throw new Error('--auth must be FORWARD_TOKEN or NONE (LEGACY requires a profile, configure it through the admin API)');
 const descriptor={target:{key:`${key}-svc`,displayName:key,baseUrl:url},route:{key,applicationKey:solution.applicationKey,pathPrefix:prefix,targetKey:`${key}-svc`,authentication},
  operations:[{key:'list',method:'GET',pathPattern:'/**',access:'AUTHENTICATED',resourceKey:solution.modules[0]??null,action:'view'}]};
 write(join(dir,'services',`${key}.json`),JSON.stringify(descriptor,null,2)+'\n');
 solution.services.push(key);save(dir,solution);
 return descriptor;
}

export function load(dir) {
 const file=join(dir,'hive.solution.json');
 if(!existsSync(file))throw new Error(`${dir} is not a Hive solution (hive.solution.json missing); run hive create solution`);
 return JSON.parse(readFileSync(file,'utf8'));
}
function save(dir,solution){writeFileSync(join(dir,'hive.solution.json'),JSON.stringify(solution,null,2)+'\n');}
