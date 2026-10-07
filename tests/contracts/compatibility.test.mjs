import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkCompatibility,CompatibilityError,compareVersions} from '../../dist/contracts/src/index.js';

// The same fixture drives services/authorization CompatibilityMatrixTest.java.
const {cases}=JSON.parse(readFileSync(new URL('./compatibility-cases.json',import.meta.url),'utf8'));
for(const testCase of cases) {
 test(`shared matrix: ${testCase.name}`,()=>{
  if(testCase.expect==='ok')assert.deepEqual(checkCompatibility(testCase.descriptor).map(w=>w.code),testCase.warnings);
  else assert.throws(()=>checkCompatibility(testCase.descriptor),error=>error instanceof CompatibilityError&&error.diagnostic.code===testCase.expect&&error.message.includes(testCase.field),testCase.name);
 });
}
test('descriptor must be an object',()=>{for(const value of [null,[],'1.0.0',42])assert.throws(()=>checkCompatibility(value),/must be an object/);});
test('diagnostics name the real incompatibility',()=>{
 try{checkCompatibility({contractVersion:'1.1.0',schemaVersion:'1.0.0',runtimeVersion:'2.3.0',manifestVersion:'1.0.0'});assert.fail('expected rejection');}
 catch(error){assert.equal(error.diagnostic.component,'compatibility');assert.equal(error.message,'runtimeVersion: supported major 1, received 2');}
});
test('semantic version ordering',()=>{assert.ok(compareVersions('1.10.0','1.9.9')>0);assert.equal(compareVersions('2.0.0','2.0.0'),0);assert.ok(compareVersions('0.9.0','1.0.0')<0);});
