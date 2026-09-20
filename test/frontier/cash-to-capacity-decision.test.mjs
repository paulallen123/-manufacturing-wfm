import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCashToCapacityPresentation,roleView} from '../../src/frontier/cash-to-capacity-decision.mjs';

const good={
  action:{summary:'Move 2 qualified operators to Line 3 for 4 hours'},
  financial:{cashReleasedEarlier:68000,additionalLabourCost:420,daysEarlier:3},
  safety:{skillsCovered:true,complianceCovered:true,fatigueSafe:true},
  service:{deliveryCommitmentsProtected:true},
  confidence:'High',
  evidence:{
    productionPlan:{authoritative:true,ageMinutes:3,ref:'mes:plan:42'},
    workforceEligibility:{authoritative:true,ageMinutes:2,ref:'wfm:eligibility:19'},
    customerCommitment:{authoritative:true,ageMinutes:4,ref:'erp:order:88'},
    financialMilestone:{authoritative:true,ageMinutes:5,ref:'erp:ar:88'}
  }
};

test('presents only when all required evidence and operational guards pass',()=>{
  const result=buildCashToCapacityPresentation(good);
  assert.equal(result.status,'presentable');
  assert.equal(result.card.cashReleasedEarlier,68000);
  assert.equal(result.card.deliveryProtected,true);
});

test('fails closed when finance evidence is not authoritative',()=>{
  const input=structuredClone(good);
  input.evidence.financialMilestone.authoritative=false;
  const result=buildCashToCapacityPresentation(input);
  assert.equal(result.status,'evidence_incomplete');
  assert.deepEqual(result.missing,['financialMilestone']);
});

test('never presents a cash recommendation through a safety or service breach',()=>{
  const unsafe=structuredClone(good);
  unsafe.safety.skillsCovered=false;
  assert.equal(buildCashToCapacityPresentation(unsafe).status,'blocked');
  const late=structuredClone(good);
  late.service.deliveryCommitmentsProtected=false;
  assert.equal(buildCashToCapacityPresentation(late).reason,'customer_commitment_risk');
});

test('stale evidence suppresses the card',()=>{
  const stale=structuredClone(good);
  stale.evidence.productionPlan.ageMinutes=90;
  assert.equal(buildCashToCapacityPresentation(stale).status,'evidence_incomplete');
});

test('employee view never exposes finance decision card',()=>{
  const card=buildCashToCapacityPresentation(good).card;
  assert.equal(roleView(card,'employee'),null);
  assert.match(roleView(card,'manager').primary,/£68,000/);
  assert.match(roleView(card,'finance').headline,/3 days earlier/);
});
