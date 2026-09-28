import test from 'node:test';
import assert from 'node:assert/strict';
import {createChangeSignalReconciliation} from './change-signal-reconciliation.mjs';

const policy=()=>({
  provider:'quickbooks-online',
  wfmTenantId:'tenant-micro-01',
  connectionId:'qbo-connection-01',
  realmId:'realm-93471',
  apiHost:'quickbooks.api.intuit.com',
  apiMinorVersion:'75',
  schemaFingerprint:'sha256:qbo-finance-v2',
  signatureKeyRevision:'webhook-key-4',
  entityKinds:['Employee','TimeActivity','Item','Purchase','JournalEntry'],
  maxLookbackDays:30,
  maximumObjects:1000,
  overlapSeconds:300
});

const webhook=()=>({
  provider:'quickbooks-online',
  wfmTenantId:'tenant-micro-01',
  connectionId:'qbo-connection-01',
  realmId:'realm-93471',
  signatureVerified:true,
  signatureKeyRevision:'webhook-key-4',
  deliveryId:'delivery-081',
  observedAt:'2026-09-26T17:02:00.000Z',
  changes:[
    {entityKind:'TimeActivity',entityId:'time-7',operation:'Update',lastUpdated:'2026-09-26T17:00:30.000Z'},
    {entityKind:'Employee',entityId:'employee-2',operation:'Update',lastUpdated:'2026-09-26T16:59:00.000Z'},
    {entityKind:'TimeActivity',entityId:'time-7',operation:'Update',lastUpdated:'2026-09-26T17:00:30.000Z'}
  ]
});

const cdcResult=plan=>({
  planFingerprint:plan.planFingerprint,
  realmId:'realm-93471',
  apiMinorVersion:'75',
  schemaFingerprint:'sha256:qbo-finance-v2',
  changedSince:plan.changedSince,
  observedThrough:plan.observedThrough,
  complete:true,
  queriedEntityKinds:['Employee','Item','JournalEntry','Purchase','TimeActivity'],
  records:[
    {entityKind:'Employee',entityId:'employee-2',syncToken:'5',lastUpdated:'2026-09-26T16:59:00.000Z',active:true,payloadDigest:'sha256:employee-2-v5'},
    {entityKind:'TimeActivity',entityId:'time-7',syncToken:'9',lastUpdated:'2026-09-26T17:00:30.000Z',active:true,payloadDigest:'sha256:time-7-v9'},
    {entityKind:'TimeActivity',entityId:'time-7',syncToken:'9',lastUpdated:'2026-09-26T17:00:30.000Z',active:true,payloadDigest:'sha256:time-7-v9'}
  ]
});

test('verified webhook creates an overlap CDC plan but never record or deletion authority',()=>{
  const reconciliation=createChangeSignalReconciliation(policy());
  const plan=reconciliation.planRecovery({
    webhook:webhook(),
    committedThrough:'2026-09-26T17:00:00.000Z',
    observedThrough:'2026-09-26T18:00:00.000Z'
  });
  assert.equal(plan.changedSince,'2026-09-26T16:55:00.000Z');
  assert.equal(plan.observedThrough,'2026-09-26T18:00:00.000Z');
  assert.equal(plan.fullSnapshotRequired,false);
  assert.equal(plan.webhookRecordAuthority,false);
  assert.equal(plan.deletionAuthority,false);
  assert.equal(plan.hints.length,2);
  assert.match(plan.checkpointNamespace,/^change-recovery:[a-f0-9]{64}$/);
});

test('duplicate and out-of-order webhook hints collapse deterministically',()=>{
  const candidate=webhook();
  candidate.changes.reverse();
  const first=createChangeSignalReconciliation(policy()).planRecovery({
    webhook:webhook(),committedThrough:'2026-09-26T17:00:00.000Z',observedThrough:'2026-09-26T18:00:00.000Z'
  });
  const second=createChangeSignalReconciliation(policy()).planRecovery({
    webhook:candidate,committedThrough:'2026-09-26T17:00:00.000Z',observedThrough:'2026-09-26T18:00:00.000Z'
  });
  assert.deepEqual(first.hints,[
    {entityKind:'Employee',entityId:'employee-2',operation:'Update',lastUpdated:'2026-09-26T16:59:00.000Z'},
    {entityKind:'TimeActivity',entityId:'time-7',operation:'Update',lastUpdated:'2026-09-26T17:00:30.000Z'}
  ]);
  assert.deepEqual(first.hints,second.hints);
  assert.equal(first.planFingerprint,second.planFingerprint);
});

test('unverified, mis-scoped and unsupported webhook signals fail closed',()=>{
  const mutations=[
    value=>{value.signatureVerified=false;},
    value=>{value.signatureKeyRevision='webhook-key-old';},
    value=>{value.realmId='realm-other';},
    value=>{value.wfmTenantId='tenant-other';},
    value=>{value.changes[0].entityKind='Invoice';},
    value=>{value.observedAt='2026-02-31T00:00:00.000Z';}
  ];
  for(const mutate of mutations){
    const candidate=webhook();
    mutate(candidate);
    assert.throws(()=>createChangeSignalReconciliation(policy()).planRecovery({
      webhook:candidate,committedThrough:'2026-09-26T17:00:00.000Z',observedThrough:'2026-09-26T18:00:00.000Z'
    }));
  }
});

test('checkpoint older than provider CDC horizon requires a full snapshot',()=>{
  const plan=createChangeSignalReconciliation(policy()).planRecovery({
    webhook:webhook(),
    committedThrough:'2026-08-01T00:00:00.000Z',
    observedThrough:'2026-09-26T18:00:00.000Z'
  });
  assert.equal(plan.changedSince,'2026-08-27T18:00:00.000Z');
  assert.equal(plan.fullSnapshotRequired,true);
  const admitted=createChangeSignalReconciliation(policy());
  const itsPlan=admitted.planRecovery({
    webhook:webhook(),committedThrough:'2026-08-01T00:00:00.000Z',observedThrough:'2026-09-26T18:00:00.000Z'
  });
  const result=admitted.admitCdc(itsPlan,cdcResult(itsPlan));
  assert.equal(result.reconciliationCandidate,false);
  assert.equal(result.fullSnapshotRequired,true);
  assert.equal(result.checkpointAdvanceAllowed,false);
});

test('complete CDC result deduplicates exact entity versions without granting checkpoint authority',()=>{
  const reconciliation=createChangeSignalReconciliation(policy());
  const plan=reconciliation.planRecovery({
    webhook:webhook(),committedThrough:'2026-09-26T17:00:00.000Z',observedThrough:'2026-09-26T18:00:00.000Z'
  });
  const admitted=reconciliation.admitCdc(plan,cdcResult(plan));
  assert.equal(admitted.reconciliationCandidate,true);
  assert.equal(admitted.checkpointAdvanceAllowed,false);
  assert.equal(admitted.deletionAuthority,false);
  assert.equal(admitted.reportedRecordCount,3);
  assert.equal(admitted.uniqueRecordCount,2);
  assert.equal(admitted.exactReplayCount,1);
});

test('conflicting payloads for one entity version are quarantined',()=>{
  const reconciliation=createChangeSignalReconciliation(policy());
  const plan=reconciliation.planRecovery({
    webhook:webhook(),committedThrough:'2026-09-26T17:00:00.000Z',observedThrough:'2026-09-26T18:00:00.000Z'
  });
  const result=cdcResult(plan);
  result.records[2].payloadDigest='sha256:conflict';
  assert.throws(()=>reconciliation.admitCdc(plan,result),/conflicting duplicate/i);
});

test('partial, misbound, stale and impossible-time CDC results are quarantined',()=>{
  const mutations=[
    value=>{value.complete=false;},
    value=>{value.realmId='realm-other';},
    value=>{value.apiMinorVersion='74';},
    value=>{value.schemaFingerprint='sha256:other';},
    value=>{value.changedSince='2026-09-26T16:56:00.000Z';},
    value=>{value.queriedEntityKinds.pop();},
    value=>{value.records[0].lastUpdated='2026-09-26T16:54:59.000Z';},
    value=>{value.records[0].lastUpdated='2026-02-31T00:00:00.000Z';}
  ];
  for(const mutate of mutations){
    const reconciliation=createChangeSignalReconciliation(policy());
    const plan=reconciliation.planRecovery({
      webhook:webhook(),committedThrough:'2026-09-26T17:00:00.000Z',observedThrough:'2026-09-26T18:00:00.000Z'
    });
    const result=cdcResult(plan);
    mutate(result);
    assert.throws(()=>reconciliation.admitCdc(plan,result));
  }
});

test('provider object ceiling is enforced before a response can claim completeness',()=>{
  const reconciliation=createChangeSignalReconciliation({...policy(),maximumObjects:2});
  const plan=reconciliation.planRecovery({
    webhook:webhook(),committedThrough:'2026-09-26T17:00:00.000Z',observedThrough:'2026-09-26T18:00:00.000Z'
  });
  assert.throws(()=>reconciliation.admitCdc(plan,cdcResult(plan)),/maximum object/i);
});

test('secret-like fields and fabricated plans cannot enter recovery evidence',()=>{
  assert.throws(()=>createChangeSignalReconciliation({...policy(),clientSecret:'synthetic-secret'}),/secret|credential material/i);
  const reconciliation=createChangeSignalReconciliation(policy());
  const plan=reconciliation.planRecovery({
    webhook:webhook(),committedThrough:'2026-09-26T17:00:00.000Z',observedThrough:'2026-09-26T18:00:00.000Z'
  });
  assert.throws(()=>reconciliation.admitCdc({...plan},cdcResult(plan)),/not issued/i);
  assert.throws(()=>reconciliation.admitCdc(plan,{...cdcResult(plan),accessToken:'synthetic-secret'}),/secret|credential material/i);
});
