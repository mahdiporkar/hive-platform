// Registers example solutions through the administrative API only (what a solution team's CI would do).
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

export function adminApi(stack){
 const call=async(path,{method='GET',body}={})=>{const r=await stack.service(path,{method,body});const text=await r.text();return {status:r.status,body:text?JSON.parse(text):null};};
 const ok=async(path,options)=>{const r=await call(path,options);assert.ok(r.status<300,`${options?.method??'GET'} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);return r.body;};
 return {call,ok};
}

/** Registers and activates a module from built manifest files. */
export async function registerModule(api,{applicationKey,displayName,moduleKey,distDir,definitionMode='MANIFEST',ensureApplication=true}){
 if(ensureApplication){const existing=await api.call(`/admin/applications/${applicationKey}`);if(existing.status===404)await api.ok('/admin/applications',{method:'POST',body:{key:applicationKey,displayName}});}
 await api.ok('/admin/modules',{method:'POST',body:{applicationKey,moduleKey,displayName:moduleKey,definitionMode}});
 const resources=JSON.parse(readFileSync(`${distDir}/resource-manifest.json`,'utf8'));
 const imported=await api.ok(`/admin/modules/${moduleKey}/resource-manifests`,{method:'POST',body:resources});
 await api.ok(`/admin/modules/${moduleKey}/resource-manifests/${imported.revision.manifestVersion}/publish`,{method:'POST'});
 const mf=JSON.parse(readFileSync(`${distDir}/mf-manifest.json`,'utf8'));
 await api.ok(`/admin/modules/${moduleKey}/artifacts`,{method:'POST',body:mf});
 return api.ok(`/admin/modules/${moduleKey}/artifacts/${mf.manifestVersion}/activate`,{method:'POST'});
}

export const browserChannel=process.platform==='win32'?{channel:'msedge'}:{};
