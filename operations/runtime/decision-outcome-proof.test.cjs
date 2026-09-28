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
  assert.equal(learning.fingerprint,'absence-recovery:redeploy:planAttainmentPct');
});

test('cost improvement maps lower actual cost to positive learning delta',()=>{
  const proof=createDecisionOutcomeProof({
    episode:completed('labourCost'),metric:'labourCost',direction:'MINIMIZE',classification:'VERIFIED_OPERATIONAL',
    baselineActual:520,baselineEvidenceRefs:['payroll:baseline']
  });
  assert.equal(proof.observed.improvement,200);
  const learning=toAdaptiveOutcomeInput(proof);
  assert.equal(learning.result-learning.baseline,200);
  assert.equal(learning.fingerprint,'absence-recovery:redeploy:labourCost');
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

test('learning fingerprint separates different selected actions for the same decision and metric',()=>{
  const redeploy=createDecisionOutcomeProof({
    episode:completed('labourCost'),metric:'labourCost',direction:'MINIMIZE',classification:'VERIFIED_OPERATIONAL',
    baselineActual:520,baselineEvidenceRefs:['payroll:baseline']
  });
  const base=completed('labourCost');
  const overtimeEpisode={...base,selection:{...base.selection,optionId:'overtime'},options:[
    ...base.options.filter(x=>x.id!=='redeploy'),
    {id:'overtime',label:'Overtime',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:.1,prediction:{labourCost:330,planAttainmentPct:96,riskScore:1},evidenceRefs:['sim:overtime'],reasonCodes:[]}
  ]};
  const overtime=createDecisionOutcomeProof({
    episode:overtimeEpisode,metric:'labourCost',direction:'MINIMIZE',classification:'VERIFIED_OPERATIONAL',
    baselineActual:520,baselineEvidenceRefs:['payroll:baseline']
  });
  assert.notEqual(toAdaptiveOutcomeInput(redeploy).fingerprint,toAdaptiveOutcomeInput(overtime).fingerprint);
  assert.equal(toAdaptiveOutcomeInput(overtime).fingerprint,'absence-recovery:overtime:labourCost');
});
