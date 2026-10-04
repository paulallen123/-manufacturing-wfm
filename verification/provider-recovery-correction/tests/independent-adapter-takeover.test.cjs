'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const PJ=require('../operations/runtime/provider-job-store.cjs'),PA=require('../operations/runtime/provider-adapter-contract.cjs');
const observations=[];
test.after(()=>fs.writeFileSync(path.join(__dirname,'independent-adapter-takeover-observations.json'),JSON.stringify({scope:'Undeployed owner correction; synthetic async callback barriers, disposable in-memory SQLite. No network, provider or customer mutation. Staging callback increments an isolated memory counter only.',observations},null,2)));
async function probe(boundary){
 const db=new DatabaseSync(':memory:');let now=1000000,fetchCalls=0,stageCalls=0,release,entered;
 const barrier=new Promise(r=>{release=r;}),arrival=new Promise(r=>{entered=r;});
 const jobs=PJ.createStore(db,{now:()=>now});const actor={tenant:'isolated-a',permissions:['company.configure']};
 const job=jobs.ensure({tenant:actor.tenant,connectorId:'synthetic',provider:'synthetic',objectType:'employee',adapterName:'synthetic',providerVersion:'1',fixtureContract:'independent-async-takeover',runKey:'one-run',startRequest:{page:1}});
 try{
  const running=PA.runDurableAdapterJob({jobStore:jobs,jobId:job.id,workerId:'old-worker',leaseMs:1000,name:'synthetic',
   tokenLease:{get:async()=>{if(boundary==='token'){entered();await barrier;}return 'synthetic-token';}},
   fetchPage:async()=>{fetchCalls++;if(boundary==='fetch'){entered();await barrier;}return {status:200,body:{}};},
   mapPage:()=>({envelope:{records:[{id:'synthetic-1'}],cursor:'page-1',sourceVersion:'1'},nextRequest:null,reconciliation:{sourceCount:1}}),
   submitBatch:async()=>{stageCalls++;return {valid:1,held:0,applied:1};}
  }).then(()=>({unexpectedSuccess:true}),e=>({status:e.status,message:e.message,leaseUpdateError:e.leaseUpdateError}));
  await arrival;now+=1001;const successor=jobs.acquire(job.id,'successor-worker',{leaseMs:1000});const before=jobs.detail(actor,job.id);
  release();const error=await running;const after=jobs.detail(actor,job.id);
  const result={boundary,fetchCalls,stageCalls,successorGeneration:successor.leaseGeneration,jobLedgerPreserved:JSON.stringify(before)===JSON.stringify(after),error};observations.push(result);return result;
 }finally{db.close();}
}
for(const boundary of ['token','fetch']){
 let observation;
 test(boundary+' takeover preserves successor job ledger',async()=>{observation=await probe(boundary);assert.equal(observation.error.status,409);assert.equal(observation.jobLedgerPreserved,true);});
 test(boundary+' takeover fences downstream adapter callbacks',()=>{if(boundary==='token')assert.equal(observation.fetchCalls,0,'Old generation invoked fetchPage after losing lease while awaiting token');assert.equal(observation.stageCalls,0,'Old generation invoked submitBatch after losing lease while awaiting response');});
}
