'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {input,fixture,verifierFor,post,serviceFor,rows}=require('./delivery-replay-fixture.cjs');

test('verifier mutation after attestation cannot change evaluated tenant or economics',async()=>{
  const f=fixture(),snapshot=input(),verify=verifierFor(snapshot);
  let borrowed,enter,release;
  const entered=new Promise(r=>{enter=r;}),gate=new Promise(r=>{release=r;});
  const service=serviceFor(f,async(candidate,tenant)=>{
    const accepted=verify(candidate,tenant);borrowed=candidate;enter();await gate;return accepted;
  });
  try{
    const pending=post(service,snapshot);await entered;
    borrowed.scope.tenant='other-tenant';
    borrowed.evidence.forEach(e=>{e.scope.tenant='other-tenant';});
    borrowed.evidence.find(e=>e.kind==='economics').payload.customerPenalty=800000;
    release();
    const response=await pending;
    assert.equal(response.status,422);
    assert.equal(rows(f).length,0);
  }finally{release?.();service.close();f.close();}
});

test('unmodified source attestation and exact replay remain available',async()=>{
  const f=fixture(),snapshot=input(),service=serviceFor(f,verifierFor(snapshot));
  try{
    const first=await post(service,snapshot),replay=await post(service,snapshot);
    assert.equal(first.status,201);
    assert.equal(replay.status,200);
    assert.equal(replay.body.shadow.digest,first.body.shadow.digest);
    assert.equal(rows(f).length,1);
  }finally{service.close();f.close();}
});

test('verifier exceptions refuse without an unverified write',async()=>{
  const f=fixture(),service=serviceFor(f,()=>{throw Error('source unavailable');});
  try{assert.equal((await post(service,input())).status,422);assert.equal(rows(f).length,0);}
  finally{service.close();f.close();}
});
