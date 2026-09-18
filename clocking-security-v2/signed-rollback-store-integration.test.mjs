import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AtomicSupervisorStateStore} from './durable-source-supervisor.mjs';
import {SignedRollbackAnchorClient,createSyntheticSignedRollbackAuthority} from './signed-rollback-anchor.mjs';

function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wfm-signed-anchor-'));
  const filePath=path.join(dir,'supervisor.json');
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  const nowMs=Date.parse('2026-09-18T18:30:00Z');
  const authority=createSyntheticSignedRollbackAuthority({privateKey,now:()=>nowMs});
  const anchor=new SignedRollbackAnchorClient({
    transport:authority,
    authorityPublicKeys:{'authority-1':publicKey},
    authorityId:'wfm-security-anchor-authority',
    anchorId:'attendance-source-continuity',
    now:()=>nowMs,
    randomBytes:()=>crypto.randomBytes(32)
  });
  const key=Buffer.alloc(32,0x41);
  const store=()=>new AtomicSupervisorStateStore({filePath,integrityKeys:{k1:key},activeKeyId:'k1',rollbackAnchor:anchor});
  return {filePath,authority,anchor,publicKey,privateKey,store};
}

test('canonical durable store accepts genuine signed authority and rejects replay of an older valid state',()=>{
  const f=fixture();
  const s=f.store();
  s.save({version:1,config:{},connectors:[],recovery:[],marker:'one'});
  const oldFrame=fs.readFileSync(f.filePath);
  s.save({version:1,config:{},connectors:[],recovery:[],marker:'two'});
  assert.equal(f.anchor.current(),2);
  fs.writeFileSync(f.filePath,oldFrame);
  assert.throws(()=>f.store().load(),/rollback detected/);
});

test('canonical durable store rejects a substituted fake rollback authority before trusting state',()=>{
  const f=fixture();
  f.store().save({version:1,config:{},connectors:[],recovery:[],marker:'trusted'});
  const attacker=crypto.generateKeyPairSync('ed25519');
  const fakeAuthority=createSyntheticSignedRollbackAuthority({privateKey:attacker.privateKey,initialGeneration:1,now:()=>Date.parse('2026-09-18T18:30:00Z')});
  const fakeAnchor=new SignedRollbackAnchorClient({
    transport:fakeAuthority,
    authorityPublicKeys:{'authority-1':f.publicKey},
    authorityId:'wfm-security-anchor-authority',
    anchorId:'attendance-source-continuity',
    now:()=>Date.parse('2026-09-18T18:30:00Z'),
    randomBytes:()=>crypto.randomBytes(32)
  });
  const key=Buffer.alloc(32,0x41);
  const substituted=new AtomicSupervisorStateStore({filePath:f.filePath,integrityKeys:{k1:key},activeKeyId:'k1',rollbackAnchor:fakeAnchor});
  assert.throws(()=>substituted.load(),/signature invalid/);
});

test('signed authority identity is customer/anchor bound so another customer cannot satisfy rollback trust',()=>{
  const f=fixture();
  f.store().save({version:1,config:{},connectors:[],recovery:[],marker:'trusted'});
  const crossClient=new SignedRollbackAnchorClient({
    transport:f.authority,
    authorityPublicKeys:{'authority-1':f.publicKey},
    authorityId:'wfm-security-anchor-authority',
    anchorId:'different-customer-continuity',
    now:()=>Date.parse('2026-09-18T18:30:00Z'),
    randomBytes:()=>crypto.randomBytes(32)
  });
  const key=Buffer.alloc(32,0x41);
  const crossStore=new AtomicSupervisorStateStore({filePath:f.filePath,integrityKeys:{k1:key},activeKeyId:'k1',rollbackAnchor:crossClient});
  assert.throws(()=>crossStore.load(),/unknown anchor|identity mismatch/);
});
