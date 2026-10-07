/**
 * finance-example — a micro-app written with plain TypeScript and DOM APIs. It implements the HiveMicroApp contract
 * directly (mount/update/unmount, one independent instance per create()), uses only what the mount context provides,
 * talks to its backend through a Hive dynamic route, and listens to workspace events from other micro-apps without
 * importing them. Example code: business vocabulary here is fixture data, not platform concepts.
 */
import type {HiveEventEnvelope, HiveMicroApp, HiveMicroAppInstance, HiveMountContext} from '@hive-platform/contracts';
import {createHttpClient} from '@hive-platform/http-client';

const STYLE=`.card{all:initial;display:block;font:14px/1.5 system-ui,sans-serif;color:#1d2433}
.card{border:1px solid #d6dbe4;border-radius:8px;padding:12px 16px;background:#fbfcfe}
h2{font-size:16px;margin:0 0 8px} button{font:inherit;padding:4px 10px;border-radius:6px;border:1px solid #6b7a99;background:#fff;cursor:pointer}
.muted{color:#5b6475} [hidden]{display:none!important} ul{margin:6px 0;padding-left:18px}`;

class FinanceInstance implements HiveMicroAppInstance {
 private root:HTMLElement|null=null;
 private style!:HTMLStyleElement;
 private context!:HiveMountContext;
 private selected:string|null=null;
 private offSelection:(()=>void)|null=null;
 private readonly http=createHttpClient();

 mount(element:HTMLElement, context:HiveMountContext):void {
  this.context=context;this.root=element;
  // Styles live inside this instance's own container; the manifest requests SHADOW_DOM so they cannot leak.
  this.style=element.ownerDocument.createElement('style');this.style.textContent=STYLE;
  this.offSelection=context.events.subscribe<{recordId:string}>('campus:record-selected',(event:HiveEventEnvelope<{recordId:string}>)=>{
   this.selected=event.payload.recordId;this.render();void this.loadPayments();
  });
  this.render();
  if(context.params['recordId']){this.selected=context.params['recordId']!;void this.loadPayments();}
 }

 update(context:HiveMountContext):void {
  this.context=context;
  if(context.params['recordId']&&context.params['recordId']!==this.selected){this.selected=context.params['recordId']!;void this.loadPayments();}
  this.render();
 }

 unmount():void {
  this.offSelection?.();this.offSelection=null;
  if(this.root)this.root.replaceChildren();
  this.root=null;
 }

 private async loadPayments():Promise<void> {
  if(!this.selected||!this.context.context.authenticated)return;
  const list=this.root?.querySelector('[data-testid=payments]');
  if(!list)return;
  list.textContent='Loading…';
  try{
   const result=await this.http.get<{payments:{id:string;amount:number}[]}>(`/api/routes/finance/payments?record=${encodeURIComponent(this.selected)}`,{signal:this.context.signal});
   list.replaceChildren(...result.payments.map(p=>{const li=this.root!.ownerDocument.createElement('li');li.textContent=`${p.id}: ${p.amount}`;return li;}));
  }catch(error){list.textContent=`Payments unavailable (${(error as {code?:string}).code??'ERROR'})`;}
 }

 private render():void {
  if(!this.root)return;
  const c=this.context, doc=this.root.ownerDocument;
  const canPay=c.permissions.can('finance-example.payments','pay');
  const card=doc.createElement('div');card.className='card';card.setAttribute('data-testid','finance-example');
  card.setAttribute('data-instance',c.instanceId);
  const title=doc.createElement('h2');title.textContent='Finance example';
  const route=doc.createElement('p');route.className='muted';route.setAttribute('data-testid','route');route.textContent=`Route ${c.route} · slot ${c.slotId} · ${c.locale}/${c.direction}`;
  const who=doc.createElement('p');who.setAttribute('data-testid','viewer');
  who.textContent=c.context.authenticated?`Signed in as ${c.context.identity.displayName}`:'Anonymous visitor';
  const record=doc.createElement('p');record.setAttribute('data-testid','selected-record');record.textContent=this.selected?`Selected record: ${this.selected}`:'No record selected';
  const payments=doc.createElement('ul');payments.setAttribute('data-testid','payments');
  const pay=doc.createElement('button');pay.textContent='Record payment';pay.setAttribute('data-testid','pay');pay.hidden=!canPay;
  pay.addEventListener('click',()=>c.events.publish('campus:payment-recorded',{recordId:this.selected??'none'}));
  card.append(title,route,who,record,payments,pay);
  this.root.replaceChildren(this.style,card);
  if(this.selected)void this.loadPayments();
 }
}

const app:HiveMicroApp={contractVersion:'1.1.0',create:()=>new FinanceInstance()};
export default app;
