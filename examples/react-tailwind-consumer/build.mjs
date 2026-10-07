// Builds the React + Tailwind proof consumer:
//  1. Tailwind CSS for the micro-app (scanned from its sources) and for the public site;
//  2. the micro-app as one self-contained ES module (React bundled in; CSS embedded as text for its shadow root);
//  3. its mf-manifest with the computed SRI value, next to its resource manifest.
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cpSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('.',import.meta.url));
const require=createRequire(import.meta.url);
const tailwind=join(dirname(require.resolve('@tailwindcss/cli/package.json')),'dist/index.mjs');
const css=(input,output)=>execFileSync(process.execPath,[tailwind,'-i',input,'-o',output,'--minify'],{stdio:['ignore','ignore','inherit']});

mkdirSync(join(root,'student-example/dist'),{recursive:true});
css(join(root,'student-example/src/styles.css'),join(root,'student-example/dist/tailwind.css'));
const out=join(root,'dist/modules/student-example');mkdirSync(out,{recursive:true});
await build({entryPoints:[join(root,'student-example/src/StudentApp.tsx')],outfile:join(out,'entry.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',
 jsx:'automatic',loader:{'.css':'text'},define:{'process.env.NODE_ENV':'"production"'},minify:true,legalComments:'none',logLevel:'warning'});
const manifest=JSON.parse(readFileSync(join(root,'student-example/manifests/mf-manifest.json'),'utf8'));
manifest.artifact.integrity='sha384-'+createHash('sha384').update(readFileSync(join(out,'entry.js'))).digest('base64');
writeFileSync(join(out,'mf-manifest.json'),JSON.stringify(manifest,null,2));
cpSync(join(root,'student-example/manifests/resource-manifest.json'),join(out,'resource-manifest.json'));
mkdirSync(join(root,'dist/public-web'),{recursive:true});
css(join(root,'public-web/styles.css'),join(root,'dist/public-web/site.css'));
console.log(`student-example: ${manifest.artifact.integrity}`);
