import type {RuntimeDiagnostic} from './index.js';

/**
 * Platform compatibility line. Executable twin: services/authorization Compatibility.java; both are verified against
 * tests/contracts/compatibility-cases.json.
 *
 * - contractVersion: HiveMicroApp lifecycle contract implemented by an artifact (1.0 deprecated, 1.1 current).
 * - schemaVersion:   manifest document format.
 * - runtimeVersion:  minimum MFE runtime an artifact requires.
 * - manifestVersion: the content version of a manifest (any valid SemVer); used for immutability and history.
 */
export const compatibilityMatrix = Object.freeze({
 platform:'0.1.x', contractVersion:'1.1.0', schemaVersion:'1.0.0', runtimeVersion:'1.0.0', manifestVersion:'any SemVer',
 deprecated:Object.freeze({contractVersion:'1.0.x'}),
});

export class CompatibilityError extends Error {
 constructor(public readonly diagnostic:RuntimeDiagnostic) {super(diagnostic.message);this.name='CompatibilityError';}
}

const SEMVER=/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
const SUPPORTED:Readonly<Record<'contractVersion'|'schemaVersion'|'runtimeVersion',readonly [major:number,maxMinor:number,currentMinor:number]>>={
 contractVersion:[1,1,1], schemaVersion:[1,0,0], runtimeVersion:[1,0,0],
};

function fail(code:string,message:string):never {throw new CompatibilityError({code,message,severity:'ERROR',component:'compatibility'});}

export function parseVersion(value:unknown,field:string):readonly [number,number,number] {
 if(value===undefined||value===null||value==='')fail('VERSION_MISSING',`${field} is required`);
 if(typeof value!=='string'||!SEMVER.test(value))fail('VERSION_INVALID',`${field} must be a stable major.minor.patch version`);
 const [major,minor,patch]=value.split('.').map(Number) as [number,number,number];
 return [major,minor,patch];
}

/** Throws CompatibilityError for incompatible descriptors; returns warnings (e.g. deprecations) otherwise. */
export function checkCompatibility(value:unknown):readonly RuntimeDiagnostic[] {
 if(typeof value!=='object'||value===null||Array.isArray(value))fail('VERSION_DESCRIPTOR_INVALID','Compatibility descriptor must be an object');
 const descriptor=value as Record<string,unknown>,warnings:RuntimeDiagnostic[]=[];
 for(const field of ['contractVersion','schemaVersion','runtimeVersion'] as const) {
  const [major,minor]=parseVersion(descriptor[field],field);
  const [supportedMajor,maxMinor,currentMinor]=SUPPORTED[field];
  if(major!==supportedMajor)fail('VERSION_MAJOR_UNSUPPORTED',`${field}: supported major ${supportedMajor}, received ${major}`);
  if(minor>maxMinor)fail('VERSION_MINOR_UNSUPPORTED',`${field}: supported through ${supportedMajor}.${maxMinor}.x, received ${String(descriptor[field])}`);
  if(minor<currentMinor)warnings.push({code:'VERSION_DEPRECATED',message:`${field} ${supportedMajor}.${minor}.x is supported but deprecated; use ${supportedMajor}.${currentMinor}.x`,severity:'WARNING',component:'compatibility'});
 }
 parseVersion(descriptor.manifestVersion,'manifestVersion');
 return warnings;
}

export function compareVersions(left:string,right:string):number {
 const a=parseVersion(left,'version'),b=parseVersion(right,'version');
 for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]!-b[i]!;
 return 0;
}
