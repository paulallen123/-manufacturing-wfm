import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AtomicSupervisorStateStore} from './durable-source-supervisor.mjs';

const KEY=Buffer.alloc(32,0x41);
function file(){ return path.join(fs.mkdtempSync(path.join(os.tmpdir(),'wfm-release-anchor-')),'state.json'); }
function weakAnchor(){
  let generation=0;
  return {
    current(){ return generation; },
    advance(expected){ if(expected!==generation) throw new Error('compare-and-set mismatch'); generation+=1; return generation; }
  };
}
function committedAnchor(){
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
function store(rollbackAnchor){
  return new AtomicSupervisorStateStore({filePath:file(),integrityKeys:{k1:KEY},activeKeyId:'k1',rollbackAnchor});
}
function withEnv(name,value,fn){
  const before=process.env[name];
  if(value===undefined) delete process.env[name]; else process.env[name]=value;
  try{return fn();}finally{if(before===undefined) delete process.env[name]; else process.env[name]=before;}
}

test('explicit release-grade mode rejects a legacy generation-only rollback anchor',()=>{
  withEnv('WFM_RELEASE_GRADE_SECURITY','1',()=>{
    assert.throws(()=>store(weakAnchor()),/commitment-aware independent rollback authority/);
  });
});

test('production mode independently rejects a legacy generation-only rollback anchor',()=>{
  withEnv('NODE_ENV','production',()=>{
    assert.throws(()=>store(weakAnchor()),/commitment-aware independent rollback authority/);
  });
});

test('release-grade mode accepts commitment-aware authority and preserves crash-recoverable state contract',()=>{
  withEnv('WFM_RELEASE_GRADE_SECURITY','1',()=>{
    const anchor=committedAnchor();
    const p=file();
    const first=new AtomicSupervisorStateStore({filePath:p,integrityKeys:{k1:KEY},activeKeyId:'k1',rollbackAnchor:anchor});
    first.save({marker:'trusted'});
    const restarted=new AtomicSupervisorStateStore({filePath:p,integrityKeys:{k1:KEY},activeKeyId:'k1',rollbackAnchor:anchor});
    assert.deepEqual(restarted.load(),{marker:'trusted'});
  });
});
