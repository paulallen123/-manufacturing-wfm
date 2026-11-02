'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// Execute the shipped IIFE and parse its emitted DOM, preserving parent/order,
// attributes, collapsed details and focus. CSS/rendering proof belongs to Chrome.
function fixture(width=1280,deliveryRows=null,backend=null){
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
    if(backend){const response=await backend(url,options);if(response)return response;}
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

const os=require('node:os');
const {Readable}=require('node:stream');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const Reporting=require('../runtime/vector-reporting-service.cjs');
async function lifecycle(t,{hidden={},changeValidation=false,secondSource=null}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'report-lifecycle-')),dbPath=path.join(dir,'fixture.sqlite');
  const db=new DatabaseSync(dbPath);
  db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);');
  db.prepare('INSERT INTO users VALUES(?,?,?)').run('payroll@fixture.invalid','fictional-tenant','payroll_admin');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update('fictional-session').digest('hex'),'payroll@fixture.invalid',Date.now()+600000);
  db.close();
  const service=Reporting.createVectorReportingService({dbPath});
  t.after(()=>{service.close();fs.rmSync(dir,{recursive:true,force:true});});
  async function call(method,url,body){
    const req=Readable.from(body==null?[]:[Buffer.from(JSON.stringify(body))]);Object.assign(req,{method,url,headers:{cookie:'wfm_session=fictional-session'}});
    const res={statusCode:200,headersSent:false,writableEnded:false,setHeader(){},end(value){this.body=String(value);this.headersSent=true;this.writableEnded=true;}};
    await service.handleRequest(req,res);
    return {status:res.statusCode,body:JSON.parse(res.body)};
  }
  const original=(await call('POST','/api/reporting/reports',{definition:{sourceId:'payroll-control',title:'Fictional saved report',columns:['team'],...hidden}})).body.report;
  const other=secondSource?(await call('POST','/api/reporting/reports',{definition:{sourceId:secondSource,title:'Other fictional saved report'}})).body.report:null;
  const calls=[];let hold=false,heldRoute='/api/reporting/reports',release,committed,sourceGate=null;
  const x=fixture(1280,null,async(url,options)=>{
    if(url==='/api/payroll-run'&&sourceGate){sourceGate.started();return sourceGate.response;}
    if(!url.startsWith('/api/reporting/'))return null;
    const method=options?.method||'GET',body=options?.body?JSON.parse(options.body):undefined;
    calls.push({url,method,body});const response=await call(method,url,body);
    if(changeValidation&&url.endsWith('/validate')&&response.body.definition)response.body.definition.claimBoundary='Changed by fictional server policy';
    if(hold&&method==='POST'&&url===heldRoute){hold=false;committed();await new Promise(resolve=>{release=resolve;});}
    return {ok:response.status<400,status:response.status,json:async()=>response.body};
  });
  await x.api.open();await x.click('[data-report-saved-id="'+original.id+'"]');
  function rows(){const db=new DatabaseSync(dbPath);try{return db.prepare('SELECT id,definition_json,definition_digest,version_of FROM vector_report_definitions ORDER BY rowid').all();}finally{db.close();}}
  return {x,original,other,calls,call,rows,saveLabel:()=>x.nodes.get('[data-report-save]').textContent,
    changeView(value='bar'){const el=x.nodes.get('[data-report-visualisation]');el.value=value;return x.nodes.get('vector-reporting-modal').listeners.change({target:el});},
    async template(sourceId='payroll-control'){const id=Reporting.visibleCatalog('payroll_admin').templates.find(r=>r.sourceId===sourceId).id;await x.click('[data-report-template="'+id+'"]');},
    holdSource(){let started,resolve;const began=new Promise(r=>{started=r;});sourceGate={started,response:new Promise(r=>{resolve=r;})};this.releaseSource=body=>resolve({ok:true,status:200,json:async()=>body});return began;},
    holdNextSave(){heldRoute='/api/reporting/reports';hold=true;return new Promise(resolve=>{committed=resolve;});},
    holdAction(route){heldRoute=route;hold=true;return new Promise(resolve=>{committed=resolve;});},release:()=>release()};
}

for(const [key,value] of [['limit',17],['claimBoundary','Fictional estimates remain unverified.']])test('immutable version retains hidden '+key+' through real service and SQLite',async t=>{
  const h=await lifecycle(t,{hidden:{[key]:value}}),before=h.rows()[0];
  await h.x.click('[data-report-save]');
  const rows=h.rows();assert.equal(rows.length,2);const child=JSON.parse(rows[1].definition_json);
  assert.equal(child[key],value);assert.equal(rows[1].version_of,h.original.id);
  assert.equal(rows[0].definition_json,before.definition_json);assert.equal(rows[0].definition_digest,before.definition_digest);
});

test('changed server hidden-setting policy refuses before creating a version',async t=>{
  const h=await lifecycle(t,{hidden:{claimBoundary:'Fictional estimates remain unverified.'},changeValidation:true});
  await h.x.click('[data-report-save]');assert.equal(h.rows().length,1);
  assert.equal(h.calls.filter(r=>r.method==='POST'&&r.url==='/api/reporting/reports').length,0);
  assert.match(h.x.notifications.join(' '),/hidden settings/i);
});

test('editing a saved view never continues to label that edit Saved',async t=>{
  const h=await lifecycle(t);assert.equal(h.saveLabel(),'Saved');h.changeView();assert.equal(h.saveLabel(),'Save');
});

for(const changed of ['template','same-editor'])test('post-commit response cannot mark '+changed+' edits Saved',async t=>{
  const h=await lifecycle(t),committed=h.holdNextSave(),pending=h.x.click('[data-report-save]');
  await committed;
  if(changed==='template')await h.template();else h.changeView();
  h.release();await pending;
  assert.equal(h.rows().length,2,'old request did commit; no cancellation is claimed');
  assert.equal(h.saveLabel(),'Save');assert.equal(h.x.notifications.some(s=>/Report saved as/.test(s)),false);
  assert.match(h.x.notifications.join(' '),/earlier.*version.*created.*current edits remain unsaved/i);
});

for(const action of ['pin','schedule'])test('changed editor stops '+action+' after automatic save committed',async t=>{
  const h=await lifecycle(t);await h.template();
  if(action==='schedule')await h.x.click('[data-report-schedule]');
  const committed=h.holdNextSave(),pending=h.x.click(action==='pin'?'[data-report-pin]':'[data-report-schedule-confirm]');
  await committed;h.changeView();h.release();await pending;
  assert.equal(h.calls.some(r=>r.method==='POST'&&r.url===(action==='pin'?'/api/reporting/dashboards/pin':'/api/reporting/schedules')),false);
  assert.equal(h.saveLabel(),'Save');
});

for(const action of ['pin','schedule'])test('dirty saved view refuses '+action+' without silently targeting its old version',async t=>{
  const h=await lifecycle(t);h.changeView();if(action==='schedule')await h.x.click('[data-report-schedule]');
  await h.x.click(action==='pin'?'[data-report-pin]':'[data-report-schedule-confirm]');
  assert.equal(h.calls.some(r=>r.method==='POST'),false);assert.match(h.x.notifications.join(' '),/save.*edits/i);
});

test('unchanged saved definition retains native pin/unpin and in-app schedule targets',async t=>{
  const h=await lifecycle(t);await h.x.click('[data-report-pin]');await h.x.click('[data-report-pin]');
  await h.x.click('[data-report-schedule]');await h.x.click('[data-report-schedule-confirm]');
  for(const route of ['/api/reporting/dashboards/pin','/api/reporting/dashboards/unpin','/api/reporting/schedules']){
    const request=h.calls.find(r=>r.method==='POST'&&r.url===route);assert.equal(request?.body.reportId,h.original.id);
  }
  const schedules=await h.call('GET','/api/reporting/schedules');assert.equal(schedules.body.schedules[0].schedule.delivery,'in_app');
  assert.equal(h.rows().length,1,'pin and schedule must not create a new report version');
});

for(const selection of ['template','saved'])test('late source rows cannot repaint or export under another '+selection,async t=>{
  const h=await lifecycle(t,{secondSource:'time-review'}),started=h.holdSource(),pending=h.x.click('[data-report-run]');
  await started;
  if(selection==='template')await h.template('time-review');else await h.x.click('[data-report-saved-id="'+h.other.id+'"]');
  const loadingAfterSelection=h.x.nodes.get('[data-report-run]').textContent;
  h.releaseSource({teams:[{team:'OLD_SOURCE_PRIVATE_ROW',unexpectedOldField:'OLD_SOURCE_PRIVATE_COLUMN'}]});await pending;
  assert.doesNotMatch(h.x.nodes.get('[data-report-main]').innerHTML,/OLD_SOURCE_PRIVATE_ROW|OLD_SOURCE_PRIVATE_COLUMN/);
  assert.equal(h.x.nodes.get('[data-report-export]').disabled,true);
  assert.equal(loadingAfterSelection,'Run report','new selection does not inherit old loading state');
  assert.equal(h.x.nodes.get('[data-report-run]').textContent,'Run report');
});

for(const action of ['pin','schedule'])test('committed '+action+' on an earlier version is disclosed without replacing current edits',async t=>{
  const h=await lifecycle(t),route=action==='pin'?'/api/reporting/dashboards/pin':'/api/reporting/schedules';
  if(action==='schedule')await h.x.click('[data-report-schedule]');
  const committed=h.holdAction(route),pending=h.x.click(action==='pin'?'[data-report-pin]':'[data-report-schedule-confirm]');
  await committed;h.changeView('bar');const current=h.x.nodes.get('[data-report-main]').innerHTML;
  h.release();await pending;
  assert.equal(h.x.nodes.get('[data-report-main]').innerHTML,current);
  assert.equal(h.saveLabel(),'Save');
  const native=await h.call('GET',action==='pin'?'/api/reporting/dashboards':'/api/reporting/schedules');
  if(action==='pin')assert.ok(native.body.dashboards[0].dashboard.reportIds.includes(h.original.id));
  else assert.equal(native.body.schedules[0].schedule.reportId,h.original.id);
  assert.match(h.x.notifications.join(' '),action==='pin'?/earlier saved version.*pinned.*current editor/i:/earlier saved version.*scheduled.*current editor/i);
});

for(const action of ['pin','schedule'])test('authority-epoch stale committed '+action+' response does not disclose or repaint',async t=>{
  const h=await lifecycle(t),route=action==='pin'?'/api/reporting/dashboards/pin':'/api/reporting/schedules';
  if(action==='schedule')await h.x.click('[data-report-schedule]');
  const committed=h.holdAction(route),pending=h.x.click(action==='pin'?'[data-report-pin]':'[data-report-schedule-confirm]');
  await committed;h.x.key({key:'Escape'});h.release();await pending;
  assert.deepEqual(h.x.notifications,[]);assert.equal(h.x.nodes.get('vector-reporting-modal').hidden,true);
});

for(const failure of ['network','unavailable'])for(const selection of ['template','saved','edited view'])test('obsolete saved-report '+failure+' failure preserves the newer '+selection,async()=>{
  let entered,release,hold=true;const started=new Promise(resolve=>{entered=resolve;});
  const x=fixture(1280,null,async url=>{
    if(hold&&url==='/api/reporting/reports/private'){
      hold=false;entered();
      return new Promise((resolve,reject)=>{release=()=>failure==='network'
        ?reject(Error('Fictional saved-report connection lost'))
        :resolve({ok:false,status:503,json:async()=>({error:'Fictional saved report unavailable'})});});
    }
    return null;
  });
  await x.api.open();await x.click('[data-report-template="payroll"]');
  const pending=x.click('[data-report-saved-id="private"]');await started;
  if(selection==='saved')await x.click('[data-report-saved-id="private"]');
  else if(selection==='template')await x.click('[data-report-template="payroll"]');
  else{
    const target=x.nodes.get('[data-report-visualisation]');target.value='bar';
    x.nodes.get('vector-reporting-modal').listeners.change({target});
  }
  const current=x.nodes.get('[data-report-main]').innerHTML,refreshes=x.calls.filter(url=>url==='/api/reporting/catalog').length;
  release();await pending;
  assert.equal(x.nodes.get('[data-report-main]').innerHTML,current,'an obsolete ordinary read failure must not discard current work');
  assert.equal(x.calls.filter(url=>url==='/api/reporting/catalog').length,refreshes,'no authority refresh for an obsolete ordinary failure');
  assert.equal(x.nodes.get('[data-report-save]').textContent,selection==='saved'?'Saved':'Save');
  assert.deepEqual(x.notifications,[]);
});

for(const status of [401,403,404])test('obsolete saved-report '+status+' denial still refreshes current authority',async()=>{
  let entered,release,hold=true;const started=new Promise(resolve=>{entered=resolve;});
  const x=fixture(1280,null,async url=>{
    if(hold&&url==='/api/reporting/reports/private'){
      hold=false;entered();return new Promise(resolve=>{release=()=>resolve({ok:false,status,json:async()=>({error:'Fictional saved report denied'})});});
    }
    return null;
  });
  await x.api.open();const pending=x.click('[data-report-saved-id="private"]');await started;
  await x.click('[data-report-template="payroll"]');x.revoke();release();await pending;
  assert.doesNotMatch(x.markup(),/Restricted payroll title|Private payroll question|Payroll secret/);
  assert.match(x.nodes.get('[data-report-main]').textContent,/Choose a question/);
  assert.equal(x.calls.filter(url=>url==='/api/reporting/catalog').length,2);
});

for(const failure of ['network','unavailable'])test('current saved-report '+failure+' failure is disclosed and can be retried',async()=>{
  let fail=true;
  const x=fixture(1280,null,async url=>{
    if(fail&&url==='/api/reporting/reports/private'){
      fail=false;
      if(failure==='network')throw Error('Fictional saved-report connection lost');
      return {ok:false,status:503,json:async()=>({error:'Fictional saved report unavailable'})};
    }
    return null;
  });
  await x.api.open();await x.click('[data-report-saved-id="private"]');
  assert.match(x.notifications.join(' '),/could not open saved report.*again.*retry/i);
  assert.ok(x.nodes.get('[data-report-saved-id="private"]'),'refreshed saved choices remain available');
  await x.click('[data-report-saved-id="private"]');
  assert.equal(x.nodes.get('[data-report-save]').textContent,'Saved');
  assert.match(x.nodes.get('[data-report-main]').textContent,/Payroll secret/);
});

test('closing and reopening during automatic save fences its pin continuation',async()=>{
  let release,started;const pending=new Promise(resolve=>started=resolve),response=new Promise(resolve=>release=resolve);
  const mutationCalls=[];
  const x=fixture(1280,null,async(url,options)=>{
    if(options?.method!=='POST')return null;
    mutationCalls.push(url);
    assert.equal(url,'/api/reporting/reports','old save must never continue into dashboard pin');
    started();await response;
    return {ok:true,status:201,json:async()=>({report:{id:'old-created',title:'Earlier synthetic version',sourceId:'payroll-control',definition:{sourceId:'payroll-control',columns:['team']}}})};
  });
  await x.api.open();await x.click('[data-report-template="payroll"]');
  const pinning=x.click('[data-report-pin]');await pending;
  assert.equal(x.nodes.get('[data-report-save]').textContent,'Saving…');
  x.key({key:'Escape'});
  assert.equal(x.nodes.get('vector-reporting-modal').hidden,true);
  assert.equal(x.document.activeElement,x.launcher);
  await x.api.open();await x.click('[data-report-saved-id="private"]');
  const before=x.nodes.get('[data-report-main]').innerHTML;
  const active=x.document.activeElement;
  release();await pinning;
  assert.deepEqual(mutationCalls,['/api/reporting/reports']);
  assert.equal(x.nodes.get('[data-report-main]').innerHTML,before);
  assert.equal(x.nodes.get('[data-report-save]').textContent,'Saved');
  assert.equal(x.nodes.get('[data-report-save]').disabled,false);
  assert.equal(x.document.activeElement,active);
  assert.deepEqual(x.notifications,[]);
  assert.equal(x.calls.filter(url=>url.endsWith('/catalog')).length,2);
  assert.doesNotMatch(x.markup(),/Earlier synthetic version|old-created/);
});

test('close and reopen after durable automatic save fences pending pin continuation',async t=>{
  const h=await lifecycle(t);await h.template();
  const committed=h.holdNextSave(),pending=h.x.click('[data-report-pin]');
  await committed;
  const committedRows=h.rows();
  assert.equal(committedRows.length,2,'automatic save committed before its response was released');
  const created=committedRows.find(row=>row.id!==h.original.id);
  const saved=await h.call('GET','/api/reporting/reports/'+created.id);
  assert.equal(saved.status,200);assert.equal(saved.body.report.id,created.id);
  const beforePins=await h.call('GET','/api/reporting/dashboards');
  assert.equal(beforePins.status,200);assert.deepEqual(beforePins.body.dashboards,[]);
  h.x.key({key:'Escape'});
  assert.equal(h.x.nodes.get('vector-reporting-modal').hidden,true);
  await h.x.api.open();await h.x.click('[data-report-saved-id="'+h.original.id+'"]');
  const current=h.x.nodes.get('[data-report-main]').innerHTML;
  const notifications=[...h.x.notifications];
  h.release();await pending;
  assert.equal(h.calls.filter(r=>r.method==='POST'&&r.url==='/api/reporting/reports').length,1);
  assert.equal(h.calls.some(r=>r.method==='POST'&&r.url==='/api/reporting/dashboards/pin'),false);
  assert.deepEqual(h.rows(),committedRows,'committed fictional report survives the stale response');
  const readback=await h.call('GET','/api/reporting/reports/'+created.id);
  assert.equal(readback.status,200);assert.equal(readback.body.report.id,created.id);
  assert.equal(JSON.stringify(readback.body.report.definition),JSON.stringify(saved.body.report.definition));
  const dashboards=await h.call('GET','/api/reporting/dashboards');
  assert.equal(dashboards.status,200);assert.deepEqual(dashboards.body.dashboards,[],'no durable dashboard pin');
  assert.equal(h.x.nodes.get('[data-report-main]').innerHTML,current);
  assert.equal(h.saveLabel(),'Saved');assert.equal(h.x.nodes.get('[data-report-save]').disabled,false);
  assert.deepEqual(h.x.notifications,notifications);
});
