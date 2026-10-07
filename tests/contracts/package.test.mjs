import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkCompatibility} from '@hive-platform/contracts';
test('consumer imports through package public exports',()=>assert.deepEqual(checkCompatibility({contractVersion:'1.1.0',schemaVersion:'1.0.0',runtimeVersion:'1.0.0',manifestVersion:'1.0.0'}),[]));