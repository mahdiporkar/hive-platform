// Test-only OpenID Connect provider: discovery, JWKS, authorization code with PKCE (S256), refresh, signed ID tokens.
// The next login's subject is chosen by the test (provider.next = {subject, name}); access tokens are random per login.
import {createServer} from 'node:http';
import {generateKeyPairSync,sign,randomBytes,createHash} from 'node:crypto';

export async function startOidcProvider({port,clientId='hive-test',clientSecret='fixture-secret',accessLifetime=300}) {
 const issuer=`http://127.0.0.1:${port}`;
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const jwk={...publicKey.export({format:'jwk'}),kid:'fixture',use:'sig',alg:'RS256'};
 const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const codes=new Map(),refresh=new Map();
 const provider={issuer,clientId,clientSecret,next:{subject:'fixture-user',name:'Fixture User'},issued:[],counters:{exchanges:0,refreshes:0}};
 const idToken=(subject,name,nonce)=>{const now=Math.floor(Date.now()/1000);const unsigned=encode({alg:'RS256',kid:'fixture'})+'.'+encode({iss:issuer,sub:subject,aud:clientId,iat:now,exp:now+300,nonce,name});
  return unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),privateKey).toString('base64url');};
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,issuer);res.setHeader('Content-Type','application/json');
  if(url.pathname==='/.well-known/openid-configuration')return res.end(JSON.stringify({issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',
   response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],token_endpoint_auth_methods_supported:['client_secret_basic'],scopes_supported:['openid','profile'],code_challenge_methods_supported:['S256']}));
  if(url.pathname==='/jwks')return res.end(JSON.stringify({keys:[jwk]}));
  if(url.pathname==='/authorize'){
   if(url.searchParams.get('client_id')!==clientId||url.searchParams.get('code_challenge_method')!=='S256'){res.writeHead(400);return res.end('{}');}
   const code=randomBytes(24).toString('hex');codes.set(code,{nonce:url.searchParams.get('nonce'),challenge:url.searchParams.get('code_challenge'),...provider.next});
   res.writeHead(302,{Location:url.searchParams.get('redirect_uri')+'?'+new URLSearchParams({code,state:url.searchParams.get('state')})});return res.end();
  }
  if(url.pathname==='/token'){
   let body='';for await(const chunk of req)body+=chunk;const form=new URLSearchParams(body);
   if(req.headers.authorization!=='Basic '+Buffer.from(`${clientId}:${clientSecret}`).toString('base64')){res.writeHead(401);return res.end('{}');}
   if(form.get('grant_type')==='refresh_token'){
    const subject=refresh.get(form.get('refresh_token'));if(!subject){res.writeHead(400);return res.end('{"error":"invalid_grant"}');}
    provider.counters.refreshes++;const access='fixture-access-'+randomBytes(16).toString('hex');provider.issued.push({subject,access});
    return res.end(JSON.stringify({access_token:access,refresh_token:form.get('refresh_token'),token_type:'Bearer',expires_in:accessLifetime}));
   }
   const record=codes.get(form.get('code'));codes.delete(form.get('code'));
   if(!record||createHash('sha256').update(form.get('code_verifier')??'').digest('base64url')!==record.challenge){res.writeHead(400);return res.end('{"error":"invalid_grant"}');}
   provider.counters.exchanges++;
   const access='fixture-access-'+randomBytes(16).toString('hex'),refreshToken='fixture-refresh-'+randomBytes(16).toString('hex');
   refresh.set(refreshToken,record.subject);provider.issued.push({subject:record.subject,access,refresh:refreshToken});
   return res.end(JSON.stringify({access_token:access,refresh_token:refreshToken,token_type:'Bearer',expires_in:accessLifetime,id_token:idToken(record.subject,record.name,record.nonce)}));
  }
  res.writeHead(404);res.end('{}');
 });
 await new Promise(r=>server.listen(port,'127.0.0.1',r));
 provider.close=()=>new Promise(r=>{server.closeAllConnections?.();server.close(r);});
 provider.tokensOf=subject=>provider.issued.filter(t=>t.subject===subject);
 provider.secrets=()=>provider.issued.flatMap(t=>[t.access,t.refresh].filter(Boolean));
 return provider;
}

/** Drives the authorization-code flow over plain HTTP with a cookie client (no browser). */
export async function login(client,provider,{subject,name=subject,returnUrl='/'}={}) {
 provider.next={subject,name};
 let response=await client(`/auth/login?returnUrl=${encodeURIComponent(returnUrl)}`);
 if(response.status!==302)throw new Error(`login start ${response.status}`);
 response=await client(response.headers.get('location'));
 const authorize=await fetch(response.headers.get('location'),{redirect:'manual'});
 response=await client(authorize.headers.get('location'));
 if(response.status!==302)throw new Error(`login callback ${response.status} ${await response.text()}`);
 return response;
}
