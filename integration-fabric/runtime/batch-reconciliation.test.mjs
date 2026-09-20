import test from 'node:test';
import assert from 'node:assert/strict';
import {assessBatchRun,makeScopedExternalIdentity} from './batch-reconciliation.mjs';

test('delta batch can advance only after transfer/schema/checksum integrity and never grants deletion authority',()=>{
  const r=assessBatchRun({provider:'sap-fieldglass',connector:'worker-download-delta',runId:'r1',rowCount:10,expectedRowCount:10,complete:true,checksumVerified:true,schemaVerified:true,sourceWatermark:'2026-09-20T22:00:00Z',previousWatermark:'2026-09-20T21:00:00Z',sourceDeclaresDelta:true});
  assert.equal(r.safeToAdvanceWatermark,true);
  assert.equal(r.deletionAuthority,false);
  assert.equal(r.reconciliationRequired,true);
});

test('partial or corrupt batch is quarantined and watermark does not move',()=>{
  const r=assessBatchRun({provider:'sap-fieldglass',connector:'worker-download-delta',runId:'r2',rowCount:9,expectedRowCount:10,complete:false,checksumVerified:true,schemaVerified:true,sourceWatermark:'2026-09-20T23:00:00Z',previousWatermark:'2026-09-20T22:00:00Z',sourceDeclaresDelta:true});
  assert.equal(r.safeToCommit,false);
  assert.equal(r.safeToAdvanceWatermark,false);
  assert.equal(r.quarantine,true);
  assert.ok(r.reasons.includes('row-count-mismatch'));
});

test('watermark regression fails closed',()=>{
  const r=assessBatchRun({provider:'x',connector:'c',runId:'r3',rowCount:0,checksumVerified:true,schemaVerified:true,sourceWatermark:'2026-09-20T21:00:00Z',previousWatermark:'2026-09-20T22:00:00Z'});
  assert.equal(r.safeToCommit,false);
  assert.ok(r.reasons.includes('watermark-regression'));
});

test('full authoritative snapshot may grant deletion authority only when integrity checks pass',()=>{
  const r=assessBatchRun({provider:'x',connector:'full',runId:'r4',rowCount:5,expectedRowCount:5,complete:true,checksumVerified:true,schemaVerified:true,sourceDeclaresDelta:false});
  assert.equal(r.safeToCommit,true);
  assert.equal(r.deletionAuthority,true);
});

test('scoped identity preserves legitimate multi-row worker records',()=>{
  const a=makeScopedExternalIdentity({provider:'sap-fieldglass',connector:'worker-download',scope:{buyer:'GB01'},recordId:'W123',dimensions:{costCenter:'A',task:'T1',rateUom:'HOUR'}});
  const b=makeScopedExternalIdentity({provider:'sap-fieldglass',connector:'worker-download',scope:{buyer:'GB01'},recordId:'W123',dimensions:{costCenter:'B',task:'T1',rateUom:'HOUR'}});
  assert.notEqual(a,b);
  assert.equal(a,makeScopedExternalIdentity({provider:'sap-fieldglass',connector:'worker-download',scope:{buyer:'GB01'},recordId:'W123',dimensions:{rateUom:'HOUR',task:'T1',costCenter:'A'}}));
});
