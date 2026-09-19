import test from 'node:test';
import assert from 'node:assert/strict';
import {TelemetryContinuityGuard} from './telemetry-continuity-guard.mjs';

const T=Date.parse('2026-09-19T02:00:00Z');
function healthy(options={}){
  const g=new TelemetryContinuityGuard(options);
  g.observeHeartbeat({stream:'http',sequence:1,observedAtMs:T,receivedAtMs:T});
  g.emitCanary({canaryId:'c1',emittedAtMs:T+1_000,stream:'http'});
  g.observeCanary({canaryId:'c1',observedAtMs:T+2_000,receivedAtMs:T+2_000});
  return g;
}

test('fresh heartbeat and recent observed canary keep telemetry healthy',()=>{
  const r=healthy().assess({nowMs:T+60_000,requiredStreams:['http']});
  assert.equal(r.status,'healthy');
  assert.equal(r.releaseEligible,true);
  assert.deepEqual(r.containment,[]);
});

test('missing canary becomes fail-closed telemetry loss',()=>{
  const g=new TelemetryContinuityGuard({maxCanaryLagMs:30_000});
  g.observeHeartbeat({stream:'http',sequence:1,observedAtMs:T,receivedAtMs:T});
  g.emitCanary({canaryId:'c1',emittedAtMs:T,stream:'http'});
  const r=g.assess({nowMs:T+30_001,requiredStreams:['http'],serviceExpectedLive:true});
  assert.equal(r.status,'telemetry_loss');
  assert.equal(r.releaseEligible,false);
  assert.equal(r.automatedSecurityMutationAllowed,false);
  assert.ok(r.reasons.some(x=>x.code==='CANARY_NOT_OBSERVED'));
});

test('quiet traffic alone cannot prove telemetry continuity',()=>{
  const g=new TelemetryContinuityGuard();
  const r=g.assess({nowMs:T,requiredStreams:['http'],serviceExpectedLive:true});
  assert.equal(r.status,'telemetry_loss');
  assert.equal(r.releaseEligible,false);
  assert.ok(r.reasons.some(x=>x.code==='MISSING_HEARTBEAT'));
  assert.ok(r.reasons.some(x=>x.code==='NO_VALID_CANARY'));
});

test('sequence gap poisons continuity until every missing sequence is observed',()=>{
  const g=healthy();
  g.observeHeartbeat({stream:'http',sequence:4,observedAtMs:T+3_000,receivedAtMs:T+3_000});
  let r=g.assess({nowMs:T+4_000,requiredStreams:['http']});
  assert.equal(r.releaseEligible,false);
  assert.ok(r.reasons.some(x=>x.code==='SEQUENCE_GAP'));

  g.observeBackfillHeartbeat({stream:'http',sequence:2,observedAtMs:T+1_500,receivedAtMs:T+4_100});
  r=g.assess({nowMs:T+4_200,requiredStreams:['http']});
  assert.equal(r.releaseEligible,false);
  assert.ok(r.reasons.some(x=>x.code==='SEQUENCE_GAP'));

  g.observeBackfillHeartbeat({stream:'http',sequence:3,observedAtMs:T+2_500,receivedAtMs:T+4_300});
  r=g.assess({nowMs:T+4_400,requiredStreams:['http']});
  assert.equal(r.releaseEligible,true);
  assert.equal(r.reasons.some(x=>x.code==='SEQUENCE_GAP'),false);
});

test('live heartbeat replay or rollback is rejected rather than treated as backfill',()=>{
  const g=new TelemetryContinuityGuard();
  g.observeHeartbeat({stream:'http',sequence:7,observedAtMs:T,receivedAtMs:T});
  assert.throws(()=>g.observeHeartbeat({stream:'http',sequence:7,observedAtMs:T+1_000,receivedAtMs:T+1_000}),/replay|rollback/);
  assert.throws(()=>g.observeHeartbeat({stream:'http',sequence:6,observedAtMs:T+1_000,receivedAtMs:T+1_000}),/replay|rollback/);
});

test('backfill cannot invent recovery for a sequence outside an unresolved gap',()=>{
  const g=new TelemetryContinuityGuard();
  g.observeHeartbeat({stream:'http',sequence:10,observedAtMs:T,receivedAtMs:T});
  g.observeHeartbeat({stream:'http',sequence:12,observedAtMs:T+2_000,receivedAtMs:T+2_000});
  assert.throws(()=>g.observeBackfillHeartbeat({stream:'http',sequence:9,observedAtMs:T-1_000,receivedAtMs:T+3_000}),/unresolved gap/);
});

test('future heartbeat timestamp poisoning is rejected',()=>{
  const g=new TelemetryContinuityGuard({maxClockSkewMs:1_000});
  assert.throws(()=>g.observeHeartbeat({stream:'http',sequence:1,observedAtMs:T+2_001,receivedAtMs:T}),/future/);
});

test('unknown or replayed canary evidence is rejected',()=>{
  const g=new TelemetryContinuityGuard();
  assert.throws(()=>g.observeCanary({canaryId:'unknown',observedAtMs:T}),/Unknown/);
  g.emitCanary({canaryId:'c1',emittedAtMs:T,stream:'http'});
  g.observeCanary({canaryId:'c1',observedAtMs:T+1,receivedAtMs:T+1});
  assert.throws(()=>g.observeCanary({canaryId:'c1',observedAtMs:T+2,receivedAtMs:T+2}),/replay/);
});

test('late canary observation cannot satisfy continuity',()=>{
  const g=new TelemetryContinuityGuard({maxCanaryLagMs:30_000});
  g.observeHeartbeat({stream:'http',sequence:1,observedAtMs:T+31_000,receivedAtMs:T+31_000});
  g.emitCanary({canaryId:'c1',emittedAtMs:T,stream:'http'});
  assert.equal(g.observeCanary({canaryId:'c1',observedAtMs:T+30_001,receivedAtMs:T+30_001}),false);
  const r=g.assess({nowMs:T+31_000,requiredStreams:['http']});
  assert.equal(r.releaseEligible,false);
  assert.ok(r.reasons.some(x=>x.code==='NO_VALID_CANARY'));
});

test('an old successful canary cannot keep promotion green forever',()=>{
  const g=healthy({maxCanaryAgeMs:60_000,maxHeartbeatAgeMs:30_000});
  g.observeHeartbeat({stream:'http',sequence:2,observedAtMs:T+120_000,receivedAtMs:T+120_000});
  const r=g.assess({nowMs:T+120_000,requiredStreams:['http']});
  assert.equal(r.releaseEligible,false);
  assert.ok(r.reasons.some(x=>x.code==='STALE_CANARY'));
});

test('telemetry loss containment stays narrow and reversible',()=>{
  const g=new TelemetryContinuityGuard();
  const r=g.assess({nowMs:T,requiredStreams:['http']});
  assert.deepEqual(r.containment,[
    'BLOCK_SECURITY_SENSITIVE_PROMOTION',
    'PAUSE_AUTOMATED_SECURITY_MUTATIONS',
    'PRESERVE_LAST_GOOD_EVIDENCE'
  ]);
});
