import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableOutcomeLedger} from './durable-outcome-ledger.mjs';

const outcome=(n=1,extra={})=>({tenantScope:'t',source:'ledger',category:'scheduling',
  fingerprint:'cover',baseline:1,result:2,verified:true,evidenceRef:'proof:'+n,...extra});
function temp(fn){
  const dir=mkdtempSync(join(tmpdir(),'vector-v123-'));
  try{return fn(join(dir,'learning.sqlite'));}finally{rmSync(dir,{recursive:true,force:true});}
}

test('same verified proof remains one win after reopening a durable ledger',()=>temp(path=>{
  let l=new DurableOutcomeLedger({path});
  const original=l.ingestOutcome(outcome()); l.close();
  l=new DurableOutcomeLedger({path});
  for(let n=0;n<4;n++) assert.deepEqual(l.ingestOutcome(outcome()),original);
  assert.equal(l.snapshot().outcomes.length,1);
  assert.equal(l.snapshot().skills.length,0);
  l.close();
}));

test('three independently evidenced wins create one advisory candidate across restarts',()=>temp(path=>{
  for(let n=1;n<=3;n++){const l=new DurableOutcomeLedger({path});l.ingestOutcome(outcome(n));l.close();}
  const l=new DurableOutcomeLedger({path}), state=l.snapshot();
  assert.equal(state.outcomes.length,3);
  assert.equal(state.skills.length,1);
  assert.equal(state.skills[0].authority,'none');
  assert.equal(state.skills[0].verifiedWinCount,3);
  l.close();
}));

test('conflicting replay rolls back without changing durable state',()=>temp(path=>{
  let l=new DurableOutcomeLedger({path});
  const first=l.ingestOutcome(outcome());
  assert.throws(()=>l.ingestOutcome(outcome(1,{result:4})),/OUTCOME_EVIDENCE_REPLAY_CONFLICT/);
  l.close();
  l=new DurableOutcomeLedger({path});
  assert.deepEqual(l.snapshot().outcomes,[first]);
  l.close();
}));

test('two handles observe each committed record rather than stale process memory',()=>temp(path=>{
  const a=new DurableOutcomeLedger({path}),b=new DurableOutcomeLedger({path});
  a.ingestOutcome(outcome(1)); b.ingestOutcome(outcome(2)); a.ingestOutcome(outcome(3));
  assert.equal(b.snapshot().skills[0].verifiedWinCount,3);
  a.close();b.close();
}));

test('tenant and source isolate proof identities; unsafe records fail before durable write',()=>temp(path=>{
  const l=new DurableOutcomeLedger({path});
  l.ingestOutcome(outcome(1));
  l.ingestOutcome(outcome(1,{tenantScope:'other'}));
  l.ingestOutcome(outcome(1,{source:'other'}));
  assert.throws(()=>l.ingestOutcome(outcome(2,{containsSecret:true})),/OUTCOME_AUTHORITY_OR_SECRET_FORBIDDEN/);
  assert.throws(()=>l.ingestOutcome(outcome(2,{evidenceRef:' '})),/OUTCOME_STABLE_evidenceRef_REQUIRED/);
  assert.equal(l.snapshot().outcomes.length,3);
  l.close();
}));

test('reopening under a different win threshold fails closed',()=>temp(path=>{
  const l=new DurableOutcomeLedger({path,minRepeatedWins:4});
  l.ingestOutcome(outcome(1)); l.close();
  assert.throws(()=>new DurableOutcomeLedger({path,minRepeatedWins:3}),/LEARNING_THRESHOLD_REPLAY_MISMATCH/);
  const same=new DurableOutcomeLedger({path,minRepeatedWins:4});
  assert.equal(same.snapshot().outcomes.length,1);
  same.close();
}));

test('derived advisory and regression metadata replays identically after restart',()=>temp(path=>{
  let l=new DurableOutcomeLedger({path});
  for(let n=1;n<=3;n++) l.ingestOutcome(outcome(n));
  l.ingestOutcome(outcome(4,{result:0,fingerprint:'regression'}));
  const before=l.snapshot();
  assert.equal(before.skills.length,1);
  assert.equal(before.evals.length,1);
  l.close();
  l=new DurableOutcomeLedger({path});
  assert.deepEqual(l.snapshot(),before);
  l.close();
}));

for(const [label,values] of [
  ['baseline',{baseline:-0,result:1}],
  ['result',{baseline:1,result:-0}],
  ['both',{baseline:-0,result:-0}]
]){
  test(`signed-zero ${label} preserves one canonical receipt across restart`,()=>temp(path=>{
    let l=new DurableOutcomeLedger({path});
    try{
      const input=outcome(1,values),receipt=l.ingestOutcome(input);
      assert.deepEqual(l.snapshot().outcomes,[receipt]);
      assert.equal(Object.is(receipt.baseline,-0),false);
      assert.equal(Object.is(receipt.result,-0),false);
      const before=l.snapshot();l.close();l=undefined;
      l=new DurableOutcomeLedger({path});
      assert.deepEqual(l.snapshot(),before);
      assert.deepEqual(l.ingestOutcome(input),receipt);
      assert.equal(l.snapshot().outcomes.length,1);
    }finally{l?.close();}
  }));
}
