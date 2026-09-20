import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomaticAttendanceEvidenceEngine } from './invisible-attendance-engine.mjs';

const START=Date.parse('2026-09-20T06:00:00Z');
const END=Date.parse('2026-09-20T14:00:00Z');

function setup(){
  const engine=new AutomaticAttendanceEvidenceEngine({corroborationWindowMs:120_000,maxOfflineAgeMs:24*60*60_000});
  engine.registerPerson({tenant:'acme',employee:'e1',sites:['s1']});
  engine.registerSource({
    tenant:'acme',sourceId:'combo-source',site:'s1',type:'misconfigured-multiprotocol',
    allowedKinds:['access_entry','access_exit','wifi_authenticated','wifi_disconnected']
  });
  engine.registerSource({tenant:'acme',sourceId:'independent-wifi',site:'s1',type:'radius'});
  return engine;
}

function ingest(engine,{sourceId,eventId,kind,at}){
  return engine.ingest({
    tenant:'acme',sourceId,eventId,employee:'e1',kind,
    observedAt:new Date(at).toISOString(),receivedAtMs:at+1000
  });
}

test('one source cannot impersonate two evidence domains to create an automatic IN',()=>{
  const engine=setup();
  ingest(engine,{sourceId:'combo-source',eventId:'combo-in-access-001',kind:'access_entry',at:START});
  const forged=ingest(engine,{sourceId:'combo-source',eventId:'combo-in-wifi-0001',kind:'wifi_authenticated',at:START+5000});

  assert.equal(forged.decision.status,'review_required');
  assert.equal(forged.decision.reason,'INSUFFICIENT_INDEPENDENT_CORROBORATION');
  assert.deepEqual(forged.decision.domains,['network_auth','physical_access']);
  assert.deepEqual(forged.decision.sources,['combo-source']);
  assert.equal(engine.getState({tenant:'acme',employee:'e1',site:'s1'}).status,'outside');

  const independent=ingest(engine,{sourceId:'independent-wifi',eventId:'independent-in-001',kind:'wifi_authenticated',at:START+6000});
  assert.equal(independent.decision.status,'authoritative');
  assert.equal(independent.decision.direction,'in');
  assert.equal(engine.getState({tenant:'acme',employee:'e1',site:'s1'}).status,'present');
});

test('one source cannot impersonate two evidence domains to stop pay',()=>{
  const engine=setup();
  ingest(engine,{sourceId:'combo-source',eventId:'legit-in-access-001',kind:'access_entry',at:START});
  ingest(engine,{sourceId:'independent-wifi',eventId:'legit-in-wifi-0001',kind:'wifi_authenticated',at:START+5000});
  assert.equal(engine.getState({tenant:'acme',employee:'e1',site:'s1'}).status,'present');

  ingest(engine,{sourceId:'combo-source',eventId:'combo-out-access-01',kind:'access_exit',at:END});
  const forgedOut=ingest(engine,{sourceId:'combo-source',eventId:'combo-out-wifi-001',kind:'wifi_disconnected',at:END+5000});

  assert.equal(forgedOut.decision.status,'review_required');
  assert.equal(forgedOut.decision.reason,'INSUFFICIENT_INDEPENDENT_CORROBORATION');
  assert.deepEqual(forgedOut.decision.domains,['network_auth','physical_access']);
  assert.deepEqual(forgedOut.decision.sources,['combo-source']);
  assert.equal(engine.getState({tenant:'acme',employee:'e1',site:'s1'}).status,'present');

  const independentOut=ingest(engine,{sourceId:'independent-wifi',eventId:'independent-out-01',kind:'wifi_disconnected',at:END+6000});
  assert.equal(independentOut.decision.status,'authoritative');
  assert.equal(independentOut.decision.direction,'out');
  assert.equal(engine.getState({tenant:'acme',employee:'e1',site:'s1'}).status,'outside');
});

test('two logical source IDs cannot manufacture independence by emitting kinds outside their registered source capability',()=>{
  const engine=new AutomaticAttendanceEvidenceEngine({corroborationWindowMs:120_000,maxOfflineAgeMs:24*60*60_000});
  engine.registerPerson({tenant:'acme',employee:'e1',sites:['s1']});
  engine.registerSource({tenant:'acme',sourceId:'door-a',site:'s1',type:'access'});
  engine.registerSource({tenant:'acme',sourceId:'door-b',site:'s1',type:'access'});

  ingest(engine,{sourceId:'door-a',eventId:'alias-access-in-001',kind:'access_entry',at:START});
  assert.throws(
    ()=>ingest(engine,{sourceId:'door-b',eventId:'alias-wifi-in-0001',kind:'wifi_authenticated',at:START+5000}),
    /not authorised for this source/
  );
  assert.equal(engine.getState({tenant:'acme',employee:'e1',site:'s1'}).status,'outside');
  assert.equal(engine.audit.filter(x=>x.action==='attendance-in-authoritative').length,0);
});
