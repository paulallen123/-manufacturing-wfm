import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAgencyWorkerCapabilityPassport,
  applyVerifiedCapabilityProgression,
} from '../../src/frontier/agency-worker-passport.mjs';
import {
  rankAgencyWorkersContextually,
  rankAgencySuppliersByRealisedOutcome,
  simulateFlexibleLabourOptions,
  assessAgencyAutonomyAuthority,
} from '../../src/frontier/agency-operations-intelligence.mjs';
import {
  createAgencyDecisionRecord,
  appendAgencyDecisionOutcome,
  verifyAgencyDecisionRecord,
} from '../../src/frontier/agency-decision-ledger.mjs';
import { runAgencyOperatingSystem } from '../../src/frontier/agency-operating-system.mjs';

const START='2026-09-21T06:00:00.000Z';
const END='2026-09-21T14:00:00.000Z';

function request(){
  return {
    requestId:'REQ-AOS-1',
    hirerName:'Synthetic Manufacturing Ltd',
    businessNature:'Food packaging',
    siteId:'site-1',
    roleId:'PACK-OP',
    roleName:'Packing Operative',
    duties:'Operate and inspect packing line',
    location:'Plant 1, Birmingham',
    startAt:START,
    endAt:END,
    expectedDuration:'1 shift',
    daysAndHours:'Monday 06:00-14:00',
    durationHours:8,
    count:1,
    requiredSkills:[{id:'packing',level:1}],
    requiredQualifications:[{id:'food-safety',level:1}],
    healthSafetyRisks:[{id:'machinery',severity:'medium'}],
    controlMeasures:['guarding','site induction'],
    expenses:{},
    payAndConditions:{shiftPremium:0},
    maxChargePerHour:30,
    targetCostPerGoodUnit:0.3,
    standardRole:true,
    industrialActionReplacement:false,
    shiftType:'day',
  };
}

function agency(id,reliability=.9){
  return {
    agencyId:id,
    approved:true,
    active:true,
    responseSlaMinutes:5,
    performance:{fillReliability:reliability},
  };
}

function worker(id,agencyId,overrides={}){
  return {
    workerId:id,
    agencyId,
    consentToShare:true,
    available:true,
    siteReady:true,
    restCompliant:true,
    suitabilityStatus:'suitable',
    availability:{startAt:'2026-09-21T05:00:00.000Z',endAt:'2026-09-21T15:00:00.000Z'},
    inductionValidUntil:'2026-12-31T23:59:59.000Z',
    rightToWork:{status:'verified',validUntil:'2027-12-31T23:59:59.000Z'},
    skills:[{id:'packing',level:2,verified:true}],
    qualifications:[{id:'food-safety',level:1,status:'valid',validUntil:'2027-12-31T23:59:59.000Z'}],
    awr:{weeksInSameRole:4,equalTreatmentConfirmed:false},
    chargeRatePerHour:22,
    preferences:{preferredSiteIds:['site-1'],preferredRoleIds:['PACK-OP'],preferredShiftTypes:['day'],repeatAssignmentsPreferred:true},
    performance:{completedShifts:30,attendanceRate:.98,punctualityRate:.97,qualityScore:.96,productivityScore:.95,completedSiteShifts:18,completedRoleShifts:20},
    ...overrides,
  };
}

test('worker capability passport recognises verified capability and does not punish optional declines',()=>{
  const w=worker('W1','A1',{age:61,sex:'female',ethnicity:'x'});
  const passport=buildAgencyWorkerCapabilityPassport({
    worker:w,
    assignments:[
      {workerId:'W1',status:'completed',siteId:'site-1',roleId:'PACK-OP',lineId:'L1',endAt:'2026-09-15T14:00:00.000Z'},
      {workerId:'W1',status:'completed',siteId:'site-1',roleId:'PACK-OP',lineId:'L1',endAt:'2026-09-16T14:00:00.000Z'},
    ],
    outcomes:[
      {workerId:'W1',type:'optional_shift_declined'},
      {workerId:'W1',type:'optional_shift_declined'},
      {workerId:'W1',type:'shift_accepted'},
      {workerId:'W1',type:'shift_attended'},
      {workerId:'W1',type:'shift_on_time'},
    ],
    context:{siteId:'site-1',roleId:'PACK-OP',lineId:'L1'},
    now:'2026-09-18T12:00:00.000Z',
  });
  assert.equal(passport.capabilityGraph.reliability.attendanceRate,1);
  assert.equal(passport.capabilityGraph.reliability.optionalShiftDeclines,2);
  assert.equal(passport.workerChoiceBoundary,'declining_an_optional_offer_is_not_a_reliability_failure');
  assert.ok(passport.ignoredSensitiveFields.includes('age'));
  assert.ok(passport.ignoredSensitiveFields.includes('sex'));
  assert.equal(passport.capabilityGraph.siteFamiliarity.completed,2);
});

test('verified training can increase portable capability while unverified claims cannot',()=>{
  const passport=buildAgencyWorkerCapabilityPassport({
    worker:worker('W1','A1'),
    context:{siteId:'site-1',roleId:'PACK-OP'},
    now:'2026-09-18T12:00:00.000Z',
  });
  const rejected=applyVerifiedCapabilityProgression(passport,{skillId:'line-changeover',level:2});
  assert.equal(rejected.progressionApplied,false);
  const progressed=applyVerifiedCapabilityProgression(passport,{
    skillId:'line-changeover',
    level:2,
    assessmentPassed:true,
    evidenceRef:'synthetic:assessment-1',
  });
  assert.equal(progressed.progressionApplied,true);
  assert.ok(progressed.capabilityGraph.verifiedSkills.some(x=>x.id==='line-changeover'&&x.level===2));
});

test('contextual worker ranking never promotes a hard-gate failure and gives new eligible workers a bounded exploration route',()=>{
  const agencies=[agency('A1'),agency('A2')];
  const good=worker('GOOD','A1');
  const newcomer=worker('NEW','A2',{
    performance:{completedShifts:0,attendanceRate:.5,punctualityRate:.5,qualityScore:.5,productivityScore:.5,completedSiteShifts:0,completedRoleShifts:0},
  });
  const blocked=worker('BLOCK','A1',{restCompliant:false,chargeRatePerHour:10});
  const passports=[good,newcomer,blocked].map(w=>buildAgencyWorkerCapabilityPassport({
    worker:w,
    context:{siteId:'site-1',roleId:'PACK-OP'},
    now:'2026-09-18T12:00:00.000Z',
  }));
  const ranked=rankAgencyWorkersContextually({
    workers:[good,newcomer,blocked],
    agencies,
    request:request(),
    policy:{tenantId:'tenant-1',newWorkerExplorationBonus:.02},
    now:'2026-09-18T12:00:00.000Z',
    passports,
  });
  assert.equal(ranked[0].workerId,'GOOD');
  assert.equal(ranked.find(x=>x.workerId==='BLOCK').eligible,false);
  assert.ok(ranked.find(x=>x.workerId==='NEW').components.newWorkerExploration>0);
});

test('supplier intelligence can prefer better realised operational outcomes over lower charge alone',()=>{
  const agencies=[agency('A1'),agency('A2')];
  const events=[
    {agencyId:'A1',type:'request_sent'},{agencyId:'A1',type:'request_filled',preferredWorker:true},
    {agencyId:'A1',type:'shift_completed',chargeRatePerHour:24},
    {agencyId:'A1',type:'agency_response',responseMinutes:4},
    {agencyId:'A1',type:'invoice_matched'},
    {agencyId:'A1',type:'production_outcome',goodUnits:1000,totalUnits:1020,labourCost:192,productionFailure:false},
    {agencyId:'A1',type:'first_shift_outcome',success:true},
    {agencyId:'A1',type:'repeat_worker_outcome',success:true},
    {agencyId:'A2',type:'request_sent'},{agencyId:'A2',type:'request_filled',preferredWorker:true},
    {agencyId:'A2',type:'shift_completed',chargeRatePerHour:18},
    {agencyId:'A2',type:'agency_response',responseMinutes:8},
    {agencyId:'A2',type:'invoice_review_required'},
    {agencyId:'A2',type:'production_outcome',goodUnits:700,totalUnits:1000,labourCost:144,productionFailure:true},
    {agencyId:'A2',type:'first_shift_outcome',success:false},
    {agencyId:'A2',type:'repeat_worker_outcome',success:false},
  ];
  const ranked=rankAgencySuppliersByRealisedOutcome({agencies,events,request:request(),now:'2026-09-18T12:00:00.000Z'});
  assert.equal(ranked[0].agencyId,'A1');
  assert.ok(ranked[0].outcomeScore>ranked[1].outcomeScore);
  assert.equal(ranked[0].explanation,'supplier_order_uses_realised_operational_outcomes_not_rate_or_fill_alone');
});

test('stochastic simulation is deterministic and can prefer the safer risk-adjusted option',()=>{
  const options=[
    {id:'cheap-risky',fillProbability:.6,qualityPassProbability:.9,productivityFactor:1,productivityVariance:.1,labourCost:200,productionValue:5000,shortageCost:5000,qualityFailureCost:1000},
    {id:'mixed-safe',fillProbability:.97,qualityPassProbability:.97,productivityFactor:.98,productivityVariance:.03,labourCost:450,productionValue:5000,shortageCost:5000,qualityFailureCost:1000},
  ];
  const a=simulateFlexibleLabourOptions({options,seed:'proof-seed',runs:1200,riskPenalty:.4});
  const b=simulateFlexibleLabourOptions({options,seed:'proof-seed',runs:1200,riskPenalty:.4});
  assert.deepEqual(a,b);
  assert.equal(a[0].id,'mixed-safe');
  assert.ok(a[0].serviceSuccessProbability>a[1].serviceSuccessProbability);
});

test('autonomy is bounded by policy, confidence, reversibility, data and risk',()=>{
  const auto=assessAgencyAutonomyAuthority({
    compliancePass:true,withinPolicy:true,confidence:.97,minimumConfidence:.92,
    reversible:true,highRisk:false,adverseEmploymentImpact:false,dataQuality:.98,minimumDataQuality:.9,
  });
  assert.equal(auto.executeAutomatically,true);
  const held=assessAgencyAutonomyAuthority({
    compliancePass:true,withinPolicy:true,confidence:.99,reversible:true,
    highRisk:true,adverseEmploymentImpact:false,dataQuality:1,
  });
  assert.equal(held.executeAutomatically,false);
  assert.ok(held.reasons.includes('high_risk_decision'));
});

test('decision record preserves decision-time evidence when outcome is appended',()=>{
  const record=createAgencyDecisionRecord({
    tenantId:'tenant-1',
    decisionId:'D1',
    decidedAt:'2026-09-18T12:00:00.000Z',
    alternatives:[{id:'a',riskAdjustedValue:10},{id:'b',riskAdjustedValue:8}],
    selectedAlternativeId:'a',
    evidence:{source:'synthetic'},
    policy:{approvalRequired:true},
    modelVersions:{ops:'v1'},
    approval:{status:'approved'},
  });
  assert.equal(verifyAgencyDecisionRecord(record).valid,true);
  const closed=appendAgencyDecisionOutcome(record,{
    recordedAt:'2026-09-21T15:00:00.000Z',
    production:{goodUnits:1000},
    labourCost:{actual:400},
    realisedValue:7000,
    attributionQuality:'reviewed',
  });
  assert.equal(closed.decisionHash,record.decisionHash);
  assert.equal(record.outcome,null);
  assert.equal(verifyAgencyDecisionRecord(closed).outcomeHashValid,true);
  assert.throws(()=>appendAgencyDecisionOutcome(closed,{}),/already_recorded/);
});

test('agency operating system exposes operations, agency and worker experiences as one closed loop',()=>{
  const input={
    now:'2026-09-18T12:00:00.000Z',
    tenantId:'tenant-1',
    siteId:'site-1',
    decisionId:'D-AOS-1',
    request:request(),
    agencies:[agency('A1')],
    candidates:[worker('W1','A1')],
    assignmentHistory:[{workerId:'W1',status:'completed',siteId:'site-1',roleId:'PACK-OP',lineId:'L1',endAt:'2026-09-16T14:00:00.000Z'}],
    workerOutcomes:[
      {workerId:'W1',type:'shift_accepted'},
      {workerId:'W1',type:'shift_attended'},
      {workerId:'W1',type:'shift_on_time'},
    ],
    agencyEvents:[
      {agencyId:'A1',type:'request_sent'},
      {agencyId:'A1',type:'request_filled',preferredWorker:true},
      {agencyId:'A1',type:'shift_completed',chargeRatePerHour:22},
      {agencyId:'A1',type:'invoice_matched'},
      {agencyId:'A1',type:'production_outcome',goodUnits:1000,totalUnits:1010,labourCost:176,productionFailure:false},
    ],
    operationalOptions:[
      {id:'agency_only',fillProbability:.94,qualityPassProbability:.96,productivityFactor:.95,productivityVariance:.05,labourCost:176,productionValue:5000,shortageCost:4000,qualityFailureCost:800},
      {id:'mixed_internal_agency',fillProbability:.99,qualityPassProbability:.98,productivityFactor:1,productivityVariance:.02,labourCost:250,productionValue:5000,shortageCost:4000,qualityFailureCost:800},
    ],
    policy:{
      parallelAgencies:1,
      responseSlaMinutes:5,
      autoDispatchApprovedAgencies:true,
      withinAuthority:true,
      reversibleAgencyDispatch:true,
      minimumAutoConfidence:.9,
      minimumDataQuality:.9,
    },
    dataQuality:.99,
  };
  const result=runAgencyOperatingSystem(input);
  assert.equal(result.operatingModel,'production_to_flexible_labour_closed_loop');
  assert.equal(result.status,'decision_ready');
  assert.ok(result.experiences.operations.sees.includes('demand_gap'));
  assert.equal(result.experiences.agency.requestId,'REQ-AOS-1');
  assert.equal(result.experiences.workers[0].workerId,'W1');
  assert.equal(result.decisionRecord.selectedAlternativeId,result.recommendation.id);
  assert.ok(result.hardBoundaries.includes('optional_shift_declines_do_not_reduce_worker_reliability'));
  assert.equal(typeof result.reproducibilityHash,'string');
});
