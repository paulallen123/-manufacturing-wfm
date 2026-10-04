'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{Worker}=require('node:worker_threads');
const modulePath=path.resolve(__dirname,'../operations/runtime/provider-job-store.cjs');
const PJ=require(modulePath);
const actor={tenant:'isolated-a',permissions:['company.configure']};
function setup(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-corrected-lease-')),dbPath=path.join(dir,'state.sqlite'),db=new DatabaseSync(dbPath);
 let now=1000000;const jobs=PJ.createStore(db,{now:()=>now});
 const run=jobs.ensure({tenant:actor.tenant,connectorId:'synthetic',provider:'synthetic',objectType:'employee',adapterName:'synthetic',providerVersion:'1',fixtureContract:'correction-local-only',runKey:'one-run',startRequest:{page:1}});
 return {dir,dbPath,db,jobs,run,advance:()=>{now+=1001;},close:()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
function callback(jobs,id,worker,action,generation){
 const args={leaseGeneration:generation};
 if(action==='checkpoint')return jobs.checkpoint(id,worker,{...args,nextRequest:{page:99},pages:1,sourceRecords:1,stagedRecords:1});
 if(action==='complete')return jobs.complete(id,worker,args);
 return jobs.fail(id,worker,new Error('delayed callback'),args);
}
for(const action of ['checkpoint','complete','fail']){
 for(const recovery of ['different-worker-id','reused-worker-id','expired-without-recovery'])test(`${recovery} fences explicit old generation: ${action}`,()=>{
  const s=setup();try{
   const old=s.jobs.acquire(s.run.id,'old-worker',{leaseMs:1000});s.advance();
   if(recovery!=='expired-without-recovery')s.jobs.acquire(s.run.id,recovery==='reused-worker-id'?'old-worker':'successor-worker',{leaseMs:1000});
   const before=s.jobs.detail(actor,s.run.id);
   assert.throws(()=>callback(s.jobs,s.run.id,'old-worker',action,old.leaseGeneration),{status:409});
   assert.deepEqual(s.jobs.detail(actor,s.run.id),before);
  }finally{s.close();}
 });
 test(`valid current generation commits ${action}`,()=>{const s=setup();try{
  const lease=s.jobs.acquire(s.run.id,'worker');const result=callback(s.jobs,s.run.id,'worker',action,lease.leaseGeneration);
  assert.equal(result.state,{checkpoint:'running',complete:'completed',fail:'retry'}[action]);
  assert.equal(s.jobs.detail(actor,s.run.id).events.at(-1).type,{checkpoint:'checkpoint',complete:'completed',fail:'retry-scheduled'}[action]);
 }finally{s.close();}});
 test(`missing generation fails closed ${action}`,()=>{const s=setup();try{s.jobs.acquire(s.run.id,'worker');const before=s.jobs.detail(actor,s.run.id);assert.throws(()=>callback(s.jobs,s.run.id,'worker',action,undefined),{status:409});assert.deepEqual(s.jobs.detail(actor,s.run.id),before);}finally{s.close();}});
 test(`event failure rolls back ${action}`,()=>{const s=setup();try{
  const lease=s.jobs.acquire(s.run.id,'worker'),before=s.jobs.detail(actor,s.run.id);
  s.db.exec("CREATE TRIGGER injected_audit_failure BEFORE INSERT ON provider_adapter_run_events BEGIN SELECT RAISE(ABORT,'injected audit failure'); END;");
  assert.throws(()=>callback(s.jobs,s.run.id,'worker',action,lease.leaseGeneration),/injected audit failure/);
  assert.deepEqual(s.jobs.detail(actor,s.run.id),before);
 }finally{s.close();}});
 for(const reuse of [false,true])test(`takeover after initial validation rejects ${action}, reused worker=${reuse}`,async()=>{
  const s=setup();let worker;try{
   const old=s.jobs.acquire(s.run.id,'old-worker',{leaseMs:1000});
   const sab=new SharedArrayBuffer(4),gate=new Int32Array(sab);
   // Pause after initial read/validation, immediately BEFORE obtaining the write lock.
   // Pausing inside the write transaction would prevent takeover and test a different ordering.
   worker=new Worker(`const {parentPort,workerData:d}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');const PJ=require(d.modulePath);const db=new DatabaseSync(d.dbPath);const gate=new Int32Array(d.sab),exec=db.exec.bind(db);db.exec=(sql)=>{if(sql==='BEGIN IMMEDIATE'){parentPort.postMessage({phase:'validated'});if(Atomics.wait(gate,0,0,5000)==='timed-out')throw Error('takeover barrier timeout');}return exec(sql);};const jobs=PJ.createStore(db,{now:()=>1000000});try{const args={leaseGeneration:d.generation};if(d.action==='checkpoint')jobs.checkpoint(d.id,'old-worker',{...args,nextRequest:{page:99},pages:1,sourceRecords:1,stagedRecords:1});else if(d.action==='complete')jobs.complete(d.id,'old-worker',args);else jobs.fail(d.id,'old-worker',Error('late failure'),args);parentPort.postMessage({phase:'finished',rejected:false});}catch(e){parentPort.postMessage({phase:'finished',rejected:true,status:e.status,message:e.message});}finally{db.close();}`,{eval:true,workerData:{modulePath,dbPath:s.dbPath,id:s.run.id,sab,action,generation:old.leaseGeneration}});
   let successorSnapshot;
   const outcome=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('barrier timeout')),7000);worker.on('error',e=>{clearTimeout(timer);reject(e);});worker.on('message',m=>{
    if(m.phase==='validated'){try{s.advance();s.jobs.acquire(s.run.id,reuse?'old-worker':'successor-worker',{leaseMs:1000});successorSnapshot=s.jobs.detail(actor,s.run.id);Atomics.store(gate,0,1);Atomics.notify(gate,0);}catch(e){clearTimeout(timer);reject(e);}}
    else{clearTimeout(timer);resolve(m);}
   });});
   assert.equal(outcome.rejected,true);assert.equal(outcome.status,409);
   assert.deepEqual(s.jobs.detail(actor,s.run.id),successorSnapshot);
  }finally{if(worker)await worker.terminate();s.close();}
 });
}
test('lease generation persists across database reopen',()=>{const s=setup();try{
 const old=s.jobs.acquire(s.run.id,'worker',{leaseMs:1000});s.db.close();
 s.db=new DatabaseSync(s.dbPath);s.jobs=PJ.createStore(s.db,{now:()=>1001001});
 const next=s.jobs.acquire(s.run.id,'worker',{leaseMs:1000});assert.equal(next.leaseGeneration,old.leaseGeneration+1);
 assert.throws(()=>s.jobs.complete(s.run.id,'worker',{leaseGeneration:old.leaseGeneration}),{status:409});
 assert.equal(s.jobs.complete(s.run.id,'worker',{leaseGeneration:next.leaseGeneration}).state,'completed');
}finally{s.db.close();fs.rmSync(s.dir,{recursive:true,force:true});}});
