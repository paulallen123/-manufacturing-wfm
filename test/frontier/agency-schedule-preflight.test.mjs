import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agencyScheduleAssignmentFingerprint,
  createPostgresAgencySchedulePreflightStore,
  preflightAgencyScheduleHandoff,
} from '../../src/frontier/agency-schedule-preflight.mjs';

const NOW='2026-10-04T12:30:00.000Z';
const OLD='a'.repeat(32);
const NEW='b'.repeat(32);
const request=()=>({requestId:'R1',roleId:'PACK-OP',location:'Plant 1, Birmingham',startAt:'2026-10-05T06:00:00.000Z',endAt:'2026-10-05T14:00:00.000Z'});
const baseRow=(overrides={})=>({
  action:'confirm_preferred_worker',
  consumedAt:'2026-10-04T12:00:00.000Z',
  workerId:'W1',
  acceptedAssuranceVersionId:OLD,
  currentAssuranceVersionId:OLD,
  currentSiteId:'S1',
  currentRequestId:'R1',
  assignmentFingerprint:agencyScheduleAssignmentFingerprint(request()),
  checkedAt:'2026-10-04T10:00:00.000Z',
  coverageUntil:'2027-12-31T23:59:59.000Z',
  promotedAt:'2026-10-04T11:00:00.000Z',
  conflicted:false,
  ...overrides,
});
const store=(rows)=>({async readAcceptedBindings(){return {rows:structuredClone(rows)}}});
const input=(rows)=>({tenantId:'T1',siteId:'S1',agencyId:'A1',tokenId:'TOK-1',request:request(),now:NOW,preflightStore:store(rows)});

test('exact durable accepted binding and current assurance permit only a non-mutating schedule handoff',async()=>{
  const result=await preflightAgencyScheduleHandoff(input([baseRow()]));
  assert.equal(result.readyForScheduleHandoff,true);
  assert.match(result.scheduleHandoffFingerprint,/^[0-9a-f]{32}$/);
  assert.equal(result.workerAssuranceBindings[0].workerId,'W1');
  assert.equal(result.workerAssuranceBindings[0].assuranceVersionId,OLD);
  assert.match(result.authorityBoundary,/preflight_only_no_schedule/);
  assert.doesNotMatch(JSON.stringify(result),/TOK-1|private-rtw-evidence|1990-01-01/);
});

test('newer current assurance invalidates the already accepted worker binding',async()=>{
  const result=await preflightAgencyScheduleHandoff(input([baseRow({currentAssuranceVersionId:NEW})]));
  assert.equal(result.readyForScheduleHandoff,false);
  assert.ok(result.failures.includes('accepted_worker_assurance_changed'));
});

test('conflict, changed assignment and insufficient coverage each fail closed',async()=>{
  const cases=[
    [baseRow({conflicted:true}),'current_assurance_conflicted'],
    [baseRow({assignmentFingerprint:'c'.repeat(24)}),'current_assurance_assignment_mismatch'],
    [baseRow({coverageUntil:'2026-10-05T12:00:00.000Z'}),'current_assurance_does_not_cover_assignment'],
  ];
  for(const [row,reason] of cases){
    const result=await preflightAgencyScheduleHandoff(input([row]));
    assert.equal(result.readyForScheduleHandoff,false,reason);
    assert.ok(result.failures.includes(reason),`${reason}: ${result.failures.join(',')}`);
  }
});

test('missing or unavailable durable acceptance fails closed',async()=>{
  const missing=await preflightAgencyScheduleHandoff(input([]));
  assert.equal(missing.readyForScheduleHandoff,false);
  assert.equal(missing.reason,'accepted_response_missing_or_unbound');
  const unavailable=await preflightAgencyScheduleHandoff({...input([baseRow()]),preflightStore:{async readAcceptedBindings(){throw new Error('db down')}}});
  assert.equal(unavailable.readyForScheduleHandoff,false);
  assert.equal(unavailable.reason,'schedule_preflight_store_unavailable');
});

test('non-scheduleable accepted action cannot create schedule handoff authority',async()=>{
  const result=await preflightAgencyScheduleHandoff(input([baseRow({action:'decline_request'})]));
  assert.equal(result.readyForScheduleHandoff,false);
  assert.equal(result.reason,'accepted_response_not_scheduleable');
});

test('PostgreSQL preflight store is a single read-only scoped query and locks current assurance in the lateral lookup',async()=>{
  let seenSql='';let seenValues=null;
  const row=baseRow();
  const pg=createPostgresAgencySchedulePreflightStore({query:async(sql,values)=>{
    seenSql=sql;seenValues=values;
    return {rows:[{
      action:row.action,consumed_at:row.consumedAt,worker_id:row.workerId,
      accepted_assurance_version_id:row.acceptedAssuranceVersionId,current_assurance_version_id:row.currentAssuranceVersionId,
      current_site_id:row.currentSiteId,current_request_id:row.currentRequestId,assignment_fingerprint:row.assignmentFingerprint,
      checked_at:row.checkedAt,coverage_until:row.coverageUntil,promoted_at:row.promotedAt,conflicted:false,
    }]};
  }});
  const read=await pg.readAcceptedBindings({tenantId:'T1',tokenId:'TOK-1',siteId:'S1',requestId:'R1',agencyId:'A1'});
  assert.equal(read.rows.length,1);
  assert.deepEqual(seenValues,['T1','TOK-1','S1','R1','A1']);
  assert.match(seenSql,/^\s*WITH\s+accepted/i);
  assert.doesNotMatch(seenSql,/\b(INSERT|UPDATE|DELETE)\b/i);
  assert.match(seenSql,/FOR SHARE/i);
  assert.match(seenSql,/tenant_id = \$1/);
  assert.match(seenSql,/token_id = \$2/);
  assert.match(seenSql,/site_id = \$3/);
  assert.match(seenSql,/request_id = \$4/);
  assert.match(seenSql,/agency_id = \$5/);
});

test('5,000 stale accepted assurance versions produce zero schedule-ready handoffs',async()=>{
  let ready=0;
  for(let i=0;i<5000;i+=1){
    const result=await preflightAgencyScheduleHandoff(input([baseRow({workerId:`W-${i}`,currentAssuranceVersionId:NEW})]));
    if(result.readyForScheduleHandoff)ready+=1;
  }
  assert.equal(ready,0);
});

test('identical accepted/current evidence yields deterministic handoff fingerprint',async()=>{
  const a=await preflightAgencyScheduleHandoff(input([baseRow()]));
  const b=await preflightAgencyScheduleHandoff(input([baseRow()]));
  assert.equal(a.scheduleHandoffFingerprint,b.scheduleHandoffFingerprint);
});
