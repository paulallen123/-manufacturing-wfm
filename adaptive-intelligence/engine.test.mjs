import assert from 'node:assert/strict';
import test from 'node:test';
import {AdaptiveIntelligenceEngine} from './engine.mjs';

const commonGuards=['safetyPass','tenantIsolationPass','rollbackReady'];
const policyGuards=['shadowPass','canaryPass','independentPolicyAuthority'];
const nonApprovals=[
  ['string false','false'],['string true','true'],['number',1],
  ['array',[]],['object',{}],['boxed true',new Boolean(true)],
  ['boxed false',new Boolean(false)],['false',false],['zero',0],['empty string','']
];
const candidate=(overrides={})=>({
  id:'typed-guard-candidate',level:1,
  baselineScore:0.70,candidateScore:0.90,holdoutScore:0.85,
  safetyPass:true,tenantIsolationPass:true,rollbackReady:true,
  shadowPass:true,canaryPass:true,independentPolicyAuthority:true,
  ...overrides
});
const evaluate=(input)=>{
  const engine=new AdaptiveIntelligenceEngine();
  const result=engine.evaluateCandidate(input);
  assert.equal(result.directProductionAuthorityGranted,false);
  assert.deepEqual(engine.snapshot().decisions,[result]);
  return result;
};
const expectDecision=(input,decision,reason)=>{
  const result=evaluate(input);
  assert.equal(result.decision,decision);
  assert.equal(result.reason,reason);
};

test('string false in all common guards rejects an improving level-1 candidate',()=>{
  expectDecision(candidate({safetyPass:'false',tenantIsolationPass:'false',rollbackReady:'false'}),
    'reject','safety-isolation-or-rollback-failed');
});

for(const level of [0,1,2,3,4]){
  for(const field of commonGuards){
    for(const [label,value] of nonApprovals){
      test(`level ${level}: ${field}=${label} rejects despite other guards passing`,()=>{
        expectDecision(candidate({level,[field]:value}),
          'reject','safety-isolation-or-rollback-failed');
      });
    }
  }
  test(`literal true guards preserve the level-${level} advisory decision`,()=>{
    const decision=level<3?'promote':'route-to-release-gates';
    const reason=level<2?'safe-non-mutating-improvement':level===2?
      'bounded-reversible-policy-approved':'high-impact-change-requires-independent-release-authority';
    expectDecision(candidate({level}),decision,reason);
  });
  test(`level ${level}: learning memory cannot grant authority`,()=>{
    expectDecision(candidate({level,memoryGrantsAuthority:true}),
      'reject','memory-authority-forbidden');
  });
}

for(const field of commonGuards){
  for(const [label,value] of [['absent',undefined],['undefined',undefined],['null',null]]){
    test(`${field} ${label} retains the missing-input error without recording a decision`,()=>{
      const input=candidate({[field]:value});
      if(label==='absent') delete input[field];
      const engine=new AdaptiveIntelligenceEngine();
      assert.throws(()=>engine.evaluateCandidate(input),{message:'CANDIDATE_MISSING_'+field});
      assert.deepEqual(engine.snapshot().candidates,[]);
      assert.deepEqual(engine.snapshot().decisions,[]);
    });
  }
}

for(const field of policyGuards){
  for(const [label,value] of [...nonApprovals,['undefined',undefined],['null',null]]){
    test(`level 2: ${field}=${label} retains strict policy rejection`,()=>{
      expectDecision(candidate({level:2,[field]:value}),
        'reject','shadow-canary-or-authority-missing');
    });
  }
  test(`level 2: absent ${field} retains strict policy rejection`,()=>{
    const input=candidate({level:2});
    delete input[field];
    expectDecision(input,'reject','shadow-canary-or-authority-missing');
  });
}

for(const field of ['candidateScore','holdoutScore']){
  for(const score of [0.70,0.69]){
    test(`${field}=${score} cannot pass the improvement gate`,()=>{
      expectDecision(candidate({[field]:score}),'reject','no-holdout-improvement');
    });
  }
}

test('explicit false memory-authority flag preserves a valid advisory promotion',()=>{
  expectDecision(candidate({memoryGrantsAuthority:false}),'promote','safe-non-mutating-improvement');
});

test('memory-authority rejection retains precedence over failed safety guards',()=>{
  expectDecision(candidate({memoryGrantsAuthority:true,safetyPass:false}),
    'reject','memory-authority-forbidden');
});

for(const field of ['baselineScore','candidateScore','holdoutScore']){
  for(const [label,value] of [
    ['NaN',NaN],['positive infinity',Infinity],['negative infinity',-Infinity],
    ['numeric string','0.8'],['boolean',true],['array',[0.8]],
    ['object',{value:0.8}],['boxed number',new Number(0.8)]
  ]){
    test(`${field} ${label} is rejected before recording candidate or decision`,()=>{
      const engine=new AdaptiveIntelligenceEngine();
      assert.throws(()=>engine.evaluateCandidate(candidate({[field]:value})),
        {message:'CANDIDATE_FINITE_NUMERIC_SCORES_REQUIRED'});
      assert.deepEqual(engine.snapshot().candidates,[]);
      assert.deepEqual(engine.snapshot().decisions,[]);
    });
  }
}

test('finite numeric scores preserve improvement semantics without a ratio-only range',()=>{
  expectDecision(candidate({baselineScore:-5,candidateScore:-3,holdoutScore:-4}),
    'promote','safe-non-mutating-improvement');
  expectDecision(candidate({baselineScore:0,candidateScore:2,holdoutScore:1}),
    'promote','safe-non-mutating-improvement');
});

const verifiedOutcome=(overrides={})=>({
  tenantScope:'outcome-tenant',source:'verified-outcome-ledger',category:'scheduling',
  fingerprint:'shift-cover',baseline:1,result:2,verified:true,evidenceRef:'proof:execution-1',
  ...overrides
});

test('replaying one verified outcome cannot manufacture repeated learning wins',()=>{
  const engine=new AdaptiveIntelligenceEngine();
  const original=engine.ingestOutcome(verifiedOutcome());
  for(let i=0;i<5;i++) assert.deepEqual(engine.ingestOutcome(verifiedOutcome()),original);
  assert.equal(engine.snapshot().outcomes.length,1);
  assert.equal(engine.snapshot().skills.length,0);
});

test('three distinct verified outcomes retain one evidence-backed skill candidate',()=>{
  const engine=new AdaptiveIntelligenceEngine();
  for(let i=1;i<=3;i++) engine.ingestOutcome(verifiedOutcome({evidenceRef:'proof:execution-'+i}));
  const snapshot=engine.snapshot();
  assert.equal(snapshot.outcomes.length,3);
  assert.equal(snapshot.skills.length,1);
  assert.equal(snapshot.skills[0].verifiedWinCount,3);
  assert.equal(snapshot.skills[0].authority,'none');
  assert.equal(snapshot.skills[0].evidenceRefs.length,3);
});

for(const [field,value] of [
  ['baseline',0],['result',3],['category','payroll'],['fingerprint','another-shift'],
  ['verified',false],['createdAt','2026-10-12T08:00:00Z']
]){
  test(`conflicting ${field} under one outcome evidence identity cannot rewrite learning`,()=>{
    const engine=new AdaptiveIntelligenceEngine();
    engine.ingestOutcome(verifiedOutcome());
    const before=engine.snapshot();
    assert.throws(()=>engine.ingestOutcome(verifiedOutcome({[field]:value})),
      {message:'OUTCOME_EVIDENCE_REPLAY_CONFLICT'});
    assert.deepEqual(engine.snapshot(),before);
  });
}

for(const evidenceRef of [undefined,null,'',' ',{},[]]){
  test(`verified outcome requires a non-empty string evidence reference: ${JSON.stringify(evidenceRef)}`,()=>{
    const engine=new AdaptiveIntelligenceEngine();
    assert.throws(()=>engine.ingestOutcome(verifiedOutcome({evidenceRef})),
      {message:'VERIFIED_OUTCOME_EVIDENCE_REFERENCE_REQUIRED'});
    assert.equal(engine.snapshot().outcomes.length,0);
    assert.equal(engine.snapshot().skills.length,0);
  });
}

test('outcome evidence identity remains isolated by tenant and source',()=>{
  const engine=new AdaptiveIntelligenceEngine();
  engine.ingestOutcome(verifiedOutcome());
  engine.ingestOutcome(verifiedOutcome({tenantScope:'another-tenant'}));
  engine.ingestOutcome(verifiedOutcome({source:'another-ledger'}));
  assert.equal(engine.snapshot().outcomes.length,3);
  assert.equal(engine.snapshot().skills.length,0);
});

