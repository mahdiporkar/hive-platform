import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkCompatibility,CompatibilityError} from '../../dist/contracts/src/index.js';
const supported={contractVersion:'1.1.0',schemaVersion:'1.0.0',runtimeVersion:'1.0.0',manifestVersion:'1.0.0'};
test('supported and compatible patch versions',()=>{
 assert.deepEqual(checkCompatibility(supported),[]);
 assert.deepEqual(checkCompatibility({...supported,contractVersion:'1.1.20',manifestVersion:'1.9.2'}),[]);
});
test('deprecated compatible contract emits actionable warning',()=>assert.equal(checkCompatibility({...supported,contractVersion:'1.0.0'})[0].code,'VERSION_DEPRECATED'));
for(const field of ['contractVersion','schemaVersion','runtimeVersion','manifestVersion']) {
 test(`${field}: missing and unsupported major rejected`,()=>{
  for(const [value,code] of [[undefined,'VERSION_MISSING'],['2.0.0','VERSION_MAJOR_UNSUPPORTED']])assert.throws(()=>checkCompatibility({...supported,[field]:value}),error=>error instanceof CompatibilityError&&error.diagnostic.code===code&&error.message.includes(field));
 });
}
test('unknown future schema and runtime minor fail safely',()=>{
 for(const field of ['schemaVersion','runtimeVersion'])assert.throws(()=>checkCompatibility({...supported,[field]:'1.1.0'}),/supported through/);
});
test('malformed semver never guessed',()=>{
 for(const version of ['1','1.0','01.0.0','1.0.0-beta','1.0.0\n',{},'99999999999999999999999.0.0'])assert.throws(()=>checkCompatibility({...supported,schemaVersion:version}));
});