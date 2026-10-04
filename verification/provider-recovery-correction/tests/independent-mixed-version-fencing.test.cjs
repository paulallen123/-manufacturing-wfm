'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const New=require('../operations/runtime/provider-job-store.cjs'),Old=require('./load-sealed-provider-store.cjs');const observations=[];
test.after(()=>fs.writeFileSync(path.join(__dirname,'mixed-version-observations.json'),JSON.stringify({scope:'Exact replacement source vs prior sealed store, disposable SQLite and synthetic clock/worker identity. Mixed code compatibility only, no actual runtime rollback or network/customer/provider action.',observations},null,2)));
function probe(action,legacy){const db=new DatabaseSync(':memory:');let now=1000000;try{
 const old=Old.createStore(db,{now:()=>now}),job=old.ensure({tenant:'isolated-a',connectorId:'synthetic',provider:'synthetic',objectType:'employee',adapterName:'synthetic',providerVersion:'1',fixtureContract:'mixed-version-proof',runKey:'one-run',startRequest:{page:1}});
 old.acquire(job.id,'reused-worker',{leaseMs:1000});now+=1001;const fresh=New.createStore(db,{now:()=>now}),lease=fresh.acquire(job.id,'reused-worker',{leaseMs:1000}),actor={tenant:'isolated-a',permissions:['company.configure']},before=fresh.detail(actor,job.id);let error=null;
 const executor=legacy?old:fresh;try{if(action==='checkpoint')executor.checkpoint(job.id,'reused-worker',{nextRequest:{page:99},pages:1,sourceRecords:1,stagedRecords:1});else if(action==='complete')executor.complete(job.id,'reused-worker');else executor.fail(job.id,'reused-worker',Error('isolated old callback'));}catch(e){error={status:e.status,message:e.message};}
 const after=fresh.detail(actor,job.id);const result={action,legacy,successorGeneration:lease.leaseGeneration,error,successorStatePreserved:JSON.stringify(before)===JSON.stringify(after),afterState:after.state,afterPages:after.pagesCompleted,afterLeaseOwner:after.leaseOwner};observations.push(result);return result;
}finally{db.close();}}
for(const action of ['checkpoint','complete','fail']){
 test('replacement rejects generation-less '+action,()=>{const r=probe(action,false);assert.equal(r.error?.status,409);assert.equal(r.successorStatePreserved,true);});
 test('prior code cannot mutate replacement generation: '+action,()=>{const r=probe(action,true);assert.equal(r.successorStatePreserved,true,'Prior worker code bypasses generation fencing on compatible migrated schema');});
}
