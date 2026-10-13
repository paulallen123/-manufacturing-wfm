import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateImpairmentRecoveryPlan,assessHotWorkCoverage} from '../../src/frontier/loss-prevention-workforce.mjs';

const evidence={
  impairment:{authoritative:true,ref:'bms:zone-a',revision:'i7',ageMinutes:2},
  policy:{authoritative:true,ref:'site:loss-prevention',revision:'p4',ageMinutes:4},
  workforce:{authoritative:true,ref:'wfm:shift-2',revision:'w9',ageMinutes:1},
  restorationPlan:{authoritative:true,ref:'cmms:wo-88',revision:'r3',ageMinutes:3}
};
const workers=[
  {id:'fw1',siteId:'s1',available:true,competencies:['fire_watch'],competencyCurrent:true},
  {id:'fw2',siteId:'s1',available:true,competencies:['fire_watch'],competencyCurrent:true},
  {id:'m1',siteId:'s1',available:true,competencies:['sprinkler_maintenance'],competencyCurrent:true},
  {id:'other',siteId:'s2',available:true,competencies:['fire_watch','sprinkler_maintenance'],competencyCurrent:true}
];
const base={
  siteId:'s1',evidence,workers,
  impairment:{siteId:'s1',state:'impaired'},
  policy:{siteId:'s1',controlRole:'fire_watch',requiredControlHeadcount:2},
  baseline:{restoreMinutes:420},
  restorationOption:{siteId:'s1',preApproved:true,restoreMinutes:90,additionalPersonMinutes:60,displacedProductionPersonMinutes:120,requiredCompetencies:['sprinkler_maintenance']},
  guardrails:{customerCommitmentsProtected:true,processSafetyProtected:true,qualityProtected:true}
};

test('qualifies earlier safe restoration when released control capacity exceeds displacement',()=>{
  const r=evaluateImpairmentRecoveryPlan(base);
  assert.equal(r.status,'qualified');
  assert.equal(r.exposureMinutesReduced,330);
  assert.equal(r.controlPersonMinutesReleased,660);
  assert.equal(r.netProductivePersonMinutes,480);
});

test('fails closed if mandatory control coverage is missing',()=>{
  const input=structuredClone(base);input.workers=input.workers.filter(w=>w.id!=='fw2');
  const r=evaluateImpairmentRecoveryPlan(input);
  assert.equal(r.status,'restricted');
  assert.equal(r.reason,'mandatory_control_coverage_gap');
});

test('never borrows competence silently from another site',()=>{
  const input=structuredClone(base);input.workers=input.workers.filter(w=>w.id!=='m1');
  const r=evaluateImpairmentRecoveryPlan(input);
  assert.equal(r.reason,'restoration_competence_gap');
});

test('stale impairment evidence blocks the recommendation',()=>{
  const input=structuredClone(base);input.evidence.impairment.ageMinutes=90;
  const r=evaluateImpairmentRecoveryPlan(input);
  assert.equal(r.reason,'stale_evidence');
});

test('invalid evidence ages and limits cannot qualify an impairment plan',()=>{
  for(const age of [-1,null,'',Number.POSITIVE_INFINITY]){
    const input=structuredClone(base);input.evidence.impairment.ageMinutes=age;
    assert.equal(evaluateImpairmentRecoveryPlan(input).status,'blocked',String(age));
  }
  for(const limit of [-1,Number.POSITIVE_INFINITY]){
    const input=structuredClone(base);input.maxEvidenceAgeMinutes=limit;
    assert.equal(evaluateImpairmentRecoveryPlan(input).status,'blocked',String(limit));
  }
});

test('fractional policy headcounts cannot qualify or claim hot-work coverage',()=>{
  const input=structuredClone(base);input.policy.requiredControlHeadcount=1.5;
  assert.equal(evaluateImpairmentRecoveryPlan(input).reason,'invalid_control_policy');
  const hotWork=assessHotWorkCoverage({siteId:'s1',policy:{siteId:'s1',fireWatchRole:'fire_watch',fireWatchHeadcount:1.5},workers,task:{siteId:'s1',hotWork:true,assignedWorkerId:'m1'}});
  assert.equal(hotWork.reason,'invalid_fire_watch_policy');
});

test('overflowed person-minute calculations cannot qualify a restoration option',()=>{
  const input=structuredClone(base);
  input.baseline.restoreMinutes=1e308;
  input.restorationOption.restoreMinutes=0;
  assert.equal(evaluateImpairmentRecoveryPlan(input).status,'blocked');
});

test('duplicate or anonymous worker rows cannot fill distinct control roles',()=>{
  const input=structuredClone(base);
  input.workers=[input.workers[0],structuredClone(input.workers[0]),input.workers[2]];
  assert.equal(evaluateImpairmentRecoveryPlan(input).reason,'mandatory_control_coverage_gap');
  const hotWork=assessHotWorkCoverage({siteId:'s1',policy:{siteId:'s1',fireWatchRole:'fire_watch',fireWatchHeadcount:2},workers:input.workers,task:{siteId:'s1',hotWork:true,assignedWorkerId:'m1'}});
  assert.equal(hotWork.reason,'fire_watch_gap');
  input.workers[1].id='';
  assert.equal(evaluateImpairmentRecoveryPlan(input).reason,'mandatory_control_coverage_gap');
});

test('one worker cannot be both hot worker and fire watch when site policy prohibits dual role',()=>{
  const one=[{id:'solo',siteId:'micro',available:true,competencies:['welder','fire_watch'],competencyCurrent:true}];
  const r=assessHotWorkCoverage({siteId:'micro',policy:{siteId:'micro',fireWatchRole:'fire_watch',fireWatchHeadcount:1,dualRoleProhibited:true},workers:one,task:{siteId:'micro',hotWork:true,assignedWorkerId:'solo'}});
  assert.equal(r.status,'blocked');
  assert.equal(r.reason,'fire_watch_gap');
});

test('hot-work coverage remains site scoped',()=>{
  const r=assessHotWorkCoverage({siteId:'s1',policy:{siteId:'s1',fireWatchRole:'fire_watch',fireWatchHeadcount:2,dualRoleProhibited:true},workers,task:{siteId:'s1',hotWork:true,assignedWorkerId:'m1'}});
  assert.equal(r.status,'covered');
  assert.deepEqual(r.workerIds,['fw1','fw2']);
});
