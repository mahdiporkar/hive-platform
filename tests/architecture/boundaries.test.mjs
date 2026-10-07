import {test} from 'node:test';
import assert from 'node:assert/strict';
import {architectureViolations, importedModules,forbiddenDependency} from '../../tools/architecture.mjs';
test('all implemented platform modules respect architecture boundaries',()=>assert.deepEqual(architectureViolations(process.cwd()),[]));
test('parser detects import, re-export, inline type import, dynamic import and require',()=>{
 assert.deepEqual(importedModules(`import type {X} from 'react'; export {Y} from 'antd'; type T=import('vue').X; import('@mui/material'); require('tailwindcss');`),['react','antd','vue','@mui/material','tailwindcss']);
});
test('dependency policy rejects framework subpaths and cross-layer imports',()=>{
 for(const name of ['react/jsx-runtime','react-dom/client','@mui/material','@angular/core','@tailwindcss/vite','../../../examples/demo','../../apps/default-shell'])assert.equal(forbiddenDependency(name),true,name);
 for(const name of ['@hive-platform/contracts','./version.js'])assert.equal(forbiddenDependency(name),false,name);
});