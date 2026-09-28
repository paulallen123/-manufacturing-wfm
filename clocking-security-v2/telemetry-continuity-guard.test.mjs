import crypto from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {TelemetryContinuityGuard,telemetryObserverPayload} from './telemetry-continuity-guard.mjs';

const T=Date.parse('2026-09-19T02:00:00Z');
const TRUST_DOMAIN='tenant-a.site-1.telemetry';
const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
const rogue=crypto.generateKeyPairSync('ed25519');

function guard(options={}){
  const {autoHandoff=true,handoffSequences={},...guardOptions}=options;
  const g=new TelemetryContinuityGuard({trustDomain:TRUST_DOMAIN,trustedObservers:[{observerId:'observer-a',publicKey,streams:['http','audit']}],...guardOptions});
  if(autoHandoff){
    for(const stream of ['http','audit']) handoff(g,{stream,lastSequence:handoffSequences[stream]??0,observedAtMs:T-10_000});
  }
  return g;
}
function sign(g,kind,{stream='http',sequence,continuityId,canaryId,emittedAtMs,observedAtMs},key=privateKey,trustDomain=TRUST_DOMAIN){
  const {observerSessionId}=g.observerChallenge();
  return crypto.sign(null,telemetryObserverPayload({trustDomain,observerSessionId,kind,stream,sequence,continuityId,canaryId,emittedAtMs,observedAtMs}),key).toString('base64');
}
function handoff(g,{stream='http',lastSequence=0,observedAtMs,receivedAtMs=observedAtMs,observerId='observer-a',continuityId='observer-a',key=privateKey}={}){
  return g.observeSessionHandoff({stream,lastSequence,observedAtMs,receivedAtMs,observerId,continuityId,signature:sign(g,'session_handoff',{stream,sequence:lastSequence,continuityId,observedAtMs},key)});
}
function heartbeat(g,{stream='http',sequence,observedAtMs,receivedAtMs=observedAtMs,observerId='observer-a',key=privateKey}={}){
  return g.observeHeartbeat({stream,sequence,observedAtMs,receivedAtMs,observerId,signature:sign(g,'heartbeat',{stream,sequence,observedAtMs},key)});
}
function backfill(g,{stream='http',sequence,observedAtMs,receivedAtMs=observedAtMs,observerId='observer-a',key=privateKey}={}){
  return g.observeBackfillHeartbeat({stream,sequence,observedAtMs,receivedAtMs,observerId,signature:sign(g,'backfill_heartbeat',{stream,sequence,observedAtMs},key)});
}
function canary(g,{canaryId,emittedAtMs,observedAtMs,receivedAtMs=observedAtMs,observerId='observer-a',key=privateKey}={}){
  const emitted=emittedAtMs ?? g.canaries.get(canaryId)?.emittedAtMs;
  return g.observeCanary({canaryId,observedAtMs,receivedAtMs,observerId,signature:sign(g,'canary',{stream:'http',canaryId,emittedAtMs:emitted,observedAtMs},key)});
}
function healthy(options={}){
  const g=guard(options);
  heartbeat(g,{sequence:1,observedAtMs:T});
  g.emitCanary({canaryId:'c1',emittedAtMs:T+1_000,stream:'http'});
  canary(g,{canaryId:'c1',observedAtMs:T+2_000});
  return g;
}

test('fresh signed handoff, heartbeat and canary keep telemetry healthy',()=>{
  const r=healthy().assess({nowMs:T+60_000,requiredStreams:['http']});
  assert.equal(r.status,'healthy');
  assert.equal(r.releaseEligible,true);
  assert.deepEqual(r.containment,[]);
});

test('guard cannot start without an explicit trust domain and independent observer key',()=>{
  assert.throws(()=>new TelemetryContinuityGuard(),/trustDomain|trusted telemetry observer/);
  assert.throws(()=>new TelemetryContinuityGuard({trustDomain:TRUST_DOMAIN,trustedObservers:[]}),/trusted telemetry observer/);
});

test('observer challenge is stable only for the life of one guard instance',()=>{
  const first=guard();
  assert.deepEqual(first.observerChallenge(),first.observerChallenge());
  const second=guard();
  assert.notEqual(first.observerChallenge().observerSessionId,second.observerChallenge().observerSessionId);
});

test('unsigned or forged live heartbeat cannot manufacture healthy telemetry',()=>{
  const g=guard();
  assert.throws(()=>g.observeHeartbeat({stream:'http',sequence:1,observedAtMs:T,receivedAtMs:T,observerId:'observer-a'}),/signature/);
  assert.throws(()=>g.observeHeartbeat({stream:'http',sequence:1,observedAtMs:T,receivedAtMs:T,observerId:'observer-a',signature:sign(g,'heartbeat',{sequence:1,observedAtMs:T},rogue.privateKey)}),/signature verification/);
  const r=g.assess({nowMs:T,requiredStreams:['http']});
  assert.equal(r.releaseEligible,false);
  assert.ok(r.reasons.some(x=>x.code==='MISSING_HEARTBEAT'));
});

test('signed evidence cannot cross trust domains or observer stream scopes',()=>{
  const other=new TelemetryContinuityGuard({trustDomain:'tenant-b.site-9.telemetry',trustedObservers:[{observerId:'observer-a',publicKey,streams:['http']}]});
  assert.throws(()=>other.observeHeartbeat({stream:'http',sequence:1,observedAtMs:T,receivedAtMs:T,observerId:'observer-a',signature:sign(other,'heartbeat',{sequence:1,observedAtMs:T})}),/signature verification/);
  const g=guard();
  assert.throws(()=>g.observeHeartbeat({stream:'other',sequence:1,observedAtMs:T,receivedAtMs:T,observerId:'observer-a',signature:sign(g,'heartbeat',{stream:'other',sequence:1,observedAtMs:T})}),/not authorised/);
});

test('heartbeat signature cannot be repurposed as canary proof',()=>{
  const g=guard();
  heartbeat(g,{sequence:1,observedAtMs:T});
  g.emitCanary({canaryId:'c1',emittedAtMs:T,stream:'http'});
  const reused=sign(g,'heartbeat',{sequence:1,observedAtMs:T+1_000});
  assert.throws(()=>g.observeCanary({canaryId:'c1',observedAtMs:T+1_000,receivedAtMs:T+1_000,observerId:'observer-a',signature:reused}),/signature verification/);
});

test('signed heartbeat and canary evidence cannot replay across restart even with reused identifiers and timestamps',()=>{
  const previous=guard();
  previous.emitCanary({canaryId:'restart-canary',emittedAtMs:T,stream:'http'});
  const oldHeartbeatSignature=sign(previous,'heartbeat',{stream:'http',sequence:1,observedAtMs:T});
  const observedAtMs=T+11_000;
  const oldCanarySignature=sign(previous,'canary',{stream:'http',canaryId:'restart-canary',emittedAtMs:T,observedAtMs});
  const restarted=guard();
  restarted.emitCanary({canaryId:'restart-canary',emittedAtMs:T,stream:'http'});
  assert.notEqual(previous.observerChallenge().observerSessionId,restarted.observerChallenge().observerSessionId);
  assert.throws(()=>restarted.observeHeartbeat({stream:'http',sequence:1,observedAtMs:T,receivedAtMs:T+12_000,observerId:'observer-a',signature:oldHeartbeatSignature}),/signature verification/);
  assert.throws(()=>restarted.observeCanary({canaryId:'restart-canary',observedAtMs,receivedAtMs:observedAtMs,observerId:'observer-a',signature:oldCanarySignature}),/signature verification/);
});

test('restart requires a fresh observer handoff and cannot forget prior sequence continuity',()=>{
  const restarted=guard({autoHandoff:false,maxHeartbeatAgeMs:60_000,maxCanaryAgeMs:60_000});
  assert.throws(()=>heartbeat(restarted,{sequence:11,observedAtMs:T+1_000}),/session handoff/i);
  handoff(restarted,{lastSequence:10,observedAtMs:T+1_000});
  heartbeat(restarted,{sequence:13,observedAtMs:T+2_000});
  restarted.emitCanary({canaryId:'restart-proof',emittedAtMs:T+2_500,stream:'http'});
  canary(restarted,{canaryId:'restart-proof',observedAtMs:T+3_000});
  let r=restarted.assess({nowMs:T+4_000,requiredStreams:['http']});
  assert.equal(r.releaseEligible,false);
  assert.ok(r.reasons.some(x=>x.code==='SEQUENCE_GAP'&&x.expected===11&&x.received===13));
  backfill(restarted,{sequence:11,observedAtMs:T+1_500,receivedAtMs:T+4_100});
  backfill(restarted,{sequence:12,observedAtMs:T+1_800,receivedAtMs:T+4_200});
  r=restarted.assess({nowMs:T+4_300,requiredStreams:['http']});
  assert.equal(r.releaseEligible,true);
});

test('missing or forged session handoff fails closed',()=>{
  const g=guard({autoHandoff:false});
  let r=g.assess({nowMs:T,requiredStreams:['http']});
  assert.equal(r.releaseEligible,false);
  assert.ok(r.reasons.some(x=>x.code==='MISSING_SESSION_HANDOFF'));
  const badSignature=sign(g,'session_handoff',{stream:'http',sequence:0,continuityId:'observer-a',observedAtMs:T},rogue.privateKey);
  assert.throws(()=>g.observeSessionHandoff({stream:'http',lastSequence:0,observedAtMs:T,receivedAtMs:T,observerId:'observer-a',continuityId:'observer-a',signature:badSignature}),/signature verification/);
});

test('missing canary becomes fail-closed telemetry loss',()=>{
  const g=guard({maxCanaryLagMs:30_000});
  heartbeat(g,{sequence:1,observedAtMs:T});
  g.emitCanary({canaryId:'c1',emittedAtMs:T,stream:'http'});
  const r=g.assess({nowMs:T+30_001,requiredStreams:['http'],serviceExpectedLive:true});
  assert.equal(r.status,'telemetry_loss');
  assert.equal(r.releaseEligible,false);
  assert.equal(r.automatedSecurityMutationAllowed,false);
  assert.ok(r.reasons.some(x=>x.code==='CANARY_NOT_OBSERVED'));
});

test('a fresh later signed canary can recover a prior missed-canary incident',()=>{
  const g=guard({maxCanaryLagMs:30_000,maxCanaryAgeMs:60_000,maxHeartbeatAgeMs:60_000});
  heartbeat(g,{sequence:1,observedAtMs:T});
  g.emitCanary({canaryId:'missed',emittedAtMs:T,stream:'http'});
  let r=g.assess({nowMs:T+30_001,requiredStreams:['http']});
  assert.equal(r.releaseEligible,false);
  assert.ok(r.reasons.some(x=>x.code==='CANARY_NOT_OBSERVED'));
  heartbeat(g,{sequence:2,observedAtMs:T+40_000});
  g.emitCanary({canaryId:'recovery',emittedAtMs:T+40_000,stream:'http'});
  canary(g,{canaryId:'recovery',observedAtMs:T+40_500});
  r=g.assess({nowMs:T+41_000,requiredStreams:['http']});
  assert.equal(r.releaseEligible,true);
  assert.equal(r.reasons.some(x=>x.code==='CANARY_NOT_OBSERVED'),false);
});

test('quiet traffic alone cannot prove telemetry continuity',()=>{
  const g=guard();
  const r=g.assess({nowMs:T,requiredStreams:['http'],serviceExpectedLive:true});
  assert.equal(r.status,'telemetry_loss');
  assert.equal(r.releaseEligible,false);
  assert.ok(r.reasons.some(x=>x.code==='MISSING_HEARTBEAT'));
  assert.ok(r.reasons.some(x=>x.code==='NO_VALID_CANARY'));
});

test('sequence gap poisons continuity until every missing signed sequence is observed',()=>{
  const g=healthy();
  heartbeat(g,{sequence:4,observedAtMs:T+3_000});
  let r=g.assess({nowMs:T+4_000,requiredStreams:['http']});
  assert.equal(r.releaseEligible,false);
  assert.ok(r.reasons.some(x=>x.code==='SEQUENCE_GAP'));
  backfill(g,{sequence:2,observedAtMs:T+1_500,receivedAtMs:T+4_100});
  r=g.assess({nowMs:T+4_200,requiredStreams:['http']});
  assert.equal(r.releaseEligible,false);
  assert.ok(r.reasons.some(x=>x.code==='SEQUENCE_GAP'));
  backfill(g,{sequence:3,observedAtMs:T+2_500,receivedAtMs:T+4_300});
  r=g.assess({nowMs:T+4_400,requiredStreams:['http']});
  assert.equal(r.releaseEligible,true);
  assert.equal(r.reasons.some(x=>x.code==='SEQUENCE_GAP'),false);
});

test('live heartbeat replay or rollback is rejected rather than treated as backfill',()=>{
  const g=guard();
  heartbeat(g,{sequence:7,observedAtMs:T});
  assert.throws(()=>heartbeat(g,{sequence:7,observedAtMs:T+1_000}),/replay|rollback/);
  assert.throws(()=>heartbeat(g,{sequence:6,observedAtMs:T+1_000}),/replay|rollback/);
});

test('backfill cannot invent recovery for a sequence outside an unresolved gap',()=>{
  const g=guard({handoffSequences:{http:9}});
  heartbeat(g,{sequence:10,observedAtMs:T});
  heartbeat(g,{sequence:12,observedAtMs:T+2_000});
  assert.throws(()=>backfill(g,{sequence:9,observedAtMs:T-1_000,receivedAtMs:T+3_000}),/unresolved gap/);
});

test('future heartbeat timestamp poisoning is rejected',()=>{
  const g=guard({maxClockSkewMs:1_000});
  const signature=sign(g,'heartbeat',{sequence:1,observedAtMs:T+2_001});
  assert.throws(()=>g.observeHeartbeat({stream:'http',sequence:1,observedAtMs:T+2_001,receivedAtMs:T,observerId:'observer-a',signature}),/future/);
});

test('unknown or replayed signed canary evidence is rejected',()=>{
  const g=guard();
  const unknownSignature=sign(g,'canary',{canaryId:'unknown',emittedAtMs:T,observedAtMs:T});
  assert.throws(()=>g.observeCanary({canaryId:'unknown',observedAtMs:T,observerId:'observer-a',signature:unknownSignature}),/Unknown/);
  g.emitCanary({canaryId:'c1',emittedAtMs:T,stream:'http'});
  canary(g,{canaryId:'c1',observedAtMs:T+1});
  assert.throws(()=>canary(g,{canaryId:'c1',observedAtMs:T+2}),/replay/);
});

test('late canary observation cannot satisfy continuity',()=>{
  const g=guard({maxCanaryLagMs:30_000});
  heartbeat(g,{sequence:1,observedAtMs:T+31_000});
  g.emitCanary({canaryId:'c1',emittedAtMs:T,stream:'http'});
  assert.equal(canary(g,{canaryId:'c1',observedAtMs:T+30_001}),false);
  const r=g.assess({nowMs:T+31_000,requiredStreams:['http']});
  assert.equal(r.releaseEligible,false);
  assert.ok(r.reasons.some(x=>x.code==='NO_VALID_CANARY'));
});

test('an old successful canary cannot keep promotion green forever',()=>{
  const g=healthy({maxCanaryAgeMs:60_000,maxHeartbeatAgeMs:30_000});
  heartbeat(g,{sequence:2,observedAtMs:T+120_000});
  const r=g.assess({nowMs:T+120_000,requiredStreams:['http']});
  assert.equal(r.releaseEligible,false);
  assert.ok(r.reasons.some(x=>x.code==='STALE_CANARY'));
});

test('telemetry loss containment stays narrow and reversible',()=>{
  const g=guard();
  const r=g.assess({nowMs:T,requiredStreams:['http']});
  assert.deepEqual(r.containment,['BLOCK_SECURITY_SENSITIVE_PROMOTION','PAUSE_AUTOMATED_SECURITY_MUTATIONS','PRESERVE_LAST_GOOD_EVIDENCE']);
});
