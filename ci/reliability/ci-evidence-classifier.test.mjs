import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyCiObservation,evaluateReleaseQuorum,CI_EVIDENCE_STATES as S} from './ci-evidence-classifier.mjs';
const sha='abc123';
const receipt={exactCandidate:{sourceCommit:sha},executed:{result:'PASS'}};

test('zero-step failure is infrastructure unavailable, never product failure',()=>{
  assert.equal(classifyCiObservation({provider:'github-actions',candidateSha:sha,status:'completed',conclusion:'failure',executedStepCount:0}).state,S.INFRASTRUCTURE_UNAVAILABLE);
});
test('running CI remains pending',()=>assert.equal(classifyCiObservation({provider:'circleci',candidateSha:sha,status:'running'}).state,S.PENDING));
test('executed failure is product/proof failure',()=>assert.equal(classifyCiObservation({provider:'circleci',candidateSha:sha,status:'completed',conclusion:'failure',executedStepCount:3}).state,S.EXECUTED_FAIL));
test('success without receipt is unproven',()=>assert.equal(classifyCiObservation({provider:'circleci',candidateSha:sha,status:'completed',conclusion:'success',executedStepCount:3}).state,S.UNPROVEN));
test('receipt bound to another commit fails identity',()=>assert.equal(classifyCiObservation({provider:'circleci',candidateSha:sha,status:'completed',conclusion:'success',executedStepCount:3,receipt:{exactCandidate:{sourceCommit:'other'},executed:{result:'PASS'}}}).state,S.EVIDENCE_IDENTITY_MISMATCH));
test('matching executed receipt passes',()=>assert.equal(classifyCiObservation({provider:'circleci',candidateSha:sha,status:'completed',conclusion:'success',executedStepCount:3,receipt}).state,S.EXECUTED_PASS));
test('two runs from same provider do not satisfy independent quorum',()=>{
  const q=evaluateReleaseQuorum({candidateSha:sha,observations:[1,2].map(()=>({provider:'circleci',candidateSha:sha,status:'completed',conclusion:'success',executedStepCount:3,receipt}))});
  assert.equal(q.status,'UNPROVEN');
});
test('GitHub runner outage plus CircleCI pass is unproven, not failed',()=>{
  const q=evaluateReleaseQuorum({candidateSha:sha,observations:[
    {provider:'github-actions',candidateSha:sha,status:'completed',conclusion:'failure',executedStepCount:0},
    {provider:'circleci',candidateSha:sha,status:'completed',conclusion:'success',executedStepCount:3,receipt}
  ]});
  assert.equal(q.status,'UNPROVEN');assert.equal(q.reason,'independent_provider_quorum_not_met');
});
test('two independent matching passes satisfy release quorum',()=>{
  const q=evaluateReleaseQuorum({candidateSha:sha,observations:['github-actions','circleci'].map(provider=>({provider,candidateSha:sha,status:'completed',conclusion:'success',executedStepCount:3,receipt}))});
  assert.equal(q.status,'PROVEN');
});
test('one genuine executed failure blocks despite another pass',()=>{
  const q=evaluateReleaseQuorum({candidateSha:sha,observations:[
    {provider:'github-actions',candidateSha:sha,status:'completed',conclusion:'success',executedStepCount:3,receipt},
    {provider:'circleci',candidateSha:sha,status:'completed',conclusion:'failure',executedStepCount:3,receipt:{...receipt,executed:{result:'FAIL'}}}
  ]});
  assert.equal(q.status,'BLOCKED');assert.equal(q.reason,'executed_proof_failed');
});
