// Executable evidence for the consumer claims: the Tailwind proof does not depend on the Operator Console design system,
// the minimal consumer uses no UI framework at all, and only @hive-platform/react may import React.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {files,importedModules} from '../../tools/architecture.mjs';

const pkg=path=>JSON.parse(readFileSync(path,'utf8'));
const allDeps=p=>Object.keys({...p.dependencies,...p.devDependencies,...p.peerDependencies,...p.optionalDependencies});
const sources=dir=>files(dir).filter(f=>/\.(m?[jt]sx?)$/.test(f)&&!f.includes(`${join('dist')}`));
const imports=dir=>sources(dir).flatMap(f=>importedModules(readFileSync(f,'utf8'),f));

test('React + Tailwind consumer uses neither Ant Design nor Material UI',()=>{
 const deps=allDeps(pkg('examples/react-tailwind-consumer/package.json'));
 assert.ok(deps.includes('tailwindcss')&&deps.includes('react'));
 for(const forbidden of deps)assert.ok(!/^(antd|@ant-design\/|@mui\/)/.test(forbidden),forbidden);
 for(const module of imports('examples/react-tailwind-consumer'))assert.ok(!/^(antd|@ant-design\/|@mui\/)/.test(module),module);
 const bundle='examples/react-tailwind-consumer/dist/modules/student-example/entry.js';
 if(existsSync(bundle))assert.ok(!readFileSync(bundle,'utf8').includes('ant-design'),'built artifact contains no Ant Design');
});

test('minimal consumer is framework-free',()=>{
 const deps=allDeps(pkg('examples/minimal-consumer/package.json'));
 for(const dep of deps)assert.ok(dep.startsWith('@hive-platform/')&&dep!=='@hive-platform/react',dep);
 for(const module of imports('examples/minimal-consumer/src'))assert.ok(module.startsWith('@hive-platform/')&&module!=='@hive-platform/react',module);
});

test('only @hive-platform/react imports React among platform packages',()=>{
 for(const name of ['contracts','core','http-client','auth','authorization','mfe-runtime','workspace']){
  assert.ok(!allDeps(pkg(`packages/${name}/package.json`)).some(d=>/^(react|react-dom|@hive-platform\/react)$/.test(d)),name);
  for(const module of imports(`packages/${name}/src`))assert.ok(!/^(react|react-dom)(\/|$)|^@hive-platform\/react$/.test(module),`${name} imports ${module}`);
 }
 assert.deepEqual(Object.keys(pkg('packages/react/package.json').peerDependencies).sort(),['react','react-dom'],'React is a peer, never bundled into the adapter');
});

test('platform packages and services never depend on apps or examples',()=>{
 for(const dir of ['packages','services','starters'])for(const module of imports(dir))assert.ok(!/(^|\/)(apps|examples)\//.test(module),module);
});
