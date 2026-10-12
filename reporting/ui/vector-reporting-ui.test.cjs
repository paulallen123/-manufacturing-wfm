'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// Execute the shipped IIFE and parse its emitted DOM, preserving parent/order,
// attributes, collapsed details and focus. CSS/rendering proof belongs to Chrome.
function fixture(width=1280){
  const listeners={},calls=[],requests=[],notifications=[],windowEvents={};let authorised=true,pending=null,pendingMutation=null,sourceReply=null,mutationStatus=200,refreshStatus=200;
  const document={readyState:'complete',addEventListener(k,f){listeners[k]=f;},activeElement:null};
  const voidTags=new Set(['INPUT','BR','HR','IMG','META','LINK']);
  class Element {
    constructor(tag='div',attrs={}){this.tagName=tag.toUpperCase();this.attributes={...attrs};this.children=[];this.parentElement=null;this.listeners={};this.value=attrs.value||'';this.text='';}
    get id(){return this.attributes.id;}set id(v){this.attributes.id=v;}
    get hidden(){return 'hidden' in this.attributes;}set hidden(v){if(v)this.attributes.hidden='';else delete this.attributes.hidden;}
    get open(){return 'open' in this.attributes;}set open(v){if(v)this.attributes.open='';else delete this.attributes.open;}
    get disabled(){return 'disabled' in this.attributes;}
    get dataset(){const data={};for(const [k,v] of Object.entries(this.attributes))if(k.startsWith('data-'))data[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=v;return data;}
    get className(){return this.attributes.class||'';}set className(v){this.attributes.class=v;}
    get classList(){return {add:()=>{},remove:()=>{}};}
    get textContent(){return this.tagName==='#TEXT'?this.text:this.children.map(c=>c.textContent).join('');}
    set textContent(v){const n=new Element('#text');n.text=String(v);this.children=[];this.appendChild(n);}
    get innerHTML(){return this.children.map(c=>c.outerHTML).join('');}
    get outerHTML(){if(this.tagName==='#TEXT')return this.text;const tag=this.tagName.toLowerCase();return '<'+tag+Object.entries(this.attributes).map(([k,v])=>' '+k+'="'+v+'"').join('')+'>'+this.innerHTML+(voidTags.has(this.tagName)?'':'</'+tag+'>');}
    set innerHTML(markup){
      this.children=[];const stack=[this];
      for(const token of String(markup).match(/<[^>]*>|[^<]+/g)||[]){
        if(token.startsWith('</')){if(stack.length>1)stack.pop();continue;}
        if(token.startsWith('<')){
          const tag=token.match(/^<([\w-]+)/)?.[1];if(!tag)continue;const attrs={};
          for(const a of token.slice(tag.length+1,-1).matchAll(/([^\s=]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g))attrs[a[1]]=a[2]??a[3]??a[4]??'';
          const child=new Element(tag,attrs);stack.at(-1).appendChild(child);if(!voidTags.has(child.tagName)&&!token.endsWith('/>'))stack.push(child);
        }else{const child=new Element('#text');child.text=token;stack.at(-1).appendChild(child);}
      }
    }
    appendChild(n){n.parentElement=this;this.children.push(n);return n;}
    addEventListener(k,f){this.listeners[k]=f;}
    matches(selector){return selector.split(',').some(part=>{
      part=part.trim();if(part.includes(':not([disabled])')&&this.disabled)return false;if(part.includes(':not([open])')&&this.open)return false;
      part=part.replace(/:not\(\[[^\]]+\]\)/g,'');
      const tag=part.match(/^[\w-]+/)?.[0];if(tag&&this.tagName!==tag.toUpperCase())return false;
      for(const c of part.matchAll(/\.([\w-]+)/g))if(!this.className.split(/\s+/).includes(c[1]))return false;
      for(const a of part.matchAll(/\[([^=\]]+)(?:="?([^"\]]+)"?)?\]/g)){if(!(a[1] in this.attributes)||(a[2]!=null&&this.attributes[a[1]]!==a[2]))return false;}
      return this.tagName!=='#TEXT';
    });}
    querySelectorAll(s){const all=[];for(const child of this.children){if(child.matches(s))all.push(child);all.push(...child.querySelectorAll(s));}return all;}
    querySelector(s){return this.querySelectorAll(s)[0]||null;}
    closest(s){for(let node=this;node;node=node.parentElement)if(node.matches(s))return node;return null;}
    getClientRects(){for(let parent=this;parent;parent=parent.parentElement){if(parent.hidden)return [];if(parent.tagName==='DETAILS'&&!parent.open&&this!==parent.querySelector('summary'))return [];}return [{width:80,height:30}];}
    focus(){if(this.getClientRects().length&&!this.disabled)document.activeElement=this;}
  }
  document.body=new Element('body');document.documentElement=document.body;document.createElement=tag=>new Element(tag);
  document.getElementById=id=>document.body.querySelectorAll('[id]').find(n=>n.id===id)||null;
  document.querySelector=s=>s.includes('heading:first-child')?null:document.body.querySelector(s);
  const nodes={get:key=>key.includes('[')||key.startsWith('.')?document.querySelector(key):document.getElementById(key)};
  const launcher=document.body.appendChild(new Element('button',{'data-fixture-launch':'1'}));launcher.focus();
  const report={id:'private',title:'Restricted payroll title',sourceId:'payroll-control',definition:{sourceId:'payroll-control',columns:['team']}};
  const window={innerWidth:width,ui:{page:'insights'},toast:m=>notifications.push(m),addEventListener(k,f){windowEvents[k]=f;}};
  const fetch=async (url,options)=>{
    if(url==='/api/payroll-run'&&sourceReply)return sourceReply.stage==='fetch'?await sourceReply.promise:{ok:true,status:200,json:async()=>await sourceReply.promise};
    calls.push(url);requests.push({url,method:options?.method||'GET'});if(options?.method==='POST'){if(pendingMutation)await pendingMutation;return {ok:mutationStatus<400,status:mutationStatus,json:async()=>({error:'Artifact not found.'})};}
    if(pending)await pending;return {ok:refreshStatus<400,status:refreshStatus,json:async()=>{
      if(refreshStatus>=400)return {error:'Session denied.'};
      if(url.endsWith('/catalog'))return {role:authorised?'payroll_admin':'manager',sources:authorised?[{id:'payroll-control',label:'Payroll secret',description:'Restricted fixture source',fields:['team','period'],endpoint:'/api/payroll-run'}]:[],templates:authorised?[{id:'payroll',sourceId:'payroll-control',label:'Private payroll question',columns:['team']}]:[]};
      if(url.endsWith('/reports'))return {reports:authorised?[report]:[]};
      if(url.endsWith('/dashboards'))return {dashboards:authorised?[{dashboard:{reportIds:['private']}}]:[]};
      if(url.endsWith('/schedules'))return {schedules:authorised?[{id:'schedule',schedule:{reportId:'private',delivery:'email_link',destination:'secret@example.test',hour:8,minute:0,timeZone:'UTC',cadence:'daily'},enabled:true}]:[]};
      if(url.endsWith('/deliveries'))return {deliveries:authorised?[{reportId:'private',status:'READY',receipt:{externalReceipt:'secret-receipt'}}]:[]};
      if(url.endsWith('/private'))return {report};throw Error('Unexpected request '+url);
    }};
  };
  const source=fs.readFileSync(path.join(__dirname,'vector-reporting-ui.js'),'utf8');
  vm.runInNewContext(source,{window,document,fetch,MutationObserver:class{observe(){}},setTimeout:f=>{f();return 0;},clearTimeout(){},Intl,Date,Map,Set,alert(){}});
  return {api:window.VectorReporting,nodes,calls,requests,notifications,launcher,document,key:e=>listeners.keydown(e),focus:()=>windowEvents.focus?.(),revoke(){authorised=false;},deny(status){mutationStatus=status;},failRefresh(status){refreshStatus=status;},hold(){pending=new Promise(resolve=>this.release=()=>{pending=null;resolve();});},holdMutation(){pendingMutation=new Promise(resolve=>this.releaseMutation=()=>{pendingMutation=null;resolve();});},deferSource(stage){sourceReply={stage,promise:new Promise((_,reject)=>this.rejectSource=()=>reject(Error('Obsolete source failure')))};},markup(){return document.body.innerHTML;},async click(selector){const target=nodes.get(selector);assert.ok(target,'shipped markup contains '+selector);await nodes.get('vector-reporting-modal').listeners.click({target});}};
}
for(const [name,width] of [['desktop',1280],['tablet',820],['mobile',390]])test(name+' fresh open reconciles catalog/saved/dashboard/schedules without restricted cached metadata',async()=>{
  const x=fixture(width);await x.api.open();assert.match(x.markup(),/Restricted payroll title/);x.key({key:'Escape'});x.revoke();x.hold();const opening=x.api.open();
  assert.doesNotMatch(x.markup(),/Restricted payroll title|Payroll secret|Private payroll question|secret@example|secret-receipt/,'clear restricted DOM before refresh completes');x.release();await opening;
  assert.doesNotMatch(x.markup(),/Restricted payroll title|Payroll secret|Private payroll question|secret@example|secret-receipt/);assert.match(x.nodes.get('[data-report-main]').innerHTML,/Choose a question|No reports available/);
  assert.equal(x.calls.filter(url=>url.endsWith('/catalog')).length,2);for(const endpoint of ['reports','dashboards','schedules','deliveries'])assert.equal(x.requests.filter(r=>r.method==='GET'&&r.url.endsWith('/'+endpoint)).length,2);
});
test('dialog Escape returns focus and announces current controls',async()=>{
  const x=fixture();await x.api.open();assert.equal(x.document.activeElement,x.nodes.get('[data-report-search]'));x.key({key:'Escape'});assert.equal(x.document.activeElement,x.launcher);
  assert.match(x.nodes.get('[data-report-status]').textContent,/Reporting controls updated/);assert.equal(x.nodes.get('[data-report-status]').attributes['aria-live'],'polite');
});
test('returning to the open reporting dialog rechecks server authority',async()=>{
  const x=fixture();await x.api.open();x.revoke();await x.focus();assert.doesNotMatch(x.markup(),/Restricted payroll title|Payroll secret/);assert.equal(x.calls.filter(url=>url.endsWith('/catalog')).length,2);
});
for(const [name,selector,prepare] of [
  ['save','[data-report-save]',()=>{}],['pin','[data-report-pin]',()=>{}],['schedule creation','[data-report-schedule-confirm]',x=>x.click('[data-report-schedule]')],
  ['pause','[data-report-schedule-state]',()=>{}],['resume','[data-report-schedule-state]',x=>{x.nodes.get('[data-report-schedule-state]').attributes['data-next-enabled']='true';}]
])for(const status of [401,403,404])test(name+' denial '+status+' reconciles every surface and open editor',async()=>{
  const x=fixture();await x.api.open();await x.click('[data-report-saved-id]');await prepare(x);assert.match(x.nodes.get('[data-report-main]').innerHTML,/Payroll secret/);x.revoke();x.deny(status);await x.click(selector);
  assert.doesNotMatch(x.markup(),/Restricted payroll title|Payroll secret|Private payroll question|secret@example|secret-receipt|data-report-save=|data-report-schedule-state/);
  assert.equal(x.calls.filter(url=>url.endsWith('/catalog')).length,2);for(const endpoint of ['reports','dashboards','schedules','deliveries'])assert.equal(x.requests.filter(r=>r.method==='GET'&&r.url.endsWith('/'+endpoint)).length,2);
});
test('denied mutation and failed refresh keep all restricted metadata cleared',async()=>{
  const x=fixture();await x.api.open();await x.click('[data-report-saved-id]');x.revoke();x.deny(404);x.failRefresh(401);await x.click('[data-report-save]');
  assert.doesNotMatch(x.markup(),/Restricted payroll title|Payroll secret|Private payroll question|data-report-save=|data-report-schedule-state/);assert.match(x.nodes.get('[data-report-main]').textContent,/No reports available/);
});
test('an obsolete refresh cannot repaint after close',async()=>{
  const x=fixture();await x.api.open();await x.click('[data-report-saved-id]');x.hold();const refresh=x.focus();x.key({key:'Escape'});x.release();await refresh;
  assert.doesNotMatch(x.markup(),/Restricted payroll title|Payroll secret|Private payroll question/);assert.equal(x.nodes.get('vector-reporting-modal').hidden,true);
});
for(const selector of ['[data-report-save]','[data-report-pin]','[data-report-schedule-state]'])test(selector+' obsolete denied mutation neither repaints nor announces stale errors',async()=>{
  const x=fixture();await x.api.open();await x.click('[data-report-saved-id]');x.holdMutation();x.deny(404);const mutation=x.click(selector);
  for(let i=0;i<10&&!x.requests.some(r=>r.method==='POST');i++)await Promise.resolve();assert.ok(x.requests.some(r=>r.method==='POST'));
  x.revoke();await x.focus();x.releaseMutation();await mutation;
  assert.doesNotMatch(x.markup(),/Restricted payroll title|Payroll secret|Private payroll question/);assert.deepEqual(x.notifications,[]);
  assert.equal(x.calls.filter(url=>url.endsWith('/catalog')).length,2,'obsolete denial must not trigger another refresh');
});
for(const stage of ['fetch','json'])test('obsolete rejected '+stage+' after authority refresh preserves the current calm UI',async()=>{
  const x=fixture();await x.api.open();await x.click('[data-report-saved-id]');x.deferSource(stage);const running=x.click('[data-report-run]');
  x.revoke();await x.focus();const before=x.nodes.get('[data-report-main]').innerHTML;x.rejectSource();await running;
  assert.equal(x.nodes.get('[data-report-main]').innerHTML,before);assert.doesNotMatch(x.markup(),/Restricted payroll title|Payroll secret|Try again|Obsolete source failure/);assert.deepEqual(x.notifications,[]);
});
for(const expanded of [false,true])test('shipped editor Tab trap uses actual '+(expanded?'expanded':'collapsed')+' Advanced controls',async()=>{
  const x=fixture();await x.api.open();await x.click('[data-report-saved-id]');const details=x.nodes.get('.vector-reporting-advanced');details.open=expanded;
  const first=x.nodes.get('button[data-report-close]'),last=expanded?details.querySelectorAll('[data-report-column]').at(-1):details.querySelector('summary');
  assert.ok(details.querySelectorAll('input,select,button').length>10,'fixture parses real emitted builder descendants');last.focus();assert.equal(x.document.activeElement,last);let prevented=false;
  x.key({key:'Tab',shiftKey:false,preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(x.document.activeElement,first);
  first.focus();prevented=false;x.key({key:'Tab',shiftKey:true,preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(x.document.activeElement,last);
});
