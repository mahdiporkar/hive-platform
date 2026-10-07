import type {Workspace, WorkspaceSlot} from '@hive-platform/contracts';
import type {WorkspaceEngine} from './engine.js';

export interface DomRendererOptions {
 /** Title for a slot frame; defaults to the module key. */
 title?(slot:WorkspaceSlot):string;
 /** Message for non-mounted states. */
 message?(slot:WorkspaceSlot):string;
}

const CSS=`.hive-workspace{display:grid;gap:12px}
.hive-workspace[data-layout=SPLIT]{grid-template-columns:repeat(var(--hive-columns,2),minmax(0,1fr))}
.hive-workspace[data-layout=DASHBOARD]{grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}
.hive-tabs{display:flex;gap:4px;grid-column:1/-1} .hive-tabs button[aria-selected=true]{font-weight:600}
.hive-slot{border:1px solid #d6dbe4;border-radius:8px;min-height:80px;display:flex;flex-direction:column}
.hive-slot[hidden]{display:none} .hive-slot-header{display:flex;justify-content:space-between;padding:4px 8px;border-bottom:1px solid #eef0f4;font-size:12px}
.hive-slot-body{padding:8px;flex:1} .hive-slot-status{padding:8px;font-size:13px;color:#5b6475}`;

/**
 * Optional, framework-free renderer for WorkspaceEngine. It owns only presentation; the engine owns lifecycle.
 * Slot body elements are kept stable across renders so mounted instances are never recreated by re-rendering.
 */
export function renderDomWorkspace(engine:WorkspaceEngine, container:HTMLElement, options:DomRendererOptions={}):()=>void {
 const doc=container.ownerDocument;
 const style=doc.createElement('style');style.textContent=CSS;
 const tabs=doc.createElement('div');tabs.className='hive-tabs';tabs.setAttribute('role','tablist');
 container.classList.add('hive-workspace');container.replaceChildren(style,tabs);
 const frames=new Map<string,{frame:HTMLElement;body:HTMLElement;title:HTMLElement;status:HTMLElement}>();
 const title=options.title??(slot=>slot.moduleKey);
 const message=options.message??(slot=>({IDLE:'',LOADING:'Loading…',MOUNTED:'',ERROR:`${slot.error?.code}: ${slot.error?.message}`,DENIED:'You are not permitted to open this page.',LOGIN_REQUIRED:'Sign in to open this page.'})[slot.status]);

 const render=(workspace:Workspace)=>{
  container.setAttribute('data-layout',workspace.layout);
  container.style.setProperty('--hive-columns',String(Math.max(1,workspace.slots.length)));
  tabs.hidden=workspace.layout!=='TABS';
  tabs.replaceChildren(...workspace.slots.map(slot=>{
   const button=doc.createElement('button');button.type='button';button.setAttribute('role','tab');button.textContent=title(slot);
   button.setAttribute('aria-selected',String(slot.slotId===workspace.activeSlotId));button.setAttribute('data-slot-tab',slot.slotId);
   button.onclick=()=>engine.focus(slot.slotId);return button;
  }));
  const live=new Set(workspace.slots.map(s=>s.slotId));
  for(const [slotId,entry] of frames)if(!live.has(slotId)){entry.frame.remove();frames.delete(slotId);}
  for(const slot of workspace.slots){
   let entry=frames.get(slot.slotId);
   if(!entry){
    const frame=doc.createElement('section');frame.className='hive-slot';frame.setAttribute('data-slot-id',slot.slotId);
    const header=doc.createElement('div');header.className='hive-slot-header';
    const name=doc.createElement('span');const close=doc.createElement('button');close.type='button';close.textContent='×';close.title='Close';
    close.setAttribute('data-slot-close',slot.slotId);close.onclick=()=>void engine.close(slot.slotId);
    header.append(name,close);
    const status=doc.createElement('div');status.className='hive-slot-status';
    const body=doc.createElement('div');body.className='hive-slot-body';
    frame.append(header,status,body);container.appendChild(frame);
    entry={frame,body,title:name,status};frames.set(slot.slotId,entry);
    void engine.attach(slot.slotId,body);
   }
   entry.title.textContent=title(slot);
   entry.frame.setAttribute('data-status',slot.status);
   entry.frame.setAttribute('data-module',slot.moduleKey);
   entry.frame.setAttribute('data-instance',slot.instanceId);
   if(slot.error)entry.frame.setAttribute('data-hive-error',slot.error.code);else entry.frame.removeAttribute('data-hive-error');
   entry.status.textContent=message(slot)??'';
   entry.frame.hidden=(workspace.layout==='SINGLE'||workspace.layout==='TABS')&&slot.slotId!==workspace.activeSlotId;
  }
 };
 render(engine.workspace);
 const off=engine.state.subscribe(render);
 return ()=>{off();for(const slotId of frames.keys())void engine.detach(slotId);frames.clear();container.replaceChildren();};
}
