import test from 'node:test';
import assert from 'node:assert/strict';
import {assessAttendanceRelease,AttendanceReleaseSwitch,REQUIRED_GATES} from './attendance-release-control.mjs';

const SHA='7eaf0d83675ca7c28b31bcfcd2146846973f427b';
function greenGates(){
  const gates=Object.fromEntries(REQUIRED_GATES.map(name=>[name,{passed:true,skipped:0,candidateSha:SHA,evidenceId:`proof/${name}/001`}]));
  gates.rollbackAuthority={
    ...gates.rollbackAuthority,
    realExternalAuthority:true,
    signedReceipts:true,
    commitmentBoundCas:true,
    restartRecoveryProven:true
  };
  return gates;
}
function providers(){
  return [
    {domain:'physical_access',providerSystemId:'salto-nebula:test-tenant',realProvider:true,passed:true,skipped:0,candidateSha:SHA,evidenceId:'provider/access/001'},
    {domain:'network_auth',providerSystemId:'radius:test-site',realProvider:true,passed:true,skipped:0,candidateSha:SHA,evidenceId:'provider/network/001'}
  ];
}

test('feature remains disabled by default even when no release assessment exists',()=>{
  assert.equal(new AttendanceReleaseSwitch().state().enabled,false);
});

test('missing or skipped mandatory gate blocks promotion',()=>{
  const gates=greenGates();
  gates.ci.skipped=1;
  const a=assessAttendanceRelease({candidateSha:SHA,gates,providerProofs:providers()});
  assert.equal(a.ready,false);
  assert(a.blockers.includes('ci'));
});

test('hosted telemetry continuity is an explicit fail-closed promotion gate',()=>{
  const gates=greenGates();
  delete gates.telemetryContinuity;
  const a=assessAttendanceRelease({candidateSha:SHA,gates,providerProofs:providers()});
  assert.equal(a.ready,false);
  assert(a.blockers.includes('telemetryContinuity'));
});

test('missing or malformed skipped count cannot satisfy a mandatory gate',()=>{
  for(const skipped of [undefined,null,'0']){
    const gates=greenGates();
    if(skipped===undefined) delete gates.deterministic.skipped;
    else gates.deterministic.skipped=skipped;
    const a=assessAttendanceRelease({candidateSha:SHA,gates,providerProofs:providers()});
    assert.equal(a.ready,false,String(skipped));
    assert(a.blockers.includes('deterministic'),String(skipped));
  }
});

test('evidence proven on another commit cannot green the candidate',()=>{
  const gates=greenGates();
  gates.durabilityRestart.candidateSha='0'.repeat(40);
  const a=assessAttendanceRelease({candidateSha:SHA,gates,providerProofs:providers()});
  assert.equal(a.ready,false);
  assert(a.blockers.includes('durabilityRestart'));
});

test('two distinct real provider domains are mandatory',()=>{
  const p=providers();
  p[1]={...p[1],domain:'physical_access'};
  const a=assessAttendanceRelease({candidateSha:SHA,gates:greenGates(),providerProofs:p});
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
    const a=assessAttendanceRelease({candidateSha:SHA,gates:greenGates(),providerProofs:p});
    assert.equal(a.ready,false);
    assert(a.blockers.includes('twoRealProviderDomains'));
  }
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
  const a=assessAttendanceRelease({candidateSha:SHA,gates,providerProofs:providers()});
  assert.equal(a.ready,false);
  assert(a.blockers.includes('rollbackAuthority'));
  assert.equal(a.accepted.rollbackAuthority,false);
});

test('rollback authority proof must cover signed receipts, commitment CAS and restart recovery',()=>{
  for(const field of ['signedReceipts','commitmentBoundCas','restartRecoveryProven']){
    const gates=greenGates();
    gates.rollbackAuthority[field]=false;
    const a=assessAttendanceRelease({candidateSha:SHA,gates,providerProofs:providers()});
    assert.equal(a.ready,false,field);
    assert(a.blockers.includes('rollbackAuthority'),field);
  }
});

test('all gates plus two real provider domains allow an explicit enable request',()=>{
  const a=assessAttendanceRelease({candidateSha:SHA,gates:greenGates(),providerProofs:providers()});
  assert.equal(a.ready,true);
  const control=new AttendanceReleaseSwitch();
  const state=control.reconcile({assessment:a,requestedEnabled:true,actorId:'release-controller'});
  assert.equal(state.enabled,true);
  assert.equal(state.candidateSha,SHA);
});

test('forged or serialized green assessment cannot bypass mandatory gate evaluation',()=>{
  const control=new AttendanceReleaseSwitch();
  const forged={ready:true,candidateSha:SHA,blockers:[],accepted:{},providerDomains:['physical_access','network_auth']};
  assert.throws(()=>control.reconcile({assessment:forged,requestedEnabled:true,actorId:'release-controller'}),/Trusted release assessment/);

  const genuine=assessAttendanceRelease({candidateSha:SHA,gates:greenGates(),providerProofs:providers()});
  const replayed=JSON.parse(JSON.stringify(genuine));
  assert.throws(()=>control.reconcile({assessment:replayed,requestedEnabled:true,actorId:'release-controller'}),/Trusted release assessment/);
  assert.equal(control.state().enabled,false);
});

test('gate regression immediately fails closed when release control reconciles again',()=>{
  const control=new AttendanceReleaseSwitch();
  const green=assessAttendanceRelease({candidateSha:SHA,gates:greenGates(),providerProofs:providers()});
  control.reconcile({assessment:green,requestedEnabled:true,actorId:'release-controller'});
  const gates=greenGates(); gates.regression.passed=false;
  const red=assessAttendanceRelease({candidateSha:SHA,gates,providerProofs:providers()});
  const state=control.reconcile({assessment:red,requestedEnabled:true,actorId:'release-controller'});
  assert.equal(state.enabled,false);
  assert.equal(state.audit.action,'rolled_back');
});

test('manual rollback disables immediately without weakening or rewriting gate evidence',()=>{
  const control=new AttendanceReleaseSwitch();
  const green=assessAttendanceRelease({candidateSha:SHA,gates:greenGates(),providerProofs:providers()});
  control.reconcile({assessment:green,requestedEnabled:true,actorId:'release-controller'});
  const state=control.rollback({actorId:'release-controller',reason:'operator-request'});
  assert.equal(state.enabled,false);
  assert.equal(state.audit.action,'rolled_back');
  assert.equal(green.ready,true);
});
