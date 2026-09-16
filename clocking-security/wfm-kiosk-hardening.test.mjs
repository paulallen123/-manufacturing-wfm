import test from 'node:test';
import assert from 'node:assert/strict';
import {WfmKioskHardening} from './wfm-kiosk-hardening.mjs';

const NOW=Date.parse('2026-09-16T19:00:00Z');
function seed(){
  const s=new WfmKioskHardening();
  s.registerPerson({tenant:'t1',employee:'e1',sites:['tamworth']});
  s.registerPerson({tenant:'t1',employee:'e2',sites:['tamworth']});
  s.registerPerson({tenant:'t2',employee:'e1',sites:['tamworth']});
  s.registerDevice({tenant:'t1',deviceId:'device-a',site:'tamworth'});
  s.registerDevice({tenant:'t1',deviceId:'device-b',site:'tamworth'});
  s.registerDevice({tenant:'t2',deviceId:'device-c',site:'tamworth'});
  return s;
}
function evt(over={}){return {eventId:'event-0001',sequence:1,employee:'e1',type:'in',capturedAt:new Date(NOW-3*86400000).toISOString(),...over};}

test('valid online challenge makes server receipt time authoritative',()=>{
  const s=seed(),c=s.issueChallenge({deviceId:'device-a',nowMs:NOW-100});
  const out=s.syncBatch({deviceId:'device-a',events:[evt({challengeId:c.challengeId})],serverNowMs:NOW});
  assert.equal(out.results[0].status,'accepted');
  assert.equal(out.results[0].authoritativeAt,new Date(NOW).toISOString());
  assert.notEqual(out.results[0].authoritativeAt,out.results[0].clientCapturedAt);
  assert.equal(s.getPersonal({tenant:'t1',employee:'e1'}).events[0].at,NOW);
});

test('missing challenge is durably held and does not mutate personal clock',()=>{
  const s=seed();
  const out=s.syncBatch({deviceId:'device-a',events:[evt()],serverNowMs:NOW});
  assert.equal(out.results[0].status,'held');
  assert.equal(out.lastSequence,1);
  assert.equal(s.getPersonal({tenant:'t1',employee:'e1'}).status,'out');
  assert.equal(s.reviewHeld({tenant:'t1'}).length,1);
});

test('expired challenge is held',()=>{
  const s=new WfmKioskHardening({challengeTtlMs:1000});
  s.registerPerson({tenant:'t1',employee:'e1',sites:['tamworth']}); s.registerDevice({tenant:'t1',deviceId:'device-a',site:'tamworth'});
  const c=s.issueChallenge({deviceId:'device-a',nowMs:NOW-2000});
  const out=s.syncBatch({deviceId:'device-a',events:[evt({challengeId:c.challengeId})],serverNowMs:NOW});
  assert.equal(out.results[0].status,'held');
  assert.equal(out.results[0].holdDetail,'CHALLENGE_EXPIRED');
});

test('challenge from another device is held',()=>{
  const s=seed(),c=s.issueChallenge({deviceId:'device-b',nowMs:NOW-100});
  const out=s.syncBatch({deviceId:'device-a',events:[evt({challengeId:c.challengeId})],serverNowMs:NOW});
  assert.equal(out.results[0].status,'held');
  assert.equal(out.results[0].holdDetail,'CHALLENGE_WRONG_DEVICE');
});

test('reused challenge cannot authorize a second distinct event',()=>{
  const s=seed(),c=s.issueChallenge({deviceId:'device-a',nowMs:NOW-100});
  let out=s.syncBatch({deviceId:'device-a',events:[evt({challengeId:c.challengeId})],serverNowMs:NOW});
  assert.equal(out.results[0].status,'accepted');
  out=s.syncBatch({deviceId:'device-a',events:[evt({eventId:'event-0002',sequence:2,employee:'e2',challengeId:c.challengeId})],serverNowMs:NOW+1000});
  assert.equal(out.results[0].status,'held');
  assert.equal(out.results[0].holdDetail,'CHALLENGE_REUSED');
  assert.equal(s.getPersonal({tenant:'t1',employee:'e2'}).status,'out');
});

test('accepted event replay is idempotent',()=>{
  const s=seed(),c=s.issueChallenge({deviceId:'device-a',nowMs:NOW-100}),e=evt({challengeId:c.challengeId});
  const a=s.syncBatch({deviceId:'device-a',events:[e],serverNowMs:NOW}).results[0];
  const b=s.syncBatch({deviceId:'device-a',events:[e],serverNowMs:NOW+2000}).results[0];
  assert.equal(b.status,'accepted'); assert.equal(b.replayed,true); assert.equal(b.personalEventId,a.personalEventId);
  assert.equal(s.getPersonal({tenant:'t1',employee:'e1'}).events.length,1);
});

test('held event replay is idempotent',()=>{
  const s=seed(),e=evt();
  const a=s.syncBatch({deviceId:'device-a',events:[e],serverNowMs:NOW}).results[0];
  const b=s.syncBatch({deviceId:'device-a',events:[e],serverNowMs:NOW+2000}).results[0];
  assert.equal(a.status,'held'); assert.equal(b.status,'held'); assert.equal(b.replayed,true);
  assert.equal(s.reviewHeld({tenant:'t1'}).length,1);
});

test('held event advances device sequence so later evidence is durably captured rather than stranded',()=>{
  const s=seed();
  assert.equal(s.syncBatch({deviceId:'device-a',events:[evt()],serverNowMs:NOW}).lastSequence,1);
  const c=s.issueChallenge({deviceId:'device-a',nowMs:NOW+1000});
  const out=s.syncBatch({deviceId:'device-a',events:[evt({eventId:'event-0002',sequence:2,type:'in',challengeId:c.challengeId,capturedAt:new Date(NOW+900).toISOString()})],serverNowMs:NOW+1000});
  assert.equal(out.lastSequence,2);
  assert.equal(out.results[0].status,'held');
  assert.equal(out.results[0].holdDetail,'PRIOR_HELD_EVENT');
  assert.equal(s.reviewHeld({tenant:'t1'}).length,2);
});

test('held review is tenant isolated',()=>{
  const s=seed();
  s.syncBatch({deviceId:'device-a',events:[evt()],serverNowMs:NOW});
  s.syncBatch({deviceId:'device-c',events:[evt({eventId:'event-2001'})],serverNowMs:NOW});
  assert.equal(s.reviewHeld({tenant:'t1'}).length,1);
  assert.equal(s.reviewHeld({tenant:'t2'}).length,1);
  assert.equal(s.reviewHeld({tenant:'t1'})[0].deviceId,'device-a');
});

test('revoked device is rejected',()=>{
  const s=seed(); s.revokeDevice('device-a');
  assert.throws(()=>s.issueChallenge({deviceId:'device-a',nowMs:NOW}),/Device is not active/);
  assert.throws(()=>s.syncBatch({deviceId:'device-a',events:[evt()],serverNowMs:NOW}),/Device is not active/);
});

test('event id content collision is rejected and sequence does not advance',()=>{
  const s=seed();
  s.syncBatch({deviceId:'device-a',events:[evt()],serverNowMs:NOW});
  const out=s.syncBatch({deviceId:'device-a',events:[evt({employee:'e2'})],serverNowMs:NOW+1000});
  assert.equal(out.results[0].status,'rejected');
  assert.match(out.results[0].error,/reused for different content/);
  assert.equal(out.lastSequence,1);
});

test('wrong-site employee is rejected before storage',()=>{
  const s=seed(); s.registerPerson({tenant:'t1',employee:'e3',sites:['leeds']});
  const out=s.syncBatch({deviceId:'device-a',events:[evt({employee:'e3'})],serverNowMs:NOW});
  assert.equal(out.results[0].status,'rejected');
  assert.equal(s.reviewHeld({tenant:'t1'}).length,0);
});

test('too-old offline timestamp is rejected instead of silently trusted',()=>{
  const s=seed();
  const out=s.syncBatch({deviceId:'device-a',events:[evt({capturedAt:new Date(NOW-8*86400000).toISOString()})],serverNowMs:NOW});
  assert.equal(out.results[0].status,'rejected');
  assert.match(out.results[0].error,/outside the supported offline window/);
});

test('unresolved held event forces later otherwise-valid event into review instead of corrupting state',()=>{
  const s=seed();
  const c1=s.issueChallenge({deviceId:'device-a',nowMs:NOW-100});
  let out=s.syncBatch({deviceId:'device-a',events:[evt({challengeId:c1.challengeId,capturedAt:new Date(NOW-50).toISOString()})],serverNowMs:NOW});
  assert.equal(out.results[0].status,'accepted');
  out=s.syncBatch({deviceId:'device-a',events:[evt({eventId:'event-0002',sequence:2,type:'out',capturedAt:new Date(NOW+1000).toISOString()})],serverNowMs:NOW+2000});
  assert.equal(out.results[0].status,'held');
  assert.equal(s.getPersonal({tenant:'t1',employee:'e1'}).status,'in');
  const c2=s.issueChallenge({deviceId:'device-a',nowMs:NOW+3000});
  out=s.syncBatch({deviceId:'device-a',events:[evt({eventId:'event-0003',sequence:3,type:'in',challengeId:c2.challengeId,capturedAt:new Date(NOW+3000).toISOString()})],serverNowMs:NOW+3100});
  assert.equal(out.results[0].status,'held');
  assert.equal(out.results[0].holdDetail,'PRIOR_HELD_EVENT');
  assert.equal(s.getPersonal({tenant:'t1',employee:'e1'}).events.length,1);
});

test('held approval applies verified reviewer time exactly once and preserves original evidence',()=>{
  const s=seed();
  s.syncBatch({deviceId:'device-a',events:[evt({capturedAt:new Date(NOW-3600000).toISOString()})],serverNowMs:NOW});
  const before=s.reviewHeld({tenant:'t1'})[0];
  const verified=new Date(NOW-500).toISOString();
  const r=s.resolveHeld({tenant:'t1',deviceId:'device-a',eventId:'event-0001',decision:'approve',authoritativeAt:verified,reviewer:'manager-2',reason:'Badge and shift evidence verified.',idempotencyKey:'review-0001',reviewedAtMs:NOW+5000});
  assert.equal(r.decision,'approve');
  assert.equal(r.authoritativeAt,verified);
  assert.equal(s.getPersonal({tenant:'t1',employee:'e1'}).events[0].at,NOW-500);
  const after=s.reviewHeld({tenant:'t1'})[0];
  assert.equal(after.clientCapturedAt,before.clientCapturedAt);
  assert.equal(after.receivedAt,before.receivedAt);
  assert.equal(after.resolution.authoritativeAt,verified);
  const replay=s.resolveHeld({tenant:'t1',deviceId:'device-a',eventId:'event-0001',decision:'approve',authoritativeAt:verified,reviewer:'manager-2',reason:'Badge and shift evidence verified.',idempotencyKey:'review-0001',reviewedAtMs:NOW+6000});
  assert.equal(replay.replayed,true);
  assert.equal(s.getPersonal({tenant:'t1',employee:'e1'}).events.length,1);
});

test('held rejection resolves evidence without mutating personal state',()=>{
  const s=seed();
  s.syncBatch({deviceId:'device-a',events:[evt()],serverNowMs:NOW});
  const r=s.resolveHeld({tenant:'t1',deviceId:'device-a',eventId:'event-0001',decision:'reject',reviewer:'manager-2',reason:'Employee confirmed no work occurred.',idempotencyKey:'review-0002',reviewedAtMs:NOW+1000});
  assert.equal(r.decision,'reject');
  assert.equal(r.personalEventId,null);
  assert.equal(s.getPersonal({tenant:'t1',employee:'e1'}).status,'out');
  assert.equal(s.reviewHeld({tenant:'t1'})[0].resolution.decision,'reject');
});

test('review resolution is tenant scoped',()=>{
  const s=seed();
  s.syncBatch({deviceId:'device-a',events:[evt()],serverNowMs:NOW});
  assert.throws(()=>s.resolveHeld({tenant:'t2',deviceId:'device-a',eventId:'event-0001',decision:'reject',reviewer:'manager-2',reason:'Reviewed and rejected safely.',idempotencyKey:'review-0003',reviewedAtMs:NOW+1000}),/not found in this tenant/);
  assert.equal(s.reviewHeld({tenant:'t1'})[0].resolution,null);
});

test('held events must be resolved in employee evidence order',()=>{
  const s=seed();
  s.syncBatch({deviceId:'device-a',events:[evt()],serverNowMs:NOW});
  const c=s.issueChallenge({deviceId:'device-a',nowMs:NOW+1000});
  s.syncBatch({deviceId:'device-a',events:[evt({eventId:'event-0002',sequence:2,type:'in',challengeId:c.challengeId,capturedAt:new Date(NOW+1000).toISOString()})],serverNowMs:NOW+1100});
  assert.throws(()=>s.resolveHeld({tenant:'t1',deviceId:'device-a',eventId:'event-0002',decision:'reject',reviewer:'manager-2',reason:'Later evidence reviewed first.',idempotencyKey:'review-0004',reviewedAtMs:NOW+2000}),/earlier held evidence/);
});

test('reason and verified time are mandatory for approval',()=>{
  const s=seed();
  s.syncBatch({deviceId:'device-a',events:[evt()],serverNowMs:NOW});
  assert.throws(()=>s.resolveHeld({tenant:'t1',deviceId:'device-a',eventId:'event-0001',decision:'approve',authoritativeAt:new Date(NOW).toISOString(),reviewer:'manager-2',reason:'short',idempotencyKey:'review-0005',reviewedAtMs:NOW+1000}),/review reason/);
  assert.throws(()=>s.resolveHeld({tenant:'t1',deviceId:'device-a',eventId:'event-0001',decision:'approve',reviewer:'manager-2',reason:'Sufficient reviewed evidence.',idempotencyKey:'review-0006',reviewedAtMs:NOW+1000}),/verified authoritative timestamp/);
});

test('resolving the prior held event allows the next held chain item to be reviewed then new online clocking resumes',()=>{
  const s=seed();
  const c1=s.issueChallenge({deviceId:'device-a',nowMs:NOW-100});
  s.syncBatch({deviceId:'device-a',events:[evt({challengeId:c1.challengeId,capturedAt:new Date(NOW-50).toISOString()})],serverNowMs:NOW});
  s.syncBatch({deviceId:'device-a',events:[evt({eventId:'event-0002',sequence:2,type:'out',capturedAt:new Date(NOW+1000).toISOString()})],serverNowMs:NOW+2000});
  const c2=s.issueChallenge({deviceId:'device-a',nowMs:NOW+3000});
  s.syncBatch({deviceId:'device-a',events:[evt({eventId:'event-0003',sequence:3,type:'in',challengeId:c2.challengeId,capturedAt:new Date(NOW+3000).toISOString()})],serverNowMs:NOW+3100});
  s.resolveHeld({tenant:'t1',deviceId:'device-a',eventId:'event-0002',decision:'approve',authoritativeAt:new Date(NOW+1500).toISOString(),reviewer:'manager-2',reason:'Exit verified against supervisor evidence.',idempotencyKey:'review-0007',reviewedAtMs:NOW+4000});
  assert.equal(s.getPersonal({tenant:'t1',employee:'e1'}).status,'out');
  s.resolveHeld({tenant:'t1',deviceId:'device-a',eventId:'event-0003',decision:'approve',authoritativeAt:new Date(NOW+3000).toISOString(),reviewer:'manager-2',reason:'Return verified against shift start.',idempotencyKey:'review-0008',reviewedAtMs:NOW+5000});
  assert.equal(s.getPersonal({tenant:'t1',employee:'e1'}).status,'in');
  const c3=s.issueChallenge({deviceId:'device-a',nowMs:NOW+6000});
  const out=s.syncBatch({deviceId:'device-a',events:[evt({eventId:'event-0004',sequence:4,type:'out',challengeId:c3.challengeId,capturedAt:new Date(NOW+6000).toISOString()})],serverNowMs:NOW+6100});
  assert.equal(out.results[0].status,'accepted');
  assert.equal(s.getPersonal({tenant:'t1',employee:'e1'}).status,'out');
});

test('resolution idempotency key cannot be reused for different decision data',()=>{
  const s=seed();
  s.syncBatch({deviceId:'device-a',events:[evt()],serverNowMs:NOW});
  s.resolveHeld({tenant:'t1',deviceId:'device-a',eventId:'event-0001',decision:'reject',reviewer:'manager-2',reason:'Evidence confirms this was accidental.',idempotencyKey:'review-0009',reviewedAtMs:NOW+1000});
  assert.throws(()=>s.resolveHeld({tenant:'t1',deviceId:'device-a',eventId:'event-0001',decision:'approve',authoritativeAt:new Date(NOW).toISOString(),reviewer:'manager-2',reason:'Different resolution must fail.',idempotencyKey:'review-0009',reviewedAtMs:NOW+2000}),/idempotency key reused/);
});

test('verified review timestamp cannot move authoritative employee clock backwards',()=>{
  const s=seed();
  const c=s.issueChallenge({deviceId:'device-a',nowMs:NOW-100});
  s.syncBatch({deviceId:'device-a',events:[evt({challengeId:c.challengeId,capturedAt:new Date(NOW-100).toISOString()})],serverNowMs:NOW});
  s.syncBatch({deviceId:'device-a',events:[evt({eventId:'event-0002',sequence:2,type:'out',capturedAt:new Date(NOW+1000).toISOString()})],serverNowMs:NOW+2000});
  assert.throws(()=>s.resolveHeld({tenant:'t1',deviceId:'device-a',eventId:'event-0002',decision:'approve',authoritativeAt:new Date(NOW-1000).toISOString(),reviewer:'manager-2',reason:'Attempted backward timestamp review.',idempotencyKey:'review-0010',reviewedAtMs:NOW+3000}),/moved backwards/);
  assert.equal(s.reviewHeld({tenant:'t1'})[0].resolution,null);
});
