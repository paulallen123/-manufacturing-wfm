import test from 'node:test';
import assert from 'node:assert/strict';
import {createEffectiveDatedWorkforceAuthority} from './effective-dated-workforce-authority.mjs';

const policy=(overrides={})=>({
  provider:'sap-successfactors',
  wfmTenantId:'tenant-eu-1',
  connectionId:'connection-sf-1',
  sourceInstanceId:'successfactors-company-ACME',
  companyId:'ACME',
  consumerId:'vector-workforce-master-v1',
  apiOrigin:'https://api012.successfactors.eu',
  apiVersion:'odata-v2',
  entity:'EmpJob',
  queryMode:'odata-effective-delta',
  schemaFingerprint:'sha256:empjob-v1',
  queryFingerprint:'sha256:empjob-approved-fields-and-filter-v1',
  maxWindowSeconds:86400,
  overlapSeconds:300,
  maxClockSkewSeconds:60,
  maxRecords:20,
  ...overrides
});

const record=(overrides={})=>({
  personId:'person-100',
  employmentId:'employment-uk-100',
  assignmentId:'assignment-plant-1',
  effectiveStartDate:'2026-09-01',
  effectiveEndDate:'9999-12-31',
  sequenceNumber:1,
  lastModifiedAt:'2026-09-26T22:05:00Z',
  sourceVersion:'2026-09-26T22:05:00Z#1',
  payloadDigest:'sha256:empjob-person-100-1',
  ...overrides
});

const batch=(overrides={})=>({
  provider:'sap-successfactors',
  wfmTenantId:'tenant-eu-1',
  connectionId:'connection-sf-1',
  sourceInstanceId:'successfactors-company-ACME',
  companyId:'ACME',
  consumerId:'vector-workforce-master-v1',
  apiOrigin:'https://api012.successfactors.eu',
  apiVersion:'odata-v2',
  entity:'EmpJob',
  queryMode:'odata-effective-delta',
  schemaFingerprint:'sha256:empjob-v1',
  queryFingerprint:'sha256:empjob-approved-fields-and-filter-v1',
  windowStart:'2026-09-26T22:00:00Z',
  windowEnd:'2026-09-26T23:00:00Z',
  observedAt:'2026-09-26T23:00:30Z',
  complete:true,
  records:[record()],
  ...overrides
});

test('admits an exact-scope effective-dated delta only as a reconciliation candidate',()=>{
  const decision=createEffectiveDatedWorkforceAuthority(policy()).admitBatch(batch());
  assert.equal(decision.effectiveDatedReconciliationCandidate,true);
  assert.equal(decision.deltaCandidate,true);
  assert.equal(decision.snapshotCandidate,false);
  assert.equal(decision.checkpointAdvanceAllowed,false);
  assert.equal(decision.deletionAuthority,false);
  assert.equal(decision.writeBackAuthority,false);
  assert.equal(decision.payrollAuthority,false);
  assert.equal(decision.accessDecisionAuthority,false);
  assert.equal(decision.uniqueRecordCount,1);
  assert.match(decision.checkpointNamespace,/^effective-workforce:[a-f0-9]{64}$/);
});

test('rejects scope, consumer, endpoint, version, entity, query and schema drift',()=>{
  for(const [field,value] of [
    ['wfmTenantId','tenant-other'],['connectionId','connection-other'],
    ['sourceInstanceId','instance-other'],['companyId','OTHER'],['consumerId','payroll-consumer'],
    ['apiOrigin','https://api4.successfactors.com'],['apiVersion','odata-v4'],
    ['entity','EmpEmployment'],['queryMode','compound-effective-delta'],
    ['schemaFingerprint','sha256:changed'],['queryFingerprint','sha256:changed-query']
  ]){
    assert.throws(
      ()=>createEffectiveDatedWorkforceAuthority(policy()).admitBatch(batch({[field]:value})),
      /approved authority/
    );
  }
});

test('preserves multiple employments and assignments for the same person',()=>{
  const records=[
    record(),
    record({employmentId:'employment-de-200',assignmentId:'assignment-plant-2',payloadDigest:'sha256:de'}),
    record({assignmentId:'assignment-plant-3',payloadDigest:'sha256:plant-3'})
  ];
  const decision=createEffectiveDatedWorkforceAuthority(policy()).admitBatch(batch({records}));
  assert.equal(decision.identityCount,3);
  assert.equal(decision.uniqueRecordCount,3);
  assert.deepEqual(decision.records.map(item=>item.employmentId).sort(),[
    'employment-de-200','employment-uk-100','employment-uk-100'
  ]);
});

test('collapses Unicode-normalised exact replays but quarantines conflicting composite identities',()=>{
  const composed=record({personId:'Jos\u00e9'});
  const decomposed={...composed,personId:'Jose\u0301'};
  const exact=createEffectiveDatedWorkforceAuthority(policy()).admitBatch(batch({records:[composed,decomposed]}));
  assert.equal(exact.uniqueRecordCount,1);
  assert.equal(exact.exactReplayCount,1);
  const conflict={...decomposed,payloadDigest:'sha256:conflict'};
  assert.throws(
    ()=>createEffectiveDatedWorkforceAuthority(policy()).admitBatch(batch({records:[composed,conflict]})),
    /conflicting duplicate/
  );
});

test('preserves sequence-numbered corrections instead of collapsing them',()=>{
  const records=[
    record(),
    record({sequenceNumber:2,sourceVersion:'2026-09-26T22:06:00Z#2',lastModifiedAt:'2026-09-26T22:06:00Z',payloadDigest:'sha256:correction'})
  ];
  const decision=createEffectiveDatedWorkforceAuthority(policy()).admitBatch(batch({records}));
  assert.equal(decision.uniqueRecordCount,2);
  assert.deepEqual(decision.records.map(item=>item.sequenceNumber),[1,2]);
});

test('rejects impossible effective dates and reversed effective intervals',()=>{
  assert.throws(
    ()=>createEffectiveDatedWorkforceAuthority(policy()).admitBatch(batch({records:[record({effectiveStartDate:'2026-02-30'})]})),
    /real calendar date/
  );
  assert.throws(
    ()=>createEffectiveDatedWorkforceAuthority(policy()).admitBatch(batch({records:[record({effectiveStartDate:'2026-10-01',effectiveEndDate:'2026-09-30'})]})),
    /effective end.*start/i
  );
});

test('requires delta modifications to fall inside the approved overlap window',()=>{
  assert.throws(
    ()=>createEffectiveDatedWorkforceAuthority(policy()).admitBatch(batch({records:[record({lastModifiedAt:'2026-09-26T21:54:59Z'})]})),
    /outside.*delta window/i
  );
  assert.throws(
    ()=>createEffectiveDatedWorkforceAuthority(policy()).admitBatch(batch({records:[record({lastModifiedAt:'2026-09-26T23:01:31Z'})]})),
    /after observation.*skew/i
  );
});

test('enforces complete bounded windows and record limits',()=>{
  assert.throws(()=>createEffectiveDatedWorkforceAuthority(policy()).admitBatch(batch({complete:false})),/incomplete/);
  assert.throws(()=>createEffectiveDatedWorkforceAuthority(policy()).admitBatch(batch({
    windowStart:'2026-09-25T22:59:59Z'
  })),/window.*limit/i);
  assert.throws(()=>createEffectiveDatedWorkforceAuthority(policy({maxRecords:1})).admitBatch(batch({
    records:[record(),record({assignmentId:'assignment-2',payloadDigest:'sha256:2'})]
  })),/record limit/);
});

test('keeps as-of snapshots distinct from deltas and still denies deletion authority',()=>{
  const snapshotPolicy=policy({queryMode:'as-of-snapshot',queryFingerprint:'sha256:as-of-2026-09-26'});
  const snapshotBatch=batch({queryMode:'as-of-snapshot',queryFingerprint:'sha256:as-of-2026-09-26'});
  const decision=createEffectiveDatedWorkforceAuthority(snapshotPolicy).admitBatch(snapshotBatch);
  assert.equal(decision.snapshotCandidate,true);
  assert.equal(decision.deltaCandidate,false);
  assert.equal(decision.deletionAuthority,false);
  assert.equal(decision.checkpointAdvanceAllowed,false);
});

test('rejects secret-bearing and executable workforce evidence',()=>{
  const secret=batch();
  secret.records[0].accessToken='do-not-store';
  assert.throws(()=>createEffectiveDatedWorkforceAuthority(policy()).admitBatch(secret),/secret|credential/);
  const executable=batch();
  Object.defineProperty(executable.records[0],'personId',{enumerable:true,get(){throw new Error('executed');}});
  assert.throws(()=>createEffectiveDatedWorkforceAuthority(policy()).admitBatch(executable),/executable|hidden/);
});

test('requires exact HTTPS origins and returns deeply immutable evidence',()=>{
  for(const apiOrigin of [
    'http://api012.successfactors.eu','https://*.successfactors.eu','https://api012.successfactors.eu/odata/v2'
  ]) assert.throws(()=>createEffectiveDatedWorkforceAuthority(policy({apiOrigin})),/exact HTTPS origin/);
  const decision=createEffectiveDatedWorkforceAuthority(policy()).admitBatch(batch());
  assert.equal(Object.isFrozen(decision),true);
  assert.equal(Object.isFrozen(decision.records),true);
  assert.equal(Object.isFrozen(decision.records[0]),true);
  assert.throws(()=>decision.records.push({}),TypeError);
});
