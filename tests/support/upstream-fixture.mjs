// Test-only upstream services: an echo API that reports exactly what it received (to prove what the BFF forwards),
// and a legacy-style API with its own token endpoint whose tokens rotate on demand.
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';

export async function startUpstream({port,legacyCredential={username:'svc-account',password:'svc-password'},legacyLifetime=120}) {
 const state={requests:[],legacy:{acquisitions:0,current:null,valid:new Set(),bodies:[]}};
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,`http://127.0.0.1:${port}`);
  let body='';for await(const chunk of req)body+=chunk;
  const seen={method:req.method,path:url.pathname,query:url.search,headers:req.headers,bodyLength:body.length};
  state.requests.push(seen);
  const send=(status,value,headers={})=>{res.writeHead(status,{'Content-Type':'application/json','Set-Cookie':'upstream_session=leak; Path=/','X-Internal-Server':'upstream-1.2.3',...headers});res.end(JSON.stringify(value));};
  if(url.pathname==='/legacy/oauth/token'&&req.method==='POST'){
   let credential={};try{credential=JSON.parse(body);}catch{}
   state.legacy.bodies.push(Object.keys(credential).sort().join(','));
   if(credential.username!==legacyCredential.username||credential.password!==legacyCredential.password)return send(401,{error:'invalid_client'});
   state.legacy.acquisitions++;state.legacy.current='legacy-token-'+state.legacy.acquisitions+'-'+randomBytes(8).toString('hex');state.legacy.valid.add(state.legacy.current);
   return send(200,{data:{accessToken:state.legacy.current,expiresIn:legacyLifetime,type:'Bearer'}});
  }
  if(url.pathname.startsWith('/legacy/')){
   const token=(req.headers.authorization??'').replace(/^Bearer /,'');
   if(!state.legacy.valid.has(token))return send(401,{error:'legacy token rejected'});
   return send(200,{legacy:true,path:url.pathname});
  }
  if(url.pathname.endsWith('/payments')){const record=url.searchParams.get('record')??'none';return send(200,{payments:[{id:'P-'+record+'-1',amount:120},{id:'P-'+record+'-2',amount:80}]});}
  if(url.pathname.endsWith('/big'))return send(200,{blob:'x'.repeat(2*1024*1024)});
  if(url.pathname.endsWith('/slow')){await new Promise(r=>setTimeout(r,3000));return send(200,{slow:true});}
  if(url.pathname.endsWith('/redirect')){res.writeHead(302,{Location:'http://169.254.169.254/latest/meta-data'});return res.end();}
  // Echo only non-sensitive facts; full headers stay in state.requests for assertions.
  return send(req.method==='POST'?201:200,{echo:{method:seen.method,path:seen.path,bodyLength:seen.bodyLength,headerNames:Object.keys(req.headers).sort()}});
 });
 await new Promise(r=>server.listen(port,'127.0.0.1',r));
 state.origin=`http://127.0.0.1:${port}`;
 state.close=()=>new Promise(r=>{server.closeAllConnections?.();server.close(r);});
 /** Revokes every issued legacy token, as if the legacy system rotated its signing keys. */
 state.rotateLegacy=()=>state.legacy.valid.clear();
 state.last=()=>state.requests.at(-1);
 return state;
}
