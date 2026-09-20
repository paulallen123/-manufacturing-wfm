import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomaticAttendanceEvidenceEngine } from './invisible-attendance-engine.mjs';

const T=Date.parse('2026-09-20T10:00:00Z');

function event(sourceId,eventId,kind,at,receivedAtMs=at+10_000){
  return {tenant:'acme',sourceId,eventId,employee:'e1',kind,observedAt:new Date(at).toISOString(),receivedAtMs};
}

test('independent evidence cannot close attendance at the exact authoritative IN timestamp',()=>{
  const engine=new AutomaticAttendanceEvidenceEngine({corroborationWindowMs:120_000,maxOfflineAgeMs:24*60*60_000});
  engine.registerPerson({tenant:'acme',employee:'e1',sites:['s1']});
  engine.registerSource({tenant:'acme',sourceId:'door',site:'s1',type:'access'});
  engine.registerSource({tenant:'acme',sourceId:'wifi',site:'s1',type:'radius'});

  engine.ingest(event('door','door-in-0001','access_entry',T));
  const clockIn=engine.ingest(event('wifi','wifi-in-0001','wifi_authenticated',T+5_000));
  assert.equal(clockIn.decision.status,'authoritative');
  assert.equal(clockIn.decision.authoritativeAt,new Date(T).toISOString());

  const exitAnchor=engine.ingest(event('door','door-out-0001','access_exit',T,T+20_000));
  assert.equal(exitAnchor.decision.status,'review_required');
  assert.equal(exitAnchor.decision.reason,'OUT_BEFORE_OPEN');
  const corroborator=engine.ingest(event('wifi','wifi-out-0001','wifi_disconnected',T+5_000,T+25_000));
  assert.notEqual(corroborator.decision.status,'authoritative');

  const state=engine.getState({tenant:'acme',employee:'e1',site:'s1'});
  assert.equal(state.status,'present');
  assert.equal(state.openAt,T);
  assert.equal(state.closeAt,null);
});

test('direct existing T&A authority cannot create a zero-duration attendance interval',()=>{
  const engine=new AutomaticAttendanceEvidenceEngine({maxOfflineAgeMs:24*60*60_000});
  engine.registerPerson({tenant:'acme',employee:'e1',sites:['s1']});
  engine.registerSource({tenant:'acme',sourceId:'legacy-ta',site:'s1',type:'taa',directAttendanceAuthority:true});

  const clockIn=engine.ingest(event('legacy-ta','taa-in-0001','legacy_clock_in',T,T+1_000));
  assert.equal(clockIn.decision.status,'authoritative');
  const clockOut=engine.ingest(event('legacy-ta','taa-out-0001','legacy_clock_out',T,T+2_000));
  assert.equal(clockOut.decision.status,'review_required');
  assert.equal(clockOut.decision.reason,'OUT_BEFORE_OPEN');

  const state=engine.getState({tenant:'acme',employee:'e1',site:'s1'});
  assert.equal(state.status,'present');
  assert.equal(state.openAt,T);
  assert.equal(state.closeAt,null);
});