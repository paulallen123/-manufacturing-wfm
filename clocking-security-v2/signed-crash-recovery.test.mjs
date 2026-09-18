import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AtomicSupervisorStateStore} from './durable-source-supervisor.mjs';
import {SignedRollbackAnchorClient,createSyntheticSignedRollbackAuthority,createSyntheticSignedAuthorityKeyPolicy,authorityKeyPolicyDigest} from './signed-rollback-anchor.mjs';

function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wfm-signed-crash-'));
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
  const client=(transport=authority)=>new SignedRollbackAnchorClient({
    transport,
    authorityPublicKeys:{'authority-1':publicKey},
    authorityId:'wfm-security-anchor-authority',
    anchorId:'attendance-source-continuity',
    authorityKeyPolicy:policy,
    authorityTrustRootPublicKeys:{'trust-root-1':trustRoot.publicKey},
    minimumAuthorityPolicySequence:1,
    expectedAuthorityPolicyDigest:authorityKeyPolicyDigest(policy),
    now:()=>nowMs,
    randomBytes:()=>crypto.randomBytes(32)
  });
  const key=Buffer.alloc(32,0x41);
  const store=(anchor=client())=>new AtomicSupervisorStateStore({filePath,integrityKeys:{k1:key},activeKeyId:'k1',rollbackAnchor:anchor});
  return {dir,filePath,authority,client,store};
}

function ambiguousCommittedTransport(real){
  return {
    read:real.read.bind(real),
    compareAndAdvance(args){
      real.compareAndAdvance(args);
      throw new Error('simulated transport loss after commit');
    }
  };
}

test('restart completes exact committed state after caller loses response following signed anchor CAS',()=>{
  const f=fixture();
  f.store().save({marker:'one'});
  const interrupted=f.store(f.client(ambiguousCommittedTransport(f.authority)));
  assert.throws(()=>interrupted.save({marker:'two'}),/transport loss after commit/);
  assert.equal(interrupted.requiresRecovery(),true);
  assert.equal(f.authority.generation(),2);
  assert.equal(JSON.parse(fs.readFileSync(f.filePath)).rollbackGeneration,1);
  const restarted=f.store();
  assert.deepEqual(restarted.load(),{marker:'two'});
  assert.equal(JSON.parse(fs.readFileSync(f.filePath)).rollbackGeneration,2);
});

test('tampering with committed pending state is rejected instead of being published during recovery',()=>{
  const f=fixture();
  f.store().save({marker:'one'});
  const interrupted=f.store(f.client(ambiguousCommittedTransport(f.authority)));
  assert.throws(()=>interrupted.save({marker:'two'}),/transport loss after commit/);
  const pending=fs.readdirSync(f.dir).find(name=>name.includes('.pending.2.'));
  assert.ok(pending);
  const pendingPath=path.join(f.dir,pending);
  const frame=JSON.parse(fs.readFileSync(pendingPath,'utf8'));
  frame.state.marker='attacker';
  fs.writeFileSync(pendingPath,JSON.stringify(frame));
  assert.throws(()=>f.store().load(),/authentication failed|does not match rollback anchor commitment/);
  assert.equal(JSON.parse(fs.readFileSync(f.filePath)).state.marker,'one');
});

test('pre-CAS crash residue with identical commitment can be safely reused by a retry',()=>{
  const f=fixture();
  f.store().save({marker:'one'});
  let first=true;
  const preCommitFailure={
    read:f.authority.read.bind(f.authority),
    compareAndAdvance(args){
      if(first){ first=false; throw new Error('simulated outage before commit'); }
      return f.authority.compareAndAdvance(args);
    }
  };
  const failed=f.store(f.client(preCommitFailure));
  assert.throws(()=>failed.save({marker:'two'}),/outage before commit/);
  assert.equal(f.authority.generation(),1);
  const pending=fs.readdirSync(f.dir).filter(name=>name.includes('.pending.2.'));
  assert.equal(pending.length,1);
  const retry=f.store(f.client());
  assert.doesNotThrow(()=>retry.save({marker:'two'}));
  assert.equal(f.authority.generation(),2);
  assert.deepEqual(f.store().load(),{marker:'two'});
});
