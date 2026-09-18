import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AtomicSupervisorStateStore} from './durable-source-supervisor.mjs';
import {SignedRollbackAnchorClient,createSyntheticSignedRollbackAuthority} from './signed-rollback-anchor.mjs';

const KEY=Buffer.alloc(32,0x41);
const NOW=Date.parse('2026-09-18T20:20:00Z');
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
function store(rollbackAnchor,filePath=file()){
  return new AtomicSupervisorStateStore({filePath,integrityKeys:{k1:KEY},activeKeyId:'k1',rollbackAnchor});
}
function withEnv(name,value,fn){
  const before=process.env[name];
  if(value===undefined) delete process.env[name]; else process.env[name]=value;
  try{return fn();}finally{if(before===undefined) delete process.env[name]; else process.env[name]=before;}
}

test('explicit release-grade mode rejects a legacy generation-only rollback anchor',()=>{
  withEnv('WFM_RELEASE_GRADE_SECURITY','1',()=>{
    assert.throws(()=>store(weakAnchor()),/verified signed commitment-aware independent rollback authority/);
  });
});

test('release-grade mode rejects an unsigned commitment-aware lookalike',()=>{
  withEnv('WFM_RELEASE_GRADE_SECURITY','1',()=>{
    assert.throws(()=>store(unsignedCommitmentLookalike()),/verified signed commitment-aware independent rollback authority/);
  });
});

test('production mode independently rejects a legacy generation-only rollback anchor',()=>{
  withEnv('NODE_ENV','production',()=>{
    assert.throws(()=>store(weakAnchor()),/verified signed commitment-aware independent rollback authority/);
  });
});

test('release-grade mode accepts the genuine signed authority client and preserves crash-recoverable state contract',()=>{
  withEnv('WFM_RELEASE_GRADE_SECURITY','1',()=>{
    const anchor=genuineSignedAnchor();
    const p=file();
    const first=store(anchor,p);
    first.save({marker:'trusted'});
    const restarted=store(anchor,p);
    assert.deepEqual(restarted.load(),{marker:'trusted'});
  });
});
