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
  e.registerSource({tenant:'acme',sourceId:'taa',site:'s1',type:'legacy',directAttendanceAuthority:true});
  return e;
}

function ingest(e,{sourceId,eventId,kind,at,receivedAtMs=at+1_000}){
  return e.ingest({
    tenant:'acme',employee:'e1',sourceId,eventId,kind,
    observedAt:new Date(at).toISOString(),receivedAtMs
  });
}

function closeIndependentSession(e){
  ingest(e,{sourceId:'door',eventId:'close-door-in-001',kind:'access_entry',at:T});
  const opened=ingest(e,{sourceId:'wifi',eventId:'close-wifi-in-001',kind:'wifi_authenticated',at:T+1_000});
  assert.equal(opened.decision.status,'authoritative');
  ingest(e,{sourceId:'door',eventId:'close-door-out-01',kind:'access_exit',at:END});
  const closed=ingest(e,{sourceId:'hmi',eventId:'close-hmi-out-001',kind:'hmi_logout',at:END-1_000,receivedAtMs:END+2_000});
  assert.equal(closed.decision.status,'authoritative');
  assert.equal(closed.decision.direction,'out');
  const state=e.getState({tenant:'acme',employee:'e1',site:'s1'});
  assert.equal(state.status,'outside');
  assert.equal(state.closeAt,END);
}

test('late independent IN evidence cannot reopen attendance before the prior authoritative close',()=>{
  const e=setup();
  closeIndependentSession(e);
  const late=T+7*60*60_000;
  ingest(e,{sourceId:'door',eventId:'late-door-in-001',kind:'access_entry',at:late,receivedAtMs:END+60_000});
  const result=ingest(e,{sourceId:'wifi',eventId:'late-wifi-in-001',kind:'wifi_authenticated',at:late+1_000,receivedAtMs:END+60_001});
  assert.equal(result.decision.status,'review_required');
  assert.equal(result.decision.reason,'IN_NOT_AFTER_PRIOR_CLOSE');
  const state=e.getState({tenant:'acme',employee:'e1',site:'s1'});
  assert.equal(state.status,'outside');
  assert.equal(state.closeAt,END);
  assert.equal(e.audit.filter(x=>x.action==='attendance-in-authoritative').length,1);
});

test('late direct T&A clock-in cannot reopen attendance before its prior authoritative clock-out',()=>{
  const e=setup();
  const opened=ingest(e,{sourceId:'taa',eventId:'taa-open-0001',kind:'legacy_clock_in',at:T});
  assert.equal(opened.decision.status,'authoritative');
  const closed=ingest(e,{sourceId:'taa',eventId:'taa-close-001',kind:'legacy_clock_out',at:END});
  assert.equal(closed.decision.status,'authoritative');
  const late=ingest(e,{sourceId:'taa',eventId:'taa-late-in-01',kind:'legacy_clock_in',at:END-60_000,receivedAtMs:END+60_000});
  assert.equal(late.decision.status,'review_required');
  assert.equal(late.decision.reason,'IN_NOT_AFTER_PRIOR_CLOSE');
  const state=e.getState({tenant:'acme',employee:'e1',site:'s1'});
  assert.equal(state.status,'outside');
  assert.equal(state.closeAt,END);
  assert.equal(e.audit.filter(x=>x.action==='attendance-in-authoritative').length,1);
});
