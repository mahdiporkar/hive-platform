// Development/test gateway: one browser origin that serves static consumer files and reverse-proxies Hive APIs to the
// BFF (the role nginx plays in deployments, see infra/nginx). The Host header is preserved so OAuth redirect URIs and
// cookies are issued for the browser-visible origin. Never used in production.
import {createServer,request as httpRequest} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {extname,join,normalize,resolve,sep} from 'node:path';

const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
 '.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.map':'application/json','.woff2':'font/woff2'};
const PROXIED=['/api/','/auth/','/oauth2/','/login/oauth2/','/actuator/'];

/**
 * @param {{port:number, bff:string, mounts:Record<string,string>, spa?:Record<string,string>, headers?:Record<string,string>}} options
 *   mounts: URL prefix -> directory; spa: URL prefix -> index.html used for unknown paths below it (client routing).
 */
export async function startGateway({port,bff,mounts,spa={},headers={}}) {
 const upstream=new URL(bff);
 const roots=Object.entries(mounts).map(([prefix,dir])=>[prefix,resolve(dir)]).sort((a,b)=>b[0].length-a[0].length);
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host}`);
  if(PROXIED.some(p=>url.pathname.startsWith(p)))return proxy(req,res);
  for(const [prefix,root] of roots){
   if(!url.pathname.startsWith(prefix))continue;
   let relative;
   try{relative=decodeURIComponent(url.pathname.slice(prefix.length));}catch{res.writeHead(400);return res.end();}
   const file=normalize(join(root,relative));
   if(file!==root&&!file.startsWith(root+sep)){res.writeHead(400);return res.end();}
   try{
    const info=await stat(file);
    if(info.isFile())return send(res,file);
    if(info.isDirectory()){try{await stat(join(file,'index.html'));return send(res,join(file,'index.html'));}catch{}}
   }catch{}
  }
  const fallback=Object.entries(spa).sort((a,b)=>b[0].length-a[0].length).find(([prefix])=>url.pathname.startsWith(prefix));
  if(fallback&&!extname(url.pathname))return send(res,resolve(fallback[1]));
  res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');
 });
 async function send(res,file){
  const body=await readFile(file);
  res.writeHead(200,{'Content-Type':TYPES[extname(file)]??'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff',...headers});
  res.end(body);
 }
 function proxy(req,res){
  const forwarded=httpRequest({host:upstream.hostname,port:upstream.port,path:req.url,method:req.method,
   headers:{...req.headers,'x-forwarded-proto':'http','x-forwarded-host':req.headers.host}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
  forwarded.on('error',()=>{if(!res.headersSent)res.writeHead(502,{'Content-Type':'application/json'});res.end('{"code":"GATEWAY_UPSTREAM_UNAVAILABLE"}');});
  req.pipe(forwarded);
 }
 await new Promise(r=>server.listen(port,'127.0.0.1',r));
 return {origin:`http://127.0.0.1:${port}`,close:()=>new Promise(r=>{server.closeAllConnections?.();server.close(r);})};
}
