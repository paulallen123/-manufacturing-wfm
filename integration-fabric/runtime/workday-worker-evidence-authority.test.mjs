import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkdayWorkerEvidenceAuthority} from './workday-worker-evidence-authority.mjs';

const policy=(overrides={})=>({
  workdayTenantId:'acme_implementation',
  exportPolicy:{
    provider:'workday',
    wfmTenantId:'vector-tenant-uk-1',
    connectionId:'connection-workday-1',
    accountId:'acme_implementation',
    environmentId:'implementation',
    regionalHost:'wd2-impl-services1.workday.com',
    credentialRevision:'isu-cert-rev-3',
    credentialScope:{mode:'custom',exports:['core-connector-worker'],imports:[],flows:[],connections:[],apis:[],topics:[]},
    exports:[{
      integrationId:'workday-core-connector-worker',
      exportId:'core-connector-worker',
      dataset:'workers',
      sinkId:'vector-worker-ingress',
      exportRevision:'2026R2-v47.0',
      schemaFingerprint:'sha256:workday-worker-v47-approved-fields'
    }]
  },
  workforcePolicy:{
    provider:'workday',
    wfmTenantId:'vector-tenant-uk-1',
    connectionId:'connection-workday-1',
    sourceInstanceId:'acme_implementation',
    companyId:'ACME-UK',
    consumerId:'vector-workforce-master-v1',
    apiOrigin:'https://wd2-impl-services1.workday.com',
    apiVersion:'soap-v47.0',
    entity:'Get_Workers',
    queryMode:'as-of-snapshot',
    schemaFingerprint:'sha256:workday-worker-v47-approved-fields',
    queryFingerprint:'sha256:get-workers-approved-response-groups-v1',
    maxWindowSeconds:86400,
    overlapSeconds:300,
    maxClockSkewSeconds:60,
    maxRecords:10000
  },
  ...overrides
});

const exportRequest=()=>({
  provider:'workday',wfmTenantId:'vector-tenant-uk-1',connectionId:'connection-workday-1',
  accountId:'acme_implementation',environmentId:'implementation',regionalHost:'wd2-impl-services1.workday.com',
  resourceKind:'export',action:'invoke-read-ingress',integrationId:'workday-core-connector-worker',
  exportId:'core-connector-worker',dataset:'workers',sinkId:'vector-worker-ingress',
  exportRevision:'2026R2-v47.0',schemaFingerprint:'sha256:workday-worker-v47-approved-fields'
});

const record=(overrides={})=>({
  personId:'WID-person-100',employmentId:'WID-worker-100',assignmentId:'WID-position-100-A',
  effectiveStartDate:'2026-09-01',effectiveEndDate:'9999-12-31',sequenceNumber:1,
  lastModifiedAt:'2026-09-28T12:30:00Z',sourceVersion:'2026R2-v47.0#1',
  payloadDigest:'sha256:worker-position-a',...overrides
});

const workforceBatch=(overrides={})=>({
  provider:'workday',wfmTenantId:'vector-tenant-uk-1',connectionId:'connection-workday-1',
  sourceInstanceId:'acme_implementation',companyId:'ACME-UK',consumerId:'vector-workforce-master-v1',
  apiOrigin:'https://wd2-impl-services1.workday.com',apiVersion:'soap-v47.0',entity:'Get_Workers',
  queryMode:'as-of-snapshot',schemaFingerprint:'sha256:workday-worker-v47-approved-fields',
  queryFingerprint:'sha256:get-workers-approved-response-groups-v1',
  windowStart:'2026-09-28T12:00:00Z',windowEnd:'2026-09-28T13:00:00Z',
  observedAt:'2026-09-28T13:02:00Z',complete:true,records:[record()],...overrides
});

const exportReceipt=plan=>({
  planFingerprint:plan.planFingerprint,providerRunId:'WID-integration-event-9001',status:'completed',
  startedAt:'2026-09-28T13:00:00Z',completedAt:'2026-09-28T13:01:00Z',
  sourceWindow:{from:'2026-09-28T12:00:00Z',to:'2026-09-28T13:00:00Z'},
  exportRevision:'2026R2-v47.0',schemaFingerprint:'sha256:workday-worker-v47-approved-fields',
  errorCount:0,pages:[{sequence:1,recordCount:1,byteCount:512,digest:'sha256:workday-export-page-1'}],
  pageCount:1,recordCount:1,byteCount:512
});

const receipt=(authority,overrides={})=>{
  const request=exportRequest();
  const plan=authority.authorizeExport(request);
  return {exportRequest:request,exportReceipt:{...exportReceipt(plan),...(overrides.exportReceipt||{})},
    workforceBatch:{...workforceBatch(),...(overrides.workforceBatch||{})}};
};

test('admits one exact Workday export plus workforce snapshot as reconciliation evidence only',()=>{
  const authority=createWorkdayWorkerEvidenceAuthority(policy());
  const decision=authority.admit(receipt(authority));
  assert.equal(decision.workdayWorkerReconciliationCandidate,true);
  assert.equal(decision.checkpointAdvanceAllowed,false);
  assert.equal(decision.deletionAuthority,false);
  assert.equal(decision.workerMutationAuthority,false);
  assert.equal(decision.payrollAuthority,false);
  assert.equal(decision.attendanceAuthority,false);
  assert.equal(decision.writeBackAuthority,false);
  assert.equal(decision.causalAuthority,false);
  assert.equal(decision.reportedRecordCount,1);
  assert.equal(decision.uniqueRecordCount,1);
  assert.match(decision.integrationEventFingerprint,/^sha256:[a-f0-9]{64}$/);
  assert.match(decision.reconciliationFingerprint,/^sha256:[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(decision),/WID-person|WID-worker|WID-position|integration-event-9001/);
});

test('preserves multiple jobs for one person without exposing source identities',()=>{
  const authority=createWorkdayWorkerEvidenceAuthority(policy());
  const records=[record(),record({assignmentId:'WID-position-100-B',payloadDigest:'sha256:worker-position-b'})];
  const evidence=receipt(authority,{workforceBatch:{records},exportReceipt:{
    pages:[{sequence:1,recordCount:2,byteCount:800,digest:'sha256:workday-export-page-1'}],recordCount:2,byteCount:800
  }});
  const decision=authority.admit(evidence);
  assert.equal(decision.assignmentIdentityCount,2);
  assert.equal(decision.uniqueRecordCount,2);
  assert.doesNotMatch(JSON.stringify(decision),/position-100/);
});

test('rejects constructor scope drift before any export can be authorised',()=>{
  const cases=[
    value=>{value.exportPolicy.provider='other';},
    value=>{value.workforcePolicy.connectionId='connection-other';},
    value=>{value.workforcePolicy.wfmTenantId='tenant-other';},
    value=>{value.workforcePolicy.sourceInstanceId='other_tenant';},
    value=>{value.exportPolicy.accountId='other_tenant';},
    value=>{value.workforcePolicy.apiOrigin='https://wd5-services1.workday.com';},
    value=>{value.workforcePolicy.schemaFingerprint='sha256:other';},
    value=>{value.exportPolicy.exports[0].dataset='payroll';},
    value=>{value.workforcePolicy.entity='Put_Worker';}
  ];
  for(const mutate of cases){
    const candidate=policy();mutate(candidate);
    assert.throws(()=>createWorkdayWorkerEvidenceAuthority(candidate),/workday|tenant|connection|host|schema|workers|Get_Workers/i);
  }
});

test('requires exact source window, record count and completion chronology across both authorities',()=>{
  for(const overrides of [
    {workforceBatch:{windowStart:'2026-09-28T11:59:59Z'}},
    {workforceBatch:{windowEnd:'2026-09-28T13:00:01Z'}},
    {workforceBatch:{observedAt:'2026-09-28T13:00:30Z'}},
    {exportReceipt:{recordCount:2}},
    {exportReceipt:{status:'running'}},
    {workforceBatch:{complete:false}}
  ]){
    const authority=createWorkdayWorkerEvidenceAuthority(policy());
    assert.throws(()=>authority.admit(receipt(authority,overrides)),/window|record|completed|observation|incomplete|status/i);
  }
});

test('rejects replay conflicts, cross-tenant requests and secret-bearing evidence',()=>{
  const authority=createWorkdayWorkerEvidenceAuthority(policy());
  const conflict=[record(),record({payloadDigest:'sha256:conflict'})];
  assert.throws(()=>authority.admit(receipt(authority,{workforceBatch:{records:conflict},exportReceipt:{
    pages:[{sequence:1,recordCount:2,byteCount:700,digest:'sha256:p'}],recordCount:2,byteCount:700
  }})),/conflicting duplicate/i);

  const crossTenant=receipt(authority);
  crossTenant.exportRequest.accountId='other_tenant';
  assert.throws(()=>authority.admit(crossTenant),/accountId|approved authority/i);

  const secret=receipt(authority);
  secret.workforceBatch.records[0].apiToken='synthetic-secret';
  assert.throws(()=>authority.admit(secret),/secret|credential/i);
});

test('quarantines exact duplicate rows in a completed Workday worker snapshot',()=>{
  const authority=createWorkdayWorkerEvidenceAuthority(policy());
  const duplicate=record();
  const evidence=receipt(authority,{workforceBatch:{records:[duplicate,{...duplicate}]},exportReceipt:{
    pages:[{sequence:1,recordCount:2,byteCount:700,digest:'sha256:duplicate-page'}],recordCount:2,byteCount:700
  }});
  assert.throws(()=>authority.admit(evidence),/duplicate.*worker|replay/i);
});

test('returns deterministic deeply immutable decision evidence',()=>{
  const firstAuthority=createWorkdayWorkerEvidenceAuthority(policy());
  const first=firstAuthority.admit(receipt(firstAuthority));
  const secondAuthority=createWorkdayWorkerEvidenceAuthority(policy());
  const second=secondAuthority.admit(receipt(secondAuthority));
  assert.deepEqual(first,second);
  assert.equal(Object.isFrozen(first),true);
  assert.equal(Object.isFrozen(first.sourceWindow),true);
  assert.throws(()=>{first.reportedRecordCount=99;},TypeError);
});

// Regression: inert cloning must inspect an array descriptor before reading its value.
test('rejects indexed accessors without executing untrusted policy data',()=>{
  const input=policy();let calls=0;const values=[];
  Object.defineProperty(values,'0',{enumerable:true,get(){calls++;return 'employeeId';}});
  input.untrustedArrayEvidence=values;
  assert.throws(()=>createWorkdayWorkerEvidenceAuthority(input),/executable|hidden/i);
  assert.equal(calls,0,'array accessor was executed before rejection');
});
