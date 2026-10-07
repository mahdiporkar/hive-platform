// Scans every service log written by the integration and E2E suites (.local/**/*.log) for credential material.
// Run after the suites: the fixtures use recognizable token, password and secret values on purpose.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';

const MARKERS=[/fixture-access-[0-9a-f]{8}/,/fixture-refresh-[0-9a-f]{8}/,/legacy-token-\d+-[0-9a-f]{6}/,/svc-password/,/service-password/,/test-only-password/,
 /fixture-secret/,/test-only-keycloak-client-secret/,/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,/Bearer\s+[A-Za-z0-9._~+/=-]{20,}/];

function logs(dir){
 if(!existsSync(dir))return [];
 return readdirSync(dir).flatMap(name=>{const path=join(dir,name);return statSync(path).isDirectory()?logs(path):name.endsWith('.log')?[path]:[];});
}

test('service logs contain no tokens, passwords or client secrets',()=>{
 const files=logs('.local');
 assert.ok(files.length>0,'no service logs found: run the integration suites first');
 const leaks=[];
 for(const file of files){const text=readFileSync(file,'utf8');for(const marker of MARKERS){const match=marker.exec(text);if(match)leaks.push(`${file}: ${match[0].slice(0,24)}…`);}}
 assert.deepEqual(leaks,[]);
 console.log(`scanned ${files.length} log files`);
});
