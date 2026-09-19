import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomaticAttendanceEvidenceEngine } from './invisible-attendance-engine.mjs';

const T=Date.parse('2026-09-19T12:00:00Z');

test('delimiter-shaped tenant/source IDs cannot inherit another tenant direct-attendance authority',()=>{
  const engine=new AutomaticAttendanceEvidenceEngine();
  engine.registerPerson({tenant:'plant:west',employee:'e1',sites:['s1']});

  // These pairs collided under the old `${tenant}:${sourceId}` map key.
  engine.registerSource({tenant:'plant:west',sourceId:'clock',site:'s1',type:'legacy_taa',directAttendanceAuthority:false});
  engine.registerSource({tenant:'plant',sourceId:'west:clock',site:'s1',type:'legacy_taa',directAttendanceAuthority:true});

  const receipt=engine.ingest({
    tenant:'plant:west',sourceId:'clock',eventId:'event0001',employee:'e1',kind:'legacy_clock_in',
    observedAt:new Date(T).toISOString(),receivedAtMs:T+100
  });

  assert.equal(receipt.decision.status,'review_required');
  assert.equal(receipt.decision.reason,'INSUFFICIENT_INDEPENDENT_CORROBORATION');
  assert.equal(engine.getState({tenant:'plant:west',employee:'e1',site:'s1'}).status,'outside');
});
