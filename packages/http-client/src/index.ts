/**
 * @hive-platform/http-client — the browser's only way to call Hive: same-origin cookie session (HIVE_SESSION),
 * CSRF for unsafe methods, a correlation id per request, timeouts and PlatformError-typed failures. It never handles
 * access tokens: credentials are attached server-side by the BFF.
 */
import type {PlatformError} from '@hive-platform/contracts';

export class HiveHttpError extends Error {
 constructor(public readonly status:number, public readonly error:PlatformError) {super(`${status} ${error.code}: ${error.message}`);this.name='HiveHttpError';}
 get code():string {return this.error.code;}
}

export interface HttpClientOptions {
 /** Origin or path prefix of the BFF; '' means same origin. */
 baseUrl?:string;
 fetch?:typeof fetch;
 timeoutMs?:number;
 correlationId?:()=>string;
}

export interface RequestOptions {body?:unknown; headers?:Record<string,string>; signal?:AbortSignal; timeoutMs?:number; raw?:boolean}

export interface HiveHttp {
 request<T=unknown>(method:string, path:string, options?:RequestOptions):Promise<T>;
 get<T=unknown>(path:string, options?:RequestOptions):Promise<T>;
 post<T=unknown>(path:string, body?:unknown, options?:RequestOptions):Promise<T>;
 put<T=unknown>(path:string, body?:unknown, options?:RequestOptions):Promise<T>;
 patch<T=unknown>(path:string, body?:unknown, options?:RequestOptions):Promise<T>;
 delete<T=unknown>(path:string, options?:RequestOptions):Promise<T>;
 /** Forgets the cached CSRF token (e.g. after login or logout changes the session). */
 resetCsrf():void;
}

const SAFE=new Set(['GET','HEAD','OPTIONS']);

export function createHttpClient(options:HttpClientOptions={}):HiveHttp {
 const base=(options.baseUrl??'').replace(/\/+$/,'');
 const doFetch=options.fetch??globalThis.fetch.bind(globalThis);
 const newId=options.correlationId??(()=>globalThis.crypto?.randomUUID?.()??`hive-${Date.now()}-${Math.random().toString(16).slice(2)}`);
 let csrf:Promise<{headerName:string;token:string}>|null=null;

 const csrfToken=()=>csrf??=(async()=>{
  const response=await doFetch(base+'/auth/csrf',{credentials:'same-origin',headers:{Accept:'application/json'}});
  if(!response.ok){csrf=null;throw await failure(response);}
  return response.json() as Promise<{headerName:string;token:string}>;
 })();

 async function request<T>(method:string, path:string, opts:RequestOptions={}, retried=false):Promise<T> {
  const verb=method.toUpperCase();
  const headers:Record<string,string>={Accept:'application/json','X-Correlation-Id':newId(),...opts.headers};
  let body:BodyInit|undefined;
  if(opts.body!==undefined){
   if(typeof opts.body==='string'||opts.body instanceof Blob||opts.body instanceof FormData||opts.body instanceof URLSearchParams)body=opts.body as BodyInit;
   else{body=JSON.stringify(opts.body);headers['Content-Type']??='application/json';}
  }
  if(!SAFE.has(verb)){const token=await csrfToken();headers[token.headerName]=token.token;}
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(new DOMException('Request timed out','TimeoutError')),opts.timeoutMs??options.timeoutMs??30000);
  const abort=()=>controller.abort(opts.signal?.reason);
  opts.signal?.addEventListener('abort',abort,{once:true});
  let response:Response;
  try{response=await doFetch(base+path,{method:verb,headers,body:body??null,credentials:'same-origin',signal:controller.signal,redirect:'manual'});}
  catch(error){throw new HiveHttpError(0,{code:controller.signal.aborted&&!opts.signal?.aborted?'REQUEST_TIMEOUT':'NETWORK_FAILURE',message:error instanceof Error?error.message:String(error)});}
  finally{clearTimeout(timer);opts.signal?.removeEventListener('abort',abort);}
  // A 403 without a PlatformError body is a CSRF rejection by the session filter: refresh the token once.
  if(response.status===403&&!SAFE.has(verb)&&!retried&&!(response.headers.get('Content-Type')??'').includes('json')){csrf=null;return request<T>(method,path,opts,true);}
  if(!response.ok)throw await failure(response);
  if(opts.raw)return response as unknown as T;
  if(response.status===204||response.headers.get('Content-Length')==='0')return undefined as T;
  const type=response.headers.get('Content-Type')??'';
  return (type.includes('json')?await response.json():await response.text()) as T;
 }

 return {
  request:(method,path,opts)=>request(method,path,opts),
  get:(path,opts)=>request('GET',path,opts),
  post:(path,body,opts)=>request('POST',path,{...opts,body}),
  put:(path,body,opts)=>request('PUT',path,{...opts,body}),
  patch:(path,body,opts)=>request('PATCH',path,{...opts,body}),
  delete:(path,opts)=>request('DELETE',path,opts),
  resetCsrf:()=>{csrf=null;},
 };
}

async function failure(response:Response):Promise<HiveHttpError> {
 let error:PlatformError={code:`HTTP_${response.status}`,message:response.statusText||`HTTP ${response.status}`};
 try{
  const text=await response.text();
  if(text){const parsed=JSON.parse(text) as Partial<PlatformError>;if(parsed&&typeof parsed.code==='string')error={code:parsed.code,message:String(parsed.message??''),...(parsed.correlationId?{correlationId:parsed.correlationId}:{})};}
 }catch{/* non-JSON error bodies keep the HTTP code */}
 return new HiveHttpError(response.status,error);
}
