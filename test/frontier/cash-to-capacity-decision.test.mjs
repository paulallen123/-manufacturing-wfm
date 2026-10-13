import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCashToCapacityPresentation,roleView} from '../../src/frontier/cash-to-capacity-decision.mjs';

const good={
  action:{summary:'Move 2 qualified operators to Line 3 for 4 hours'},
  currency:'GBP',
  financial:{invoiceMilestoneAmountAdvanced:68000,additionalLabourCost:420,daysEarlier:3,financingValue:67,liquidityProtectionValue:6000,disruptionCost:0,estimatedEconomicValue:5647},
  safety:{skillsCovered:true,complianceCovered:true,fatigueSafe:true,qualityProtected:true,safetyProtected:true},
  service:{deliveryCommitmentsProtected:true},
  confidence:'High',
  evidence:{
    productionPlan:{authoritative:true,ageMinutes:3,ref:'mes:plan:42',revision:'p7'},
    workforceEligibility:{authoritative:true,ageMinutes:2,ref:'wfm:eligibility:19',revision:'w4'},
    customerCommitment:{authoritative:true,ageMinutes:4,ref:'erp:order:88',revision:'o8'},
    financialMilestone:{authoritative:true,ageMinutes:5,ref:'erp:ar:88',revision:'f3'}
  }
};

test('presents invoice timing and economic value as separate concepts',()=>{
  const result=buildCashToCapacityPresentation(good);
  assert.equal(result.status,'presentable');
  assert.equal(result.card.invoiceMilestoneAmountAdvanced,68000);
  assert.equal(result.card.estimatedEconomicValue,5647);
  assert.notEqual(result.card.invoiceMilestoneAmountAdvanced,result.card.estimatedEconomicValue);
});

test('fails closed when finance evidence is not authoritative',()=>{
  const input=structuredClone(good);
  input.evidence.financialMilestone.authoritative=false;
  const result=buildCashToCapacityPresentation(input);
  assert.equal(result.status,'evidence_incomplete');
  assert.deepEqual(result.missing,['financialMilestone']);
});

test('never presents through safety quality or service breach',()=>{
  const unsafe=structuredClone(good);
  unsafe.safety.skillsCovered=false;
  assert.equal(buildCashToCapacityPresentation(unsafe).status,'blocked');
  const quality=structuredClone(good);
  quality.safety.qualityProtected=false;
  assert.equal(buildCashToCapacityPresentation(quality).status,'blocked');
  const late=structuredClone(good);
  late.service.deliveryCommitmentsProtected=false;
  assert.equal(buildCashToCapacityPresentation(late).reason,'customer_commitment_risk');
});

test('stale evidence suppresses the card',()=>{
  const stale=structuredClone(good);
  stale.evidence.productionPlan.ageMinutes=90;
  assert.equal(buildCashToCapacityPresentation(stale).status,'evidence_incomplete');
});

test('employee view hides finance decision while manager and finance wording stays explicit',()=>{
  const card=buildCashToCapacityPresentation(good).card;
  assert.equal(roleView(card,'employee'),null);
  assert.match(roleView(card,'manager').primary,/invoice milestone/);
  assert.match(roleView(card,'finance').primary,/Estimated economic value/);
  assert.match(roleView(card,'finance').secondary,/not realised/);
});

test('unknown or revoked roles cannot inherit the manager cash view',()=>{
  const card=buildCashToCapacityPresentation(good).card;
  for(const role of ['revoked','unknown','contractor','',null,42,{}]){
    assert.equal(roleView(card,role),null,String(role));
  }
  assert.equal(roleView(card,'operations-director').detailLevel,'cross-site');
  assert.equal(roleView(card,'manager').detailLevel,'manager');
  assert.equal(roleView(card,'finance').detailLevel,'financial');
  for(const role of ['director','operations','supervisor','company-admin','payroll_admin','admin','superuser']){
    assert.equal(roleView(card,role).detailLevel,'manager',role);
  }
});

