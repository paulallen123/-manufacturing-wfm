'use strict';
const { WORKFLOWS } = require('./workflow-action-evidence-contract.cjs');

const ID = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/;
const id = value => typeof value === 'string' && ID.test(value);
const timestamp = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:00\.000Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
};
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && Object.keys(value).every(key => fields.includes(key));
const scope = ['tenantId', 'siteId'];
const rootFields = [...scope, 'windowStart', 'windowEnd', 'asOf', 'sourceKind', 'sourceId',
  'sourceRevision', 'evidenceRef', 'complete', 'events'];
const eventFields = [...scope, 'actionId', 'workflow', 'sourceRevision',
  'startedAt', 'endedAt', 'observedAt', 'evidenceRef', 'recordSha256'];

// An aggregate of caller-declared manual intervals from the existing workflow
// families. It does not authenticate audit records or establish cost/savings.
module.exports = function assessAdminTouchEvidence(input) {
  const blocked = reason => ({ status: 'BLOCKED', reason, sourceAuthenticated: false,
    executionAuthority: false, claimedSavingsPence: null });
  if (!exact(input, rootFields) || !scope.every(key => id(input[key])) ||
      input.sourceKind !== 'WORKFLOW_AUDIT' || !id(input.sourceId) ||
      !id(input.sourceRevision) || !id(input.evidenceRef) || input.complete !== true ||
      !Array.isArray(input.events) || input.events.length > 10000) return blocked('SOURCE_INVALID');
  const start = timestamp(input.windowStart), end = timestamp(input.windowEnd), asOf = timestamp(input.asOf);
  if (start === null || end === null || asOf === null || !(start < end && end <= asOf))
    return blocked('WINDOW_INVALID');
  const ids = new Set(), refs = new Set(), hashes = new Set(), intervals = [], seenWorkflows = new Set();
  const minutesByWorkflow = Object.fromEntries(WORKFLOWS.map(kind => [kind, 0]));
  const eventEvidence = [];
  for (const event of input.events) {
    if (!exact(event, eventFields) || !scope.every(key => event[key] === input[key]) ||
        !id(event.actionId) || !id(event.evidenceRef) ||
        !WORKFLOWS.includes(event.workflow) || event.sourceRevision !== input.sourceRevision ||
        typeof event.recordSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(event.recordSha256))
      return blocked('EVENT_INVALID');
    const from = timestamp(event.startedAt), until = timestamp(event.endedAt), observed = timestamp(event.observedAt);
    if (from === null || until === null || observed === null ||
        !(start <= from && from < until && until <= end && until <= observed && observed <= asOf) ||
        until - from > 8 * 60 * 60000) return blocked('EVENT_TIME_INVALID');
    if (ids.has(event.actionId) || refs.has(event.evidenceRef) || hashes.has(event.recordSha256) ||
        event.evidenceRef === input.evidenceRef) return blocked('DUPLICATE_EVIDENCE');
    ids.add(event.actionId); refs.add(event.evidenceRef); hashes.add(event.recordSha256);
    intervals.push([from, until]);
    seenWorkflows.add(event.workflow);
    minutesByWorkflow[event.workflow] += (until - from) / 60000;
    eventEvidence.push({ workflow: event.workflow, recordSha256: event.recordSha256 });
  }
  intervals.sort((a, b) => a[0] - b[0]);
  if (intervals.some((interval, index) => index > 0 && interval[0] < intervals[index - 1][1]))
    return blocked('INTERVAL_OVERLAP');
  const declaredTouchMinutes = Object.values(minutesByWorkflow).reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(declaredTouchMinutes)) return blocked('EFFORT_OVERFLOW');
  eventEvidence.sort((a, b) => a.recordSha256 < b.recordSha256 ? -1 : a.recordSha256 > b.recordSha256 ? 1 : 0);
  return { status: 'REVIEW_DECLARED_EFFORT', ...Object.fromEntries(scope.map(key => [key, input[key]])),
    windowStart: input.windowStart, windowEnd: input.windowEnd, asOf: input.asOf,
    sourceId: input.sourceId, sourceRevision: input.sourceRevision, evidenceRef: input.evidenceRef,
    actionCount: input.events.length, distinctWorkflowCount: seenWorkflows.size,
    declaredTouchMinutes, minutesByWorkflow, eventEvidence,
    claimBoundary: 'SUPPLIED_MANUAL_INTERVALS_ONLY', sourceAuthenticated: false,
    executionAuthority: false, claimedSavingsPence: null };
};
