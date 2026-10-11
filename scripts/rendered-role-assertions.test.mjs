import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createNavigationEvidence, proveRoleView } from './rendered-role-assertions.mjs';

// Offline Chromium fixtures exercise the exact helper used by both hosted runners.
// These tests establish assertion behavior, never customer or hosted proof.
const contracts={
 manager:{home:'What needs your attention right now',homeClass:'vector-home',route:'leave',label:'Review time off',heading:'Absence & Leave',api:'/api/bootstrap'},
 employee:{home:'Maya',homeClass:'employee',route:'personal',label:'Open Personal',heading:'Your work, in one place.',api:'/api/personal'},
 payroll_admin:{home:'Payroll preparation',homeClass:'vw-panel',route:'personal',label:'Personal',heading:'Your work, in one place.',api:'/api/personal'},
 director:{home:'What needs your attention right now',homeClass:'vector-home',route:'onboarding',label:'Employee onboarding',heading:'Employee onboarding',api:'/api/onboarding'}
};
function fixture(kind,role){
 const c=contracts[role],missing=['passkey-only','missing-app'].includes(kind),hidden=kind==='hidden-shell'?'display:none':kind==='transparent-shell'?'opacity:0':'';
 return `<!doctype html><title>Vector · Workforce</title><style>body{font:18px sans-serif}.content{padding:24px}button{padding:20px}</style>
 <button>Manage passkeys</button><!--${'padding'.repeat(2000)}-->
 ${missing?'':`<div class="app" data-vector-shell="test" style="${hidden}"><main class="content"><section class="${c.homeClass}" ${role==='employee'?'data-vector-employee-home="1"':''}><h1>${c.home}</h1></section><button data-vector-route="${c.route}">${c.label}</button></main></div>`}
 <script>
 history.replaceState({},'',location.pathname+'#vector/${role==='payroll_admin'?'payroll-run':'overview'}');
 if(!${kind==='stale-mobile'} || !sessionStorage.loaded)fetch('/api/bootstrap').then(response=>response.json()); sessionStorage.loaded='1';
 document.querySelector('[data-vector-route]')?.addEventListener('click',async()=>{
 if(${kind==='inert-navigation'})return;
 history.pushState({},'','#vector/${c.route}');
 ${kind==='no-route-response'?'':`await fetch('${c.api}').then(response=>response.json());`}
 ${kind==='hash-only'?'':`document.querySelector('.content').innerHTML='<section><h1 style="${kind==='offscreen-outcome'?'position:fixed;left:-9999px':''}">${c.heading}</h1><button>View details</button></section>';`}
 });</script>`;
}
async function browser(t,kind,role='manager',actorRole=role){
 const expectedActor={role:actorRole,tenant:'fixture-tenant',email:'fixture@example.invalid'};
 const responses={'/api/bootstrap':{actor:{...expectedActor,personId:'fixture-person'},state:{version:1,staff:[],org:[],requests:[]}},'/api/personal':{identity:{id:'fixture-person',name:'Maya'},requests:[],shifts:[],leave:null},'/api/onboarding':{people:[],batches:[],limitations:[],invites:[]}};
 const server=http.createServer((req,res)=>{res.setHeader('Cache-Control','no-store');if(req.url.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(responses[req.url]));}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture(kind,role));}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'render-assertions-'));
 const proc=spawn(process.env.CHROMIUM_PATH||'/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',env:{PATH:process.env.PATH,HOME:profile}});
 let ws;
 t.after(async()=>{ws?.close();const exited=once(proc,'exit');proc.kill('SIGTERM');await Promise.race([exited,delay(2000)]);if(proc.exitCode===null)proc.kill('SIGKILL');await new Promise(r=>server.close(r));fs.rmSync(profile,{recursive:true,force:true});});
 let port;for(let i=0;i<100;i++){try{port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];break;}catch{await delay(50);}}
 assert.ok(port,'Chromium did not start');const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();ws=new WebSocket(targets.find(x=>x.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 let id=0;const pending=new Map(),evidence=createNavigationEvidence(origin);
 ws.onmessage=event=>{const msg=JSON.parse(event.data);if(msg.id){const p=pending.get(msg.id);pending.delete(msg.id);msg.error?p.reject(Error(msg.error.message)):p.resolve(msg.result);}else evidence.onEvent(msg);};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
 await send('Page.enable');await send('Network.enable');
 return {send,evidence,role,expectedActor,origin,timeoutMs:450,navigate:()=>send('Page.navigate',{url:origin})};
}
for(const kind of ['passkey-only','hidden-shell','transparent-shell','missing-app','inert-navigation','hash-only','no-route-response','offscreen-outcome'])test('rejects '+kind,async t=>{
 const b=await browser(t,kind);await assert.rejects(()=>proveRoleView(b),/visible|navigation|response|heading|app/i);
});
test('mobile reload rejects stale desktop bootstrap',async t=>{
 const b=await browser(t,'stale-mobile');await proveRoleView(b);
 await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 // Return to the home document without requesting a new bootstrap.
 await assert.rejects(()=>proveRoleView({...b,navigate:()=>b.send('Page.reload',{ignoreCache:true})}),/bootstrap|response/i);
});
for(const role of Object.keys(contracts))test('accepts visible '+role+' home and named route with fresh responses',async t=>{
 const b=await browser(t,'valid',role);await proveRoleView(b);
});

for(const role of Object.keys(contracts))test('fresh mobile navigation accepts '+role,async t=>{
 const b=await browser(t,'valid',role);await proveRoleView(b);
 await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 const result=await proveRoleView({...b,navigate:()=>b.send('Page.reload',{ignoreCache:true})});
 assert.ok(result.home.responses.some(r=>r.path==='/api/bootstrap'));
 assert.equal(result.navigation.route,contracts[role].route);
});
test('late desktop response cannot satisfy a new mobile navigation checkpoint',()=>{
 const e=createNavigationEvidence('http://localhost');
 e.onEvent({method:'Network.requestWillBeSent',params:{requestId:'desktop',request:{url:'http://localhost/api/bootstrap',method:'GET'}}});
 const mobile=e.checkpoint();
 e.onEvent({method:'Network.responseReceived',params:{requestId:'desktop',response:{url:'http://localhost/api/bootstrap',status:200}}});
 e.onEvent({method:'Network.loadingFinished',params:{requestId:'desktop'}});
 assert.deepEqual(e.since(mobile),[]);
 e.onEvent({method:'Network.requestWillBeSent',params:{requestId:'mobile',request:{url:'http://localhost/api/bootstrap',method:'GET'}}});
 e.onEvent({method:'Network.responseReceived',params:{requestId:'mobile',response:{url:'http://localhost/api/bootstrap',status:200}}});
 e.onEvent({method:'Network.loadingFinished',params:{requestId:'mobile'}});
 assert.equal(e.since(mobile).length,1);
});
test('untracked, external and mutation responses are not fresh read proof',()=>{
 const e=createNavigationEvidence('http://localhost'),mark=e.checkpoint();
 for(const [requestId,url,method] of [['external','http://elsewhere/api/bootstrap','GET'],['mutation','http://localhost/api/bootstrap','POST']]){
  e.onEvent({method:'Network.requestWillBeSent',params:{requestId,request:{url,method}}});
  e.onEvent({method:'Network.responseReceived',params:{requestId,response:{url,status:200}}});
 e.onEvent({method:'Network.loadingFinished',params:{requestId:requestId}});
 }
 e.onEvent({method:'Network.responseReceived',params:{requestId:'unknown',response:{url:'http://localhost/api/bootstrap',status:200}}});
 e.onEvent({method:'Network.loadingFinished',params:{requestId:'unknown'}});
 assert.deepEqual(e.since(mark),[]);
});
test('a different role home is not accepted as the authenticated role',async t=>{
 const b=await browser(t,'valid','employee','manager');await assert.rejects(()=>proveRoleView({...b,role:'manager'}),/visible role app home/);
});
for(const role of ['director','payroll_admin'])test('named navigation can open '+role+' menu controls',async t=>{
 const b=await browser(t,'valid',role);
 const navigate=async()=>{
  await b.navigate();
  for(let i=0;i<50;i++){
   const ready=await b.send('Runtime.evaluate',{expression:"!!document.querySelector('[data-vector-route]')",returnByValue:true});
   if(ready.result?.value)break;await delay(20);
  }
  await b.send('Runtime.evaluate',{expression:`{
   const target=document.querySelector('[data-vector-route]');target.hidden=true;
   const via=document.createElement('button');via.textContent='${role==='director'?'Settings & more':'People'}';via.setAttribute('${role==='director'?'data-vector-settings':'data-vector-nav'}','${role==='director'?'':'1'}');
   via.onclick=()=>{target.hidden=false;};document.querySelector('.app').append(via);
  }`});
 };
 const result=await proveRoleView({...b,navigate});assert.equal(result.navigation.route,contracts[role].route);
});
test('navigation tolerates a replaced CDP execution context while waiting for app UI',async t=>{
 const b=await browser(t,'valid');let replaced=false;
 const send=async(method,params)=>{if(method==='Runtime.evaluate'&&!replaced){replaced=true;throw Error('Execution context was destroyed.');}return b.send(method,params);};
 await proveRoleView({...b,send});
});

async function mobileMenuFixture(t, { duplicate = false, inert = false } = {}) {
 const b=await browser(t,'valid',duplicate?'director':'payroll_admin');
 await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 const navigate=async()=>{
  await b.navigate();
  for(let i=0;i<50;i++){
   const ready=await b.send('Runtime.evaluate',{expression:"!!document.querySelector('[data-vector-route]')",returnByValue:true});
   if(ready.result?.value)break;await delay(20);
  }
  await b.send('Runtime.evaluate',{expression:`{
   const app=document.querySelector('.app'),target=app.querySelector('[data-vector-route]');target.hidden=true;
   const meta=document.createElement('meta');meta.name='viewport';meta.content='width=device-width, initial-scale=1';document.head.append(meta);
   const style=document.createElement('style');style.textContent='.mobile-proof-sidebar{position:fixed;left:0;top:0;width:250px;height:100vh;z-index:5;background:white;transform:translateX(-102%);transition:transform .2s ease}body.vector-menu-open .mobile-proof-sidebar{transform:translateX(0)}';document.head.append(style);
   const sidebar=document.createElement('aside');sidebar.className='mobile-proof-sidebar';
   const via=document.createElement('button');via.textContent='${duplicate?'Offscreen settings':'People'}';via.setAttribute('${duplicate?'data-vector-settings':'data-vector-nav'}','${duplicate?'':'1'}');sidebar.append(via);app.prepend(sidebar);
   window.proofClicks=[];
   via.onclick=()=>{window.proofClicks.push(sidebar.getAnimations().some(a=>a.playState==='running')?'moving sidebar':'settled sidebar');target.hidden=false;sidebar.remove();};
   ${duplicate?`const topbar=document.createElement('button');topbar.textContent='Topbar settings';topbar.setAttribute('data-vector-settings','');topbar.onclick=()=>{window.proofClicks.push('topbar');target.hidden=false;};app.append(topbar);`:''}
   const menu=document.createElement('button');menu.textContent='Open menu';menu.setAttribute('data-vector-menu','');menu.style='position:fixed;right:0;top:0;z-index:10';menu.onclick=()=>{window.proofClicks.push('menu');${inert?'':"document.body.classList.add('vector-menu-open');"}};app.append(menu);
   sidebar.getBoundingClientRect();
  }`});
 };
 return {...b,navigate,timeoutMs:1000};
}
test('mobile menu waits for the candidate 200ms sidebar transform before clicking',async t=>{
 const b=await mobileMenuFixture(t);await proveRoleView(b);
 const clicks=await b.send('Runtime.evaluate',{expression:'window.proofClicks',returnByValue:true});
 assert.deepEqual(clicks.result.value,['menu','settled sidebar']);
});
test('mobile duplicate settings selects actionable topbar instead of offscreen first match',async t=>{
 const b=await mobileMenuFixture(t,{duplicate:true});await proveRoleView(b);
 const clicks=await b.send('Runtime.evaluate',{expression:'window.proofClicks',returnByValue:true});
 assert.deepEqual(clicks.result.value,['topbar']);
});
test('mobile inert menu never admits the offscreen sidebar control',async t=>{
 const b=await mobileMenuFixture(t,{inert:true});await assert.rejects(()=>proveRoleView(b),/navigation control.*visible|actionable/i);
 const clicks=await b.send('Runtime.evaluate',{expression:'window.proofClicks',returnByValue:true});
 assert.deepEqual(clicks.result.value,['menu']);
});

test('redirect after checkpoint retains the original request chain start',()=>{
 const e=createNavigationEvidence('http://localhost');
 e.onEvent({method:'Network.requestWillBeSent',params:{requestId:'old-chain',request:{url:'http://localhost/redirect',method:'GET'}}});
 const mobile=e.checkpoint();
 e.onEvent({method:'Network.requestWillBeSent',params:{requestId:'old-chain',redirectResponse:{status:302},request:{url:'http://localhost/api/bootstrap',method:'GET'}}});
 e.onEvent({method:'Network.responseReceived',params:{requestId:'old-chain',response:{url:'http://localhost/api/bootstrap',status:200}}});
 e.onEvent({method:'Network.loadingFinished',params:{requestId:'old-chain'}});
 assert.deepEqual(e.since(mobile),[]);
});
test('genuinely new redirected GET retains fresh request-chain identity',()=>{
 const e=createNavigationEvidence('http://localhost'),mark=e.checkpoint();
 e.onEvent({method:'Network.requestWillBeSent',params:{requestId:'new-chain',request:{url:'http://localhost/redirect',method:'GET'}}});
 const started=e.checkpoint();
 e.onEvent({method:'Network.requestWillBeSent',params:{requestId:'new-chain',redirectResponse:{status:302},request:{url:'http://localhost/api/bootstrap',method:'GET'}}});
 e.onEvent({method:'Network.responseReceived',params:{requestId:'new-chain',response:{url:'http://localhost/api/bootstrap',status:200}}});
 e.onEvent({method:'Network.loadingFinished',params:{requestId:'new-chain'}});
 assert.equal(e.since(mark).length,1);assert.equal(e.since(mark)[0].sequence,started);
});
test('manager priority leave action is not mistaken for route navigation',async t=>{
 const b=await browser(t,'valid');
 const navigate=async()=>{
  await b.navigate();
  for(let i=0;i<50;i++){
   const ready=await b.send('Runtime.evaluate',{expression:"!!document.querySelector('[data-vector-route]')",returnByValue:true});
   if(ready.result?.value)break;await delay(20);
  }
  await b.send('Runtime.evaluate',{expression:`{
   const button=document.createElement('button');button.textContent='Review Maya · leave request';button.dataset.vectorRoute='leave';button.dataset.vectorWorkflow='leave';button.dataset.vectorSourceId='request-1';
   window.priorityOpened=false;button.onclick=()=>{window.priorityOpened=true;};
   document.querySelector('.content').prepend(button);
  }`});
 };
 const result=await proveRoleView({...b,navigate});assert.equal(result.navigation.control,'Review time off');
 const opened=await b.send('Runtime.evaluate',{expression:'window.priorityOpened',returnByValue:true});assert.equal(opened.result.value,false);
});

test('redirected proof still requires a known chain and final same-origin GET',()=>{
 const e=createNavigationEvidence('http://localhost'),mark=e.checkpoint();
 for(const [id,method,url] of [['post','POST','http://localhost/api/bootstrap'],['external','GET','http://elsewhere/api/bootstrap']]){
  e.onEvent({method:'Network.requestWillBeSent',params:{requestId:id,request:{url:'http://localhost/redirect',method:'GET'}}});
  e.onEvent({method:'Network.requestWillBeSent',params:{requestId:id,redirectResponse:{status:307},request:{url,method}}});
  e.onEvent({method:'Network.responseReceived',params:{requestId:id,response:{url,status:200}}});
 e.onEvent({method:'Network.loadingFinished',params:{requestId:id}});
 }
 e.onEvent({method:'Network.requestWillBeSent',params:{requestId:'orphan',redirectResponse:{status:302},request:{url:'http://localhost/api/bootstrap',method:'GET'}}});
 e.onEvent({method:'Network.responseReceived',params:{requestId:'orphan',response:{url:'http://localhost/api/bootstrap',status:200}}});
 e.onEvent({method:'Network.loadingFinished',params:{requestId:'orphan'}});
 assert.deepEqual(e.since(mark),[]);
});
