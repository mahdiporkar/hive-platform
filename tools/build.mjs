import {execFileSync} from 'node:child_process';
import {readdirSync,cpSync,existsSync} from 'node:fs';
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','-p','tsconfig.json'],{stdio:'inherit'});
for(const entry of readdirSync('packages',{withFileTypes:true})) {
 const compiled=`dist/${entry.name}/src`;
 if(entry.isDirectory()&&existsSync(compiled))cpSync(compiled,`packages/${entry.name}/dist`,{recursive:true});
}