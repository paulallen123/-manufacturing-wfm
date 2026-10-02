import test from 'node:test';
import assert from 'node:assert/strict';
import {createManagedExportAuthority} from './managed-export-authority.mjs';

const policy=()=>({
  provider:'celigo-integrator-io',
  wfmTenantId:'tenant-uk-01',
  connectionId:'connection-celigo-01',
  accountId:'celigo-account-01',
  environmentId:'production-eu',
  regionalHost:'api.eu.integrator.io',
  credentialRevision:'rev-7',
  credentialScope:{mode:'custom',exports:['export-workers'],imports:[],flows:[],connections:[],apis:[],topics:[]},
  exports:[{
    integrationId:'integration-manufacturing-01',
    exportId:'export-workers',
    dataset:'workers',
    sinkId:'wfm-ingress-workers',
    exportRevision:'2026-09-26.1',
    schemaFingerprint:'sha256:workers-v3'
  }]
});

const request=()=>({
  provider:'celigo-integrator-io',
  wfmTenantId:'tenant-uk-01',
  connectionId:'connection-celigo-01',
  accountId:'celigo-account-01',
  environmentId:'production-eu',
  regionalHost:'api.eu.integrator.io',
  resourceKind:'export',
  action:'invoke-read-ingress',
  integrationId:'integration-manufacturing-01',
  exportId:'export-workers',
  dataset:'workers',
  sinkId:'wfm-ingress-workers',
  exportRevision:'2026-09-26.1',
  schemaFingerprint:'sha256:workers-v3'
});

const receipt=plan=>({
  planFingerprint:plan.planFingerprint,
  providerRunId:'run-00042',
  status:'completed',
  startedAt:'2026-09-26T08:00:00.000Z',
  completedAt:'2026-09-26T08:01:00.000Z',
  sourceWindow:{from:'2026-09-26T07:00:00.000Z',to:'2026-09-26T08:00:00.000Z'},
  exportRevision:'2026-09-26.1',
  schemaFingerprint:'sha256:workers-v3',
  errorCount:0,
  pages:[
    {sequence:1,recordCount:2,byteCount:120,digest:'sha256:page-1'},
    {sequence:2,recordCount:1,byteCount:70,digest:'sha256:page-2'}
  ],
  pageCount:2,
  recordCount:3,
  byteCount:190
});

test('exact custom-scoped export compiles to a stable read-ingress plan',()=>{
  const authority=createManagedExportAuthority(policy());
  const first=authority.authorize(request());
  const second=authority.authorize(request());
  assert.equal(first.authority,'read-ingress-only');
  assert.equal(first.planFingerprint,second.planFingerprint);
  assert.equal(first.checkpointNamespace,second.checkpointNamespace);
  assert.match(first.checkpointNamespace,/^managed-export:[a-f0-9]{64}$/);
  assert.equal(first.exportId,'export-workers');
  assert.equal(first.regionalHost,'api.eu.integrator.io');
  assert.equal(Object.isFrozen(first),true);
});

test('broad credentials and any non-export action fail before invocation',()=>{
  const broad=policy();
  broad.credentialScope.mode='full';
  assert.throws(()=>createManagedExportAuthority(broad),/custom export scope/i);

  for(const [resourceKind,action] of [
    ['import','invoke'],['flow','run'],['connection','update'],['api','invoke'],['export','update']
  ]){
    const authority=createManagedExportAuthority(policy());
    assert.throws(()=>authority.authorize({...request(),resourceKind,action}),/read-ingress export invocation/i);
  }
});

test('scope, route, dataset, sink, revision and schema mismatches fail closed',()=>{
  const mutations={
    wfmTenantId:'tenant-other',connectionId:'connection-other',accountId:'account-other',
    environmentId:'sandbox',regionalHost:'api.integrator.io',integrationId:'integration-other',
    exportId:'export-other',dataset:'attendance',sinkId:'unapproved-sink',
    exportRevision:'stale',schemaFingerprint:'sha256:other'
  };
  for(const [field,value] of Object.entries(mutations)){
    const authority=createManagedExportAuthority(policy());
    assert.throws(()=>authority.authorize({...request(),[field]:value}),new RegExp(field,'i'),field);
  }
});

test('credential scope cannot hide wildcard or additional mutation authority',()=>{
  for(const mutate of [
    value=>value.credentialScope.exports.push('*'),
    value=>value.credentialScope.exports.push('export-other'),
    value=>value.credentialScope.imports.push('import-payroll'),
    value=>value.credentialScope.flows.push('flow-payroll'),
    value=>value.credentialScope.connections.push('connection-admin'),
    value=>value.credentialScope.apis.push('api-admin'),
    value=>value.credentialScope.topics.push('topic-write')
  ]){
    const candidate=policy();
    mutate(candidate);
    assert.throws(()=>createManagedExportAuthority(candidate),/credential scope/i);
  }
});

test('only a complete gapless error-free receipt becomes a reconciliation candidate',()=>{
  const authority=createManagedExportAuthority(policy());
  const plan=authority.authorize(request());
  const admitted=authority.admitReceipt(plan,receipt(plan));
  assert.equal(admitted.reconciliationCandidate,true);
  assert.equal(admitted.checkpointAdvanceAllowed,false);
  assert.equal(admitted.deletionAuthority,false);
  assert.equal(admitted.providerRunId,'run-00042');
  assert.equal(admitted.recordCount,3);
  assert.equal(admitted.pageCount,2);
  assert.equal(admitted.checkpointNamespace,plan.checkpointNamespace);
  assert.equal(Object.isFrozen(admitted),true);
});

test('partial, failed, gapped, duplicate or internally inconsistent receipts are quarantined',()=>{
  const cases=[
    value=>{value.status='running';},
    value=>{value.errorCount=1;},
    value=>{value.pageCount=3;},
    value=>{value.recordCount=4;},
    value=>{value.byteCount=191;},
    value=>{value.pages[1].sequence=1;},
    value=>{value.pages[1].sequence=3;},
    value=>{value.pages[1].digest=value.pages[0].digest;},
    value=>{value.planFingerprint='sha256:other';},
    value=>{value.exportRevision='stale';},
    value=>{value.schemaFingerprint='sha256:other';},
    value=>{value.completedAt='2026-09-26T07:59:00.000Z';},
    value=>{value.sourceWindow.to='2026-09-26T06:00:00.000Z';},
    value=>{value.sourceWindow.from='2026-02-31T00:00:00.000Z';}
  ];
  for(const mutate of cases){
    const authority=createManagedExportAuthority(policy());
    const plan=authority.authorize(request());
    const candidate=receipt(plan);
    mutate(candidate);
    assert.throws(()=>authority.admitReceipt(plan,candidate));
  }
});

test('secret-like material cannot enter policy, requests, receipts or evidence',()=>{
  const withSecret=policy();
  withSecret.apiToken='synthetic-secret';
  assert.throws(()=>createManagedExportAuthority(withSecret),/secret|credential material/i);

  const authority=createManagedExportAuthority(policy());
  assert.throws(()=>authority.authorize({...request(),authorization:'Bearer synthetic-secret'}),/secret|credential material/i);
  const plan=authority.authorize(request());
  assert.throws(()=>authority.admitReceipt(plan,{...receipt(plan),cookie:'synthetic-secret'}),/secret|credential material/i);
  assert.ok(!JSON.stringify(plan).includes('synthetic-secret'));
});
