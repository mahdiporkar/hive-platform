// Documentation verification: required documents exist, relative links resolve, referenced npm scripts exist.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {dirname,join,normalize} from 'node:path';

const REQUIRED=['README.md','CHANGELOG.md',...['architecture','platform-principles','control-plane-runtime-plane','headless-ui-architecture','contracts','compatibility','mfe-runtime',
 'workspace-runtime','event-bus','public-hybrid-authenticated','authorization','resource-catalog','manifest-governance','dynamic-routing','legacy-authentication','identity',
 'operator-console','consumer-guide','react-tailwind-guide','cli','deployment','observability','security','versioning','extension-points','source-capability-map'].map(d=>`docs/${d}.md`),
 ...['001-monorepo-architecture','002-control-plane-runtime-plane','003-authorization-source-of-truth','004-mfe-runtime-contract','005-workspace-runtime','006-workspace-persistence',
 '007-dynamic-routing','008-identity-and-session','009-manifest-versioning','010-framework-neutrality'].map(a=>`docs/adr/ADR-${a}.md`)];
const markdown=['README.md','CHANGELOG.md',...readdirSync('docs',{recursive:true}).filter(f=>String(f).endsWith('.md')).map(f=>join('docs',String(f)))];

test('every required document and ADR exists',()=>{for(const file of REQUIRED)assert.ok(existsSync(file),file);});

test('relative links in documentation resolve',()=>{
 const broken=[];
 for(const file of markdown){
  for(const [,target] of readFileSync(file,'utf8').matchAll(/\]\(([^)\s#]+)(#[^)]*)?\)/g)){
   if(/^[a-z]+:/i.test(target))continue;
   if(!existsSync(normalize(join(dirname(file),target))))broken.push(`${file} -> ${target}`);
  }
 }
 assert.deepEqual(broken,[]);
});

test('npm scripts referenced in documentation exist',()=>{
 const scripts=Object.keys(JSON.parse(readFileSync('package.json','utf8')).scripts);
 const missing=new Set();
 for(const file of markdown){
  const text=readFileSync(file,'utf8');
  for(const [,name] of text.matchAll(/npm run ([a-z][a-z0-9:-]*)/g))if(!scripts.includes(name))missing.add(`${file}: ${name}`);
  for(const [,list] of text.matchAll(/npm run (test:[a-z0-9:-]+(?: \| [a-z0-9:-]+)+)/g))for(const name of list.split(' | ').slice(1))if(!scripts.includes(name)&&!scripts.includes(`test:${name}`))missing.add(`${file}: ${name}`);
 }
 assert.deepEqual([...missing],[]);
});
