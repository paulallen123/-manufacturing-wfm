import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomaticAttendanceEvidenceEngine } from './invisible-attendance-engine.mjs';

const T=Date.parse('2026-09-20T07:00:00Z');

test('unknown connector cannot self-declare existing T&A direct attendance authority',()=>{
  const e=new AutomaticAttendanceEvidenceEngine();
  e.registerPerson({tenant:'acme',employee:'e1',sites:['s1']});
  assert.throws(
    ()=>e.registerSource({
      tenant:'acme',
      sourceId:'generic-gateway',
      site:'s1',
      type:'vendor-gateway',
      directAttendanceAuthority:true,
      allowedKinds:['legacy_clock_in','legacy_clock_out']
    }),
    /reserved for explicitly recognised existing T&A/
  );
});

test('direct existing T&A authority requires provider/source event time',()=>{
  const e=new AutomaticAttendanceEvidenceEngine();
  assert.throws(
    ()=>e.registerSource({
      tenant:'acme',
      sourceId:'taa',
      site:'s1',
      type:'legacy',
      directAttendanceAuthority:true,
      timestampMode:'server'
    }),
    /requires the source event timestamp/
  );
});

test('recognised source-timestamped existing T&A remains direct authority',()=>{
  const e=new AutomaticAttendanceEvidenceEngine({maxOfflineAgeMs:86_400_000});
  e.registerPerson({tenant:'acme',employee:'e1',sites:['s1']});
  e.registerSource({tenant:'acme',sourceId:'taa',site:'s1',type:'legacy',directAttendanceAuthority:true});
  const r=e.ingest({
    tenant:'acme',
    sourceId:'taa',
    eventId:'legacy-direct-0001',
    employee:'e1',
    kind:'legacy_clock_in',
    observedAt:new Date(T).toISOString(),
    receivedAtMs:T+1000
  });
  assert.equal(r.decision.status,'authoritative');
  assert.equal(r.decision.reason,'DIRECT_EXISTING_TAA');
});
