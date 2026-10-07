// The packaged JSON model must be exactly the official CLI transformation of the reviewed DSL.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {authorizationModel} from '../../tools/openfga-model.mjs';

test('infra/openfga/model.json equals the OpenFGA CLI transformation of model.fga',()=>{
 const output=execFileSync('docker',['run','--rm','--mount',`type=bind,source=${resolve('infra/openfga')},target=/model,readonly`,'openfga/cli:v0.7.20','model','transform','--file','/model/model.fga'],
  {encoding:'utf8',env:{...process.env,MSYS_NO_PATHCONV:'1'},timeout:120000});
 assert.deepEqual(JSON.parse(output),authorizationModel());
});

test('model keeps platform administration separate from resource grants',()=>{
 const types=Object.fromEntries(authorizationModel().type_definitions.map(t=>[t.type,t]));
 assert.deepEqual(Object.keys(types).sort(),['action','group','platform','resource','role','user']);
 assert.deepEqual(Object.keys(types.platform.relations).sort(),['auditor','integration_admin','operator','reader','security_admin','super_admin']);
 assert.ok(!('parent' in types.platform.relations),'platform relations are not inherited from resources');
});
