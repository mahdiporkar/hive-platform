import type {RuntimeDiagnostic} from './index.js';
export const compatibilityMatrix = Object.freeze({platform:'0.1.x',contractVersion:'1.1.0',schemaVersion:'1.0.0',runtimeVersion:'1.0.0',manifestVersion:'1.x'});
export class CompatibilityError extends Error {
 constructor(public readonly diagnostic:RuntimeDiagnostic) {super(diagnostic.message);this.name='CompatibilityError';}
}
function fail(code:string,message:string):never {throw new CompatibilityError({code,message,severity:'ERROR',component:'compatibility'});}
function parse(value:unknown,field:string):readonly [number,number,number] {
 if(value===undefined||value===null||value==='')fail('VERSION_MISSING',`${field} is required`);
 if(typeof value!=='string'||!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))fail('VERSION_INVALID',`${field} must be a stable major.minor.patch version`);
 const parts=(value as string).split('.').map(Number);
 if(parts.some(p=>!Number.isSafeInteger(p)))fail('VERSION_INVALID',`${field} exceeds supported integer range`);
 return parts as unknown as readonly [number,number,number];
}
export function checkCompatibility(value:unknown):readonly RuntimeDiagnostic[] {
 if(typeof value!=='object'||value===null||Array.isArray(value))fail('VERSION_DESCRIPTOR_INVALID','Compatibility descriptor must be an object');
 const descriptor=value as Record<string,unknown>, warnings:RuntimeDiagnostic[]=[];
 for(const field of ['contractVersion','schemaVersion','runtimeVersion'] as const) {
  const [major,minor]=parse(descriptor[field],field);
  const [supportedMajor,supportedMinor]=parse(compatibilityMatrix[field],field);
  if(major!==supportedMajor)fail('VERSION_MAJOR_UNSUPPORTED',`${field}: supported major ${supportedMajor}, received ${major}`);
  if(minor>supportedMinor)fail('VERSION_MINOR_UNSUPPORTED',`${field}: supported through ${supportedMajor}.${supportedMinor}.x, received ${descriptor[field]}`);
  if(field==='contractVersion'&&minor===0)warnings.push({code:'VERSION_DEPRECATED',message:'contractVersion 1.0.x is supported but deprecated; use 1.1.x',severity:'WARNING',component:'compatibility'});
 }
 const [manifestMajor]=parse(descriptor.manifestVersion,'manifestVersion');
 if(manifestMajor!==1)fail('VERSION_MAJOR_UNSUPPORTED','manifestVersion: supported major 1');
 return warnings;
}