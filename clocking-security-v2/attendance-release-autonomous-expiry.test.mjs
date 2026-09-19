import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  assessAttendanceRelease,
  AttendanceReleaseSwitch,
  REQUIRED_GATES,
  createAttendanceReleaseEvidencePolicy
} from './attendance-release-control.mjs';

const SHA='4b665ab17c86f1641b93df747d3b67a60ca45f21';
const POLICY_ID='attendance-release/autonomous-expiry-v1';
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const PUBLIC_KEY_PEM=publicKey.export({type:'spki',format:'pem'});
const evidencePolicy=createAttendanceReleaseEvidencePolicy({
  policyId:POLICY_ID,
  issuers:[{
    issuerId:'autonomous-expiry-attestor',
    publicKeyPem:PUBLIC_KEY_PEM,
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
  gate.issuerId='autonomous-expiry-attestor';
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
  proof.issuerId='autonomous-expiry-attestor';
  proof.signature=sign(null,Buffer.from(JSON.stringify(payload)),privateKey).toString('base64url');
  return proof;
}

function signedEvidence({issuedAtMs,expiresAtMs}){
  const gates=Object.fromEntries(REQUIRED_GATES.map(name=>[name,signGate(name,{
    passed:true,
    skipped:0,
    candidateSha:SHA,
    evidenceId:`autonomous/${name}/001`,
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
    signProvider({domain:'physical_access',providerSystemId:'salto:test',realProvider:true,passed:true,skipped:0,candidateSha:SHA,evidenceId:'autonomous/provider/access',issuedAtMs,expiresAtMs}),
    signProvider({domain:'network_auth',providerSystemId:'radius:test',realProvider:true,passed:true,skipped:0,candidateSha:SHA,evidenceId:'autonomous/provider/network',issuedAtMs,expiresAtMs})
  ];
  return {gates,providerProofs};
}

test('enabled release automatically fails closed after signed evidence expires without another reconcile call',async()=>{
  const nowMs=Date.now();
  const expiresAtMs=nowMs+900;
  const {gates,providerProofs}=signedEvidence({issuedAtMs:nowMs-100,expiresAtMs});
  const assessment=assessAttendanceRelease({candidateSha:SHA,gates,providerProofs,evidencePolicy,nowMs});
  assert.equal(assessment.ready,true);

  const control=new AttendanceReleaseSwitch({expectedCandidateSha:SHA,evidencePolicy});
  const enabled=control.reconcile({assessment,requestedEnabled:true,actorId:'release-controller'});
  assert.equal(enabled.enabled,true);

  await new Promise(resolve=>setTimeout(resolve,1100));
  const state=control.state();
  assert.equal(state.enabled,false);
  assert.equal(state.candidateSha,null);
  assert.equal(state.validUntilMs,null);
  assert.equal(state.audit.at(-1).action,'rolled_back');
  assert.equal(state.audit.at(-1).reason,'evidence-expired');
  assert.deepEqual(state.audit.at(-1).blockers,['evidenceExpired']);
});

test('future-evaluated trusted assessment cannot enable the release switch using caller-controlled time',()=>{
  const actualNow=Date.now();
  const futureAssessmentTime=actualNow+60_000;
  const {gates,providerProofs}=signedEvidence({issuedAtMs:actualNow-100,expiresAtMs:actualNow+120_000});
  const assessment=assessAttendanceRelease({candidateSha:SHA,gates,providerProofs,evidencePolicy,nowMs:futureAssessmentTime});
  assert.equal(assessment.ready,true);

  const control=new AttendanceReleaseSwitch({expectedCandidateSha:SHA,evidencePolicy});
  const state=control.reconcile({assessment,requestedEnabled:true,actorId:'release-controller'});
  assert.equal(state.enabled,false);
  assert.equal(state.audit.reason,'assessment-in-future');
  assert.deepEqual(state.audit.blockers,['assessmentTimeInvalid']);
});
