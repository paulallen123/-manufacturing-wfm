import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomaticAttendanceEvidenceEngine } from './invisible-attendance-engine.mjs';

const T=Date.parse('2026-09-20T09:00:00Z');

function setup(){
  const engine=new AutomaticAttendanceEvidenceEngine({corroborationWindowMs:120_000,maxOfflineAgeMs:86_400_000});
  engine.registerPerson({tenant:'acme',employee:'e1',sites:['s1']});
  engine.registerSource({tenant:'acme',sourceId:'door',site:'s1',type:'access'});
  engine.registerSource({tenant:'acme',sourceId:'wifi',site:'s1',type:'radius'});
  return engine;
}

function ingest(engine,{sourceId,eventId,kind,at}){
  return engine.ingest({tenant:'acme',employee:'e1',sourceId,eventId,kind,observedAt:new Date(at).toISOString(),receivedAtMs:at+1000});
}

test('removing and re-adding a site assignment cannot revive pre-reassignment evidence into attendance authority',()=>{
  const engine=setup();
  const pending=ingest(engine,{sourceId:'door',eventId:'door-before-assignment-change-01',kind:'access_entry',at:T});
  assert.equal(pending.decision.status,'review_required');

  engine.registerPerson({tenant:'acme',employee:'e1',sites:[]});
  engine.registerPerson({tenant:'acme',employee:'e1',sites:['s1']});

  const wifi=ingest(engine,{sourceId:'wifi',eventId:'wifi-after-assignment-change-01',kind:'wifi_authenticated',at:T+20_000});
  assert.notEqual(wifi.decision.status,'authoritative');
  assert.equal(wifi.decision.reason,'NO_TRUSTED_TIME_ANCHOR');
  assert.equal(engine.getState({tenant:'acme',employee:'e1',site:'s1'}).status,'outside');
  assert.equal(engine.audit.filter(x=>x.action==='attendance-in-authoritative').length,0);

  const fresh=ingest(engine,{sourceId:'door',eventId:'door-after-assignment-change-01',kind:'access_entry',at:T+25_000});
  assert.equal(fresh.decision.status,'authoritative');
  assert.equal(fresh.decision.direction,'in');
  assert.equal(engine.getState({tenant:'acme',employee:'e1',site:'s1'}).status,'present');
});

test('idempotent person registration does not invalidate pending evidence',()=>{
  const engine=setup();
  const pending=ingest(engine,{sourceId:'door',eventId:'door-before-idempotent-register-01',kind:'access_entry',at:T});
  assert.equal(pending.decision.status,'review_required');

  engine.registerPerson({tenant:'acme',employee:'e1',sites:['s1']});
  const wifi=ingest(engine,{sourceId:'wifi',eventId:'wifi-after-idempotent-register-01',kind:'wifi_authenticated',at:T+15_000});
  assert.equal(wifi.decision.status,'authoritative');
  assert.equal(wifi.decision.direction,'in');
});
