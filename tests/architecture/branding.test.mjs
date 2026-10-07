// Spec §64: no obsolete source-product names in Hive. Allowed only in explicitly marked migration/reference documents.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {files} from '../../tools/architecture.mjs';

const OBSOLETE=/aurevia|super[-_ ]?app/i;
const ALLOWED=new Set(['docs/migration/source-capability-map.md','docs/migration/requested-specification.md','docs/migration/phase-status.md','docs/source-capability-map.md',
 'tests/architecture/branding.test.mjs']);
const BINARY=/\.(png|jpg|jpeg|gif|ico|woff2?|jar|zip|gz)$/i;

test('no obsolete source names in file contents, file names or directories',()=>{
 const violations=[];
 for(const path of files(process.cwd())){
  const name=relative(process.cwd(),path).replaceAll('\\','/');
  if(name.startsWith('.git/')||name.startsWith('.local/')||name.includes('/node_modules/')||name==='package-lock.json')continue;
  if(OBSOLETE.test(name)){violations.push(`${name}: name`);continue;}
  if(ALLOWED.has(name)||BINARY.test(name))continue;
  const match=OBSOLETE.exec(readFileSync(path,'utf8'));
  if(match)violations.push(`${name}: "${match[0]}"`);
 }
 assert.deepEqual(violations,[]);
});

test('allowed historical references are marked as migration or reference material',()=>{
 for(const name of ALLOWED){
  if(name.startsWith('tests/'))continue;
  let text;try{text=readFileSync(name,'utf8');}catch{continue;}
  assert.match(text.slice(0,600),/reference|migration|source|requirement|evidence/i,`${name} must state it is migration/reference material`);
 }
});
