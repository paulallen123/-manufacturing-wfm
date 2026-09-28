import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AtomicSupervisorStateStore} from './durable-source-supervisor.mjs';
import {SignedRollbackAnchorClient,createSyntheticSignedRollbackAuthority,createSyntheticSignedAuthorityKeyPolicy,authorityKeyPolicyDigest} from './signed-rollback-anchor.mjs';

const KEY=Buffer.alloc(32,0x41);
const NOW=Date.parse('2026-09-18T22:30:00Z');
function file(){ return path.join(fs.mkdtempSync(path.join(os.tmpdir(),'wfm-release-anchor-')),'state.json'); }
function weakAnchor(){
  let generation=0;
  return {
    current(){ return generation; },
    advance(expected){ if(expected!==generation) throw new Error('compare-and-set mismatch'); generation+=1; return generation; }
  };
}
function unsignedCommitmentLookalike(){
  let generation=0,commitment=null;
  return {
    current(){ return generation; },
    advance(expected){ if(expected!==generation) throw new Error('compare-and-set mismatch'); generation+=1; return generation; },
    currentState(){ return {generation,commitment}; },
    advanceCommitted(expected,nextCommitment){
      if(expected!==generation) throw new Error('compare-and-set mismatch');
      generation+=1; commitment=nextCommitment;
      return {generation,commitment};
    }
  };
}
function genuineSignedAnchor(){
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  const authority=createSyntheticSignedRollbackAuthority({privateKey,now:()=>NOW});
  return new SignedRollbackAnchorClient({
    transport:authority,
    authorityPublicKeys:{'authority-1':publicKey},
    authorityId:'wfm-security-anchor-authority',
    anchorId:'attendance-source-continuity',
    now:()=>NOW,
    randomBytes:()=>crypto.randomBytes(32)
  });
}
function lifecycleFixture({status='active',sequence=1}={}){
  const authorityKeys=crypto.generateKeyPairSync('ed25519');
  const trustRoot=crypto.generateKeyPairSync('ed25519');
  const authority=createSyntheticSignedRollbackAuthority({privateKey:authorityKeys.privateKey,now:()=>NOW});
  const makeClient=(nextStatus=status,nextSequence=sequence)=>{
    const policy=createSyntheticSignedAuthorityKeyPolicy({
      rootPrivateKey:trustRoot.privateKey,
      sequence:nextSequence,
      issuedAtMs:NOW-1_000,
      expiresAtMs:NOW+60_000,
      keys:[{keyId:'authority-1',status:nextStatus,notBeforeMs:NOW-60_000,notAfterMs:NOW+60_000}]
    });
    return new SignedRollbackAnchorClient({
      transport:authority,
      authorityPublicKeys:{'authority-1':authorityKeys.publicKey},
      authorityId:'wfm-security-anchor-authority',
      anchorId:'attendance-source-continuity',
      authorityKeyPolicy:policy,
      authorityTrustRootPublicKeys:{'trust-root-1':trustRoot.publicKey},
      minimumAuthorityPolicySequence:nextSequence,
      expectedAuthorityPolicyDigest:authorityKeyPolicyDigest(policy),
      now:()=>NOW,
      randomBytes:()=>crypto.randomBytes(32)
    });
  };
  return {authority,authorityKeys,trustRoot,makeClient};
}
function store(rollbackAnchor,filePath=file()){
  return new AtomicSupervisorStateStore({filePath,integrityKeys:{k1:KEY},activeKeyId:'k1',rollbackAnchor});
}
function withEnv(name,value,fn){
  const before=process.env[name];
  if(value===undefined) delete process.env[name]; else process.env[name]=value;
  try{return fn();}finally{if(before===undefined) delete process.env[name]; else process.env[name]=before;}
}

const RELEASE_ERROR=/lifecycle-bound verified signed commitment-aware independent rollback authority/;

test('explicit release-grade mode rejects a legacy generation-only rollback anchor',()=>{
  withEnv('WFM_RELEASE_GRADE_SECURITY','1',()=>{
    assert.throws(()=>store(weakAnchor()),RELEASE_ERROR);
  });
});

test('release-grade mode rejects an unsigned commitment-aware lookalike',()=>{
  withEnv('WFM_RELEASE_GRADE_SECURITY','1',()=>{
    assert.throws(()=>store(unsignedCommitmentLookalike()),RELEASE_ERROR);
  });
});

test('production mode independently rejects a legacy generation-only rollback anchor',()=>{
  withEnv('NODE_ENV','production',()=>{
    assert.throws(()=>store(weakAnchor()),RELEASE_ERROR);
  });
});

test('release-grade mode rejects a genuine signed client without signed key lifecycle state',()=>{
  withEnv('WFM_RELEASE_GRADE_SECURITY','1',()=>{
    assert.throws(()=>store(genuineSignedAnchor()),RELEASE_ERROR);
  });
});

test('release-grade mode accepts lifecycle-bound signed authority and preserves crash-recoverable state contract',()=>{
  withEnv('WFM_RELEASE_GRADE_SECURITY','1',()=>{
    const f=lifecycleFixture();
    const anchor=f.makeClient('active',1);
    const p=file();
    const first=store(anchor,p);
    first.save({marker:'trusted'});
    const restarted=store(f.makeClient('active',1),p);
    assert.deepEqual(restarted.load(),{marker:'trusted'});
  });
});

test('revoked authority key is rejected across restart even when its public key remains configured',()=>{
  withEnv('WFM_RELEASE_GRADE_SECURITY','1',()=>{
    const f=lifecycleFixture();
    const p=file();
    store(f.makeClient('active',1),p).save({marker:'before-revocation'});
    const restarted=store(f.makeClient('revoked',2),p);
    assert.throws(()=>restarted.load(),/revoked by the current signed policy/);
  });
});
