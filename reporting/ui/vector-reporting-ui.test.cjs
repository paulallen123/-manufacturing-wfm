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
  const source=fs.readFileSync(path.join(__dirname,'vector-reporting-ui.js'),'utf8');
  vm.runInNewContext(source,{window,document,fetch,MutationObserver:class{observe(){}},setTimeout:f=>{f();return 0;},clearTimeout(){},Intl,Date,Map,Set,alert(){}});
  return {api:window.VectorReporting,nodes,calls,requests,notifications,launcher,document,key:e=>listeners.keydown(e),focus:()=>windowEvents.focus?.(),revoke(){authorised=false;},setDeliveryReply(value){deliveryReply=value;},deny(status){mutationStatus=status;},failRefresh(status){refreshStatus=status;},hold(){pending=new Promise(resolve=>this.release=()=>{pending=null;resolve();});},holdMutation(){pendingMutation=new Promise(resolve=>this.releaseMutation=()=>{pendingMutation=null;resolve();});},deferSource(stage){sourceReply={stage,promise:new Promise((_,reject)=>this.rejectSource=()=>reject(Error('Obsolete source failure')))};},markup(){return document.body.innerHTML;},async click(selector){const target=nodes.get(selector);assert.ok(target,'shipped markup contains '+selector);await nodes.get('vector-reporting-modal').listeners.click({target});}};
}
for(const [name,width] of [['desktop',1280],['tablet',820],['mobile',390]])test(name+' fresh open reconciles catalog/saved/dashboard/schedules without restricted cached metadata',async()=>{
  const x=fixture(width);await x.api.open();assert.match(x.markup(),/Restricted payroll title/);x.key({key:'Escape'});x.revoke();x.hold();const opening=x.api.open();
  assert.doesNotMatch(x.markup(),/Restricted payroll title|Payroll secret|Private payroll question|secret@example|secret-receipt/,'clear restricted DOM before refresh completes');x.release();await opening;
  assert.doesNotMatch(x.markup(),/Restricted payroll title|Payroll secret|Private payroll question|secret@example|secret-receipt/);assert.match(x.nodes.get('[data-report-main]').innerHTML,/Choose a question|No reports available/);
  assert.equal(x.calls.filter(url=>url.endsWith('/catalog')).length,2);for(const endpoint of ['reports','dashboards','schedules','deliveries'])assert.equal(x.requests.filter(r=>r.method==='GET'&&r.url.endsWith('/'+endpoint)).length,2);
});
test('delivery history exposes unknown and blocked outcomes beyond the old five-row cutoff without external receipts',async()=>{
  const statuses=['READY','READY','READY','READY','READY','UNKNOWN','BLOCKED_RECONCILIATION_REQUIRED','BLOCKED_READBACK_REQUIRED','BLOCKED_NO_ADAPTER','BLOCKED_AUTHORITY_DRIFT','BLOCKED_SCHEDULE_PAUSED'];
  const rows=statuses.map((status,i)=>({reportId:'private',status,mode:i<5?'in_app':'email_link',createdAt:'2026-10-27T12:00:00Z',receipt:{externalReceipt:'secret-receipt',destination:'secret@example.test'},observations:[{private:'provider-secret'}]}));
  const x=fixture(390,rows);await x.api.open();const host=x.nodes.get('[data-report-deliveries]');
  assert.equal(host.querySelectorAll('button').length,statuses.length);
  for(const text of ['In-product report ready','Outcome unknown','earlier delivery needs reconciliation','independent confirmation is unavailable','delivery connection is unavailable','current authorization is unavailable','schedule was paused'])assert.ok(host.textContent.includes(text),text);
  assert.doesNotMatch(host.innerHTML,/secret-receipt|secret@example|provider-secret|data-report-retry|data-report-schedule-state/);
  const before=x.requests.filter(r=>r.method==='POST').length;await x.click('.delivery');
  assert.equal(x.requests.filter(r=>r.method==='POST').length,before,'opening a current report never dispatches or retries');
  x.revoke();await x.focus();assert.doesNotMatch(x.markup(),/Outcome unknown|earlier delivery needs reconciliation|Restricted payroll title/);
});
for(const status of ['SENT','FAILED','READY','VERIFIED','FUTURE_STATUS','toString','__proto__','<img src=x onerror=alert(1)>'])test('external '+status+' remains unverified and escaped',async()=>{
  const x=fixture(1280,[{reportId:'<img src=x onerror=alert(1)>',status,mode:'email_link',createdAt:'not-a-time'}]);await x.api.open();
  const host=x.nodes.get('[data-report-deliveries]');assert.match(host.textContent,/Outcome unverified — reconciliation required/);assert.match(host.textContent,/Time unavailable/);
  assert.doesNotMatch(host.innerHTML,/<img|In-product report ready|Invalid Date|\[native code\]/);assert.match(host.innerHTML,/&lt;img/);
});
test('all authorized unresolved receipts remain visible, including the endpoint hundredth row',async()=>{
  const rows=Array.from({length:100},(_,i)=>({reportId:'private',status:i===99?'UNKNOWN':'READY',mode:'in_app'}));
  const x=fixture(820,rows);await x.api.open();const host=x.nodes.get('[data-report-deliveries]');assert.equal(host.querySelectorAll('button').length,100);assert.match(host.textContent,/Outcome unknown/);
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

for(const reply of [{status:503},{status:404},{status:200,body:{}},{status:200,body:{deliveries:null}},{status:200,rejectJson:true}])test('unavailable delivery history never claims no deliveries: '+JSON.stringify(reply),async()=>{
 const x=fixture();x.setDeliveryReply(reply);await x.api.open();const host=x.nodes.get('[data-report-deliveries]');assert.match(host.textContent,/Delivery history is unavailable/);assert.doesNotMatch(host.textContent,/No scheduled deliveries yet/);assert.match(x.nodes.get('[data-report-status]').textContent,/outcomes could not be checked/);assert.match(x.markup(),/Restricted payroll title/);
});
for(const status of [401,403])test('delivery-only authority denial '+status+' clears the entire reporting surface',async()=>{
 const x=fixture();await x.api.open();x.setDeliveryReply({status});await x.focus();assert.doesNotMatch(x.markup(),/Restricted payroll title|Payroll secret|In-product report ready/);assert.match(x.nodes.get('[data-report-main]').textContent,/No reports available/);
});
test('confirmed empty delivery history remains distinct from unavailable and can recover on refresh',async()=>{
 const x=fixture();x.setDeliveryReply({status:503});await x.api.open();x.setDeliveryReply({status:200,body:{deliveries:[]}});await x.focus();assert.match(x.nodes.get('[data-report-deliveries]').textContent,/No scheduled deliveries yet/);assert.doesNotMatch(x.nodes.get('[data-report-status]').textContent,/unavailable/);
});

// V084 declared episode projection regressions.
function loadProjection(){
 let exported='';const window={};
 let source=fs.readFileSync(path.join(__dirname,process.env.PROJECTION_BASELINE?'baseline-ui.js':'vector-reporting-ui.js'),'utf8');
 // Expose shipped consumer/render/export functions only in this test. Skip DOM
 // installation; production requests, authority and session code stay untouched.
 source=source.slice(0,source.indexOf('const observer=new MutationObserver'))+'window.probe={rowsFor,state,tableMarkup,chartMarkup,csv};})();';
 vm.runInNewContext(source,{window,document:{createElement:()=>({click(){}})},Blob:class{constructor(parts){exported=parts.join('');}},URL:{createObjectURL:()=>'',revokeObjectURL(){}},setTimeout(){},Intl,Date,Map,Set});
 return {...window.probe,exported:()=>exported};
}
const {createDecisionEpisode}=require('../../operations/runtime/decision-episode.cjs');
function episode(){return createDecisionEpisode({tenant:'fictional',site:'fictional-site',decisionType:'fictional-recovery',triggerId:'fixture',contextRevision:'fixture-r1',mode:'SHADOW',triggeredAt:'2026-01-01T00:00:00.000Z',sourceEvidence:['=fictional\tref'],objective:{throughputUnits:1},options:[{id:'do-nothing',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0,prediction:{throughputUnits:0}},{id:'candidate',label:'=Candidate <action>\t',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0,prediction:{throughputUnits:50}}]});}
test('actual helper-produced unselected shadow exposes recommendation estimate without selection or verification',()=>{
 const h=loadProjection(),e=episode(),r=h.rowsFor('decision-outcomes',{episodes:[e]})[0];
 assert.match(r.selectedOption,/Unknown/);assert.match(r.predictedImpact,/Recommendation only/);assert.match(r.predictedImpact,/50/);assert.match(r.actualImpact,/Unknown/);assert.match(r.verification,/Unknown/);assert.match(r.evidenceRef,/fictional/);
});
test('selected estimate, zero/null recorded values and provenance render/export without numeric chart authority',()=>{
 const h=loadProjection(),e=JSON.parse(JSON.stringify(episode()));
 e.selection={optionId:'do-nothing',authorityDecision:'SHADOW_OBSERVED'};
 const selected=e.options.find(option=>option.id==='do-nothing');selected.label='=Selected <action>\t';selected.prediction={throughputUnits:0,overtimeCost:null,blank:'',numericString:'44',nonfinite:Infinity};
 e.outcome={actual:{throughputUnits:0,overtimeCost:null,blank:'',numericString:'55',nonfinite:Infinity},evidenceRefs:['=outcome\nref']};
 const rows=h.rowsFor('decision-outcomes',{episodes:[e]});const r=rows[0];
 assert.equal(r.selectedOption,selected.label);assert.match(r.predictedImpact,/Selected-option estimate/);assert.match(r.predictedImpact,/"throughputUnits":0/);assert.match(r.predictedImpact,/"overtimeCost":null/);assert.doesNotMatch(r.predictedImpact,/50|44|blank|nonfinite/);
 assert.match(r.actualImpact,/Recorded, unverified/);assert.match(r.actualImpact,/"throughputUnits":0/);assert.match(r.actualImpact,/"overtimeCost":null/);assert.doesNotMatch(r.actualImpact,/55|blank|nonfinite/);assert.match(r.verification,/Unknown/);assert.match(r.evidenceRef,/source/);assert.match(r.evidenceRef,/outcome/);
 assert.deepEqual(Object.keys(r).sort(),['site','decisionType','status','selectedOption','verification','predictedImpact','actualImpact','evidenceRef'].sort());
 h.state.rows=rows;h.state.raw={episodes:[e]};h.state.columns=Object.keys(r);
 const html=h.tableMarkup();assert.match(html,/&lt;action&gt;/);assert.match(html,/unverified/);
 for(const kind of ['kpi','bar','line'])assert.match(h.chartMarkup(kind),/No numeric measure/);
 h.csv();assert.match(h.exported(),/Selected-option estimate/);assert.match(h.exported(),/Recorded, unverified/);assert.match(h.exported(),/text:/);assert.doesNotMatch(h.exported(),/SHADOW_OBSERVED/);
});
test('flat legacy episodes use generic mapping per row and empty/null rows remain safe',()=>{
 const h=loadProjection(),flat={decisionType:'legacy',selectedOption:'explicit',actualImpact:'Legacy supplied field'},e=episode();
 const rows=h.rowsFor('decision-outcomes',{episodes:[flat,e,null,{}]});assert.equal(rows[0].actualImpact,flat.actualImpact);assert.equal(rows[0].selectedOption,'explicit');assert.match(rows[1].predictedImpact,/Recommendation only/);assert.equal(Object.keys(rows[2]).length,0);assert.equal(Object.keys(rows[3]).length,0);
 assert.equal(h.rowsFor('decision-outcomes',{episodes:[]}).length,0);assert.equal(h.rowsFor('decision-outcomes',{decisions:[flat]})[0].actualImpact,flat.actualImpact);
});

test('absent and invalid recorded selections are distinct and recommendation stays advisory',()=>{
 const h=loadProjection(),e=episode();
 {const r=h.rowsFor('decision-outcomes',{episodes:[e]})[0];assert.match(r.selectedOption,/no recorded selection/);assert.match(r.predictedImpact,/Recommendation only/);}
 for(const selection of [null,undefined,{optionId:'missing'},{},'',false,0,{optionId:0}]){const r=h.rowsFor('decision-outcomes',{episodes:[{...e,selection}]})[0];assert.match(r.selectedOption,/invalid recorded selection/);assert.match(r.predictedImpact,/Recommendation only/);assert.match(r.verification,/Unknown/);}
});

// V084: fictional decision source-to-reporting boundary.
{
'use strict';
// Fictional private SQLite fixture. No listener, provider, or customer database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createDemandDecisionService } = require('../../operations/runtime/demand-decision-service.cjs');
const { createDecisionEpisode, selectDecisionOption, recordDecisionOutcome } = require('../../operations/runtime/decision-episode.cjs');
const { visibleCatalog } = require('../runtime/vector-reporting-service.cjs');

const hash = value => createHash('sha256').update(String(value)).digest('hex');
function response() {
  return {statusCode:200, headers:{}, headersSent:false, writableEnded:false, body:'',
    setHeader(k,v){this.headers[String(k).toLowerCase()]=v;},
    end(v=''){this.body=String(v);this.headersSent=true;this.writableEnded=true;}};
}
async function get(service, url, token) {
  const req=Readable.from([]); req.method='GET'; req.url=url; req.headers=token?{cookie:'wfm_session='+token}:{};
  const res=response(); await service.handleRequest(req,res);
  return {status:res.statusCode, body:JSON.parse(res.body), headers:res.headers};
}
function projection() {
  const window={};
  let source=fs.readFileSync(path.join(__dirname,'vector-reporting-ui.js'),'utf8');
  const cut=source.indexOf('const observer=new MutationObserver');
  assert.ok(cut>0,'existing VM harness boundary must exist');
  source=source.slice(0,cut)+'window.probe={rowsFor};})();';
  vm.runInNewContext(source,{window,document:{createElement:()=>({click(){}})},Blob:class{},URL:{},setTimeout(){},Intl,Date,Map,Set});
  return window.probe.rowsFor;
}
function episode(tenant,site) {
  return createDecisionEpisode({
    tenant,site,decisionType:'fictional-recovery',triggerId:'fixture-'+site,contextRevision:'fixture-r1',
    mode:'SHADOW',triggeredAt:'2026-01-01T00:00:00.000Z',sourceEvidence:['fictional-source-'+site],
    objective:{throughputUnits:1},
    options:[
      {id:'do-nothing',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0,prediction:{throughputUnits:0}},
      {id:'candidate',label:'Fictional candidate',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0,prediction:{throughputUnits:50}}
    ]
  });
}

test('fictional tenant-scoped decision GET projects saved episodes without inventing outcomes',async()=>{
  const fixtureDir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-v084-'));
  const dbPath=path.join(fixtureDir,'fictional.sqlite');
  let db=new DatabaseSync(dbPath);
  db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL);'+
          'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);');
  const users=[['alpha@example.test','alpha','manager','fictional-alpha-token'],
               ['beta@example.test','beta','manager','fictional-beta-token'],
               ['employee@example.test','alpha','employee','fictional-employee-token']];
  for(const [email,tenant,role,token] of users){
    db.prepare('INSERT INTO users(email,tenant,role) VALUES(?,?,?)').run(email,tenant,role);
    db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)').run(hash(token),email,Date.now()+3600000);
  }
  db.close();
  let service=createDemandDecisionService({dbPath,internalToken:'fictional-unused-v084'});
  try {
    const alphaUnselected=episode('alpha','fictional-alpha-open');
    const selected=selectDecisionOption(episode('alpha','fictional-alpha-recorded'),{
      optionId:'candidate',selectedAt:'2026-01-02T00:00:00.000Z',actorRef:'fictional-actor',authorityDecision:'SHADOW_OBSERVED'});
    const alphaRecorded=recordDecisionOutcome(selected,{
      observedAt:'2026-01-03T00:00:00.000Z',actual:{throughputUnits:0},evidenceRefs:['fictional-outcome-ref']});
    const beta=episode('beta','fictional-beta-private');
    db=new DatabaseSync(dbPath);
    const insert=db.prepare('INSERT INTO vector_decision_episodes(tenant,episode_id,decision_type,episode_json,created_at) VALUES(?,?,?,?,?)');
    for(const e of [alphaUnselected,alphaRecorded,beta])insert.run(e.tenant,e.episodeId,e.decisionType,JSON.stringify(e),e.triggeredAt);
    const before=db.prepare('SELECT tenant,episode_id,episode_json FROM vector_decision_episodes ORDER BY tenant,episode_id').all();
    db.close();

    const catalog=visibleCatalog('manager');
    const source=catalog.sources.find(item=>item.id==='decision-outcomes');
    assert.equal(source.endpoint,'/api/operations/intelligence/decisions');
    assert.equal(visibleCatalog('employee').sources.some(item=>item.id==='decision-outcomes'),false);
    const alpha=await get(service,source.endpoint,'fictional-alpha-token');
    const betaResult=await get(service,source.endpoint,'fictional-beta-token');
    const employee=await get(service,source.endpoint,'fictional-employee-token');
    const anonymous=await get(service,source.endpoint,null);
    assert.equal(alpha.status,200); assert.equal(alpha.headers['cache-control'],'no-store');
    assert.equal(alpha.body.contractVersion,'VECTOR_DECISION_EPISODE_LIST_V1');
    assert.equal(alpha.body.tenant,'alpha'); assert.equal(alpha.body.episodes.length,2);
    assert.doesNotMatch(JSON.stringify(alpha.body),/fictional-beta-private/);
    assert.equal(betaResult.status,200); assert.equal(betaResult.body.tenant,'beta');
    assert.equal(betaResult.body.episodes.length,1);
    assert.doesNotMatch(JSON.stringify(betaResult.body),/fictional-alpha/);
    assert.equal(employee.status,403); assert.equal(anonymous.status,401);

    const rows=projection()('decision-outcomes',alpha.body);
    const open=rows.find(row=>row.site==='fictional-alpha-open');
    const recorded=rows.find(row=>row.site==='fictional-alpha-recorded');
    assert.equal(rows.length,2);
    assert.match(open.selectedOption,/no recorded selection/);
    assert.match(open.predictedImpact,/Recommendation only/);
    assert.match(open.actualImpact,/Unknown/); assert.match(open.verification,/Unknown/);
    assert.equal(recorded.selectedOption,'Fictional candidate');
    assert.match(recorded.predictedImpact,/Selected-option estimate/);
    assert.match(recorded.actualImpact,/Recorded, unverified/);
    assert.match(recorded.actualImpact,/"throughputUnits":0/);
    assert.match(recorded.verification,/Unknown/);
    assert.match(recorded.evidenceRef,/fictional-outcome-ref/);
    assert.doesNotMatch(JSON.stringify(rows),/fictional-beta-private/);


    // Drive the shipped Run function using a fake fetch transport to the real
    // service handler. The modal is a markup-capturing stub, not a browser.
    const main={innerHTML:''}, status={textContent:''};
    const modal={hidden:false,querySelector(selector){
      if(selector==='[data-report-main]')return main;
      if(selector==='[data-report-status]')return status;
      return null;
    }};
    const document={getElementById(id){return id==='vector-reporting-modal'?modal:null;}};
    const window={}; let requests=0;
    const fetch=async(url,options)=>{
      requests++;
      assert.equal(url,source.endpoint);
      assert.equal(options.credentials,'same-origin');
      assert.equal(options.cache,'no-store');
      assert.equal(options.method??'GET','GET');
      const result=await get(service,url,'fictional-alpha-token');
      return {ok:result.status<400,status:result.status,json:async()=>result.body};
    };
    let shipped=fs.readFileSync(path.join(__dirname,'vector-reporting-ui.js'),'utf8');
    const cut=shipped.indexOf('const observer=new MutationObserver');
    assert.ok(cut>0);
    shipped=shipped.slice(0,cut)+'window.probe={run,state};})();';
    vm.runInNewContext(shipped,{window,document,fetch,Intl,Date,Map,Set,setTimeout(){}});
    const ui=window.probe;
    ui.state.catalog=catalog;ui.state.selectedTemplate='decision-learning';ui.state.selectedSource=source;
    ui.state.columns=['site','selectedOption','predictedImpact','actualImpact','verification','evidenceRef'];
    await ui.run();
    assert.equal(requests,1);assert.equal(ui.state.raw.tenant,'alpha');assert.equal(ui.state.rows.length,2);
    assert.match(main.innerHTML,/Recommendation only/);
    assert.match(main.innerHTML,/Recorded, unverified/);
    assert.match(main.innerHTML,/fictional-outcome-ref/);
    assert.doesNotMatch(main.innerHTML,/fictional-beta-private/);

    db=new DatabaseSync(dbPath);
    const after=db.prepare('SELECT tenant,episode_id,episode_json FROM vector_decision_episodes ORDER BY tenant,episode_id').all();
    db.close(); assert.deepEqual(after,before);
    service.close(); service=createDemandDecisionService({dbPath,internalToken:'fictional-unused-v084'});
    const reopened=await get(service,source.endpoint,'fictional-alpha-token');
    assert.equal(reopened.status,200); assert.deepEqual(reopened.body,alpha.body);
  } finally { service.close(); fs.rmSync(fixtureDir,{recursive:true,force:true}); }
});
}
