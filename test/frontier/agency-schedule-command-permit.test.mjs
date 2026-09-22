import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { evaluateAgencyScheduleCommandPermit } from '../../src/frontier/agency-schedule-command-permit.mjs';

const NOW='2026-10-04T12:30:00.000Z';
const OLD='a'.repeat(32);const NEW='b'.repeat(32);
const REQUEST={requestId:'R1',roleId:'PACK-OP',location:'Plant 1, Birmingham',startAt:'2026-10-05T06:00:00.000Z',endAt:'2026-10-05T14:00:00.000Z'};
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const digest=(v,n=24)=>crypto.createHash('sha256').update(String(v??'')).digest('hex').slice(0,n);
const assignmentFp=()=>digest(JSON.stringify(stable({roleId:'PACK-OP',location:'Plant 1, Birmingham',startAt:'2026-10-05T06:00:00.000Z',endAt:'2026-10-05T14:00:00.000Z'})));
const row=(overrides={})=>({action:'confirm_preferred_worker',consumedAt:'2026-10-04T12:00:00.000Z',workerId:'W1',acceptedAssuranceVersionId:OLD,currentAssuranceVersionId:OLD,currentSiteId:'S1',currentRequestId:'R1',assignmentFingerprint:assignmentFp(),checkedAt:'2026-10-04T10:00:00.000Z',coverageUntil:'2027-12-31T23:59:59.000Z',promotedAt:'2026-10-04T11:00:00.000Z',conflicted:false,...overrides});
const handoffFp=(rows=[row()])=>digest(JSON.stringify(stable({tenantId:'T1',siteId:'S1',requestId:'R1',agencyId:'A1',acceptedResponseFingerprint:digest('TOK-1',16),assignmentFingerprint:assignmentFp(),bindings:rows.map(r=>({workerId:r.workerId,assuranceVersionId:r.currentAssuranceVersionId})).sort((a,b)=>a.workerId.localeCompare(b.workerId))})),32);
const preflight=(rows=[row()])=>({readyForScheduleHandoff:true,requestId:'R1',siteId:'S1',agencyId:'A1',acceptedResponseFingerprint:digest('TOK-1',16),scheduleHandoffFingerprint:handoffFp(rows)});
const store=rows=>({async withLockedAuthority(_scope,evaluate){return evaluate(structuredClone(rows));}});
const command=(overrides={})=>({type:'shadow_schedule_assignment',tenantId:'T1',siteId:'S1',requestId:'R1',agencyId:'A1',roleId:'PACK-OP',location:'Plant 1, Birmingham',startAt:'2026-10-05T06:00:00.000Z',endAt:'2026-10-05T14:00:00.000Z',assignmentFingerprint:assignmentFp(),scheduleHandoffFingerprint:handoffFp(),workerAssuranceBindings:[{workerId:'W1',assuranceVersionId:OLD}],...overrides});
const input=(rows=[row()])=>({tenantId:'T1',siteId:'S1',agencyId:'A1',tokenId:'TOK-1',request:structuredClone(REQUEST),now:NOW,preflight:preflight(rows),authorityStore:store(rows)});

test('valid command receives a single shadow envelope inside the locked guard and no live schedule authority',async()=>{
  let capturedPermit=null;let envelope=null;
  const result=await evaluateAgencyScheduleCommandPermit({...input(),shadowScheduleCommand:async permit=>{capturedPermit=permit;envelope=permit.consume(command());}});
  assert.equal(result.permitPassed,true);assert.equal(result.scheduleWriteAuthorized,false);assert.equal(envelope.acceptedForShadow,true);assert.equal(envelope.scheduleWriteAuthorized,false);assert.match(result.shadowCommandFingerprint,/^[0-9a-f]{32}$/);assert.equal(result.workerAssuranceBindings[0].workerId,'W1');
  assert.throws(()=>capturedPermit.consume(command()),/schedule_command_permit_expired/);
  assert.doesNotMatch(JSON.stringify(result),/TOK-1|share-code|1990-01-01|document-number|raw-right-to-work/);
});

test('permit is one-shot even while its transaction-scoped callback is active',async()=>{
  const result=await evaluateAgencyScheduleCommandPermit({...input(),shadowScheduleCommand:async permit=>{permit.consume(command());assert.throws(()=>permit.consume(command()),/schedule_command_permit_already_consumed/);}});
  assert.equal(result.permitPassed,true);
});

test('command scope, handoff, assignment and worker evidence must exactly match the guarded authority',async()=>{
  for(const [override,reason] of [
    [{siteId:'OTHER'},'schedule_command_site_id_mismatch'],
    [{scheduleHandoffFingerprint:'c'.repeat(32)},'schedule_command_handoff_fingerprint_mismatch'],
    [{assignmentFingerprint:'c'.repeat(24)},'schedule_command_assignment_fingerprint_mismatch'],
    [{endAt:'2026-10-05T15:00:00.000Z'},'schedule_command_assignment_window_mismatch'],
    [{workerAssuranceBindings:[{workerId:'W1',assuranceVersionId:NEW}]},'schedule_command_worker_bindings_mismatch'],
  ]){
    const result=await evaluateAgencyScheduleCommandPermit({...input(),shadowScheduleCommand:async permit=>{permit.consume(command(override));}});
    assert.equal(result.permitPassed,false,reason);assert.equal(result.reason,reason);assert.equal(result.scheduleWriteAuthorized,false);
  }
});

test('unexpected fields are rejected so raw personal/compliance data cannot be smuggled into the command envelope',async()=>{
  const result=await evaluateAgencyScheduleCommandPermit({...input(),shadowScheduleCommand:async permit=>{permit.consume(command({dateOfBirth:'1990-01-01'}));}});
  assert.equal(result.permitPassed,false);assert.equal(result.reason,'schedule_command_unexpected_field');assert.doesNotMatch(JSON.stringify(result),/1990-01-01/);
});

test('callback must consume the permit exactly once and callback failure fails closed',async()=>{
  const unused=await evaluateAgencyScheduleCommandPermit({...input(),shadowScheduleCommand:async()=>{}});assert.equal(unused.permitPassed,false);assert.equal(unused.reason,'schedule_command_permit_not_consumed');
  const failed=await evaluateAgencyScheduleCommandPermit({...input(),shadowScheduleCommand:async permit=>{permit.consume(command());throw new Error('shadow sink unavailable');}});assert.equal(failed.permitPassed,false);assert.equal(failed.reason,'shadow_critical_section_failed');assert.equal(failed.scheduleWriteAuthorized,false);
});

test('stale or conflicted authoritative assurance prevents permit issuance and never invokes the command callback',async()=>{
  for(const rows of [[row({currentAssuranceVersionId:NEW})],[row({conflicted:true})]]){
    let calls=0;const result=await evaluateAgencyScheduleCommandPermit({...input(rows),preflight:preflight([row()]),shadowScheduleCommand:async()=>{calls+=1;}});
    assert.equal(result.permitPassed,false);assert.equal(calls,0);assert.equal(result.scheduleWriteAuthorized,false);
  }
});

test('5,000 stale/tampered schedule commands produce zero shadow command permits',async()=>{
  let passed=0;
  for(let i=0;i<5000;i+=1){
    const result=await evaluateAgencyScheduleCommandPermit({...input(),shadowScheduleCommand:async permit=>{permit.consume(command({workerAssuranceBindings:[{workerId:'W1',assuranceVersionId:i%2===0?NEW:OLD}],scheduleHandoffFingerprint:i%2===0?handoffFp():'f'.repeat(32)}));}});
    if(result.permitPassed)passed+=1;
  }
  assert.equal(passed,0);
});

test('identical guarded command state produces deterministic shadow command evidence',async()=>{
  const run=()=>evaluateAgencyScheduleCommandPermit({...input(),shadowScheduleCommand:async permit=>{permit.consume(command());}});
  const [a,b]=await Promise.all([run(),run()]);assert.equal(a.permitPassed,true);assert.equal(b.permitPassed,true);assert.equal(a.shadowCommandFingerprint,b.shadowCommandFingerprint);assert.equal(a.scheduleHandoffFingerprint,b.scheduleHandoffFingerprint);
});
