/**
 * directory-example — plain TypeScript micro-app that lists fixture records and announces the selection on the
 * workspace event bus. It does not know which micro-apps (if any) listen. Uses SCOPED styles: every selector is
 * prefixed with its own class so nothing leaks into the host or sibling micro-apps.
 */
import type {HiveMicroApp, HiveMicroAppInstance, HiveMountContext} from '@hive-platform/contracts';

const RECORDS=[{id:'R-1',name:'First record'},{id:'R-2',name:'Second record'},{id:'R-3',name:'Third record'}];
const STYLE=`.hx-directory{font:14px/1.5 system-ui,sans-serif}.hx-directory button{margin:2px 0;display:block}.hx-directory .hx-selected{font-weight:600}`;

function create():HiveMicroAppInstance {
 let root:HTMLElement|null=null;let selected:string|null=null;let context:HiveMountContext;
 const render=()=>{
  if(!root)return;
  const doc=root.ownerDocument;
  const style=doc.createElement('style');style.textContent=STYLE;
  const box=doc.createElement('div');box.className='hx-directory';box.setAttribute('data-testid','directory-example');
  const heading=doc.createElement('strong');heading.textContent=`Directory (${context.instanceId})`;
  box.append(heading,...RECORDS.map(record=>{
   const button=doc.createElement('button');button.type='button';button.textContent=`${record.id} · ${record.name}`;
   button.setAttribute('data-record',record.id);if(record.id===selected)button.className='hx-selected';
   button.addEventListener('click',()=>{selected=record.id;render();context.events.publish('campus:record-selected',{recordId:record.id});});
   return button;
  }));
  root.replaceChildren(style,box);
 };
 return {
  mount(element,ctx){root=element;context=ctx;render();},
  update(ctx){context=ctx;render();},
  unmount(){root?.replaceChildren();root=null;},
 };
}

const app:HiveMicroApp={contractVersion:'1.1.0',create};
export default app;
