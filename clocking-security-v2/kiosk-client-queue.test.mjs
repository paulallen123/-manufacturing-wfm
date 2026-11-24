import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const require=createRequire(import.meta.url),__dirname=path.dirname(fileURLToPath(import.meta.url));
'use strict';
// Execute the real client against an IndexedDB-shaped transactional model.
// Detached clones, writer serialization, atomic commit/abort and fresh VMs are
// modeled here; this is not browser/device durability or customer evidence.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const os=require('node:os'),{execFileSync}=require('node:child_process');
const source=fs.readFileSync(process.env.V036_CLIENT_SOURCE||__dirname+'/../ux-overlay/kiosk-client.js','utf8');
const clone=x=>x===undefined?undefined:structuredClone(x),turn=()=>new Promise(r=>setImmediate(r));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};}
function response(results,ok=true){return{ok,json:async()=>({results,error:ok?undefined:'Synthetic rejection'})};}
function fixture(){
 const rows=new Map([['config',{id:'fixture-device',secret:'synthetic-device-secret-not-live-0000',nextSequence:1,clockOffsetMs:0}],['queue',[]]]),waiting=[];let active=false,serial=0;
 const state={rows,failKey:null,nextId:()=>String(++serial).padStart(32,'0')};
 function pump(){if(active||!waiting.length)return;active=true;const tx=waiting.shift();tx.start();}
 state.database={objectStoreNames:{contains:()=>true},transaction(_name,mode){
  let snapshot,started=false,scheduled=false,done=false,aborted=false,ops=[];
  const tx={error:null,objectStore(){return{get:key=>request('get',key),put:(value,key)=>request('put',key,clone(value))};},abort(){if(!done){aborted=true;schedule();}},start(){started=true;snapshot=new Map([...rows].map(([k,v])=>[k,clone(v)]));schedule();}};
  function request(kind,key,value){const req={};ops.push({kind,key,value,req});schedule();return req;}
  function schedule(){if(!started||scheduled||done)return;scheduled=true;queueMicrotask(step);}
  function step(){
   scheduled=false;if(done)return;if(aborted){finish(false);return;}
   const op=ops.shift();if(op){
    if(op.kind==='put'&&state.failKey===op.key){state.failKey=null;tx.error=Error('Synthetic IndexedDB write failure');op.req.error=tx.error;op.req.onerror?.();tx.onerror?.();aborted=true;}
    else if(op.kind==='get'){op.req.result=clone(snapshot.get(op.key));op.req.onsuccess?.();}
    else{assert.equal(mode,'readwrite');snapshot.set(op.key,clone(op.value));op.req.onsuccess?.();}
    schedule();return;
   }
   finish(true);
  }
  function finish(commit){done=true;if(commit){if(mode==='readwrite'){rows.clear();for(const[k,v]of snapshot)rows.set(k,clone(v));}tx.oncomplete?.();}else tx.onabort?.();active=false;pump();}
  waiting.push(tx);queueMicrotask(pump);return tx;
 }};return state;
}
async function harness(state=fixture()){
 const nodes=new Map(),buttons=['in','out','break_start','break_end'].map(kind=>({dataset:{kind}})),calls=[],pending=[];
 const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',className:'',hidden:false});return nodes.get(id);};get('employee').value='fixture-worker';
 get('result').cloneNode=()=>({textContent:'',className:'result'});
 get('setup').append=node=>{nodes.set(node.id,node);node.parentElement=get('setup');};
 const navigator={onLine:false},context=vm.createContext({console,Promise,Set,Map,JSON,Date,Error,Object,Number,queueMicrotask,navigator,location:{protocol:'http:'},crypto:{randomUUID:state.nextId},indexedDB:{open(){const req={};queueMicrotask(()=>{req.result=state.database;req.onsuccess?.();});return req;}},document:{getElementById:get,querySelectorAll:()=>buttons,body:{}},window:{addEventListener(){}},setInterval:()=>0,fetch:async(url,options)=>{calls.push({url,options,payload:JSON.parse(options.body)});const d=deferred();pending.push(d);return d.promise;}});
 vm.runInContext(source,context,{filename:'kiosk-client.js'});for(let i=0;i<4;i++)await turn();assert.equal(typeof get('sync').onclick,'function');
 return{state,get,calls,pending,navigator,tap:kind=>buttons.find(b=>b.dataset.kind===(kind||'in')).onclick(),sync:()=>get('sync').onclick(),async waitCalls(n){for(let i=0;i<20&&calls.length<n;i++)await turn();assert.equal(calls.length,n);},events:()=>clone(state.rows.get('queue'))};
}
test('offline tap commits event and sequence before local success feedback',async()=>{const h=await harness();await h.tap();assert.equal(h.events().length,1);assert.equal(h.events()[0].sequence,1);assert.equal(h.state.rows.get('config').nextSequence,2);assert.equal(h.calls.length,0);assert.match(h.get('result').textContent,/Sync is pending/);});
test('sequential events and sequence survive a fresh UI VM over committed local state',async()=>{const s=fixture(),h=await harness(s);await h.tap();await h.tap('out');const before=h.events(),fresh=await harness(s);assert.deepEqual(fresh.events(),before);assert.deepEqual(before.map(x=>x.sequence),[1,2]);assert.equal(s.rows.get('config').nextSequence,3);assert.equal(fresh.calls.length,0);});
test('failed reconnect retains every pending event',async()=>{const h=await harness();await h.tap();const before=h.events(),p=h.sync();await h.waitCalls(1);h.pending[0].reject(Error('Synthetic offline'));await p;assert.deepEqual(h.events(),before);assert.match(h.get('result').textContent,/retry/);});
test('partial acknowledgement removes only accepted submitted events',async()=>{const h=await harness();await h.tap();await h.tap('out');const q=h.events(),p=h.sync();await h.waitCalls(1);h.pending[0].resolve(response([{eventId:q[0].eventId,status:'accepted'},{eventId:q[1].eventId,status:'held',error:'Synthetic review'}]));await p;assert.deepEqual(h.events(),[q[1]]);assert.match(h.get('result').textContent,/Synthetic review/);});
test('duplicate accepted acknowledgements neither add events nor resend an empty queue',async()=>{const h=await harness();await h.tap();const e=h.events()[0],p=h.sync();await h.waitCalls(1);h.pending[0].resolve(response([{eventId:e.eventId,status:'accepted'},{eventId:e.eventId,status:'accepted',replayed:true}]));await p;assert.deepEqual(h.events(),[]);await h.sync();assert.equal(h.calls.length,1);assert.match(h.get('result').textContent,/normal manager\/payroll review/);});
test('enqueue during pending sync survives older acknowledgement and failed later request',async()=>{
 const h=await harness();await h.tap();const first=h.events()[0];h.navigator.onLine=true;const old=h.sync();await h.waitCalls(1);const edit=h.tap('out');await h.waitCalls(2);const added=h.events().find(x=>x.eventId!==first.eventId);assert.ok(added);
 h.pending[0].resolve(response([{eventId:first.eventId,status:'accepted'}]));await old;h.pending[1].reject(Error('Synthetic second request dropped'));await edit;assert.deepEqual(h.events(),[added]);
});
test('overlapping offline taps preserve both events with distinct sequential identities',async()=>{const h=await harness();await Promise.all([h.tap(),h.tap('out')]);assert.equal(h.events().length,2);assert.deepEqual(h.events().map(x=>x.sequence),[1,2]);assert.equal(new Set(h.events().map(x=>x.eventId)).size,2);assert.equal(h.state.rows.get('config').nextSequence,3);});
test('two UI connections serialize offline queue and sequence updates',async()=>{const s=fixture(),a=await harness(s),b=await harness(s);await Promise.all([a.tap(),b.tap('out')]);assert.equal(a.events().length,2);assert.deepEqual(a.events().map(x=>x.sequence),[1,2]);assert.equal(s.rows.get('config').nextSequence,3);});
test('sequence write failure aborts its event and does not show local success',async()=>{const h=await harness();h.state.failKey='config';await h.tap();assert.deepEqual(h.events(),[]);assert.equal(h.state.rows.get('config').nextSequence,1);assert.equal(h.get('result').className,'result error');await h.tap();assert.equal(h.events().length,1);assert.equal(h.events()[0].sequence,1);});
test('queue write failure leaves sequence unchanged and retry succeeds',async()=>{const h=await harness();h.state.failKey='queue';await h.tap();assert.deepEqual(h.events(),[]);assert.equal(h.state.rows.get('config').nextSequence,1);await h.tap();assert.equal(h.events()[0].sequence,1);});
test('failed acknowledgement transaction keeps the event for an exact retry',async()=>{const h=await harness();await h.tap();const before=h.events(),p=h.sync();await h.waitCalls(1);h.state.failKey='queue';h.pending[0].resolve(response([{eventId:before[0].eventId,status:'accepted'}]));await p;assert.deepEqual(h.events(),before);const retry=h.sync();await h.waitCalls(2);assert.deepEqual(h.calls[1].payload,h.calls[0].payload);h.pending[1].resolve(response([{eventId:before[0].eventId,status:'accepted',replayed:true}]));await retry;assert.deepEqual(h.events(),[]);});
test('unknown response identities never remove legitimate local events',async()=>{const h=await harness();await h.tap();const before=h.events(),p=h.sync();await h.waitCalls(1);h.pending[0].resolve(response([{eventId:'not-submitted',status:'accepted'}]));await p;assert.deepEqual(h.events(),before);});
function v072Registration(h,id='replacement-device',secret='  synthetic-replacement-secret-not-live-0000  '){h.get('deviceId').value=id;h.get('deviceSecret').value=secret;}
function v072View(h){return{setup:h.get('setup').hidden,clock:h.get('clock').hidden,secret:h.get('deviceSecret').value};}
function v072Feedback(h){return h.get(h.get('setup').hidden?'result':'registrationResult');}
function v072Refusal(h){assert.equal(v072Feedback(h).className,'result error');assert.match(v072Feedback(h).textContent,/pending.*review/i);assert.equal(h.calls.length,0);}
test('V072 pending-queue registration: replacement preserves pending bytes, identity, sequence and entered secret',async()=>{
 const h=await harness();await h.tap();v072Registration(h);h.navigator.onLine=true;
 const before=clone([...h.state.rows]),view=v072View(h),queueBytes=JSON.stringify(h.events());
 await h.get('saveDevice').onclick();
 assert.deepEqual([...h.state.rows],before);assert.equal(JSON.stringify(h.events()),queueBytes);assert.deepEqual(v072View(h),view);v072Refusal(h);
});
test('V072 pending-queue registration: same credentials cannot reset the pending sequence',async()=>{
 const h=await harness();await h.tap();await h.tap('out');const current=clone(h.state.rows.get('config'));
 v072Registration(h,current.id,current.secret);const before=clone([...h.state.rows]),view=v072View(h);
 await h.get('saveDevice').onclick();
 assert.deepEqual([...h.state.rows],before);assert.equal(h.state.rows.get('config').nextSequence,3);assert.deepEqual(v072View(h),view);v072Refusal(h);
});
test('V072 pending-queue registration: Forget removes credentials but its orphan queue cannot be rebound',async()=>{
 const h=await harness();await h.tap();const queued=h.events();await h.get('forget').onclick();
 assert.equal(h.state.rows.get('config'),null);assert.deepEqual(h.events(),queued);assert.equal(h.get('setup').hidden,false);assert.equal(h.get('clock').hidden,true);
 v072Registration(h);const before=clone([...h.state.rows]),view=v072View(h);
 await h.get('saveDevice').onclick();
 assert.deepEqual([...h.state.rows],before);assert.deepEqual(v072View(h),view);v072Refusal(h);
});
test('V072 pending-queue registration: a legacy orphan queue remains untouched for review',async()=>{
 const state=fixture();state.rows.delete('config');state.rows.set('queue',[{eventId:'legacy-event',sequence:19,employee:'fixture-worker',type:'in',capturedAt:'2026-11-24T08:00:00.000Z'}]);
 const h=await harness(state);v072Registration(h);const before=clone([...state.rows]),view=v072View(h);
 await h.get('saveDevice').onclick();
 assert.deepEqual([...state.rows],before);assert.equal(state.rows.has('config'),false);assert.deepEqual(v072View(h),view);v072Refusal(h);
});
test('V072 pending-queue registration: empty queues retain initial and replacement registration behavior',async()=>{
 for(const initial of [true,false]){
  const state=fixture();if(initial)state.rows.delete('config');else state.rows.get('config').nextSequence=19;
  const h=await harness(state);v072Registration(h);await h.get('saveDevice').onclick();
  assert.deepEqual(clone(state.rows.get('config')),{id:'replacement-device',secret:'synthetic-replacement-secret-not-live-0000',name:'replacement-device',nextSequence:1,clockOffsetMs:0});
  assert.deepEqual(h.events(),[]);assert.equal(h.get('deviceSecret').value,'');assert.equal(h.get('setup').hidden,true);assert.equal(h.get('clock').hidden,false);assert.equal(h.calls.length,0);
 }
});
test('V072 pending-queue registration: an earlier enqueue transaction prevents a later connection from replacing identity',async()=>{
 const state=fixture(),clock=await harness(state),setup=await harness(state),prior=clone(state.rows.get('config'));v072Registration(setup);const view=v072View(setup);
 const enqueue=clock.tap(),register=setup.get('saveDevice').onclick();await Promise.all([enqueue,register]);
 assert.equal(clock.events().length,1);assert.equal(clock.events()[0].sequence,1);assert.deepEqual(clone(state.rows.get('config')),{...prior,nextSequence:2});
 assert.deepEqual(v072View(setup),view);assert.equal(clock.calls.length,0);v072Refusal(setup);
});
test('V072 pending-queue registration: an aborted registration write preserves state and reports the error',async()=>{
 const h=await harness();h.state.rows.get('config').nextSequence=19;v072Registration(h);const before=clone([...h.state.rows]),view=v072View(h);h.state.failKey='config';
 await assert.doesNotReject(h.get('saveDevice').onclick());
 assert.deepEqual([...h.state.rows],before);assert.deepEqual(v072View(h),view);assert.equal(v072Feedback(h).className,'result error');assert.match(v072Feedback(h).textContent,/Synthetic IndexedDB write failure/);assert.equal(h.calls.length,0);
});
test('V072 pending-queue registration: refusal survives a fresh VM without a replacement sync',async()=>{
 const state=fixture(),first=await harness(state);await first.tap();v072Registration(first);first.navigator.onLine=true;const before=clone([...state.rows]);await first.get('saveDevice').onclick();
 assert.deepEqual([...state.rows],before);v072Refusal(first);
 const fresh=await harness(state);assert.deepEqual([...state.rows],before);assert.equal(fresh.get('setup').hidden,true);assert.equal(fresh.get('clock').hidden,false);assert.equal(fresh.get('queued').textContent,1);
 v072Registration(fresh);fresh.navigator.onLine=true;const view=v072View(fresh);await fresh.get('saveDevice').onclick();
 assert.deepEqual([...state.rows],before);assert.deepEqual(v072View(fresh),view);v072Refusal(fresh);
});
test('registration refusal is displayed inside the visible setup panel after forgetting a kiosk',async()=>{
 const h=await harness();await h.tap();await h.get('forget').onclick();
 v072Registration(h);await h.get('saveDevice').onclick();
 const feedback=h.get('registrationResult');
 assert.equal(feedback.parentElement,h.get('setup'));
 assert.equal(feedback.parentElement.hidden,false);
 assert.match(feedback.textContent,/pending.*review/i);
 assert.equal(h.get('clock').hidden,true);
 assert.equal(h.events().length,1);
});
test('existing-output composition replaces the archived client with the reviewed overlay',t=>{
 const root=path.resolve(__dirname,'..'),out=fs.mkdtempSync(path.join(os.tmpdir(),'v036-existing-composition-'));
 t.after(()=>fs.rmSync(out,{recursive:true,force:true}));
 execFileSync('tar',['--no-same-owner','-xzf',path.join(root,'artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz'),'-C',out]);
 execFileSync(process.execPath,[path.join(root,'scripts/compose-vector-local-runtime.mjs'),out],{stdio:'pipe'});
 assert.deepEqual(fs.readFileSync(path.join(out,'public/kiosk-client.js')),fs.readFileSync(path.join(root,'ux-overlay/kiosk-client.js')));
});
