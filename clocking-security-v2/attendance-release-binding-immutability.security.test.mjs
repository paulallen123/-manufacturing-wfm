import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { AttendanceReleaseSwitch, createAttendanceReleaseEvidencePolicy } from './attendance-release-control.mjs';

const SHA='7eaf0d83675ca7c28b31bcfcd2146846973f427b';
const OTHER_SHA='0'.repeat(40);

function policy(policyId,issuerId){
  const {publicKey}=generateKeyPairSync('ed25519');
  return createAttendanceReleaseEvidencePolicy({
    policyId,
    issuers:[{
      issuerId,
      publicKeyPem:publicKey.export({type:'spki',format:'pem'}),
      allowedGates:['*']
    }]
  });
}

test('release switch candidate and evidence-policy bindings are immutable after construction',()=>{
  const originalPolicy=policy('attendance-release/immutable-v1','immutable-attestor');
  const alternatePolicy=policy('attendance-release/alternate-v1','alternate-attestor');
  const control=new AttendanceReleaseSwitch({expectedCandidateSha:SHA,evidencePolicy:originalPolicy});

  assert.throws(()=>{ control.expectedCandidateSha=OTHER_SHA; },TypeError);
  assert.throws(()=>{ control.evidencePolicy=alternatePolicy; },TypeError);
  assert.equal(control.expectedCandidateSha,SHA);
  assert.equal(control.evidencePolicy,originalPolicy);

  const candidateDescriptor=Object.getOwnPropertyDescriptor(control,'expectedCandidateSha');
  const policyDescriptor=Object.getOwnPropertyDescriptor(control,'evidencePolicy');
  assert.equal(candidateDescriptor.writable,false);
  assert.equal(candidateDescriptor.configurable,false);
  assert.equal(policyDescriptor.writable,false);
  assert.equal(policyDescriptor.configurable,false);

  const state=control.state();
  assert.equal(state.expectedCandidateSha,SHA);
  assert.equal(state.evidencePolicyId,'attendance-release/immutable-v1');
  assert.equal(state.enabled,false);
});
