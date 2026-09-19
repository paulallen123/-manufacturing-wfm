import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomaticAttendanceEvidenceEngine } from './invisible-attendance-engine.mjs';
import { AttendanceCoverageAssurance } from './attendance-coverage-assurance.mjs';

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

test('delimiter-shaped tenant/site IDs cannot overwrite another tenant shift roster',()=>{
  const coverage=new AttendanceCoverageAssurance({engine:{}});
  const start=new Date(T).toISOString();
  const end=new Date(T+8*60*60_000).toISOString();

  // These triples collided under the old colon-joined shift key.
  coverage.registerShift({tenant:'plant:west',site:'s1',shiftId:'day1',startAt:start,endAt:end,assignments:[{employee:'e1'}]});
  coverage.registerShift({tenant:'plant',site:'west:s1',shiftId:'day1',startAt:start,endAt:end,assignments:[{employee:'e2'}]});

  const victim=coverage.preflight({tenant:'plant:west',site:'s1',shiftId:'day1'});
  assert.equal(victim.total,1);
  assert.equal(victim.rows[0].employee,'e1');
});

test('delimiter-shaped tenant/site IDs cannot inject another tenant automatic coverage plan',()=>{
  const coverage=new AttendanceCoverageAssurance({engine:{}});
  const start=new Date(T).toISOString();
  const end=new Date(T+8*60*60_000).toISOString();

  coverage.registerShift({tenant:'plant:west',site:'s1',shiftId:'day1',startAt:start,endAt:end,assignments:[{employee:'e1'}]});
  coverage.setCoveragePlan({tenant:'plant:west',site:'s1',employee:'e1',routes:[]});

  // This plan collided with plant:west / s1 / e1 under the old key and could
  // make the victim tenant's automatic-coverage release target appear green.
  coverage.setCoveragePlan({tenant:'plant',site:'west:s1',employee:'e1',routes:[
    {domain:'legacy_taa',sourceId:'clock',role:'authoritative'}
  ]});

  const victim=coverage.preflight({tenant:'plant:west',site:'s1',shiftId:'day1'});
  assert.equal(victim.releaseTargetMet,false);
  assert.equal(victim.automaticReady,0);
  assert.deepEqual(victim.uncovered,['e1']);
});
