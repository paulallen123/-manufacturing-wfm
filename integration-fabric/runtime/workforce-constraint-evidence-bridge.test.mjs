import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorkforceConstraintEvidenceCandidate } from './workforce-constraint-evidence-bridge.mjs';

const denied={
  operationalDecisionAuthority:false,
  controlAuthority:false,
  writeBackAuthority:false,
  payrollAuthority:false,
  attendanceAuthority:false,
  causalClaimAuthority:false,
  checkpointAdvanceAllowed:false,
  deletionAuthority:false
};

test('admits Azure IoT current-state evidence only as bounded workforce constraint context',()=>{
  const candidate=buildWorkforceConstraintEvidenceCandidate({
    evidenceType:'azure-iot-operations-keyframe',
    siteId:'plant-1',
    workCenterId:'line-a',
    evidence:{
      ...denied,
      stateSnapshotCandidate:true,
      sourceCompletenessProven:false,
      deliveryCompletenessProven:false,
      wfmTenantId:'tenant-1',
      connectionId:'aio-1',
      externalAssetId:'asset-1',
      reconciliationFingerprint:'sha256:'+'a'.repeat(64)
    }
  });
  assert.equal(candidate.workforceConstraintEvidenceCandidate,true);
  assert.equal(candidate.eligibleForWorkforceConstraintAssessment,true);
  for(const field of Object.keys(denied)) assert.equal(candidate[field],false,field);
});

test('rejects manufacturing evidence when plant/site binding drifts',()=>{
  assert.throws(()=>buildWorkforceConstraintEvidenceCandidate({
    evidenceType:'manufacturing-observation',
    siteId:'plant-1',
    evidence:{
      ...denied,
      transactionalEvidenceCandidate:true,
      derivedObservationCandidate:false,
      wfmTenantId:'tenant-1',
      connectionId:'mes-1',
      plantId:'plant-2',
      checkpointNamespace:'manufacturing-observation:abc'
    }
  }),/plant does not match/);
});

test('rejects any upstream attempt to smuggle control, payroll or decision authority through the bridge',()=>{
  for(const field of ['operationalDecisionAuthority','controlAuthority','writeBackAuthority','payrollAuthority','attendanceAuthority']){
    assert.throws(()=>buildWorkforceConstraintEvidenceCandidate({
      evidenceType:'azure-iot-operations-keyframe',
      siteId:'plant-1',
      evidence:{
        ...denied,
        [field]:true,
        stateSnapshotCandidate:true,
        wfmTenantId:'tenant-1',
        connectionId:'aio-1',
        externalAssetId:'asset-1',
        reconciliationFingerprint:'sha256:'+'b'.repeat(64)
      }
    }),new RegExp(field));
  }
});
