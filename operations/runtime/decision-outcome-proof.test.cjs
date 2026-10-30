'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createDecisionEpisode,selectDecisionOption,recordDecisionOutcome}=require('./decision-episode.cjs');
const {createDecisionOutcomeProof,toAdaptiveOutcomeInput}=require('./decision-outcome-proof.cjs');

function completed(metric='planAttainmentPct'){
  const episode=createDecisionEpisode({
    tenant:'alpha',site:'tamworth',decisionType:'absence-recovery',triggerId:'absence:42',
    triggeredAt:'2026-09-22T08:00:00Z',contextRevision:'twin:abc',mode:'HUMAN_APPROVAL',
    sourceEvidence:['absence:42','skills:line-4','plan:a'],
    objective:{labourCost:.25,planAttainmentPct:.55,riskScore:.2,uncertaintyPenalty:.1},
    options:[
      {id:'do-nothing',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:.05,prediction:{labourCost:500,planAttainmentPct:80,riskScore:2},evidenceRefs:['sim:a']},
      {id:'redeploy',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:.1,prediction:{labourCost:300,planAttainmentPct:98,riskScore:1},evidenceRefs:['sim:b']}
    ]
  });
  const selected=selectDecisionOption(episode,{optionId:'redeploy',selectedAt:'2026-09-22T08:05:00Z',actorRef:'manager:1',authorityDecision:'HUMAN_APPROVED'});
  const actual=metric==='labourCost'?{labourCost:320,planAttainmentPct:97,riskScore:1}:{labourCost:320,planAttainmentPct:97,riskScore:1};
  return recordDecisionOutcome(selected,{observedAt:'2026-09-22T16:00:00Z',evidenceRefs:['mes:shift:a','payroll:shift:a'],actual});
}

test('simulation can never become learning-eligible or verified value',()=>{
  const proof=createDecisionOutcomeProof({episode:completed(),metric:'planAttainmentPct',direction:'MAXIMIZE',classification:'SIMULATED'});
  assert.equal(proof.verifiedOperationalOutcome,false);
  assert.equal(proof.realisedFinancialOutcome,false);
  assert.equal(proof.learningEligible,false);
  assert.throws(()=>toAdaptiveOutcomeInput(proof),/verified decision outcome/);
});

test('operational proof requires independent baseline and result evidence',()=>{
  const episode=completed();
  assert.throws(()=>createDecisionOutcomeProof({episode,metric:'planAttainmentPct',direction:'MAXIMIZE',classification:'VERIFIED_OPERATIONAL',baselineActual:82,baselineEvidenceRefs:[]}),/Baseline and result evidence/);
  const proof=createDecisionOutcomeProof({
    episode,metric:'planAttainmentPct',direction:'MAXIMIZE',classification:'VERIFIED_OPERATIONAL',
    baselineActual:82,baselineEvidenceRefs:['mes:prior-comparable-shift']
  });
  assert.equal(proof.verifiedOperationalOutcome,true);
  assert.equal(proof.realisedFinancialOutcome,false);
  assert.equal(proof.observed.improvement,15);
  const learning=toAdaptiveOutcomeInput(proof);
  assert.equal(learning.result-learning.baseline,15);
  assert.equal(learning.verified,true);
});

test('cost improvement maps lower actual cost to positive learning delta',()=>{
  const proof=createDecisionOutcomeProof({
    episode:completed('labourCost'),metric:'labourCost',direction:'MINIMIZE',classification:'VERIFIED_OPERATIONAL',
    baselineActual:520,baselineEvidenceRefs:['payroll:baseline']
  });
  assert.equal(proof.observed.improvement,200);
  const learning=toAdaptiveOutcomeInput(proof);
  assert.equal(learning.result-learning.baseline,200);
});

test('realised financial value requires finance evidence currency and a bounded window',()=>{
  const episode=completed('labourCost');
  assert.throws(()=>createDecisionOutcomeProof({
    episode,metric:'labourCost',direction:'MINIMIZE',classification:'REALISED_FINANCIAL',
    baselineActual:520,baselineEvidenceRefs:['payroll:baseline'],financeEvidenceRefs:[]
  }),/Finance evidence/);
  const proof=createDecisionOutcomeProof({
    episode,metric:'labourCost',direction:'MINIMIZE',classification:'REALISED_FINANCIAL',
    baselineActual:520,baselineEvidenceRefs:['payroll:baseline'],financeEvidenceRefs:['finance:ledger:shift-a'],
    currency:'GBP',measurementWindow:{start:'2026-09-22T08:00:00Z',end:'2026-09-22T16:00:00Z'}
  });
  assert.equal(proof.realisedFinancialOutcome,true);
  assert.equal(proof.currency,'GBP');
  assert.equal(proof.observed.improvement,200);
});

test('non-financial KPI cannot be labelled realised financial value',()=>{
  assert.throws(()=>createDecisionOutcomeProof({
    episode:completed(),metric:'planAttainmentPct',direction:'MAXIMIZE',classification:'REALISED_FINANCIAL',
    baselineActual:82,baselineEvidenceRefs:['mes:baseline'],financeEvidenceRefs:['finance:x'],
    currency:'GBP',measurementWindow:{start:'2026-09-22T08:00:00Z',end:'2026-09-22T16:00:00Z'}
  }),/supported financial metric/);
});

test('changed nested settled result cannot be consumed under an issued proof digest',()=>{
  const proof=createDecisionOutcomeProof({episode:completed('labourCost'),metric:'labourCost',direction:'MINIMIZE',classification:'VERIFIED_OPERATIONAL',baselineActual:520,baselineEvidenceRefs:['payroll:baseline']});
  const original=toAdaptiveOutcomeInput(proof);
  const changed=structuredClone(proof);
  changed.observed.result=720;
  assert.equal(original.result-original.baseline,200);
  assert.equal(changed.proofDigest,proof.proofDigest);
  assert.throws(()=>toAdaptiveOutcomeInput(changed),/integrity/);
  changed.observed.result=320;
  changed.direction='MAXIMIZE';
  assert.throws(()=>toAdaptiveOutcomeInput(changed),/integrity/);
  assert.deepEqual(toAdaptiveOutcomeInput(structuredClone(proof)),original);
});

test('missing and substituted digest cannot label a proof verified for learning',()=>{
  const proof=createDecisionOutcomeProof({episode:completed(),metric:'planAttainmentPct',direction:'MAXIMIZE',classification:'VERIFIED_OPERATIONAL',baselineActual:82,baselineEvidenceRefs:['mes:baseline']});
  for(const substituted of [undefined,null,'0'.repeat(64)]){
    const changed=structuredClone(proof);changed.proofDigest=substituted;
    assert.throws(()=>toAdaptiveOutcomeInput(changed),/integrity/);
  }
});


// Reviewed numeric-actual regressions run through the existing admission entry point.
{
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDecisionEpisode, selectDecisionOption, recordDecisionOutcome } = require('./decision-episode.cjs');
const { createDecisionOutcomeProof } = require('./decision-outcome-proof.cjs');

function episode() {
  const initial = createDecisionEpisode({
    tenant:'alpha',site:'tamworth',decisionType:'absence-recovery',triggerId:'absence:42',
    triggeredAt:'2026-09-22T08:00:00Z',contextRevision:'twin:abc',mode:'HUMAN_APPROVAL',
    sourceEvidence:['absence:42'],objective:{labourCost:.25,planAttainmentPct:.55,riskScore:.2,uncertaintyPenalty:.1},
    options:[
      {id:'do-nothing',feasible:true,policyAllowed:true,hardConstraintsPassed:true,prediction:{labourCost:500},evidenceRefs:['sim:a']},
      {id:'redeploy',feasible:true,policyAllowed:true,hardConstraintsPassed:true,prediction:{labourCost:300},evidenceRefs:['sim:b']}
    ]
  });
  const selected = selectDecisionOption(initial,{optionId:'redeploy',selectedAt:'2026-09-22T08:05:00Z',actorRef:'manager:1',authorityDecision:'HUMAN_APPROVED'});
  return recordDecisionOutcome(selected,{observedAt:'2026-09-22T16:00:00Z',evidenceRefs:['payroll:shift:a'],actual:{labourCost:320}});
}
function input(overrides={}) {
  return {episode:episode(),metric:'labourCost',direction:'MINIMIZE',classification:'REALISED_FINANCIAL',
    baselineActual:520,baselineEvidenceRefs:['payroll:baseline'],financeEvidenceRefs:['finance:ledger:shift-a'],
    currency:'GBP',measurementWindow:{start:'2026-09-22T08:00:00Z',end:'2026-09-22T16:00:00Z'},...overrides};
}
test('absent, null and string baseline actuals cannot be presented as realised financial value',()=>{
  for(const value of [undefined,null,'520','',false]) {
    assert.throws(()=>createDecisionOutcomeProof(input({baselineActual:value})),/baseline actual must be a finite number/);
  }
});
test('a forged nonnumeric or numeric-string result actual cannot become realised financial value',()=>{
  for(const value of [null,undefined,'320','',false]) {
    const mutated=structuredClone(episode());
    mutated.outcome.actual.labourCost=value;
    assert.throws(()=>createDecisionOutcomeProof(input({episode:mutated})),/result actual must be a finite number|Recorded actual result is required/);
  }
});
test('explicit numeric zero is measured rather than treated as absent',()=>{
  const proof=createDecisionOutcomeProof(input({baselineActual:0}));
  assert.equal(proof.observed.baseline,0);
  assert.equal(proof.observed.improvement,-320);
});
}

// Independently authored boundary cases; local target makes ordinary CI portable.
{
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const modulePath = require.resolve('./decision-outcome-proof.cjs');
const { createDecisionOutcomeProof, toAdaptiveOutcomeInput } = require(modulePath);

function episode(actual = 320) {
  return {
    episodeId: 'decision:independent:1', tenant: 'synthetic-alpha', site: 'synthetic-site',
    decisionType: 'absence-recovery', selection: { optionId: 'redeploy' },
    options: [
      { id: 'do-nothing', prediction: { labourCost: 500, planAttainmentPct: 80 } },
      { id: 'redeploy', prediction: { labourCost: 300, planAttainmentPct: 98 } }
    ],
    outcome: {
      observedAt: '2026-09-22T16:00:00Z', evidenceRefs: ['synthetic:result'],
      actual: { labourCost: actual, planAttainmentPct: 97 }
    }
  };
}

function input(override = {}) {
  return {
    episode: episode(), metric: 'labourCost', direction: 'MINIMIZE',
    classification: 'REALISED_FINANCIAL', baselineActual: 520,
    baselineEvidenceRefs: ['synthetic:baseline'], financeEvidenceRefs: ['synthetic:ledger'],
    currency: 'GBP',
    measurementWindow: { start: '2026-09-22T08:00:00Z', end: '2026-09-22T16:00:00Z' },
    ...override
  };
}

test('missing baseline actual cannot silently become a zero saving', () => {
  const candidate = input(); delete candidate.baselineActual;
  assert.throws(() => createDecisionOutcomeProof(candidate), /baseline actual/);
});

test('coercible baseline values cannot prove financial results', () => {
  for (const value of ['520', '', true, false, [], [520], new Number(520), NaN, Infinity, -Infinity]) {
    assert.throws(() => createDecisionOutcomeProof(input({ baselineActual: value })), /baseline actual/, String(value));
  }
});

test('coercible result values cannot prove financial results', () => {
  for (const value of ['320', '', true, false, [], [320], new Number(320), NaN, Infinity, -Infinity]) {
    assert.throws(() => createDecisionOutcomeProof(input({ episode: episode(value) })), /result actual/, String(value));
  }
});

test('missing result and missing baseline are rejected for verified operational evidence too', () => {
  const missing = episode(); delete missing.outcome.actual.labourCost;
  assert.throws(() => createDecisionOutcomeProof(input({ episode: missing, classification: 'VERIFIED_OPERATIONAL' })), /result actual|Recorded actual/);
  const noBaseline = input({ classification: 'VERIFIED_OPERATIONAL' }); delete noBaseline.baselineActual;
  assert.throws(() => createDecisionOutcomeProof(noBaseline), /baseline actual/);
});

test('explicit numeric zero is retained at both ends', () => {
  const zeroBaseline = createDecisionOutcomeProof(input({ baselineActual: 0 }));
  assert.equal(zeroBaseline.observed.baseline, 0);
  assert.equal(zeroBaseline.observed.improvement, -320);
  const zeroResult = createDecisionOutcomeProof(input({ episode: episode(0) }));
  assert.equal(zeroResult.observed.result, 0);
  assert.equal(zeroResult.observed.improvement, 520);
});

test('simulation remains unverified even with missing actual measurements', () => {
  const simulated = episode(); delete simulated.outcome.actual.labourCost;
  const proof = createDecisionOutcomeProof(input({ episode: simulated, classification: 'SIMULATED' }));
  assert.equal(proof.observed, null);
  assert.equal(proof.realisedFinancialOutcome, false);
  assert.equal(proof.learningEligible, false);
  assert.throws(() => toAdaptiveOutcomeInput(proof), /verified decision outcome/);
});

test('valid financial value keeps exact observed improvement and learning delta', () => {
  const proof = createDecisionOutcomeProof(input());
  assert.equal(proof.observed.baseline, 520);
  assert.equal(proof.observed.result, 320);
  assert.equal(proof.observed.improvement, 200);
  assert.equal(proof.realisedFinancialOutcome, true);
  assert.equal(toAdaptiveOutcomeInput(proof).result - toAdaptiveOutcomeInput(proof).baseline, 200);
});
}
