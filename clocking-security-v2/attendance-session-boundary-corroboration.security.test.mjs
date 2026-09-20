import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomaticAttendanceEvidenceEngine } from './invisible-attendance-engine.mjs';

const T=Date.parse('2026-09-18T06:00:00Z');
const END=T+8*60*60_000;

function setup(){
  const e=new AutomaticAttendanceEvidenceEngine({corroborationWindowMs:120_000,maxOfflineAgeMs:86_400_000});
  e.registerPerson({tenant:'acme',employee:'e1',sites:['s1']});
  e.registerSource({tenant:'acme',sourceId:'door',site:'s1',type:'access'});
  e.registerSource({tenant:'acme',sourceId:'wifi',site:'s1',type:'radius'});
  e.registerSource({tenant:'acme',sourceId:'hmi',site:'s1',type:'mes'});
  return e;
}

function ingest(e,{sourceId,eventId,kind,at,receivedAtMs=at+1_000}){
  return e.ingest({
    tenant:'acme',employee:'e1',sourceId,eventId,kind,
    observedAt:new Date(at).toISOString(),receivedAtMs
  });
}

function open(e,at=T){
  ingest(e,{sourceId:'door',eventId:`open-door-${at}`,kind:'access_entry',at});
  const opened=ingest(e,{sourceId:'wifi',eventId:`open-wifi-${at}`,kind:'wifi_authenticated',at:at+1_000});
  assert.equal(opened.decision.status,'authoritative');
}

function close(e,at=END){
  ingest(e,{sourceId:'door',eventId:`close-door-${at}`,kind:'access_exit',at});
  const closed=ingest(e,{sourceId:'hmi',eventId:`close-hmi-${at}`,kind:'hmi_logout',at:at-1_000,receivedAtMs:at+2_000});
  assert.equal(closed.decision.status,'authoritative');
}

test('pre-close evidence cannot be recycled to corroborate a new post-close IN',()=>{
  const e=setup();
  open(e);
  ingest(e,{sourceId:'wifi',eventId:'prior-session-wifi-auth',kind:'wifi_authenticated',at:END-30_000,receivedAtMs:END+1_000});
  close(e);
  const result=ingest(e,{sourceId:'door',eventId:'new-session-door-entry',kind:'access_entry',at:END+30_000,receivedAtMs:END+31_000});
  assert.equal(result.decision.status,'review_required');
  assert.equal(result.decision.reason,'INSUFFICIENT_INDEPENDENT_CORROBORATION');
  assert.equal(e.getState({tenant:'acme',employee:'e1',site:'s1'}).status,'outside');
});

test('pre-open negative evidence cannot be recycled to corroborate a new-session OUT',()=>{
  const e=setup();
  ingest(e,{sourceId:'hmi',eventId:'pre-open-hmi-logout',kind:'hmi_logout',at:T,receivedAtMs:T+1_000});
  open(e,T+30_000);
  const result=ingest(e,{sourceId:'door',eventId:'post-open-door-exit',kind:'access_exit',at:T+60_000,receivedAtMs:T+61_000});
  assert.equal(result.decision.status,'review_required');
  assert.equal(result.decision.reason,'INSUFFICIENT_INDEPENDENT_CORROBORATION');
  assert.equal(e.getState({tenant:'acme',employee:'e1',site:'s1'}).status,'present');
});
