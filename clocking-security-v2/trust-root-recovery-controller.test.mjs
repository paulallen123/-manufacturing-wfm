import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createTrustRootRecoveryPackage,signTrustRootRecoveryPackage,trustRootRecoveryDigest} from './trust-root-recovery.mjs';
import {SignedRollbackAnchorClient,createSyntheticSignedRollbackAuthority,createSyntheticSignedAuthorityKeyPolicy,authorityKeyPolicyDigest} from './signed-rollback-anchor.mjs';
import {TrustRootRecoveryController} from './trust-root-recovery-controller.mjs';

const NOW=Date.parse('2026-09-19T00:30:00Z');
const DOMAIN='acme-prod';
function keys(){ return crypto.generateKeyPairSync('ed25519'); }
function fixture({initialEpoch=7,domain=DOMAIN}={}){
  const oldRoot=keys(),newRoot=keys(),c1=keys(),c2=keys(),c3=keys();
  const epochSigner=keys(),epochPolicyRoot=keys();
  const current={'root-old':oldRoot.publicKey};
  const proposed={'root-new':newRoot.publicKey};
  const custodians={'recovery-a':c1.publicKey,'recovery-b':c2.publicKey,'recovery-c':c3.publicKey};
  const authority=createSyntheticSignedRollbackAuthority({
    authorityId:'wfm-trust-recovery-epoch-authority',
    anchorId:`trust-root-recovery:${domain}`,
    keyId:'epoch-signer-1',privateKey:epochSigner.privateKey,initialGeneration:initialEpoch,now:()=>NOW
  });
  const policy=createSyntheticSignedAuthorityKeyPolicy({
    authorityId:'wfm-trust-recovery-epoch-authority',rootKeyId:'epoch-policy-root',rootPrivateKey:epochPolicyRoot.privateKey,
    sequence:3,issuedAtMs:NOW-1_000,expiresAtMs:NOW+60_000,
    keys:[{keyId:'epoch-signer-1',status:'active',notBeforeMs:NOW-60_000,notAfterMs:NOW+60_000}]
  });
  const makeEpochAnchor=({withPolicy=true,anchorId=`trust-root-recovery:${domain}`,authorityId='wfm-trust-recovery-epoch-authority'}={})=>new SignedRollbackAnchorClient({
    transport:authority,authorityPublicKeys:{'epoch-signer-1':epochSigner.publicKey},authorityId,anchorId,
    authorityKeyPolicy:withPolicy?policy:null,
    authorityTrustRootPublicKeys:withPolicy?{'epoch-policy-root':epochPolicyRoot.publicKey}:null,
    minimumAuthorityPolicySequence:withPolicy?3:0,
    expectedAuthorityPolicyDigest:withPolicy?authorityKeyPolicyDigest(policy):null,
    now:()=>NOW,randomBytes:()=>crypto.randomBytes(32)
  });
  const epochAnchor=makeEpochAnchor();
  const controller=new TrustRootRecoveryController({epochAnchor,trustDomainId:domain});
  function pkg({epoch=initialEpoch+1,changeId='recovery-001',trustDomainId=domain,signers=['a','b']}={}){
    let p=createTrustRootRecoveryPackage({
      trustDomainId,recoveryEpoch:epoch,previousRootPublicKeys:current,newRootPublicKeys:proposed,
      issuedAtMs:NOW-1_000,expiresAtMs:NOW+60_000,reason:'ROOT_COMPROMISE',changeId
    });
    if(signers.includes('a')) p=signTrustRootRecoveryPackage(p,{custodianId:'recovery-a',privateKey:c1.privateKey});
    if(signers.includes('b')) p=signTrustRootRecoveryPackage(p,{custodianId:'recovery-b',privateKey:c2.privateKey});
    if(signers.includes('c')) p=signTrustRootRecoveryPackage(p,{custodianId:'recovery-c',privateKey:c3.privateKey});
    return p;
  }
  return {oldRoot,newRoot,c1,c2,c3,current,proposed,custodians,authority,policy,makeEpochAnchor,epochAnchor,controller,pkg};
}
function run(f,p=f.pkg?.()??f.pkg,{current=f.current,proposed=f.proposed}={}){
  return f.controller.verifyAndCommit({
    packageValue:p,currentRootPublicKeys:current,proposedRootPublicKeys:proposed,
    recoveryCustodianPublicKeys:f.custodians,requiredApprovals:2,nowMs:NOW
  });
}

test('quorum-approved recovery commits exactly the next epoch to the independent signed authority',()=>{
  const f=fixture(); const p=f.pkg();
  const out=run(f,p);
  assert.equal(out.recoveryCommitStatus,'committed');
  assert.equal(out.recoveryEpoch,8);
  const state=f.epochAnchor.currentState();
  assert.equal(state.generation,8);
  assert.equal(state.commitment,trustRootRecoveryDigest(p));
});

test('failed quorum verification cannot advance the independent recovery epoch',()=>{
  const f=fixture(); const p=f.pkg({signers:['a']});
  assert.throws(()=>run(f,p),/quorum not met/);
  assert.equal(f.epochAnchor.currentState().generation,7);
});

test('crash after epoch commitment can resume only the exact committed recovery package',()=>{
  const f=fixture(); const p=f.pkg();
  assert.equal(run(f,p).recoveryCommitStatus,'committed');
  const resumed=run(f,p);
  assert.equal(resumed.recoveryCommitStatus,'already_committed');
  assert.equal(resumed.epochAuthorityGeneration,8);
});

test('same-epoch different recovery package is rejected after commitment',()=>{
  const f=fixture(); const first=f.pkg({changeId:'recovery-001'}); const second=f.pkg({changeId:'recovery-002'});
  run(f,first);
  assert.throws(()=>run(f,second),/already committed to a different package/);
});

test('old committed recovery package cannot be replayed after the new roots are installed',()=>{
  const f=fixture(); const p=f.pkg(); run(f,p);
  assert.throws(()=>run(f,p,{current:f.proposed,proposed:f.proposed}),/previous-root digest mismatch|must change the root set/);
});

test('recovery epoch cannot skip forward even with a valid custodian quorum',()=>{
  const f=fixture(); const p=f.pkg({epoch:9});
  assert.throws(()=>run(f,p),/exactly the next independently committed epoch/);
  assert.equal(f.epochAnchor.currentState().generation,7);
});

test('cross-domain recovery package is rejected and cannot advance the epoch',()=>{
  const f=fixture(); const p=f.pkg({trustDomainId:'other-prod'});
  assert.throws(()=>run(f,p),/trust domain mismatch/);
  assert.equal(f.epochAnchor.currentState().generation,7);
});

test('release-grade controller rejects a lookalike epoch authority object',()=>{
  const fake={authorityId:'wfm-trust-recovery-epoch-authority',anchorId:`trust-root-recovery:${DOMAIN}`,currentState(){return {generation:7,commitment:null};},advanceCommitted(){return {generation:8,commitment:'0'.repeat(64)};}};
  assert.throws(()=>new TrustRootRecoveryController({epochAnchor:fake,trustDomainId:DOMAIN}),/lifecycle-bound signed authority provenance/);
});

test('release-grade controller rejects a genuine signed client without lifecycle policy',()=>{
  const f=fixture(); const weak=f.makeEpochAnchor({withPolicy:false});
  assert.throws(()=>new TrustRootRecoveryController({epochAnchor:weak,trustDomainId:DOMAIN}),/lifecycle-bound signed authority provenance/);
});

test('epoch authority is bound to the exact recovery trust domain',()=>{
  const f=fixture(); const wrong=f.makeEpochAnchor({anchorId:'trust-root-recovery:other-prod'});
  assert.throws(()=>new TrustRootRecoveryController({epochAnchor:wrong,trustDomainId:DOMAIN}),/anchor identity mismatch/);
});
