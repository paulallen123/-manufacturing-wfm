import test from 'node:test';
import assert from 'node:assert/strict';
import {TelemetryContinuityGuard} from './telemetry-continuity-guard.mjs';

const T=Date.parse('2026-09-19T02:00:00Z');
function healthy(){
  const g=new TelemetryContinuityGuard();
  g.observeHeartbeat({stream:'http',sequence:1,observedAtMs:T,receivedAtMs:T});
  g.emitCanary({canaryId:'c1',emittedAtMs:T+1_000,stream:'http'});
  g.observeCanary({canaryId:'c1',observedAtMs:T+2_000});
  return g;
}

test('fresh heartbeat and observed canary keep telemetry healthy',()=>{
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
  assert.match(r.reasons[0].code,/CANARY_NOT_OBSERVED/);
});

test('quiet traffic alone cannot prove telemetry because required heartbeat is missing',()=>{
  const g=new TelemetryContinuityGuard();
  const r=g.assess({nowMs:T,requiredStreams:['http'],serviceExpectedLive:true});
  assert.equal(r.status,'telemetry_loss');
  assert.equal(r.releaseEligible,false);
});

test('sequence gap poisons continuity even if the latest heartbeat is fresh',()=>{
  const g=new TelemetryContinuityGuard();
  g.observeHeartbeat({stream:'http',sequence:10,observedAtMs:T,receivedAtMs:T});
  g.observeHeartbeat({stream:'http',sequence:12,observedAtMs:T+1_000,receivedAtMs:T+1_000});
  const r=g.assess({nowMs:T+2_000,requiredStreams:['http']});
  assert.equal(r.status,'telemetry_loss');
  assert.ok(r.reasons.some(x=>x.code==='SEQUENCE_GAP'));
});

test('replayed or rolled-back heartbeat is rejected',()=>{
  const g=new TelemetryContinuityGuard();
  g.observeHeartbeat({stream:'http',sequence:7,observedAtMs:T,receivedAtMs:T});
  assert.throws(()=>g.observeHeartbeat({stream:'http',sequence:7,observedAtMs:T+1_000,receivedAtMs:T+1_000}),/replay|rollback/);
  assert.throws(()=>g.observeHeartbeat({stream:'http',sequence:8,observedAtMs:T-1,receivedAtMs:T+1_000}),/time rollback/);
});

test('future timestamp poisoning is rejected',()=>{
  const g=new TelemetryContinuityGuard({maxClockSkewMs:1_000});
  assert.throws(()=>g.observeHeartbeat({stream:'http',sequence:1,observedAtMs:T+2_001,receivedAtMs:T}),/future/);
});

test('unknown or replayed canary evidence is rejected',()=>{
  const g=new TelemetryContinuityGuard();
  assert.throws(()=>g.observeCanary({canaryId:'unknown',observedAtMs:T}),/Unknown/);
  g.emitCanary({canaryId:'c1',emittedAtMs:T,stream:'http'});
  g.observeCanary({canaryId:'c1',observedAtMs:T+1});
  assert.throws(()=>g.observeCanary({canaryId:'c1',observedAtMs:T+2}),/replay/);
});

test('stale heartbeat blocks promotion even when old canary was seen',()=>{
  const g=healthy();
  const r=g.assess({nowMs:T+120_001,requiredStreams:['http']});
  assert.equal(r.releaseEligible,false);
  assert.ok(r.reasons.some(x=>x.code==='STALE_HEARTBEAT'));
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
