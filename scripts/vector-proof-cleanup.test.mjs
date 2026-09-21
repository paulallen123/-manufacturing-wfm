import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {trackProofRuntime, cleanupProofResources} from './vector-proof-cleanup.mjs';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const budgets={graceMs:50,forceMs:150};
function childFor(t,code='setInterval(()=>{},1000);process.stdout.write("ready");'){
 const child=spawn(process.execPath,['-e',code],{stdio:['ignore','pipe','ignore']});
 t.after(async()=>{
  if(child.exitCode===null&&child.signalCode===null&&child.pid){
   const closed=once(child,'close');child.kill('SIGKILL');await closed;
  }
 });
 return child;
}

test('already exited runtime resolves immediately without signalling it',async t=>{
 const child=childFor(t,'process.exit(42)');await once(child,'close');
 const stop=trackProofRuntime(child,budgets);let signals=0;
 const kill=child.kill.bind(child);child.kill=(...args)=>{signals++;return kill(...args);};
 const result=await Promise.race([stop(),pause(250).then(()=>null)]);
 assert.equal(result?.stopped,true);assert.equal(result.exitCode,42);assert.equal(signals,0);
});
test('running owned runtime exits and is observed, not merely signalled',async t=>{
 const child=childFor(t);const stop=trackProofRuntime(child,budgets);await once(child.stdout,'data');
 const result=await stop();assert.equal(result.stopped,true);assert.equal(result.forced,false);
 assert.equal(child.signalCode,'SIGTERM');
});
test('graceful termination is allowed to finish before escalation',async t=>{
 const child=childFor(t,'process.on("SIGTERM",()=>setTimeout(()=>process.exit(0),10));setInterval(()=>{},1000);process.stdout.write("ready");');
 const stop=trackProofRuntime(child,{graceMs:200,forceMs:150});await once(child.stdout,'data');
 const result=await stop();assert.equal(result.stopped,true);assert.equal(result.forced,false);assert.equal(result.exitCode,0);
});
test('runtime ignoring graceful termination is force-stopped within the budget',async t=>{
 const child=childFor(t,'process.on("SIGTERM",()=>{});setInterval(()=>{},1000);process.stdout.write("ready");');
 const stop=trackProofRuntime(child,budgets);await once(child.stdout,'data');
 const result=await stop();assert.equal(result.stopped,true);assert.equal(result.forced,true);assert.equal(child.signalCode,'SIGKILL');
});
test('a prior kill request is not mistaken for actual process exit',async t=>{
 const child=childFor(t,'process.on("SIGTERM",()=>{});setInterval(()=>{},1000);process.stdout.write("ready");');
 const stop=trackProofRuntime(child,budgets);await once(child.stdout,'data');child.kill('SIGTERM');
 assert.equal(child.killed,true);assert.equal(child.exitCode,null);assert.equal(child.signalCode,null);
 const result=await stop();assert.equal(result.stopped,true);assert.equal(result.forced,true);
});
test('spawn failure is captured immediately and never awaits a missing exit',async()=>{
 const child=spawn('/__vector_synthetic_missing_executable__',[],{stdio:'ignore'});
 const stop=trackProofRuntime(child,budgets);await new Promise(resolve=>child.once('close',resolve));
 const result=await stop();assert.equal(result.stopped,true);assert.equal(result.errorCode,'ENOENT');
});
test('repeated cleanup shares one shutdown and does not resend termination',async t=>{
 const child=childFor(t);const stop=trackProofRuntime(child,budgets);await once(child.stdout,'data');
 let signals=0;const kill=child.kill.bind(child);child.kill=(...args)=>{signals++;return kill(...args);};
 const first=stop(),second=stop();assert.equal(first,second);await Promise.all([first,second]);assert.equal(signals,1);
});
test('failed signalling times out honestly rather than asserting stopped',async t=>{
 const child=childFor(t);const stop=trackProofRuntime(child,budgets);await once(child.stdout,'data');
 const kill=child.kill.bind(child);child.kill=()=>false;
 try{const result=await stop();assert.equal(result.stopped,false);assert.equal(result.errorCode,'RUNTIME_STOP_TIMEOUT');}
 finally{child.kill=kill;}
});
test('both browser failures still permit owned-runtime cleanup',async t=>{
 const child=childFor(t);const stop=trackProofRuntime(child,budgets);await once(child.stdout,'data');
 const calls=[];
 const result=await cleanupProofResources({context:{close:async()=>{calls.push('context');throw Error('private content');}},browser:{close:async()=>{calls.push('browser');throw Error('private content');}},stopRuntime:stop},{timeoutMs:500});
 assert.deepEqual(calls,['context','browser']);assert.equal(result.runtimeStopped,true);assert.equal(result.status,'FAIL');
 assert.deepEqual(result.failures.map(f=>f.component),['context','browser']);assert.equal(JSON.stringify(result).includes('private content'),false);
});
test('hanging browser closure is bounded and runtime cleanup still executes',async t=>{
 const child=childFor(t);const stop=trackProofRuntime(child,budgets);await once(child.stdout,'data');let browserClosed=false;
 const result=await cleanupProofResources({context:{close:()=>new Promise(()=>{})},browser:{close:async()=>{browserClosed=true;}},stopRuntime:stop},{timeoutMs:300});
 assert.equal(result.status,'FAIL');assert.equal(result.runtimeStopped,true);assert.equal(browserClosed,true);
 assert.deepEqual(result.failures,[{component:'context',code:'CLEANUP_TIMEOUT'}]);
});
test('cleanup failure cannot replace the original proof failure',async()=>{
 const original=Error('ORIGINAL_PROOF_FAILURE');let observed,cleanup;
 try{try{throw original;}finally{cleanup=await cleanupProofResources({context:{close:async()=>{throw Error('secondary');}},stopRuntime:async()=>({stopped:true})},{timeoutMs:100});}}
 catch(error){observed=error;}
 assert.equal(observed,original);assert.equal(cleanup.status,'FAIL');
});
test('missing or unresolved runtime shutdown cannot produce a cleanup pass',async()=>{
 for(const stopRuntime of [undefined,async()=>({stopped:false}),()=>new Promise(()=>{})]){
  const result=await cleanupProofResources({stopRuntime},{timeoutMs:30});assert.equal(result.status,'FAIL');assert.equal(result.runtimeStopped,false);
 }
});
test('invalid shutdown budgets fail before process signalling',async t=>{
 const child=childFor(t);await once(child.stdout,'data');
 assert.throws(()=>trackProofRuntime(child,{graceMs:Infinity}),/budget/i);assert.equal(child.killed,false);
});
test('existing browser assertions are byte-preserved between startup and finalization',()=>{
 const updated=fs.readFileSync(new URL('./vector-five-section-browser-regression.mjs',import.meta.url),'utf8');
 const core=s=>s.slice(s.indexOf('async function check('),s.lastIndexOf('}finally{'));
 assert.equal(createHash('sha256').update(core(updated)).digest('hex'),'1ddb3167f132c9e7ed1dcb15524b19fb1e85ae26ce1b6058d42a42fee4233714');assert.match(updated,/trackProofRuntime\(app\)/);assert.match(updated,/cleanupProofResources\(/);
 assert.match(updated,/if\(cleanup\.status!=='PASS'\)process\.exitCode=1/);
});
