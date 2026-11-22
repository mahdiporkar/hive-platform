import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { register } from '../src/register.mjs';

test('HYBRID upgrade is idempotent and does not reset or delete dynamic resources', async () => {
 const dir=mkdtempSync(join(tmpdir(),'hive-hybrid-')); const original=globalThis.fetch;
 const module={applicationKey:'app',moduleKey:'example',definitionMode:'MANIFEST',revision:1};let upgrades=0;
 try {
  writeFileSync(join(dir,'hive.solution.json'),JSON.stringify({applicationKey:'app',modules:['example'],services:[],moduleDefinitionModes:{example:'HYBRID'}}));
  mkdirSync(join(dir,'dist/modules/example'),{recursive:true});
  for(const file of ['mf-manifest','resource-manifest'])writeFileSync(join(dir,`dist/modules/example/${file}.json`),JSON.stringify({manifestVersion:'1.0.0'}));
  globalThis.fetch=async(url,options)=>{
   const path=new URL(url).pathname;assert.notEqual(options.method,'DELETE');
   if(options.method==='GET'&&path==='/admin/modules/example')return Response.json(module);
   if(options.method==='PUT'){assert.equal(path,'/admin/modules/example');Object.assign(module,JSON.parse(options.body));upgrades++;}
   return Response.json({status:'PUBLISHED'});
  };
  await register(dir,{authorization:'https://control.example.edu',password:'test'});
  await register(dir,{authorization:'https://control.example.edu',password:'test'});
  assert.equal(upgrades,1);assert.equal(module.definitionMode,'HYBRID');
 } finally {globalThis.fetch=original;rmSync(dir,{recursive:true,force:true});}
});
