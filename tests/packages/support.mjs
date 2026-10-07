// Minimal DOM stand-in for headless package tests (real browsers are exercised by the E2E suites).
export class FakeElement {
 constructor(doc,tag){this.ownerDocument=doc;this.tagName=tag;this.children=[];this.attributes={};this.parent=null;this.shadowRoot=null;this.textContent='';this.className='';this.listeners={};this.hidden=false;
  const classes=new Set();this.classList={add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)};this.style={values:{},setProperty:(k,v)=>{this.style.values[k]=v;}};}
 replaceChildren(...nodes){for(const c of [...this.children])c.remove();for(const n of nodes)this.appendChild(n);}
 append(...nodes){for(const n of nodes)this.appendChild(n);}
 removeAttribute(name){delete this.attributes[name];}
 appendChild(child){child.remove?.();child.parent=this;this.children.push(child);return child;}
 remove(){if(this.parent){this.parent.children=this.parent.children.filter(c=>c!==this);this.parent=null;}}
 setAttribute(name,value){this.attributes[name]=String(value);}
 getAttribute(name){return this.attributes[name]??null;}
 attachShadow(){if(this.shadowRoot)throw new Error('shadow root exists');this.shadowRoot=new FakeElement(this.ownerDocument,'#shadow-root');this.shadowRoot.host=this;return this.shadowRoot;}
 get isConnected(){let node=this;while(node.parent)node=node.parent;return node===this.ownerDocument.body||node.host!==undefined;}
}
export function fakeDocument(){const document={createElement:tag=>new FakeElement(document,tag)};document.body=new FakeElement(document,'body');return document;}

/** Evaluates verified artifact source as a real ES module (data: URL instead of the browser Blob URL). */
export const dataImporter=source=>import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

export async function sri(source,algorithm='sha384'){
 const digest=await crypto.subtle.digest({sha256:'SHA-256',sha384:'SHA-384',sha512:'SHA-512'}[algorithm],new TextEncoder().encode(source));
 return `${algorithm}-${Buffer.from(digest).toString('base64')}`;
}

/** fetch stub serving a map of URL -> {status, body} or throwing for network failures. */
export function fakeFetch(routes,calls=[]){
 return async(url,init={})=>{
  calls.push({url:String(url),init});
  const route=routes[String(url)];
  if(!route)throw new TypeError('fetch failed: connection refused');
  if(typeof route==='function')return route(init);
  return new Response(route.body,{status:route.status??200,headers:route.headers??{'Content-Type':'application/json'}});
 };
}

export function runtimeModule(overrides={}){
 return {applicationKey:'fixture-app',moduleKey:'records',displayName:'Records',schemaVersion:'1.0.0',manifestVersion:'1.0.0',contractVersion:'1.1.0',runtimeVersion:'1.0.0',
  artifact:{url:'https://cdn.example.test/records.js',integrity:'',format:'ES_MODULE'},styleIsolation:'SCOPED',routes:[],...overrides};
}
