'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { proofRetryDecision: decide } = require(process.env.RETRY_POLICY_UNDER_TEST || './provider-proof-retry-policy.cjs');
const NOW = 1800000000000;
const review = (transport='api',extra={}) => ({ transport, reviewedDigest:'a'.repeat(64), ...extra });
const state = (extra={}) => ({ completedAttempts:1, firstFailureAt:NOW, operation:'read-proof', authorizationValid:true, operationKey:'proof-123', ...extra });
const run = (r=review(),f={code:'timeout'},s=state(),now=NOW) => decide(r,f,s,now);
const denied = result => assert.notEqual(result.action,'RETRY');

test('explicit transient read proof gets a deterministic bounded schedule',()=>{
  const a=run(); assert.equal(a.action,'RETRY'); assert.equal(a.nextAttempt,2);
  assert.ok(a.retryAfterMs>=250 && a.retryAfterMs<=300);
  assert.equal(Date.parse(a.nextAttemptAt),NOW+a.retryAfterMs);
  assert.deepEqual(run(),a); assert.equal(a.firstFailureAt,NOW); assert.ok(Object.isFrozen(a));
});
test('backoff grows with the number of completed attempts',()=>assert.ok(run(review(),{code:'timeout'},state({completedAttempts:2})).retryAfterMs>run().retryAfterMs));
for (const transport of ['api','webhook','queue-stream','secure-file','read-only-db','identity','on-prem-agent','ipaas']) {
  test(transport+' retains a finite transport-specific ceiling',()=>{
    const r=run(review(transport)); assert.equal(r.action,'RETRY');
    denied(run(review(transport),{code:'timeout'},state({completedAttempts:10})));
  });
}
test('attempt limit counts the first provider attempt and cannot be reset',()=>{
  assert.equal(run(review(),{code:'timeout'},state({completedAttempts:4})).nextAttempt,5);
  assert.equal(run(review(),{code:'timeout'},state({completedAttempts:5})).action,'QUARANTINE');
});
test('elapsed budget includes the proposed wait and preserves durable anchor',()=>{
  const s=state({firstFailureAt:NOW-299900}); assert.equal(run(review(),{code:'timeout'},s).action,'QUARANTINE'); assert.equal(s.firstFailureAt,NOW-299900);
  assert.equal(run(review(),{code:'timeout'},state({firstFailureAt:NOW-300001})).action,'QUARANTINE');
});
for (const firstFailureAt of [undefined,null,NaN,Infinity,NOW+1,'2027-01-01',-1]) test('invalid anchor '+String(firstFailureAt)+' cannot renew budget',()=>denied(run(review(),{code:'timeout'},state({firstFailureAt}))));
for (const completedAttempts of [undefined,null,0,-1,1.5,'1',Infinity,Number.MAX_SAFE_INTEGER+1]) test('invalid completed attempts '+String(completedAttempts)+' cannot renew budget',()=>denied(run(review(),{code:'timeout'},state({completedAttempts}))));
test('provider rate-limit minimum is never clipped to the transport delay cap',()=>{
  const r=run(review(),{status:429,retryAfterMs:20000,retryAfter:30}); assert.equal(r.action,'RETRY'); assert.ok(r.retryAfterMs>=30000);
  assert.equal(run(review(),{status:429,retryAfterMs:300001}).action,'QUARANTINE');
});
test('HTTP date hint is a minimum; expired date keeps local floor',()=>{
  assert.equal(run(review(),{status:429,retryAfter:new Date(NOW+60000).toUTCString()}).retryAfterMs,60000);
  assert.ok(run(review(),{status:429,retryAfter:new Date(NOW-60000).toUTCString()}).retryAfterMs>=250);
});
for (const hint of [null,-1,NaN,Infinity,{},[],true,'','  ','tomorrow','x'.repeat(81)]) test('malformed Retry-After '+String(hint)+' is denied',()=>denied(run(review(),{status:429,retryAfter:hint})));
test('malformed direct millisecond hint cannot be hidden by valid seconds hint',()=>denied(run(review(),{status:429,retryAfterMs:'1000',retryAfter:10})));
for (const code of ['auth-expired','auth-revoked','invalid-credential']) test(code+' requires reauthorization despite retry hint',()=>assert.equal(run(review(),{code,status:503,retryable:true}).action,'REAUTHORIZE'));
test('HTTP 401 requires reauthorization',()=>assert.equal(run(review(),{status:401,retryable:true}).action,'REAUTHORIZE'));
for (const code of ['wrong-target','permission-denied','invalid-scope','schema-mismatch','bad-request','write-attempt','credential-missing','unsupported-operation']) test(code+' cannot be overridden by a transient HTTP status',()=>denied(run(review(),{code,status:503,retryable:true})));
for (const status of [400,403,404,405,409,410,422]) test('terminal HTTP '+status+' wins over retry hint',()=>denied(run(review(),{status,retryable:true})));
test('unknown error, raw message and retryable flag never grant retry',()=>{
  const r=run(review(),{code:'secret://credential',message:'secret-value',retryable:true}); denied(r); assert.ok(!JSON.stringify(r).includes('secret'));
});
for (const operation of ['write','authorization','refresh','acknowledge','delete','proof','']) test('operation '+operation+' cannot be automatically replayed',()=>denied(run(review(),{code:'timeout'},state({operation}))));
test('authorization must be current and cannot be replaced by a transport digest',()=>{
  denied(run(review(),{code:'timeout'},state({authorizationValid:false})));
  denied(run(review(),{code:'timeout'},state({authorizationValid:undefined})));
  assert.equal(run(review(),{code:'timeout'},state({authorizationExpiresAt:NOW})).action,'REAUTHORIZE');
  assert.equal(run(review(),{code:'timeout'},state({authorizationExpiresAt:NOW+100})).action,'REAUTHORIZE');
  assert.equal(run(review(),{code:'timeout'},state({authorizationExpiresAt:NOW+1000})).action,'RETRY');
});
for (const transport of ['webhook','queue-stream','secure-file','on-prem-agent','ipaas']) test(transport+' duplicate-sensitive proof requires operation key',()=>denied(run(review(transport),{code:'timeout'},state({operationKey:undefined}))));
test('malformed operation key is denied without echoing it',()=>{ const r=run(review('webhook'),{code:'timeout'},state({operationKey:'password\nsecret'})); denied(r); assert.ok(!JSON.stringify(r).includes('password')); });
test('reviewed policy can tighten but not loosen ceilings',()=>{
  assert.equal(run(review('api',{retryPolicy:{maxAttempts:1}})).action,'QUARANTINE');
  assert.equal(run(review('api',{retryPolicy:{maxElapsedMs:100}})).action,'QUARANTINE');
  for (const retryPolicy of [{maxAttempts:6},{maxElapsedMs:300001},{baseDelayMs:0},{maxAttempts:0},{maxElapsedMs:'1'},null,[]]) denied(run(review('api',{retryPolicy})));
});
for (const r of [review('unknown'),review('API'),review('api',{reviewedDigest:''}),review('api',{reviewedDigest:'unsigned'})]) test('malformed review '+JSON.stringify(r)+' is denied',()=>denied(run(r)));
test('records reject accessors without executing code',()=>{
  let calls=0; for (const slot of ['review','failure','state','policy']) {
    const bad={}; Object.defineProperty(bad,'code',{enumerable:true,get(){calls++; return 'timeout';}});
    denied(slot==='review'?run(bad):slot==='failure'?run(review(),bad):slot==='state'?run(review(),{code:'timeout'},bad):run(review('api',{retryPolicy:bad})));
  } assert.equal(calls,0);
});
test('coercion hooks and inherited records do not execute',()=>{
  let calls=0; const evil={valueOf(){calls++;return 1;},toString(){calls++;return 'timeout';}};
  denied(run(review(),{code:evil})); denied(run(review(),{status:evil})); denied(run(review(),{retryAfter:evil,code:'timeout'}));
  denied(run(Object.create(review()))); assert.equal(calls,0);
});
test('malformed status or clock does not produce a schedule',()=>{
  for (const status of [null,'503',NaN,99,600]) denied(run(review(),{code:'timeout',status}));
  for (const now of [undefined,null,NaN,Infinity,'1800000000000',-1]) denied(decide(review(),{code:'timeout'},state(),now));
});
test('input and nested reviewed policy remain unchanged',()=>{
  const r=review('api',{retryPolicy:{maxAttempts:4}}), f={status:429,retryAfter:1},s=state(); const before=JSON.stringify([r,f,s]); run(r,f,s); assert.equal(JSON.stringify([r,f,s]),before);
});
test('attempt metadata never overflows a safe integer',()=>{
  const r=run(review(),{code:'timeout'},state({completedAttempts:Number.MAX_SAFE_INTEGER}));
  denied(r); assert.ok(r.nextAttempt===undefined || Number.isSafeInteger(r.nextAttempt));
});
test('fractional hints round upward to preserve the provider minimum',()=>{
  assert.equal(run(review(),{status:429,retryAfterMs:1000.1}).retryAfterMs,1001);
  assert.equal(run(review(),{status:429,retryAfter:'1.0001'}).retryAfterMs,1001);
});
test('proxy records are rejected before running any traps',()=>{
  let calls=0; const bad=new Proxy({}, {getPrototypeOf(){calls++;return Object.prototype;},ownKeys(){calls++;return [];},get(){calls++;return 'timeout';}});
  denied(run(bad)); denied(run(review(),bad)); denied(run(review(),{code:'timeout'},bad));
  denied(run(review('api',{retryPolicy:bad}))); assert.equal(calls,0);
});
