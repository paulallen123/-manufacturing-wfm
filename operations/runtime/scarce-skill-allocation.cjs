'use strict';

// A read-only review signal. Source authenticity, publication and approval remain
// with the existing roster/skills/demand adapters and scheduling authority.
const {
  normaliseRequirement, normaliseWorker, evaluateOpenShift, digest
} = require('./manufacturing-scheduling-engine.cjs');

const CONTRACT_VERSION='VECTOR_SCARCE_SKILL_ALLOCATION_REVIEW_V1';
function requiredText(value, name) {
  if (typeof value!=='string' || !value.trim() || value.length>180)
    throw new Error(`${name} is required.`);
  return value.trim();
}
function count(value, name) {
  if (!Number.isSafeInteger(value) || value<0)
    throw new Error(`${name} must be a nonnegative integer.`);
  return value;
}
function sameWindow(raw, requirement) {
  try {
    const window=normaliseRequirement({...requirement,start:raw?.start,end:raw?.end});
    return window.start===requirement.start && window.end===requirement.end;
  } catch { return false; }
}
function assessScarceSkillAllocation(input={}) {
  const tenant=requiredText(input.tenant,'tenant');
  const site=requiredText(input.site,'site');
  const publishedRevision=requiredText(input.publishedRevision,'published revision');
  const evidence=input.sourceEvidence;
  if (!Array.isArray(evidence) || evidence.length<3 ||
      evidence.some(ref=>typeof ref!=='string'||!ref.trim()||ref.length>220) ||
      new Set(evidence).size!==evidence.length)
    throw new Error('Distinct roster, skills and demand source evidence is required.');
  if (input.requirement?.headcount!==1 ||
      input.requirement?.planningHeadcount!==undefined && input.requirement.planningHeadcount!==1)
    throw new Error('Exactly one published slot is required.');
  if (!Array.isArray(input.requirement.requiredSkills) ||
      ['requiredSkills','requiredCertifications'].some(key=>
        input.requirement[key]!==undefined &&
        (!Array.isArray(input.requirement[key]) || input.requirement[key].length>100)))
    throw new Error('Complete bounded skill and certification requirements are required.');
  const requirement=normaliseRequirement(input.requirement);
  if (requirement.site!==site || requirement.headcount!==1)
    throw new Error('Requirement scope must match the published site.');
  const slotId=`${requirement.id}#1`;
  const incumbentWorkerId=requiredText(input.incumbentWorkerId,'incumbent worker');
  if (!Array.isArray(input.currentAssignments))
    throw new Error('Exact published assignment is required.');
  const outgoing=input.currentAssignments.filter(a=>a?.slotId===slotId);
  if (outgoing.length!==1 || outgoing[0].workerId!==incumbentWorkerId ||
      !sameWindow(outgoing[0],requirement))
    throw new Error('Exact published assignment is required.');
  const demand=input.scarceSkillDemand;
  const skill=requiredText(demand?.skill,'scarce skill');
  if (demand.tenant!==tenant || demand.site!==site ||
      !sameWindow(demand,requirement))
    throw new Error('Scarce skill demand scope and slot window must match.');
  const requiredCount=count(demand.requiredCount,'required count');
  const coveredCount=count(demand.coveredCount,'covered count');
  const demandRevision=requiredText(demand.sourceRevision,'demand source revision');
  const demandEvidenceRef=requiredText(demand.evidenceRef,'demand evidence reference');
  if (!evidence.includes(demandEvidenceRef))
    throw new Error('Demand evidence must be in the source evidence set.');
  if (!Array.isArray(input.workers) || !input.workers.length)
    throw new Error('Worker evidence is required.');
  const workers=input.workers.map(normaliseWorker);
  if (new Set(workers.map(w=>w.id)).size!==workers.length)
    throw new Error('Worker ids must be unique.');
  const incumbent=workers.find(w=>w.id===incumbentWorkerId);
  if (!incumbent) throw new Error('Incumbent worker evidence is required.');
  const remaining=input.currentAssignments.filter(a=>a.slotId!==slotId);
  // The scheduler performs the existing skill, certification, availability,
  // fatigue, rest, policy and overlap checks. No second eligibility engine.
  const evaluation=evaluateOpenShift({requirement:input.requirement,workers:input.workers,
    currentAssignments:remaining,policy:input.policy});
  const incumbentCheck=evaluation.ranked.find(r=>r.workerId===incumbentWorkerId);
  const replacement=requiredCount>coveredCount && incumbent.skills.includes(skill) &&
    incumbentCheck?.eligible
    ? evaluation.ranked.find(r=>r.workerId!==incumbentWorkerId && r.eligible &&
        !workers.find(w=>w.id===r.workerId).skills.includes(skill))
    : null;
  const identity={contractVersion:CONTRACT_VERSION,tenant,site,publishedRevision,
    slotId,incumbentWorkerId,skill,requiredCount,coveredCount,demandRevision,
    demandEvidenceRef,sourceEvidence:[...evidence].sort(),
    replacementWorkerId:replacement?.workerId??null};
  return Object.freeze({
    ...identity,assessmentId:digest(identity),
    status:replacement?'REVIEW':'NO_OPPORTUNITY',
    replacementWorkerId:replacement?.workerId??null,
    executionPermitted:false,sourceAuthenticated:false,expectedSaving:null,
    claimBoundary:'SOURCE_UNAUTHENTICATED_REVIEW_ONLY_NO_SCHEDULE_CHANGE'
  });
}

module.exports=Object.freeze({CONTRACT_VERSION,assessScarceSkillAllocation});
