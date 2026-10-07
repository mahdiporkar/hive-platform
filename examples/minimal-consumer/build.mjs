// Bundles the framework-neutral micro-app into one self-contained ES module, computes its SRI value into the
// mf-manifest, and bundles the plain-DOM hosts. Output: dist/ (served by any static server or the dev gateway).
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {cpSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';

const root=new URL('.',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');
const out=`${root}dist`;
mkdirSync(`${out}/modules/finance-example`,{recursive:true});
const common={bundle:true,format:'esm',platform:'browser',target:'es2022',logLevel:'warning',legalComments:'none'};
await build({...common,entryPoints:[`${root}src/finance-example.ts`],outfile:`${out}/modules/finance-example/entry.js`});
await build({...common,entryPoints:{'runtime-host':`${root}src/runtime-host.ts`,...(process.env.HIVE_SKIP_WORKSPACE_HOST?{}:{'workspace-host':`${root}src/workspace-host.ts`})},outdir:`${out}/host`,splitting:false});
const artifact=readFileSync(`${out}/modules/finance-example/entry.js`);
const manifest=JSON.parse(readFileSync(`${root}manifests/mf-manifest.json`,'utf8'));
manifest.artifact.integrity='sha384-'+createHash('sha384').update(artifact).digest('base64');
writeFileSync(`${out}/modules/finance-example/mf-manifest.json`,JSON.stringify(manifest,null,2));
cpSync(`${root}manifests/resource-manifest.json`,`${out}/modules/finance-example/resource-manifest.json`);
cpSync(`${root}public`,out,{recursive:true});
console.log(`minimal-consumer built: ${manifest.artifact.integrity}`);
