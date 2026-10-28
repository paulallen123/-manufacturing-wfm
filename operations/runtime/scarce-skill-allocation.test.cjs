'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assessScarceSkillAllocation } = require('./scarce-skill-allocation.cjs');

const start = '2026-11-02T08:00:00Z';
const end = '2026-11-02T16:00:00Z';
function worker(id, skills, hourlyCost = 20) {
  return { id, type:'EMPLOYEE', status:'ACTIVE', homeSite:'plant-a',
    eligibleSites:['plant-a'], skills, hourlyCost,
    availability:[{start,end}] };
}
function input() {
  return {
    tenant:'tenant-a', site:'plant-a', publishedRevision:'roster-7',
    sourceEvidence:['roster-record-7','skills-record-9','demand-record-4'],
    requirement:{id:'general-shift', site:'plant-a', role:'operator', start,end,
      headcount:1, requiredSkills:['operator']},
    currentAssignments:[{slotId:'general-shift#1', workerId:'specialist', start,end}],
    incumbentWorkerId:'specialist',
    workers:[worker('specialist',['operator','cnc'],25), worker('replacement',['operator'],20)],
    scarceSkillDemand:{tenant:'tenant-a',site:'plant-a',skill:'cnc',start,end,
      requiredCount:2,coveredCount:1,sourceRevision:'demand-4',evidenceRef:'demand-record-4'}
  };
}

test('finds a feasible replacement that frees a scarce skill without execution authority', () => {
  const result=assessScarceSkillAllocation(input());
  assert.equal(result.status,'REVIEW');
  assert.equal(result.replacementWorkerId,'replacement');
  assert.equal(result.incumbentWorkerId,'specialist');
  assert.equal(result.executionPermitted,false);
  assert.equal(result.sourceAuthenticated,false);
  assert.equal(result.expectedSaving,null);
  assert.match(result.assessmentId,/^[a-f0-9]{64}$/);
});

test('does not flag a covered skill or a replacement already holding that scarce skill', () => {
  const covered=input(); covered.scarceSkillDemand.coveredCount=2;
  assert.equal(assessScarceSkillAllocation(covered).status,'NO_OPPORTUNITY');
  const noRelease=input(); noRelease.workers[1].skills.push('cnc');
  assert.equal(assessScarceSkillAllocation(noRelease).status,'NO_OPPORTUNITY');
});

test('rejects mismatched demand scope and slot window', () => {
  const foreign=input(); foreign.scarceSkillDemand.tenant='tenant-b';
  assert.throws(()=>assessScarceSkillAllocation(foreign),/scope/i);
  const otherWindow=input(); otherWindow.scarceSkillDemand.end='2026-11-02T17:00:00Z';
  assert.throws(()=>assessScarceSkillAllocation(otherWindow),/scope/i);
});

test('requires an exact published incumbent assignment and distinct source evidence', () => {
  const missing=input(); missing.currentAssignments=[];
  assert.throws(()=>assessScarceSkillAllocation(missing),/published assignment/i);
  const missingEvidence=input(); missingEvidence.sourceEvidence=['roster-record-7'];
  assert.throws(()=>assessScarceSkillAllocation(missingEvidence),/evidence/i);
});

test('uses scheduler feasibility to block overlapping or unqualified replacements', () => {
  const overlapping=input(); overlapping.currentAssignments.push({slotId:'other#1',workerId:'replacement',start,end});
  assert.equal(assessScarceSkillAllocation(overlapping).status,'NO_OPPORTUNITY');
  const unqualified=input(); unqualified.workers[1].skills=[];
  assert.equal(assessScarceSkillAllocation(unqualified).status,'NO_OPPORTUNITY');
});

test('refuses a requirement list that the scheduler would truncate', () => {
  const oversized=input();
  oversized.requirement.requiredSkills=Array.from({length:101},(_,i)=>`skill-${i}`);
  assert.throws(()=>assessScarceSkillAllocation(oversized),/bounded skill/i);
});
