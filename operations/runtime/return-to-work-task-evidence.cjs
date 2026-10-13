'use strict';

// Advisory evidence check only. The scheduling authority must independently
// authenticate the source and decide whether an assignment may be published.
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const normalized = new Date(time).toISOString();
  const [date, clock] = value.split('T');
  if (normalized.slice(0, 10) !== date || normalized.slice(11, 19) !== clock.slice(0, 8)) return null;
  return time;
}

function assessReturnToWorkTaskEvidence({ assignment, evidence, observedAt } = {}) {
  const reasons = [];
  const at = instant(observedAt);
  const start = instant(assignment?.start);
  const end = instant(assignment?.end);
  if (at === null || start === null || end === null || end <= start || at > start) reasons.push('INVALID_OBSERVATION_OR_ASSIGNMENT_TIME');
  for (const key of ['workerId', 'taskId', 'site', 'assignmentRevision']) {
    if (typeof assignment?.[key] !== 'string' || !assignment[key].trim()) reasons.push('MISSING_ASSIGNMENT_' + key.toUpperCase());
  }
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) reasons.push('MISSING_TASK_EVIDENCE');
  else {
    for (const key of ['workerId', 'taskId', 'site', 'assignmentRevision']) {
      if (evidence[key] !== assignment?.[key]) reasons.push('EVIDENCE_SCOPE_MISMATCH_' + key.toUpperCase());
    }
    if (typeof evidence.sourceRef !== 'string' || !evidence.sourceRef.trim()) reasons.push('MISSING_SOURCE_REFERENCE');
    if (typeof evidence.approverRef !== 'string' || !evidence.approverRef.trim() || evidence.approverRef === assignment?.workerId) reasons.push('MISSING_INDEPENDENT_APPROVER');
    if (evidence.taskControlsConfirmed !== true) reasons.push('TASK_CONTROLS_UNCONFIRMED');
    if (evidence.restrictionsResolved !== true) reasons.push('TASK_RESTRICTIONS_UNRESOLVED');
    const effectiveFrom = instant(evidence.effectiveFrom), effectiveTo = instant(evidence.effectiveTo);
    if (at === null || start === null || end === null || effectiveFrom === null || effectiveTo === null ||
        effectiveFrom > at || effectiveFrom > start || effectiveTo < end || effectiveTo <= effectiveFrom)
      reasons.push('TASK_EVIDENCE_NOT_CURRENT_FOR_ASSIGNMENT');
  }
  return Object.freeze({
    evidenceGate: reasons.length ? 'BLOCKED' : 'EVIDENCE_COMPLETE_UNVERIFIED',
    reasons: Object.freeze(reasons),
    assignmentPermitted: false,
    claimBoundary: 'Evidence shape and exact task interval only; source, approver, restrictions and current scheduling authority require independent verification.'
  });
}

module.exports = Object.freeze({ assessReturnToWorkTaskEvidence });
