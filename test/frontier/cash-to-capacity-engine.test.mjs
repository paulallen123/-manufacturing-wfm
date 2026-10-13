import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCashToCapacityCandidate,rankCashToCapacityCandidates} from '../../src/frontier/cash-to-capacity-engine.mjs';

const evidence={
  productionPlan:{authoritative:true,ageMinutes:2,ref:'mes:plan:1',revision:'p7'},
  workforceEligibility:{authoritative:true,ageMinutes:2,ref:'wfm:elig:1',revision:'w4'},
  customerCommitment:{authoritative:true,ageMinutes:3,ref:'erp:order:1',revision:'o8'},
  financialMilestone:{authoritative:true,ageMinutes:4,ref:'erp:ar:1',revision:'f3'}
};
const base={
  action:{actionId:'a1',summary:'Move 2 qualified operators to Line 3 for 4 hours'},
  evidence,
  guardrails:{skillsCovered:true,complianceCovered:true,fatigueSafe:true,qualityProtected:true,safetyProtected:true,deliveryCommitmentsProtected:true},
  orders:[{orderId:'884',baselineCompletionAt:'2026-09-23T17:00:00Z',candidateCompletionAt:'2026-09-20T17:00:00Z',committedAt:'2026-09-24T17:00:00Z',invoiceMilestoneAmount:68000}],
  finance:{annualFundingRate:0.12,additionalLabourCost:420,disruptionCost:0,liquidityProtectionValue:6000}
};

test('qualifies a guarded cash-timing action only when estimated economic value is positive',()=>{
  const result=evaluateCashToCapacityCandidate(base);
  assert.equal(result.status,'qualified');
  assert.equal(result.cashTiming.invoiceMilestoneAmountAdvanced,68000);
  assert.equal(Math.round(result.cashTiming.maxDaysEarlier),3);
  assert.ok(result.economics.estimatedEconomicValue>0);
});

test('does not confuse invoice value moved earlier with economic value',()=>{
  const result=evaluateCashToCapacityCandidate(base);
  assert.notEqual(Math.round(result.economics.estimatedEconomicValue),68000);
  assert.ok(result.economics.financingValue<100);
});

test('rejects an action that creates a new late customer order',()=>{
  const input=structuredClone(base);
  input.orders.push({orderId:'885',baselineCompletionAt:'2026-09-21T12:00:00Z',candidateCompletionAt:'2026-09-23T12:00:00Z',committedAt:'2026-09-22T12:00:00Z',invoiceMilestoneAmount:12000});
  assert.equal(evaluateCashToCapacityCandidate(input).reason,'customer_commitment_risk');
});

test('fails closed when evidence is stale or source revision is missing',()=>{
  const stale=structuredClone(base);stale.evidence.productionPlan.ageMinutes=90;
  assert.equal(evaluateCashToCapacityCandidate(stale).reason,'stale_evidence');
  const missing=structuredClone(base);missing.evidence.financialMilestone.revision='';
  assert.equal(evaluateCashToCapacityCandidate(missing).reason,'missing_source_revision');
});

test('rejects invalid source ages and age limits before qualifying cash advice',()=>{
  for(const age of [-1,null,'0','2',NaN,Infinity,undefined]){
    const input=structuredClone(base);input.evidence.productionPlan.ageMinutes=age;
    assert.equal(evaluateCashToCapacityCandidate(input).reason,'stale_evidence',String(age));
  }
  for(const limit of [-1,null,'15',NaN,Infinity,{},false]){
    const input=structuredClone(base);input.maxEvidenceAgeMinutes=limit;
    assert.equal(evaluateCashToCapacityCandidate(input).reason,'invalid_evidence_age_limit',String(limit));
  }
  const fresh=structuredClone(base);fresh.evidence.productionPlan.ageMinutes=0;
  assert.equal(evaluateCashToCapacityCandidate(fresh).status,'qualified');
});

test('rejects a cash-timing action whose true economic case is negative',()=>{
  const input=structuredClone(base);
  input.finance.liquidityProtectionValue=0;
  const result=evaluateCashToCapacityCandidate(input);
  assert.equal(result.status,'rejected');
  assert.equal(result.reason,'economic_case_below_threshold');
});

test('ranking uses estimated economic value after hard gates',()=>{
  const a=evaluateCashToCapacityCandidate(base);
  const b=evaluateCashToCapacityCandidate({...structuredClone(base),action:{actionId:'a2',summary:'Alternative'},finance:{...base.finance,liquidityProtectionValue:8000}});
  assert.equal(rankCashToCapacityCandidates([a,b])[0].actionId,'a2');
});

