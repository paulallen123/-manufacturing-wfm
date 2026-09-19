import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {assessAttendanceRelease,AttendanceReleaseSwitch,REQUIRED_GATES,createAttendanceReleaseEvidencePolicy} from './attendance-release-control.mjs';

const SHA='7eaf0d83675ca7c28b31bcfcd2146846973f427b';
const POLICY_ID='attendance-release/test-v1';
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const PUBLIC_KEY_PEM=publicKey.export({type:'spki',format:'pem'});
const evidencePolicy=createAttendanceReleaseEvidencePolicy({
  policyId:POLICY_ID,
  issuers:[{
    issuerId:'test-release-attestor',
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
    candidateSha:String(gate.candidateSha||''),
    evidenceId:String(gate.evidenceId||''),
    passed:gate.passed===true,
    skipped:gate.skipped
  };
  if(name==='rollbackAuthority'){
    for(const field of ['realExternalAuthority','signedReceipts','commitmentBoundCas','restartRecoveryProven']) payload[field]=gate[field]===true;
  }
  gate.policyId=POLICY_ID;
  gate.issuerId='test-release-attestor';
  gate.signature=sign(null,Buffer.from(JSON.stringify(payload)),privateKey).toString('base64url');
  return gate;
}
function signProvider(proof){
  const domain=String(proof.domain||'').trim().toLowerCase();
  const payload={
    version:1,
    kind:'attendance-provider-proof',
    policyId:POLICY_ID,
    domain,
    providerSystemId:String(proof.providerSystemId||''),
    realProvider:proof.realProvider===true,
    passed:proof.passed===true,
    skipped:proof.skipped,
    candidateSha:String(proof.candidateSha||''),
    evidenceId:String(proof.evidenceId||'')
  };
  proof.policyId=POLICY_ID;
  proof.issuerId='test-release-attestor';
  proof.signature=sign(null,Buffer.from(JSON.stringify(payload)),privateKey).toString('base64url');
  return proof;
}
function greenGates(){
  const gates=Object.fromEntries(REQUIRED_GATES.map(name=>[name,{passed:true,skipped:0,candidateSha:SHA,evidenceId:`proof/${name}/001`} ]));
  gates.rollbackAuthority={
    ...gates.rollbackAuthority,
    realExternalAuthority:true,
    signedReceipts:true,
    commitmentBoundCas:true,
    restartRecoveryProven:true
  };
  for(const name of REQUIRED_GATES) signGate(name,gates[name]);
  return gates;
}
function providers(){
  return [
    signProvider({domain:'physical_access',providerSystemId:'salto-nebula:test-tenant',realProvider:true,passed:true,skipped:0,candidateSha:SHA,evidenceId:'provider/access/001'}),
    signProvider({domain:'network_auth',providerSystemId:'radius:test-site',realProvider:true,passed:true,skipped:0,candidateSha:SHA,evidenceId:'provider/network/001'})
  ];
}
function assess({gates=greenGates(),providerProofs=providers(),policy=evidencePolicy}={}){
  return assessAttendanceRelease({candidateSha:SHA,gates,providerProofs,evidencePolicy:policy});
}
function releaseSwitch({expectedCandidateSha=SHA,policy=evidencePolicy}={}){
  return new AttendanceReleaseSwitch({expectedCandidateSha,evidencePolicy:policy});
}

test('feature remains disabled by default even when no release assessment exists',()=>{
  const control=releaseSwitch();
  assert.equal(control.state().enabled,false);
  assert.equal(control.state().expectedCandidateSha,SHA);
  assert.equal(control.state().evidencePolicyId,POLICY_ID);
});

test('missing or skipped mandatory gate blocks promotion',()=>{
  const gates=greenGates();
  gates.ci.skipped=1;
  const a=assess({gates});
  assert.equal(a.ready,false);
  assert(a.blockers.includes('ci'));
});

test('hosted telemetry continuity is an explicit fail-closed promotion gate',()=>{
  const gates=greenGates();
  delete gates.telemetryContinuity;
  const a=assess({gates});
  assert.equal(a.ready,false);
  assert(a.blockers.includes('telemetryContinuity'));
});

test('missing or malformed skipped count cannot satisfy a mandatory gate',()=>{
  for(const skipped of [undefined,null,'0']){
    const gates=greenGates();
    if(skipped===undefined) delete gates.deterministic.skipped;
    else gates.deterministic.skipped=skipped;
    const a=assess({gates});
    assert.equal(a.ready,false,String(skipped));
    assert(a.blockers.includes('deterministic'),String(skipped));
  }
});

test('evidence proven on another commit cannot green the candidate',()=>{
  const gates=greenGates();
  gates.durabilityRestart.candidateSha='0'.repeat(40);
  const a=assess({gates});
  assert.equal(a.ready,false);
  assert(a.blockers.includes('durabilityRestart'));
});

test('two distinct real provider domains are mandatory',()=>{
  const p=providers();
  p[1]={...p[1],domain:'physical_access'};
  const a=assess({providerProofs:p});
  assert.equal(a.ready,false);
  assert(a.blockers.includes('twoRealProviderDomains'));
});

test('provider-domain aliases, skipped proof, reused system identity or reused evidence cannot manufacture two-domain proof',()=>{
  const cases=[
    (()=>{ const p=providers(); p[1]={...p[1],domain:' PHYSICAL_ACCESS '}; return p; })(),
    (()=>{ const p=providers(); p[1]={...p[1],skipped:1}; return p; })(),
    (()=>{ const p=providers(); p[1]={...p[1],providerSystemId:p[0].providerSystemId}; return p; })(),
    (()=>{ const p=providers(); p[1]={...p[1],evidenceId:p[0].evidenceId}; return p; })()
  ];
  for(const p of cases){
    const a=assess({providerProofs:p});
    assert.equal(a.ready,false);
    assert(a.blockers.includes('twoRealProviderDomains'));
  }
});

test('caller-constructed gate booleans cannot manufacture a green assessment',()=>{
  const gates=greenGates();
  delete gates.ci.signature;
  const a=assess({gates});
  assert.equal(a.ready,false);
  assert(a.blockers.includes('ci'));

  const tampered=greenGates();
  tampered.deterministic.evidenceId='proof/deterministic/forged';
  const b=assess({gates:tampered});
  assert.equal(b.ready,false);
  assert(b.blockers.includes('deterministic'));
});

test('caller-constructed or cross-policy provider booleans cannot manufacture real-provider proof',()=>{
  const p=providers();
  delete p[1].signature;
  let a=assess({providerProofs:p});
  assert.equal(a.ready,false);
  assert(a.blockers.includes('twoRealProviderDomains'));

  const otherKeys=generateKeyPairSync('ed25519');
  const otherPolicy=createAttendanceReleaseEvidencePolicy({
    policyId:'attendance-release/other-v1',
    issuers:[{issuerId:'other-attestor',publicKeyPem:otherKeys.publicKey.export({type:'spki',format:'pem'}),allowedGates:['*'],allowedProviderDomains:['physical_access','network_auth']}]
  });
  assert.throws(()=>assessAttendanceRelease({candidateSha:SHA,gates:greenGates(),providerProofs:providers()}),/Trusted release evidence policy/);
  a=assess({policy:otherPolicy});
  assert.equal(a.ready,false);
  assert(a.blockers.includes('ci'));
  assert(a.blockers.includes('twoRealProviderDomains'));
});

test('synthetic or merely signed local rollback proof cannot satisfy the release gate',()=>{
  const gates=greenGates();
  gates.rollbackAuthority={
    passed:true,
    skipped:0,
    candidateSha:SHA,
    evidenceId:'proof/rollbackAuthority/synthetic',
    realExternalAuthority:false,
    signedReceipts:true,
    commitmentBoundCas:true,
    restartRecoveryProven:true
  };
  signGate('rollbackAuthority',gates.rollbackAuthority);
  const a=assess({gates});
  assert.equal(a.ready,false);
  assert(a.blockers.includes('rollbackAuthority'));
  assert.equal(a.accepted.rollbackAuthority,false);
});

test('rollback authority proof must cover signed receipts, commitment CAS and restart recovery',()=>{
  for(const field of ['signedReceipts','commitmentBoundCas','restartRecoveryProven']){
    const gates=greenGates();
    gates.rollbackAuthority[field]=false;
    signGate('rollbackAuthority',gates.rollbackAuthority);
    const a=assess({gates});
    assert.equal(a.ready,false,field);
    assert(a.blockers.includes('rollbackAuthority'),field);
  }
});

test('all signed gates plus two signed real provider domains allow an explicit enable request',()=>{
  const a=assess();
  assert.equal(a.ready,true);
  const control=releaseSwitch();
  const state=control.reconcile({assessment:a,requestedEnabled:true,actorId:'release-controller'});
  assert.equal(state.enabled,true);
  assert.equal(state.candidateSha,SHA);
  assert.equal(a.evidencePolicyId,POLICY_ID);
});

test('release switch rejects a trusted green assessment bound to another candidate or another evidence policy',()=>{
  const genuine=assess();
  const wrongCandidateControl=releaseSwitch({expectedCandidateSha:'0'.repeat(40)});
  assert.throws(
    ()=>wrongCandidateControl.reconcile({assessment:genuine,requestedEnabled:true,actorId:'release-controller'}),
    /bound runtime candidate/
  );
  assert.equal(wrongCandidateControl.state().enabled,false);

  const otherKeys=generateKeyPairSync('ed25519');
  const otherPolicy=createAttendanceReleaseEvidencePolicy({
    policyId:'attendance-release/alternate-v1',
    issuers:[{issuerId:'alternate-attestor',publicKeyPem:otherKeys.publicKey.export({type:'spki',format:'pem'}),allowedGates:['*'],allowedProviderDomains:['physical_access','network_auth']}]
  });
  const wrongPolicyControl=releaseSwitch({policy:otherPolicy});
  assert.throws(
    ()=>wrongPolicyControl.reconcile({assessment:genuine,requestedEnabled:true,actorId:'release-controller'}),
    /bound release policy/
  );
  assert.equal(wrongPolicyControl.state().enabled,false);
});

test('forged or serialized green assessment cannot bypass mandatory gate evaluation',()=>{
  const control=releaseSwitch();
  const forged={ready:true,candidateSha:SHA,blockers:[],accepted:{},providerDomains:['physical_access','network_auth']};
  assert.throws(()=>control.reconcile({assessment:forged,requestedEnabled:true,actorId:'release-controller'}),/Trusted release assessment/);

  const genuine=assess();
  const replayed=JSON.parse(JSON.stringify(genuine));
  assert.throws(()=>control.reconcile({assessment:replayed,requestedEnabled:true,actorId:'release-controller'}),/Trusted release assessment/);
  assert.equal(control.state().enabled,false);
});

test('gate regression immediately fails closed when release control reconciles again',()=>{
  const control=releaseSwitch();
  const green=assess();
  control.reconcile({assessment:green,requestedEnabled:true,actorId:'release-controller'});
  const gates=greenGates();
  gates.regression.passed=false;
  signGate('regression',gates.regression);
  const red=assess({gates});
  const state=control.reconcile({assessment:red,requestedEnabled:true,actorId:'release-controller'});
  assert.equal(state.enabled,false);
  assert.equal(state.audit.action,'rolled_back');
});

test('manual rollback disables immediately without weakening or rewriting gate evidence',()=>{
  const control=releaseSwitch();
  const green=assess();
  control.reconcile({assessment:green,requestedEnabled:true,actorId:'release-controller'});
  const state=control.rollback({actorId:'release-controller',reason:'operator-request'});
  assert.equal(state.enabled,false);
  assert.equal(state.audit.action,'rolled_back');
  assert.equal(green.ready,true);
});
