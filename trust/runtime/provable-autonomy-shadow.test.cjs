'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {generateKeyPairSync}=require('node:crypto');
const {createShadowEvidence,verifyPermit,verifyReceipt}=require('./provable-autonomy-shadow.cjs');

const key=generateKeyPairSync('ed25519');
const hash='a'.repeat(64);
const clock=()=>1000;
const fields={tenant:'tenant-a',site:'site-1',action:'integration.retry',resources:['connection-1'],tools:['connector.retry'],policyHash:hash,buildHash:'b'.repeat(64),dataClass:'workforce-metadata',issuedAt:900,expiresAt:1100,nonce:'nonce-unique-1',maxCalls:1};
const context={tenant:'tenant-a',site:'site-1',policyHash:hash,buildHash:'b'.repeat(64),revokedKeyIds:new Set()};
function make(){return createShadowEvidence({privateKey:key.privateKey,keyId:'software-test-key',now:clock});}
function keys(){return new Map([['software-test-key',key.publicKey]]);}
function fixture(){const writer=make();const permit=writer.issuePermit(fields);return {writer,permit};}

test('signed shadow permit and receipt verify without granting execution authority',()=>{
  const {writer,permit}=fixture();
  const receipt=writer.issueReceipt(permit,{executorBuildHash:context.buildHash,startedAt:950,endedAt:960,tools:['connector.retry'],resources:['connection-1'],callCount:1,transcriptHash:'c'.repeat(64),status:'SUCCEEDED',reasonCode:'VERIFIED'});
  assert.deepEqual(verifyPermit(permit,{publicKeys:keys(),now:clock,...context}),{ok:true,trustLevel:'L1_SOFTWARE_SIGNED',executionAuthorityGranted:false});
  assert.deepEqual(verifyReceipt(receipt,permit,{publicKeys:keys(),now:clock,...context}),{ok:true,trustLevel:'L1_SOFTWARE_SIGNED',executionAuthorityGranted:false,status:'SUCCEEDED'});
  assert.deepEqual(verifyReceipt(receipt,permit,{publicKeys:keys(),now:clock,...context}),{ok:true,trustLevel:'L1_SOFTWARE_SIGNED',executionAuthorityGranted:false,status:'SUCCEEDED'});
});

test('tampering, wrong scope, build or policy, expiry and revoked key fail closed',()=>{
  const {permit}=fixture();
  for(const changed of [{...permit,tenant:'tenant-b'},{...permit,resources:['connection-2']},{...permit,signature:'invalid'}]){
    assert.equal(verifyPermit(changed,{publicKeys:keys(),now:clock,...context}).ok,false);
  }
  for(const changed of [{tenant:'tenant-b'},{site:'site-2'},{policyHash:'d'.repeat(64)},{buildHash:'e'.repeat(64)}]){
    assert.equal(verifyPermit(permit,{publicKeys:keys(),now:clock,...context,...changed}).ok,false);
  }
  assert.equal(verifyPermit(permit,{publicKeys:keys(),now:()=>1101,...context}).ok,false);
  assert.equal(verifyPermit(permit,{publicKeys:keys(),now:clock,...context,revokedKeyIds:new Set(['software-test-key'])}).ok,false);
  assert.equal(verifyPermit(permit,{publicKeys:new Map(),now:clock,...context}).ok,false);
});

test('receipt rejects unapproved tool, resource, budget, wrong build and tampering',()=>{
  const {writer,permit}=fixture();
  const base={executorBuildHash:context.buildHash,startedAt:950,endedAt:960,tools:['connector.retry'],resources:['connection-1'],callCount:1,transcriptHash:'c'.repeat(64),status:'SUCCEEDED',reasonCode:'VERIFIED'};
  for(const changed of [{tools:['connector.write']},{resources:['connection-2']},{callCount:2},{executorBuildHash:'d'.repeat(64)}]){
    const receipt=writer.issueReceipt(permit,{...base,...changed});
    assert.equal(verifyReceipt(receipt,permit,{publicKeys:keys(),now:clock,...context}).ok,false);
  }
  const receipt=writer.issueReceipt(permit,base);
  assert.equal(verifyReceipt({...receipt,status:'FAILED'},permit,{publicKeys:keys(),now:clock,...context}).ok,false);
});

test('missing receipt and incomplete action are never reported as success',()=>{
  const {writer,permit}=fixture();
  assert.equal(verifyReceipt(null,permit,{publicKeys:keys(),now:clock,...context}).ok,false);
  const incomplete=writer.issueReceipt(permit,{executorBuildHash:context.buildHash,startedAt:950,endedAt:960,tools:[],resources:[],callCount:0,transcriptHash:'c'.repeat(64),status:'INCOMPLETE',reasonCode:'EXECUTOR_CRASH'});
  const result=verifyReceipt(incomplete,permit,{publicKeys:keys(),now:clock,...context});
  assert.equal(result.ok,true);
  assert.equal(result.status,'INCOMPLETE');
  assert.equal(result.executionAuthorityGranted,false);
});

test('strict portable schema rejects extra fields and raw sensitive values',()=>{
  const writer=make();
  assert.throws(()=>writer.issuePermit({...fields,payrollValue:123}));
  assert.throws(()=>writer.issuePermit({...fields,dataClass:'raw-health-record'}));
  const permit=writer.issuePermit(fields);
  assert.equal(verifyPermit({...permit,prompt:'secret'}, {publicKeys:keys(),now:clock,...context}).ok,false);
  assert.throws(()=>writer.issueReceipt(permit,{status:'SUCCEEDED',rawResponse:'secret'}));
});

test('bounded nonce ledger detects replay; offline revocation state fails closed',()=>{
  const {permit}=fixture();const used=new Set();
  const options={publicKeys:keys(),now:clock,...context,nonceLedger:{claim(id){if(used.has(id))return false;used.add(id);return true;}}};
  assert.equal(verifyPermit(permit,{...options,consume:true}).ok,true);
  assert.equal(verifyPermit(permit,{...options,consume:true}).ok,false);
  assert.equal(verifyPermit(permit,{...options,consume:true,revokedKeyIds:null}).ok,false);
});

test('1000 synthetic permit cases reject tampering, expiry, wrong tenant and replay',()=>{
  const writer=make(),used=new Set(),latencies=[];
  const options={publicKeys:keys(),now:clock,...context,nonceLedger:{claim(id){if(used.has(id))return false;used.add(id);return true;}}};
  for(let i=0;i<1000;i++){
    const start=process.hrtime.bigint();
    const permit=writer.issuePermit({...fields,nonce:`nonce-case-${i}`});
    assert.equal(verifyPermit(permit,{...options,consume:true}).ok,true);
    const attack=i%4;
    const rejected=attack===0?verifyPermit({...permit,maxCalls:2},options):
      attack===1?verifyPermit(permit,{...options,now:()=>1101}):
      attack===2?verifyPermit(permit,{...options,tenant:'tenant-b'}):
      verifyPermit(permit,{...options,consume:true});
    assert.equal(rejected.ok,false,`case ${i} must fail closed`);
    latencies.push(Number(process.hrtime.bigint()-start)/1e6);
  }
  latencies.sort((a,b)=>a-b);
  assert.ok(latencies[500]<=25,`median synthetic signing and verification ${latencies[500]}ms`);
});
