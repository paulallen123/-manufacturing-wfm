import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  assessAttendanceRelease,
  AttendanceReleaseSwitch,
  REQUIRED_GATES,
  createAttendanceReleaseEvidencePolicy
} from './attendance-release-control.mjs';

const SHA='19b4fb78182d4fd8ce3f3cbdcf9754333b14c5a7';
const POLICY_ID='attendance-release/future-clock-v1';
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const evidencePolicy=createAttendanceReleaseEvidencePolicy({
  policyId:POLICY_ID,
  issuers:[{
    issuerId:'future-clock-attestor',
    publicKeyPem:publicKey.export({type:'spki',format:'pem'}),
    allowedGates:['*'],
    allowedProviderDomains:['physical_access','network_auth']
  }]
});

function signGate(name,gate){
  const payload={
    version:1,
    kind:'attendance-release-gate',
    policyId:POLICY_ID,
    gate:name,
    candidateSha:gate.candidateSha,
    evidenceId:gate.evidenceId,
    passed:gate.passed===true,
    skipped:gate.skipped,
    issuedAtMs:gate.issuedAtMs,
    expiresAtMs:gate.expiresAtMs
  };
  if(name==='rollbackAuthority'){
    for(const field of ['realExternalAuthority','signedReceipts','commitmentBoundCas','restartRecoveryProven']) payload[field]=gate[field]===true;
  }
  gate.policyId=POLICY_ID;
  gate.issuerId='future-clock-attestor';
  gate.signature=sign(null,Buffer.from(JSON.stringify(payload)),privateKey).toString('base64url');
  return gate;
}

function signProvider(proof){
  const payload={
    version:1,
    kind:'attendance-provider-proof',
    policyId:POLICY_ID,
    domain:proof.domain,
    providerSystemId:proof.providerSystemId,
    realProvider:proof.realProvider===true,
    passed:proof.passed===true,
    skipped:proof.skipped,
    candidateSha:proof.candidateSha,
    evidenceId:proof.evidenceId,
    issuedAtMs:proof.issuedAtMs,
    expiresAtMs:proof.expiresAtMs
  };
  proof.policyId=POLICY_ID;
  proof.issuerId='future-clock-attestor';
  proof.signature=sign(null,Buffer.from(JSON.stringify(payload)),privateKey).toString('base64url');
  return proof;
}

function signedEvidence({issuedAtMs,expiresAtMs}){
  const gates=Object.fromEntries(REQUIRED_GATES.map(name=>[name,signGate(name,{
    passed:true,
    skipped:0,
    candidateSha:SHA,
    evidenceId:`future-clock/${name}/001`,
    issuedAtMs,
    expiresAtMs,
    ...(name==='rollbackAuthority'?{
      realExternalAuthority:true,
      signedReceipts:true,
      commitmentBoundCas:true,
      restartRecoveryProven:true
    }:{})
  })]));
  const providerProofs=[
    signProvider({domain:'physical_access',providerSystemId:'salto:future-clock-test',realProvider:true,passed:true,skipped:0,candidateSha:SHA,evidenceId:'future-clock/provider/access',issuedAtMs,expiresAtMs}),
    signProvider({domain:'network_auth',providerSystemId:'radius:future-clock-test',realProvider:true,passed:true,skipped:0,candidateSha:SHA,evidenceId:'future-clock/provider/network',issuedAtMs,expiresAtMs})
  ];
  return {gates,providerProofs};
}

test('caller cannot fast-forward assessment and reconcile clocks to activate future-issued evidence',()=>{
  const actualNow=Date.now();
  const futureNow=actualNow+60_000;
  const {gates,providerProofs}=signedEvidence({issuedAtMs:futureNow-100,expiresAtMs:futureNow+60_000});
  const assessment=assessAttendanceRelease({candidateSha:SHA,gates,providerProofs,evidencePolicy,nowMs:futureNow});
  assert.equal(assessment.ready,true);

  const control=new AttendanceReleaseSwitch({expectedCandidateSha:SHA,evidencePolicy});
  const result=control.reconcile({assessment,requestedEnabled:true,actorId:'release-controller',nowMs:futureNow});
  assert.equal(result.enabled,false);
  assert.equal(result.audit.reason,'assessment-in-future');
  assert.deepEqual(result.audit.blockers,['assessmentTimeInvalid']);

  const state=control.state();
  assert.equal(state.enabled,false);
  assert.equal(state.failClosedReason,null);
});

test('forward expiry simulation may disable but cannot advance the trusted wall clock',()=>{
  const actualNow=Date.now();
  const expiresAtMs=actualNow+60_000;
  const {gates,providerProofs}=signedEvidence({issuedAtMs:actualNow-100,expiresAtMs});
  const assessment=assessAttendanceRelease({candidateSha:SHA,gates,providerProofs,evidencePolicy,nowMs:actualNow});
  const control=new AttendanceReleaseSwitch({expectedCandidateSha:SHA,evidencePolicy});
  assert.equal(control.reconcile({assessment,requestedEnabled:true,actorId:'release-controller'}).enabled,true);

  const expired=control.reconcile({assessment,requestedEnabled:true,actorId:'release-controller',nowMs:expiresAtMs+1});
  assert.equal(expired.enabled,false);
  assert.equal(expired.audit.reason,'evidence-expired');
  assert.deepEqual(expired.audit.blockers,['evidenceExpired']);
  assert.equal(control.state().failClosedReason,null);
});