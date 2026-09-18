import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createTrustRootRecoveryPackage,signTrustRootRecoveryPackage,trustRootRecoveryDigest,verifyTrustRootRecovery} from './trust-root-recovery.mjs';

const NOW=Date.parse('2026-09-19T00:00:00Z');
const TRUST_DOMAIN='attendance-release-eu-west-1';
function keys(){ return crypto.generateKeyPairSync('ed25519'); }
function fixture(){
  const oldRoot=keys(),newRoot=keys(),otherRoot=keys();
  const c1=keys(),c2=keys(),c3=keys(),attacker=keys();
  const current={'root-old':oldRoot.publicKey};
  const proposed={'root-new':newRoot.publicKey};
  const custodians={'recovery-a':c1.publicKey,'recovery-b':c2.publicKey,'recovery-c':c3.publicKey};
  let pkg=createTrustRootRecoveryPackage({
    trustDomainId:TRUST_DOMAIN,
    recoveryEpoch:8,previousRootPublicKeys:current,newRootPublicKeys:proposed,
    issuedAtMs:NOW-1_000,expiresAtMs:NOW+60_000,reason:'ROOT_COMPROMISE',changeId:'sec-2026-09-19-001'
  });
  pkg=signTrustRootRecoveryPackage(pkg,{custodianId:'recovery-a',privateKey:c1.privateKey});
  pkg=signTrustRootRecoveryPackage(pkg,{custodianId:'recovery-b',privateKey:c2.privateKey});
  return {oldRoot,newRoot,otherRoot,c1,c2,c3,attacker,current,proposed,custodians,pkg};
}
function verify(f,extra={}){
  return verifyTrustRootRecovery({
    packageValue:f.pkg,currentRootPublicKeys:f.current,proposedRootPublicKeys:f.proposed,
    recoveryCustodianPublicKeys:f.custodians,requiredApprovals:2,minimumRecoveryEpoch:7,
    expectedTrustDomainId:TRUST_DOMAIN,nowMs:NOW,...extra
  });
}

test('two independent recovery custodians can authorize exact trust-root replacement',()=>{
  const f=fixture(); const out=verify(f);
  assert.equal(out.recoveryEpoch,8);
  assert.equal(out.trustDomainId,TRUST_DOMAIN);
  assert.deepEqual(out.approvedCustodians,['recovery-a','recovery-b']);
  assert.equal(out.rootPublicKeys.has('root-new'),true);
});

test('single recovery custodian cannot activate emergency root replacement',()=>{
  const f=fixture(); f.pkg={...f.pkg,signatures:[f.pkg.signatures[0]]};
  assert.throws(()=>verify(f),/quorum not met/);
});

test('duplicate custodian signatures cannot manufacture quorum',()=>{
  const f=fixture(); f.pkg={...f.pkg,signatures:[f.pkg.signatures[0],f.pkg.signatures[0]]};
  assert.throws(()=>verify(f),/Duplicate recovery custodian/);
});

test('untrusted recovery signer is rejected',()=>{
  const f=fixture();
  let p=createTrustRootRecoveryPackage({trustDomainId:TRUST_DOMAIN,recoveryEpoch:8,previousRootPublicKeys:f.current,newRootPublicKeys:f.proposed,issuedAtMs:NOW-1_000,expiresAtMs:NOW+60_000,reason:'ROOT_LOSS',changeId:'sec-2026-09-19-002'});
  p=signTrustRootRecoveryPackage(p,{custodianId:'recovery-a',privateKey:f.c1.privateKey});
  p=signTrustRootRecoveryPackage(p,{custodianId:'attacker',privateKey:f.attacker.privateKey}); f.pkg=p;
  assert.throws(()=>verify(f),/untrusted custodian/);
});

test('old-root mismatch blocks recovery package reuse against another root set',()=>{
  const f=fixture(); const wrongCurrent={'root-other':f.otherRoot.publicKey};
  assert.throws(()=>verify(f,{currentRootPublicKeys:wrongCurrent}),/previous-root digest mismatch/);
});

test('same roots cannot authorize recovery in another trust domain',()=>{
  const f=fixture();
  assert.throws(()=>verify(f,{expectedTrustDomainId:'attendance-release-us-east-1'}),/trust domain mismatch/);
});

test('proposed-root substitution after approval is rejected',()=>{
  const f=fixture(); const attackerRoot={'root-attacker':f.attacker.publicKey};
  assert.throws(()=>verify(f,{proposedRootPublicKeys:attackerRoot}),/proposed-root digest mismatch/);
});

test('recovery epoch rollback is rejected',()=>{
  const f=fixture();
  assert.throws(()=>verify(f,{minimumRecoveryEpoch:8}),/must advance/);
});

test('same-epoch equivocation is rejected when exact recovery digest is pinned',()=>{
  const f=fixture();
  assert.throws(()=>verify(f,{expectedRecoveryDigest:'0'.repeat(64)}),/package digest mismatch/);
  assert.doesNotThrow(()=>verify(f,{expectedRecoveryDigest:trustRootRecoveryDigest(f.pkg)}));
});

test('cross-authority recovery package is rejected',()=>{
  const f=fixture();
  const payload={...f.pkg,authorityId:'other-authority'}; f.pkg=payload;
  assert.throws(()=>verify(f),/authority identity mismatch/);
});

test('expired recovery package fails closed',()=>{
  const f=fixture();
  assert.throws(()=>verify(f,{nowMs:NOW+120_000}),/stale|validity/);
});

test('tampered recovery package fails custodian signature verification',()=>{
  const f=fixture(); f.pkg={...f.pkg,changeId:'sec-2026-09-19-tampered'};
  assert.throws(()=>verify(f),/signature invalid/);
});

test('one-of-one emergency recovery policy is prohibited',()=>{
  const f=fixture();
  assert.throws(()=>verify(f,{recoveryCustodianPublicKeys:{'recovery-a':f.c1.publicKey},requiredApprovals:1}),/At least two independent recovery custodians|required.*threshold/);
});
