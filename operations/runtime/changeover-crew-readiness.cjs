'use strict';

// Advisory consistency of declared changeover and crew receipts; no qualification authority.
const SHA = /^[0-9a-f]{64}$/;
function fail(code) { throw new Error(code); }
function id(x) { return typeof x === 'string' && x.length > 0 && x.length <= 160 && x.trim() === x; }
function instant(x) {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x)) fail('INVALID_INSTANT');
  const n = Date.parse(x);
  if (!Number.isFinite(n) || new Date(n).toISOString() !== x) fail('INVALID_INSTANT');
  return n;
}
function receipt(x, input, asOf) {
  if (!x || typeof x !== 'object' || Array.isArray(x) ||
    !id(x.source) || !id(x.recordId) || !id(x.revision) ||
    typeof x.recordSha256 !== 'string' || !SHA.test(x.recordSha256) ||
    ['tenantId', 'siteId', 'lineId', 'changeoverId'].some(key => x[key] !== input[key]) ||
    x.start !== input.start || x.end !== input.end) fail('RECEIPT_SCOPE_MISMATCH');
  const eventAt = instant(x.eventAt), observedAt = instant(x.observedAt);
  if (eventAt > observedAt || observedAt > asOf) fail('RECEIPT_CHRONOLOGY');
}
function assessChangeoverCrew(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    !['tenantId', 'siteId', 'lineId', 'changeoverId'].every(key => id(input[key]))) fail('INVALID_SCOPE');
  const asOf = instant(input.asOf), start = instant(input.start), end = instant(input.end);
  if (start <= asOf || end <= start || end - start > 86400000) fail('INVALID_WINDOW');
  const plan = input.changeoverPlan, crew = input.crewSnapshot;
  receipt(plan, input, asOf); receipt(crew, input, asOf);
  if (plan.state !== 'APPROVED' || crew.state !== 'PUBLISHED' || crew.complete !== true ||
    plan.source === crew.source || plan.recordSha256 === crew.recordSha256 ||
    !Number.isSafeInteger(plan.requiredHeadcount) || plan.requiredHeadcount < 1 || plan.requiredHeadcount > 100 ||
    !Array.isArray(plan.requiredSkills) || !plan.requiredSkills.length || plan.requiredSkills.length > 100 ||
    !Array.isArray(crew.assignments) || crew.assignments.length > 1000) fail('INVALID_EVIDENCE');
  const required = new Map();
  for (const skill of plan.requiredSkills) {
    if (!skill || !id(skill.skillId) || required.has(skill.skillId) ||
      !Number.isSafeInteger(skill.minimumQualified) || skill.minimumQualified < 1 ||
      skill.minimumQualified > plan.requiredHeadcount) fail('INVALID_SKILL_REQUIREMENT');
    required.set(skill.skillId, skill.minimumQualified);
  }
  const seenWorkers = new Set(), qualified = new Map([...required.keys()].map(key => [key, 0]));
  for (const assignment of crew.assignments) {
    if (!assignment || !id(assignment.workerRef) || seenWorkers.has(assignment.workerRef) ||
      assignment.start !== input.start || assignment.end !== input.end ||
      !Array.isArray(assignment.skills) || assignment.skills.length > 100) fail('INVALID_CREW_ASSIGNMENT');
    seenWorkers.add(assignment.workerRef);
    const seenSkills = new Set();
    for (const skill of assignment.skills) {
      if (!skill || !id(skill.skillId) || seenSkills.has(skill.skillId) ||
        skill.status !== 'VERIFIED' || instant(skill.expiresAt) < end) fail('INVALID_CREW_SKILL');
      seenSkills.add(skill.skillId);
      if (qualified.has(skill.skillId)) qualified.set(skill.skillId, qualified.get(skill.skillId) + 1);
    }
  }
  const skillGaps = Object.freeze([...required].sort(([a], [b]) => a.localeCompare(b))
    .filter(([skillId, count]) => qualified.get(skillId) < count)
    .map(([skillId, count]) => Object.freeze({ skillId, required: count, declaredQualified: qualified.get(skillId) })));
  const headcountGap = Math.max(0, plan.requiredHeadcount - seenWorkers.size);
  return Object.freeze({
    tenantId: input.tenantId, siteId: input.siteId, lineId: input.lineId, changeoverId: input.changeoverId,
    start: input.start, end: input.end, requiredHeadcount: plan.requiredHeadcount,
    declaredCrewCount: seenWorkers.size, headcountGap, skillGaps,
    status: headcountGap || skillGaps.length ? 'DECLARED_GAP' : 'NO_DECLARED_GAP',
    planRecordSha256: plan.recordSha256, crewRecordSha256: crew.recordSha256,
    claimBoundary: 'DECLARED_CHANGEOVER_CREW_COVERAGE_ONLY',
    sourceAuthenticated: false, qualificationAuthority: false, scheduleAuthority: false,
    payrollAuthority: false, executionAuthority: false
  });
}
module.exports = { assessChangeoverCrew };
