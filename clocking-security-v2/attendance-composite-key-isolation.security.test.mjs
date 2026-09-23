import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomaticAttendanceEvidenceEngine } from './invisible-attendance-engine.mjs';
import { AttendanceCoverageAssurance } from './attendance-coverage-assurance.mjs';
import { AttendanceSourceSupervisor } from './attendance-source-supervisor.mjs';
import { AttendancePayrollGate } from './attendance-payroll-gate.mjs';
import { DurableEvidenceJournal } from './durable-attendance-journal.mjs';
import { SQLiteAttendanceRuntime } from './sqlite-attendance-runtime.mjs';

const T=Date.parse('2026-09-19T12:00:00Z');

test('delimiter-shaped tenant/source IDs cannot inherit another tenant direct-attendance authority',()=>{
  const engine=new AutomaticAttendanceEvidenceEngine();
  engine.registerPerson({tenant:'plant:west',employee:'e1',sites:['s1']});

  // These pairs collided under the old `${tenant}:${sourceId}` map key.
  engine.registerSource({tenant:'plant:west',sourceId:'clock',site:'s1',type:'legacy',directAttendanceAuthority:false});
  engine.registerSource({tenant:'plant',sourceId:'west:clock',site:'s1',type:'legacy',directAttendanceAuthority:true});

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

test('delimiter-shaped tenant/source IDs cannot overwrite another tenant continuity connector',()=>{
  const supervisor=new AttendanceSourceSupervisor({heartbeatSlaMs:10_000});
  supervisor.register({tenant:'plant:west',sourceId:'wifi',provider:'radius-a',site:'s1',nowMs:T});
  supervisor.register({tenant:'plant',sourceId:'west:wifi',provider:'radius-b',site:'s2',nowMs:T});

  const a=supervisor.heartbeat({tenant:'plant:west',sourceId:'wifi',atMs:T+1000});
  const b=supervisor.heartbeat({tenant:'plant',sourceId:'west:wifi',atMs:T+2000});
  assert.equal(a.tenant,'plant:west');
  assert.equal(a.sourceId,'wifi');
  assert.equal(a.site,'s1');
  assert.equal(b.tenant,'plant');
  assert.equal(b.sourceId,'west:wifi');
  assert.equal(b.site,'s2');
});

test('another tenant manager correction cannot become payroll authority through delimiter collision',()=>{
  const row={employee:'e1',workerType:'employee',status:'missing_out',openAt:new Date(T-6*60*60_000).toISOString(),evidenceCount:2};
  const coverage={evaluateShift(){return {rows:[row],payrollReady:false,unexpectedCount:0,unmappedSignalCount:0};}};
  const certifier={certifyShift(){return {claimLevel:'NOT_CERTIFIED',claim:null,certification:{sourceContinuityPeriod:true,verifiedPeriodCertified:false}};}};
  const payroll=new AttendancePayrollGate({coverage,certifier});

  payroll.recordCorrection({
    tenant:'plant',site:'west:s1',shiftId:'day1',employee:'e1',reviewId:'review-attacker',actorId:'manager-attacker',reasonCode:'CONFIRMED_EXIT',
    correctedInAt:new Date(T-6*60*60_000).toISOString(),correctedOutAt:new Date(T-1000).toISOString(),reviewedAt:T
  });

  const victim=payroll.projectShift({tenant:'plant:west',site:'s1',shiftId:'day1',nowMs:T,shiftWindowClosed:true});
  assert.equal(victim.payrollReady,false);
  assert.equal(victim.attendanceInputs.length,0);
  assert.equal(victim.manualReviewCount,0);
  assert.equal(victim.reviewRequired.length,1);
});

test('durable journal stores delimiter-colliding tenant/source identities independently',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wfm-attendance-journal-key-'));
  try{
    const journal=new DurableEvidenceJournal({filePath:path.join(dir,'attendance.log')});
    const a=journal.appendEvent({tenant:'plant:west',sourceId:'clock',eventId:'event0001',payload:'a'});
    const b=journal.appendEvent({tenant:'plant',sourceId:'west:clock',eventId:'event0001',payload:'b'});
    assert.equal(a.persisted,true);
    assert.equal(b.persisted,true);
    assert.notEqual(a.key,b.key);
    assert.equal(journal.listEvents().length,2);
  } finally {
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('transactional runtime does not reject another tenant event because its composite identity contains delimiters',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wfm-attendance-sqlite-key-'));
  const dbPath=path.join(dir,'attendance.sqlite');
  let runtime;
  try{
    const engine=new AutomaticAttendanceEvidenceEngine();
    engine.registerPerson({tenant:'plant:west',employee:'e1',sites:['s1']});
    engine.registerSource({tenant:'plant:west',sourceId:'clock',site:'s1',type:'legacy',directAttendanceAuthority:true});
    engine.registerPerson({tenant:'plant',employee:'e2',sites:['s2']});
    engine.registerSource({tenant:'plant',sourceId:'west:clock',site:'s2',type:'legacy',directAttendanceAuthority:true});
    runtime=new SQLiteAttendanceRuntime({filePath:dbPath,engine});

    const first=runtime.ingest({tenant:'plant:west',sourceId:'clock',eventId:'event0001',employee:'e1',kind:'legacy_clock_in',observedAt:new Date(T).toISOString(),receivedAtMs:T+100});
    const second=runtime.ingest({tenant:'plant',sourceId:'west:clock',eventId:'event0001',employee:'e2',kind:'legacy_clock_in',observedAt:new Date(T+1000).toISOString(),receivedAtMs:T+1100});
    assert.equal(first.decision.status,'authoritative');
    assert.equal(second.decision.status,'authoritative');
    assert.equal(runtime.storedEventCount(),2);
  } finally {
    try{ runtime?.close(); }catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
