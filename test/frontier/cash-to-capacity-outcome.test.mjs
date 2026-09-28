import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileCashToCapacityOutcome,learningSummary} from '../../src/frontier/cash-to-capacity-outcome.mjs';

const base={
  decision:{decisionId:'d1'},
  prediction:{estimatedEconomicValue:5600,daysEarlier:3},
  operationalOutcome:{authoritative:true,productionCompleted:true,customerCommitmentMet:true,ref:'mes:actual:884'},
  financialOutcome:{authoritative:true,realisedEconomicValue:5100,actualDaysEarlier:2,ref:'erp:payment:884'}
};

test('keeps realised outcome distinct from the prediction',()=>{
  const r=reconcileCashToCapacityOutcome(base);
  assert.equal(r.status,'reconciled');
  assert.equal(r.prediction.economicValue,5600);
  assert.equal(r.realised.economicValue,5100);
  assert.equal(r.calibration.valueError,-500);
});

test('refuses to learn from non-authoritative financial outcomes',()=>{
  const input=structuredClone(base);input.financialOutcome.authoritative=false;
  assert.equal(reconcileCashToCapacityOutcome(input).reason,'financial_outcome_not_authoritative');
});

test('learning summary is evidence-only and cannot mutate decision authority',()=>{
  const r=reconcileCashToCapacityOutcome(base);
  const s=learningSummary([r]);
  assert.equal(s.status,'evidence_only');
  assert.equal(s.count,1);
  assert.equal(s.meanAbsoluteValueError,500);
});
