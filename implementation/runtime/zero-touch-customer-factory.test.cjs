'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createZeroTouchCustomerFactory}=require('./zero-touch-customer-factory.cjs');

test('zero-touch factory advances to LIVE without human orchestration',async()=>{
 const f=createZeroTouchCustomerFactory({maxConcurrency:4,execute:async job=>({status:'PASS',evidence:{stage:job.id}})});
 const r=await f.runUntilBlocked('customer-a');
 assert.equal(r.state,'LIVE');
 assert.ok(f.snapshot().every(j=>j.status==='PASS'));
});

test('retryable lane failure does not stop independent work',async()=>{
 let failed=false;
 const f=createZeroTouchCustomerFactory({maxConcurrency:8,execute:async job=>{
   if(job.id==='RECONCILING'&&!failed){failed=true;return {status:'RETRY',safeRetry:true,evidence:{reason:'temporary'}};}
   return {status:'PASS',evidence:{stage:job.id}};
 }});
 await f.tick('customer-b');
 await f.tick('customer-b');
 await f.tick('customer-b');
 const s=f.snapshot();
 assert.equal(s.find(x=>x.id==='RECONCILING').status,'PENDING');
 assert.equal(s.find(x=>x.id==='CONNECTING').status,'PASS');
 const r=await f.runUntilBlocked('customer-b');
 assert.equal(r.state,'LIVE');
});

test('unsafe failure fails closed and prevents dependent promotion',async()=>{
 const f=createZeroTouchCustomerFactory({execute:async job=>job.id==='PROVING'?{status:'FAIL',safeRetry:false,evidence:{reason:'unproven'}}:{status:'PASS'}});
 const r=await f.runUntilBlocked('customer-c');
 assert.equal(r.state,'BLOCKED');
 assert.equal(f.snapshot().find(x=>x.id==='PROVING').status,'FAILED_CLOSED');
 assert.notEqual(f.snapshot().find(x=>x.id==='LIVE').status,'PASS');
});
