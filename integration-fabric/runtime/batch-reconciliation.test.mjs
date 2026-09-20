import test from 'node:test';
import assert from 'node:assert/strict';
import {assessBatchRun,makeScopedExternalIdentity} from './batch-reconciliation.mjs';

const scope={providerId:'sap-fieldglass',connectionId:'conn-1',resource:'worker-download-delta',tenant:'buyer-gb01',dataset:'workers'};
const coverage={dataset:'workers',kind:'incremental-delta',absenceMeaning:'unchanged-or-outside-window',scopeProven:true,pageComplete:true,reconciliationComplete:true,authoritativeForExistence:false};

function checkpoint(scopeNamespace,watermark){return {scopeNamespace,watermark};}

test('delta batch can advance only after transfer/schema/checksum integrity and never grants deletion authority',()=>{
  const first=assessBatchRun({provider:'sap-fieldglass',connector:'worker-download-delta',runId:'r0',scope,rowCount:10,complete:true,checksumVerified:true,schemaVerified:true,sourceWatermark:'2026-09-20T21:00:00Z',watermarkKind:'iso8601',datasetCoverage:coverage,sourceDeclaresDelta:true});
  const r=assessBatchRun({provider:'sap-fieldglass',connector:'worker-download-delta',runId:'r1',scope,rowCount:10,expectedRowCount:10,complete:true,checksumVerified:true,schemaVerified:true,sourceWatermark:'2026-09-20T22:00:00Z',previousCheckpoint:checkpoint(first.scopeNamespace,'2026-09-20T21:00:00Z'),watermarkKind:'iso8601',datasetCoverage:coverage,sourceDeclaresDelta:true});
  assert.equal(r.safeToAdvanceWatermark,true);
  assert.equal(r.deletionAuthority,false);
  assert.equal(r.reconciliationRequired,true);
});

test('clean but incomplete batch is quarantined and cannot advance its watermark',()=>{
  const r=assessBatchRun({provider:'x',connector:'delta',runId:'partial-clean',scope:{providerId:'x',connectionId:'c',resource:'delta'},rowCount:10,expectedRowCount:10,complete:false,checksumVerified:true,schemaVerified:true,sourceWatermark:'cursor-2',sourceDeclaresDelta:true});
  assert.equal(r.safeToCommit,false);
  assert.equal(r.safeToAdvanceWatermark,false);
  assert.equal(r.quarantine,true);
  assert.ok(r.reasons.includes('incomplete-batch'));
});

test('partial or corrupt batch is quarantined and watermark does not move',()=>{
  const r=assessBatchRun({provider:'sap-fieldglass',connector:'worker-download-delta',runId:'r2',scope,rowCount:9,expectedRowCount:10,complete:false,checksumVerified:true,schemaVerified:true,sourceWatermark:'2026-09-20T23:00:00Z',watermarkKind:'iso8601',datasetCoverage:coverage,sourceDeclaresDelta:true});
  assert.equal(r.safeToCommit,false);
  assert.equal(r.safeToAdvanceWatermark,false);
  assert.equal(r.quarantine,true);
  assert.ok(r.reasons.includes('row-count-mismatch'));
});

test('timestamp watermark comparison uses instants rather than unsafe string ordering',()=>{
  const baseScope={providerId:'x',connectionId:'conn',resource:'c'};
  const seed=assessBatchRun({provider:'x',connector:'c',runId:'seed',scope:baseScope,rowCount:0,complete:true,checksumVerified:true,schemaVerified:true,sourceWatermark:'2026-09-20T21:00:00Z',watermarkKind:'iso8601'});
  const sameInstant=assessBatchRun({provider:'x',connector:'c',runId:'r3a',scope:baseScope,rowCount:0,complete:true,checksumVerified:true,schemaVerified:true,sourceWatermark:'2026-09-20T22:00:00+01:00',previousCheckpoint:checkpoint(seed.scopeNamespace,'2026-09-20T21:00:00Z'),watermarkKind:'iso8601'});
  assert.equal(sameInstant.safeToCommit,true);
  const regressed=assessBatchRun({provider:'x',connector:'c',runId:'r3b',scope:baseScope,rowCount:0,complete:true,checksumVerified:true,schemaVerified:true,sourceWatermark:'2026-09-20T20:59:59Z',previousCheckpoint:checkpoint(seed.scopeNamespace,'2026-09-20T22:00:00+01:00'),watermarkKind:'iso8601'});
  assert.equal(regressed.safeToCommit,false);
  assert.ok(regressed.reasons.includes('watermark-regression'));
});

test('integer watermarks compare numerically and support values beyond Number precision',()=>{
  const seed=assessBatchRun({provider:'x',connector:'c',runId:'seed-int',scope:{providerId:'x',connectionId:'conn',resource:'c'},rowCount:0,complete:true,checksumVerified:true,schemaVerified:true});
  const advanced=assessBatchRun({provider:'x',connector:'c',runId:'r4',scope:{providerId:'x',connectionId:'conn',resource:'c'},rowCount:0,complete:true,checksumVerified:true,schemaVerified:true,sourceWatermark:'10000000000000000000',previousCheckpoint:checkpoint(seed.scopeNamespace,'9999999999999999999'),watermarkKind:'unsigned-integer'});
  assert.equal(advanced.safeToCommit,true);
  assert.equal(advanced.watermark.comparable,true);
});

test('opaque cursors are not falsely ordered but still require a complete verified batch',()=>{
  const seed=assessBatchRun({provider:'x',connector:'c',runId:'seed-opaque',scope:{providerId:'x',connectionId:'conn',resource:'c'},rowCount:0,complete:true,checksumVerified:true,schemaVerified:true});
  const r=assessBatchRun({provider:'x',connector:'c',runId:'r5',scope:{providerId:'x',connectionId:'conn',resource:'c'},rowCount:0,complete:true,checksumVerified:true,schemaVerified:true,sourceWatermark:'token-A',previousCheckpoint:checkpoint(seed.scopeNamespace,'token-Z'),watermarkKind:'opaque'});
  assert.equal(r.safeToAdvanceWatermark,true);
  assert.equal(r.watermark.comparable,false);
});

test('invalid or undeclared comparable watermark formats fail closed',()=>{
  const seed=assessBatchRun({provider:'x',connector:'c',runId:'seed-invalid',scope:{providerId:'x',connectionId:'conn',resource:'c'},rowCount:0,complete:true,checksumVerified:true,schemaVerified:true});
  assert.throws(()=>assessBatchRun({provider:'x',connector:'c',runId:'r6',scope:{providerId:'x',connectionId:'conn',resource:'c'},rowCount:0,complete:true,checksumVerified:true,schemaVerified:true,sourceWatermark:'not-a-time',previousCheckpoint:checkpoint(seed.scopeNamespace,'2026-09-20T00:00:00Z'),watermarkKind:'iso8601'}),/valid timestamps/);
  assert.throws(()=>assessBatchRun({provider:'x',connector:'c',runId:'r7',scope:{providerId:'x',connectionId:'conn',resource:'c'},rowCount:0,complete:true,checksumVerified:true,schemaVerified:true,sourceWatermark:'2',previousCheckpoint:checkpoint(seed.scopeNamespace,'1'),watermarkKind:'provider-magic'}),/unsupported watermarkKind/);
});

test('string-valued safety flags are rejected instead of being treated as truthy evidence',()=>{
  assert.throws(()=>assessBatchRun({provider:'x',connector:'c',runId:'r-bool',scope:{providerId:'x',connectionId:'conn',resource:'c'},rowCount:0,complete:true,checksumVerified:'false',schemaVerified:true,sourceDeclaresDelta:false}),/checksumVerified must be a boolean/);
  assert.throws(()=>assessBatchRun({provider:'x',connector:'c',runId:'r-bool-2',scope:{providerId:'x',connectionId:'conn',resource:'c'},rowCount:0,complete:'true',checksumVerified:true,schemaVerified:true,sourceDeclaresDelta:false}),/complete must be a boolean/);
});

test('complete transfer alone cannot grant deletion authority',()=>{
  const r=assessBatchRun({provider:'x',connector:'full',runId:'r8',scope:{providerId:'x',connectionId:'conn',resource:'full'},rowCount:5,expectedRowCount:5,complete:true,checksumVerified:true,schemaVerified:true,sourceDeclaresDelta:false});
  assert.equal(r.safeToCommit,true);
  assert.equal(r.deletionAuthority,false);
  assert.equal(r.absenceDisposition,'do-not-delete');
});

test('only reconciled authoritative complete snapshot yields tombstone-candidate authority',()=>{
  const r=assessBatchRun({provider:'x',connector:'full',runId:'r9',scope:{providerId:'x',connectionId:'conn',resource:'full',tenant:'t1',site:'s1'},requiredScopeDimensions:['tenant','site'],rowCount:5,expectedRowCount:5,complete:true,checksumVerified:true,schemaVerified:true,sourceDeclaresDelta:false,datasetCoverage:{dataset:'workers',kind:'complete-snapshot',absenceMeaning:'not-present-in-authoritative-snapshot',scopeProven:true,pageComplete:true,reconciliationComplete:true,authoritativeForExistence:true}});
  assert.equal(r.deletionAuthority,false);
  assert.equal(r.tombstoneCandidateAuthority,true);
  assert.equal(r.absenceDisposition,'tombstone-candidate');
});

test('checkpoint scope mismatch is rejected before watermark admission',()=>{
  const first=assessBatchRun({provider:'x',connector:'c',runId:'scope-a',scope:{providerId:'x',connectionId:'conn',resource:'c',site:'A'},rowCount:0,complete:true,checksumVerified:true,schemaVerified:true,sourceWatermark:'1',watermarkKind:'unsigned-integer'});
  assert.throws(()=>assessBatchRun({provider:'x',connector:'c',runId:'scope-b',scope:{providerId:'x',connectionId:'conn',resource:'c',site:'B'},rowCount:0,complete:true,checksumVerified:true,schemaVerified:true,sourceWatermark:'2',previousCheckpoint:checkpoint(first.scopeNamespace,'1'),watermarkKind:'unsigned-integer'}),/scope mismatch/);
});

test('scoped identity preserves legitimate multi-row worker records',()=>{
  const a=makeScopedExternalIdentity({provider:'sap-fieldglass',connector:'worker-download',scope:{buyer:'GB01'},recordId:'W123',dimensions:{costCenter:'A',task:'T1',rateUom:'HOUR'}});
  const b=makeScopedExternalIdentity({provider:'sap-fieldglass',connector:'worker-download',scope:{buyer:'GB01'},recordId:'W123',dimensions:{costCenter:'B',task:'T1',rateUom:'HOUR'}});
  assert.notEqual(a,b);
  assert.equal(a,makeScopedExternalIdentity({provider:'sap-fieldglass',connector:'worker-download',scope:{buyer:'GB01'},recordId:'W123',dimensions:{rateUom:'HOUR',task:'T1',costCenter:'A'}}));
});
