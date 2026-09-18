import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AtomicSupervisorStateStore} from './durable-source-supervisor.mjs';

const KEY=Buffer.alloc(32,0x41);
function file(){ return path.join(fs.mkdtempSync(path.join(os.tmpdir(),'wfm-anchor-provenance-')),'state.json'); }
function forgedCommitmentAwareAnchor(){
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
function withReleaseGrade(fn){
  const before=process.env.WFM_RELEASE_GRADE_SECURITY;
  process.env.WFM_RELEASE_GRADE_SECURITY='1';
  try{return fn();}finally{if(before===undefined) delete process.env.WFM_RELEASE_GRADE_SECURITY; else process.env.WFM_RELEASE_GRADE_SECURITY=before;}
}

test('release-grade store rejects an unsigned lookalike rollback authority even when it implements the commitment methods',()=>{
  withReleaseGrade(()=>{
    assert.throws(
      ()=>new AtomicSupervisorStateStore({
        filePath:file(),
        integrityKeys:{k1:KEY},
        activeKeyId:'k1',
        rollbackAnchor:forgedCommitmentAwareAnchor()
      }),
      /signed|provenance|trusted rollback authority/i
    );
  });
});
