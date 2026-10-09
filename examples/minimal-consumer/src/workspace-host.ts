/**
 * Plain-DOM workspace host: the headless WorkspaceEngine plus its optional DOM renderer. Demonstrates that layouts,
 * multi-instance lifecycle, inter-app events and restore-after-refresh work without the default shell or any framework.
 */
import type {WorkspaceLayout} from '@hive-platform/contracts';
import {createAuth} from '@hive-platform/auth';
import {createHttpClient} from '@hive-platform/http-client';
import {MfeRuntime} from '@hive-platform/mfe-runtime';
import {WorkspaceEngine, renderDomWorkspace, sessionPersistence} from '@hive-platform/workspace';

const auth=createAuth(createHttpClient());
const diagnostics:unknown[]=[];
const runtime=new MfeRuntime({onDiagnostic:d=>diagnostics.push(d)});

async function start():Promise<void> {
 const context=await auth.currentContext();
 const engine=new WorkspaceEngine({runtime,context,id:'example',persistence:sessionPersistence('hive.workspace.example'),onDiagnostic:d=>diagnostics.push(d)});
 if(!engine.restore()){
  await engine.setLayout('SPLIT');
  engine.open(location.pathname==='/'||location.pathname.endsWith('.html')?'/directory':location.pathname);
 }
 renderDomWorkspace(engine,document.getElementById('workspace')!,{title:slot=>`${slot.moduleKey} · ${slot.route}`});

 const layouts=document.getElementById('layouts')!;
 for(const layout of ['SINGLE','TABS','SPLIT','DASHBOARD'] as WorkspaceLayout[]){
  const button=document.createElement('button');button.type='button';button.textContent=layout;button.setAttribute('data-layout-button',layout);
  button.onclick=()=>void engine.setLayout(layout);layouts.appendChild(button);
 }
 const form=document.getElementById('open') as HTMLFormElement;
 form.addEventListener('submit',event=>{event.preventDefault();const path=String(new FormData(form).get('path')??'');if(path.startsWith('/'))engine.open(path);form.reset();});

 const user=document.getElementById('user')!;const button=document.createElement('button');button.setAttribute('data-testid','auth-button');
 if(context.authenticated){user.textContent=`${context.identity.displayName} `;button.textContent='Sign out';
  button.onclick=async()=>{if((await auth.logout()).redirecting)return;await engine.setContext(await auth.currentContext());user.textContent='';button.textContent='Signed out';};}
 else{button.textContent='Sign in';button.onclick=()=>auth.login(location.pathname);}
 user.appendChild(button);

 Object.assign(window,{hiveWorkspace:{engine,diagnostics,get context(){return context;}}});
 document.body.setAttribute('data-hive-ready','true');
}
start().catch(error=>{document.body.setAttribute('data-hive-error',String(error));});
