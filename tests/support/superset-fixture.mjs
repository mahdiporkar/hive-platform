// Test-only emulation of the Superset REST endpoints Hive uses (login, health, dashboard, charts, chart data).
// It also sets its own session cookie on every response so tests can prove the tunnel never relays it.
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';

export async function startSupersetFixture({port,username='hive-service',password='service-password'}) {
 const state={logins:0,tokens:new Set(),requests:[]};
 const jwt=()=>{const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');return `${encode({alg:'HS256'})}.${encode({sub:username,exp:Math.floor(Date.now()/1000)+600,jti:randomBytes(6).toString('hex')})}.${randomBytes(16).toString('base64url')}`;};
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  const url=new URL(req.url,'http://superset');state.requests.push({method:req.method,path:url.pathname,headers:req.headers,body});
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Set-Cookie':'session=superset-internal; HttpOnly'});res.end(JSON.stringify(value));};
  if(url.pathname==='/api/v1/security/login'&&req.method==='POST'){
   const credential=JSON.parse(body||'{}');
   if(credential.username!==username||credential.password!==password||credential.provider!=='db')return send(401,{message:'Not authorized'});
   state.logins++;const token=jwt();state.tokens.add(token);return send(200,{access_token:token});
  }
  if(url.pathname==='/health'){res.writeHead(200,{'Content-Type':'text/plain'});return res.end('OK');}
  if(!state.tokens.has((req.headers.authorization??'').replace(/^Bearer /,'')))return send(401,{msg:'Token is invalid'});
  const dashboard=/^\/api\/v1\/dashboard\/([a-z0-9-]+)(\/charts)?$/.exec(url.pathname);
  if(dashboard&&!dashboard[2])return send(200,{result:{id:dashboard[1],dashboard_title:`Dashboard ${dashboard[1]}`}});
  if(dashboard)return send(200,{result:[{id:7,slice_name:'Enrollment by term'}]});
  if(url.pathname==='/api/v1/chart/data'&&req.method==='POST')return send(200,{result:[{data:[{term:'T1',count:42}],query:JSON.parse(body||'{}')}]});
  if(/^\/api\/v1\/chart\/[a-z0-9-]+$/.test(url.pathname))return send(200,{result:{id:url.pathname.split('/').pop()}});
  return send(200,{result:'any other Superset API'});
 });
 await new Promise(r=>server.listen(port,'127.0.0.1',r));
 state.origin=`http://127.0.0.1:${port}`;
 state.close=()=>new Promise(r=>{server.closeAllConnections?.();server.close(r);});
 state.revokeTokens=()=>state.tokens.clear();
 return state;
}
