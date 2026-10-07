/**
 * @hive-platform/auth — login, logout and context access. Authentication happens entirely between the BFF and the
 * identity provider; the browser only follows redirects and holds an HttpOnly session cookie.
 */
import type {AnyHiveContext, HiveContext, PublicHiveContext} from '@hive-platform/contracts';
import {HiveHttpError, type HiveHttp} from '@hive-platform/http-client';

export interface LoginSelector {provider?:string; tenant?:string; domain?:string}

export interface HiveAuth {
 publicContext():Promise<PublicHiveContext>;
 /** The authenticated context, or null when there is no valid session. */
 context():Promise<HiveContext|null>;
 /** Authenticated context when signed in, public context otherwise. */
 currentContext():Promise<AnyHiveContext>;
 loginUrl(returnUrl?:string, selector?:LoginSelector):string;
 login(returnUrl?:string, selector?:LoginSelector):void;
 logout():Promise<void>;
}

/** Mirrors the BFF's validation so consumers never construct an open redirect. */
export function isSafeReturnUrl(value:string):boolean {
 if(typeof value!=='string'||value.length>2048||!value.startsWith('/')||value.startsWith('//')||value.includes('\\'))return false;
 if([...value].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127))return false;
 let decoded=value;
 for(let i=0;i<4;i++){let next:string;try{next=decodeURIComponent(decoded);}catch{return false;}if(next===decoded)break;decoded=next;if(decoded.startsWith('//')||decoded.includes('\\'))return false;}
 const path=decoded.split(/[?#]/)[0]!;
 if(value.includes('#')||path.includes('//')||path.split('/').some(s=>s==='.'||s==='..'))return false;
 return !path.toLowerCase().startsWith('/auth/')&&!path.startsWith('/login/oauth2/');
}

export function createAuth(http:HiveHttp, options:{navigate?:(url:string)=>void; baseUrl?:string}={}):HiveAuth {
 const base=(options.baseUrl??'').replace(/\/+$/,'');
 const navigate=options.navigate??((url:string)=>{globalThis.location.assign(url);});
 const loginUrl=(returnUrl='/', selector:LoginSelector={})=>{
  const params=new URLSearchParams({returnUrl:isSafeReturnUrl(returnUrl)?returnUrl:'/'});
  for(const [key,value] of Object.entries(selector))if(value)params.set(key,value);
  return `${base}/auth/login?${params}`;
 };
 const context=async()=>{
  try{return await http.get<HiveContext>('/api/me/context');}
  catch(error){if(error instanceof HiveHttpError&&error.status===401)return null;throw error;}
 };
 return {
  publicContext:()=>http.get<PublicHiveContext>('/api/public/context'),
  context,
  currentContext:async()=>(await context())??await http.get<PublicHiveContext>('/api/public/context'),
  loginUrl,
  login:(returnUrl,selector)=>navigate(loginUrl(returnUrl,selector)),
  logout:async()=>{await http.post('/auth/logout');http.resetCsrf();},
 };
}
