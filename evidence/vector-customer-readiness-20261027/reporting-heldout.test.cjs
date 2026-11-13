'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// Execute the shipped IIFE and parse its emitted DOM, preserving parent/order,
// attributes, collapsed details and focus. CSS/rendering proof belongs to Chrome.
function fixture(width=1280,deliveryRows=null){
  const listeners={},calls=[],requests=[],notifications=[],windowEvents={};let authorised=true,pending=null,pendingMutation=null,sourceReply=null,mutationStatus=200,refreshStatus=200,deliveryReply=null;
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
    if(pending)await pending;
    if(url.endsWith('/deliveries')&&deliveryReply)return {ok:deliveryReply.status<400,status:deliveryReply.status,json:async()=>{if(deliveryReply.rejectJson)throw Error('Invalid JSON');return deliveryReply.body;}};
    return {ok:refreshStatus<400,status:refreshStatus,json:async()=>{
      if(refreshStatus>=400)return {error:'Session denied.'};
      if(url.endsWith('/catalog'))return {role:authorised?'payroll_admin':'manager',sources:authorised?[{id:'payroll-control',label:'Payroll secret',description:'Restricted fixture source',fields:['team','period'],endpoint:'/api/payroll-run'}]:[],templates:authorised?[{id:'payroll',sourceId:'payroll-control',label:'Private payroll question',columns:['team']}]:[]};
      if(url.endsWith('/reports'))return {reports:authorised?[report]:[]};
      if(url.endsWith('/dashboards'))return {dashboards:authorised?[{dashboard:{reportIds:['private']}}]:[]};
      if(url.endsWith('/schedules'))return {schedules:authorised?[{id:'schedule',schedule:{reportId:'private',delivery:'email_link',destination:'secret@example.test',hour:8,minute:0,timeZone:'UTC',cadence:'daily'},enabled:true}]:[]};
      if(url.endsWith('/deliveries'))return {deliveries:authorised?(deliveryRows||[{reportId:'private',status:'READY',mode:'in_app',receipt:{externalReceipt:'secret-receipt'}}]):[]};
      if(url.endsWith('/private'))return {report};throw Error('Unexpected request '+url);
    }};
  };
  const source=fs.readFileSync(process.env.VECTOR_REPORTING_SOURCE||path.join(__dirname,'../../reporting/ui/vector-reporting-ui.js'),'utf8');
  vm.runInNewContext(source,{window,document,fetch,MutationObserver:class{observe(){}},setTimeout:f=>{f();return 0;},clearTimeout(){},Intl,Date,Map,Set,alert(){}});
  return {api:window.VectorReporting,nodes,calls,requests,notifications,launcher,document,key:e=>listeners.keydown(e),focus:()=>windowEvents.focus?.(),revoke(){authorised=false;},setDeliveryReply(value){deliveryReply=value;},deny(status){mutationStatus=status;},failRefresh(status){refreshStatus=status;},hold(){pending=new Promise(resolve=>this.release=()=>{pending=null;resolve();});},holdMutation(){pendingMutation=new Promise(resolve=>this.releaseMutation=()=>{pendingMutation=null;resolve();});},deferSource(stage){sourceReply={stage,promise:new Promise((_,reject)=>this.rejectSource=()=>reject(Error('Obsolete source failure')))};},markup(){return document.body.innerHTML;},async click(selector){const target=nodes.get(selector);assert.ok(target,'shipped markup contains '+selector);await nodes.get('vector-reporting-modal').listeners.click({target});}};
}
for(const width of [390,820,1280])test('independent all returned delivery rows '+width,async()=>{
 const rows=Array.from({length:127},(_,i)=>({reportId:'private',status:i%2?'BLOCKED_RECONCILIATION_REQUIRED':'UNKNOWN',mode:'email_link',createdAt:'2026-10-27T00:00:00Z',receipt:{externalReceipt:'DO_NOT_RENDER'},observations:[{detail:'DO_NOT_RENDER'}]}));
 const x=fixture(width,rows);await x.api.open();const host=x.nodes.get('[data-report-deliveries]');
 assert.equal(host.querySelectorAll('.delivery').length,127);assert.doesNotMatch(host.innerHTML,/DO_NOT_RENDER|Ready|ready|success|data-report-retry/);
 await x.click('.delivery');assert.ok(x.requests.some(r=>r.url==='/api/reporting/reports/private'&&r.method==='GET'));assert.equal(x.requests.filter(r=>r.method!=='GET').length,0);
 x.revoke();x.hold();const refreshing=x.focus();assert.doesNotMatch(x.markup(),/Outcome unknown|earlier delivery needs reconciliation|Restricted payroll title/);x.release();await refreshing;
 assert.doesNotMatch(x.markup(),/Outcome unknown|earlier delivery needs reconciliation|Restricted payroll title/);
});
for(const [status,mode] of [['READY',undefined],['READY','email_link'],['READY','sftp'],['VERIFIED','in_app'],['constructor','in_app'],[null,'in_app'],['UNKNOWN','in_app']])test('independent fail-closed '+status+'/'+mode,async()=>{
 const x=fixture(390,[{reportId:'private',status,mode,createdAt:'bad',receipt:{secret:'DO_NOT_RENDER'}}]);await x.api.open();const host=x.nodes.get('[data-report-deliveries]');
 assert.equal(host.querySelectorAll('.delivery').length,1);assert.match(host.textContent,/unknown|unverified/);assert.doesNotMatch(host.innerHTML,/In-product report ready|Invalid Date|DO_NOT_RENDER/);
});
test('independent empty delivery list remains honest',async()=>{const x=fixture(1280,[]);await x.api.open();const host=x.nodes.get('[data-report-deliveries]');assert.equal(host.querySelectorAll('.delivery').length,0);assert.match(host.textContent,/No scheduled deliveries yet/);});

for(const reply of [{status:404},{status:429},{status:502},{status:200,body:null},{status:200,body:{deliveries:'[]'}},{status:200,body:{deliveries:{length:0}}},{status:200,rejectJson:true}])test('independent unavailability and recovery '+JSON.stringify(reply),async()=>{
 const x=fixture(390,[{reportId:'private',status:'UNKNOWN',mode:'email_link'}]);await x.api.open();assert.match(x.markup(),/Outcome unknown/);
 x.setDeliveryReply(reply);await x.focus();const host=x.nodes.get('[data-report-deliveries]');assert.match(host.textContent,/Delivery history is unavailable/);assert.doesNotMatch(host.textContent,/No scheduled deliveries|Outcome unknown/);assert.match(x.nodes.get('[data-report-status]').textContent,/outcomes could not be checked/);
 x.setDeliveryReply(null);await x.focus();assert.match(host.textContent,/Outcome unknown/);assert.doesNotMatch(host.textContent,/Delivery history is unavailable/);assert.equal(x.requests.filter(r=>r.method!=='GET').length,0);
});
for(const status of [401,403])test('independent delayed delivery denial '+status,async()=>{
 const x=fixture();await x.api.open();x.setDeliveryReply({status});x.hold();const refresh=x.focus();assert.doesNotMatch(x.markup(),/Restricted payroll title|Payroll secret|In-product report ready/);x.release();await refresh;assert.doesNotMatch(x.markup(),/Restricted payroll title|Payroll secret|In-product report ready|No scheduled deliveries/);assert.match(x.nodes.get('[data-report-main]').textContent,/No reports available/);
});
for(const status of [404,503,401])test('independent stale delivery failure after close '+status,async()=>{
 const x=fixture();await x.api.open();x.setDeliveryReply({status});x.hold();const refresh=x.focus();x.key({key:'Escape'});x.release();await refresh;
 assert.equal(x.nodes.get('vector-reporting-modal').hidden,true);assert.doesNotMatch(x.markup(),/Restricted payroll title|Payroll secret|Delivery history is unavailable|No scheduled deliveries/);
});
test('independent malformed member fails closed without false empty history',async()=>{
 const x=fixture();x.setDeliveryReply({status:200,body:{deliveries:[null]}});await x.api.open();assert.match(x.nodes.get('[data-report-main]').textContent,/No reports available/);assert.doesNotMatch(x.markup(),/No scheduled deliveries|Restricted payroll title/);
});
