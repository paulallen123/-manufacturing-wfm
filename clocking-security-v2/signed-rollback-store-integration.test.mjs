import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AtomicSupervisorStateStore} from './durable-source-supervisor.mjs';
import {SignedRollbackAnchorClient,createSyntheticSignedRollbackAuthority,createSyntheticSignedAuthorityKeyPolicy,authorityKeyPolicyDigest} from './signed-rollback-anchor.mjs';

function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wfm-signed-anchor-'));
  const filePath=path.join(dir,'supervisor.json');
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  const trustRoot=crypto.generateKeyPairSync('ed25519');
  const nowMs=Date.parse('2026-09-18T18:30:00Z');
  const authority=createSyntheticSignedRollbackAuthority({privateKey,now:()=>nowMs});
  const policy=createSyntheticSignedAuthorityKeyPolicy({
    rootPrivateKey:trustRoot.privateKey,
    sequence:1,
    issuedAtMs:nowMs-1_000,
    expiresAtMs:nowMs+60_000,
    keys:[{keyId:'authority-1',status:'active',notBeforeMs:nowMs-60_000,notAfterMs:nowMs+60_000}]
  });
  const makeAnchor=({transport=authority,anchorId='attendance-source-continuity'}={})=>new SignedRollbackAnchorClient({
    transport,
    authorityPublicKeys:{'authority-1':publicKey},
    authorityId:'wfm-security-anchor-authority',
    anchorId,
    authorityKeyPolicy:policy,
    authorityTrustRootPublicKeys:{'trust-root-1':trustRoot.publicKey},
    minimumAuthorityPolicySequence:1,
    expectedAuthorityPolicyDigest:authorityKeyPolicyDigest(policy),
    now:()=>nowMs,
    randomBytes:()=>crypto.randomBytes(32)
  });
  const anchor=makeAnchor();
  const key=Buffer.alloc(32,0x41);
  const store=(rollbackAnchor=anchor)=>new AtomicSupervisorStateStore({filePath,integrityKeys:{k1:key},activeKeyId:'k1',rollbackAnchor});
  return {filePath,authority,anchor,publicKey,privateKey,trustRoot,policy,makeAnchor,store};
}

test('canonical durable store accepts genuine signed authority and rejects replay of an older valid state',()=>{
  const f=fixture();
  const s=f.store();
  s.save({version:1,config:{},connectors:[],recovery:[],marker:'one'});
  const oldFrame=fs.readFileSync(f.filePath);
  s.save({version:1,config:{},connectors:[],recovery:[],marker:'two'});
  assert.equal(f.anchor.current(),2);
  fs.writeFileSync(f.filePath,oldFrame);
  assert.throws(()=>f.store(f.makeAnchor()).load(),/rollback detected/);
});

test('canonical durable store rejects a substituted fake rollback authority before trusting state',()=>{
  const f=fixture();
  f.store().save({version:1,config:{},connectors:[],recovery:[],marker:'trusted'});
  const attacker=crypto.generateKeyPairSync('ed25519');
  const fakeAuthority=createSyntheticSignedRollbackAuthority({privateKey:attacker.privateKey,initialGeneration:1,now:()=>Date.parse('2026-09-18T18:30:00Z')});
  const fakeAnchor=f.makeAnchor({transport:fakeAuthority});
  assert.throws(()=>f.store(fakeAnchor).load(),/signature invalid/);
});

test('signed authority identity is customer/anchor bound so another customer cannot satisfy rollback trust',()=>{
  const f=fixture();
  f.store().save({version:1,config:{},connectors:[],recovery:[],marker:'trusted'});
  const crossClient=f.makeAnchor({anchorId:'different-customer-continuity'});
  assert.throws(()=>f.store(crossClient).load(),/unknown anchor|identity mismatch/);
});
