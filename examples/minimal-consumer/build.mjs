// Bundles each framework-neutral micro-app into one self-contained ES module, writes its mf-manifest with the computed
// SRI value next to its resource manifest, and bundles the plain-DOM hosts. Output: dist/ (any static server).
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {cpSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('.',import.meta.url));
const out=`${root}dist`;
const common={bundle:true,format:'esm',platform:'browser',target:'es2022',logLevel:'warning',legalComments:'none'};
const modules={
 'finance-example':{entry:'src/finance-example.ts',mf:'manifests/finance-mf-manifest.json',resources:'manifests/finance-resource-manifest.json'},
 'directory-example':{entry:'src/directory-example.ts',mf:'manifests/directory/mf-manifest.json',resources:'manifests/directory/resource-manifest.json'},
};
for(const [key,module] of Object.entries(modules)){
 const dir=`${out}/modules/${key}`;mkdirSync(dir,{recursive:true});
 await build({...common,entryPoints:[root+module.entry],outfile:`${dir}/entry.js`});
 const manifest=JSON.parse(readFileSync(root+module.mf,'utf8'));
 manifest.artifact.integrity='sha384-'+createHash('sha384').update(readFileSync(`${dir}/entry.js`)).digest('base64');
 writeFileSync(`${dir}/mf-manifest.json`,JSON.stringify(manifest,null,2));
 cpSync(root+module.resources,`${dir}/resource-manifest.json`);
 console.log(`${key}: ${manifest.artifact.integrity}`);
}
await build({...common,entryPoints:{'runtime-host':`${root}src/runtime-host.ts`,'workspace-host':`${root}src/workspace-host.ts`},outdir:`${out}/host`});
cpSync(`${root}public`,out,{recursive:true});
