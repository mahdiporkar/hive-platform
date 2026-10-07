// Server-rendered public site (SEO-compatible consumer) built with React + Tailwind on Hive's public APIs.
// It is a separate deployable: it never runs inside the Hive shell, needs no session and receives only public data.
// Signed-in features live in the portal; links hand over to Hive's login with a safe return URL.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {createElement as h} from 'react';
import {renderToString} from 'react-dom/server';

const SITE_CSS=new URL('../dist/public-web/site.css',import.meta.url);

/** Fetches public Hive data server-side (anonymous; no cookies are forwarded). */
async function publicData(hive) {
 const [context,news]=await Promise.all([
  fetch(`${hive}/api/public/context`).then(r=>r.json()),
  fetch(`${hive}/api/routes/students/news`).then(r=>r.ok?r.json():{news:[]}),
 ]);
 return {context,news:news.news??[]};
}

export function renderNewsPage({context,news,portal}) {
 const navigation=context.modules.flatMap(m=>m.routes.filter(r=>r.navigation).map(r=>({label:r.navigation.label,path:r.path})));
 const body=h('div',{className:'min-h-screen bg-slate-50 text-slate-800'},
  h('header',{className:'flex items-center gap-6 border-b border-slate-200 bg-white px-8 py-4'},
   h('strong',{className:'text-lg text-indigo-900','data-testid':'brand'},context.branding.name),
   h('nav',{className:'flex gap-4 text-sm'},navigation.map(n=>h('a',{key:n.path,href:portal+n.path,className:'text-indigo-700 hover:underline'},n.label))),
   h('a',{href:`${portal}/auth/login?returnUrl=${encodeURIComponent('/students')}`,className:'ml-auto rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white','data-testid':'portal-login'},'Sign in to the portal')),
  h('main',{className:'mx-auto max-w-3xl px-8 py-10'},
   h('h1',{className:'text-3xl font-bold text-indigo-950'},'Campus news'),
   h('ul',{className:'mt-6 space-y-4','data-testid':'news'},news.map(item=>h('li',{key:item.id,className:'rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200'},
    h('h2',{className:'text-xl font-semibold'},item.title),h('p',{className:'mt-1 text-slate-600'},item.summary))))));
 return `<!doctype html><html lang="${context.locale}" dir="${context.direction}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`+
  `<title>Campus news · ${escape(context.branding.name)}</title><meta name="description" content="Public campus news rendered on the server"><link rel="stylesheet" href="/site.css"></head>`+
  `<body>${renderToString(body)}</body></html>`;
}

const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);

export async function startPublicWeb({port,hive,portal}) {
 const server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,`http://${req.headers.host}`);
   if(url.pathname==='/site.css'){res.writeHead(200,{'Content-Type':'text/css'});return res.end(readFileSync(SITE_CSS));}
   if(url.pathname==='/'||url.pathname==='/news'){
    const html=renderNewsPage({...await publicData(hive),portal});
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'public, max-age=60'});return res.end(html);
   }
   res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');
  }catch(error){res.writeHead(502,{'Content-Type':'text/plain'});res.end('Hive public API unavailable');}
 });
 await new Promise(r=>server.listen(port,'127.0.0.1',r));
 return {origin:`http://127.0.0.1:${port}`,close:()=>new Promise(r=>{server.closeAllConnections?.();server.close(r);})};
}

if(process.argv[1]&&new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll('\\','/').split('/').slice(-2).join('/'))){
 const site=await startPublicWeb({port:Number(process.env.PORT??4100),hive:process.env.HIVE_URL??'http://127.0.0.1:8080',portal:process.env.PORTAL_URL??'http://127.0.0.1:8080'});
 console.log(`public-web on ${site.origin}`);
}
