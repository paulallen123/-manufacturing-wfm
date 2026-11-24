'use strict';
const { types } = require('node:util');
const { WORKFLOWS } = require('./workflow-action-evidence-contract.cjs');

const ID = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/;
const id = value => typeof value === 'string' && ID.test(value);
const timestamp = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:00\.000Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
};
const scope = ['tenantId', 'siteId'];
const rootFields = [...scope, 'windowStart', 'windowEnd', 'asOf', 'sourceKind', 'sourceId',
  'sourceRevision', 'evidenceRef', 'complete', 'events'];
const eventFields = [...scope, 'actionId', 'workflow', 'sourceRevision',
  'startedAt', 'endedAt', 'observedAt', 'evidenceRef', 'recordSha256'];

function snapshotObject(value, fields) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key))) return null;
    const snapshot = {};
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) return null;
      snapshot[field] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}
function snapshotEvents(value) {
  try {
    if (!Array.isArray(value) || types.isProxy(value) || value.length > 10000) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || keys.at(-1) !== 'length') return null;
    const events = [];
    for (let index = 0; index < value.length; index++) {
      if (keys[index] !== String(index)) return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) return null;
      const event = snapshotObject(descriptor.value, eventFields);
      if (!event) return null;
      events.push(event);
    }
    return Object.freeze(events);
  } catch {
    return null;
  }
}

module.exports = function assessAdminTouchEvidence(input) {
  const blocked = reason => ({ status: 'BLOCKED', reason, sourceAuthenticated: false,
    executionAuthority: false, claimedSavingsPence: null });
  const root = snapshotObject(input, rootFields);
  const events = root && snapshotEvents(root.events);
  if (!root || !events || !scope.every(key => id(root[key])) ||
      root.sourceKind !== 'WORKFLOW_AUDIT' || !id(root.sourceId) ||
      !id(root.sourceRevision) || !id(root.evidenceRef) || root.complete !== true) return blocked('SOURCE_INVALID');
  const snapshot = Object.freeze({ ...root, events });
  const start = timestamp(snapshot.windowStart), end = timestamp(snapshot.windowEnd), asOf = timestamp(snapshot.asOf);
  if (start === null || end === null || asOf === null || !(start < end && end <= asOf))
    return blocked('WINDOW_INVALID');
  const ids = new Set(), refs = new Set(), hashes = new Set(), intervals = [], seenWorkflows = new Set();
  const minutesByWorkflow = Object.fromEntries(WORKFLOWS.map(kind => [kind, 0]));
  const eventEvidence = [];
  for (const event of snapshot.events) {
    if (!scope.every(key => event[key] === snapshot[key]) ||
        !id(event.actionId) || !id(event.evidenceRef) ||
        !WORKFLOWS.includes(event.workflow) || event.sourceRevision !== snapshot.sourceRevision ||
        typeof event.recordSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(event.recordSha256))
      return blocked('EVENT_INVALID');
    const from = timestamp(event.startedAt), until = timestamp(event.endedAt), observed = timestamp(event.observedAt);
    if (from === null || until === null || observed === null ||
        !(start <= from && from < until && until <= end && until <= observed && observed <= asOf) ||
        until - from > 8 * 60 * 60000) return blocked('EVENT_TIME_INVALID');
    if (ids.has(event.actionId) || refs.has(event.evidenceRef) || hashes.has(event.recordSha256) ||
        event.evidenceRef === snapshot.evidenceRef) return blocked('DUPLICATE_EVIDENCE');
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
  return { status: 'REVIEW_DECLARED_EFFORT', ...Object.fromEntries(scope.map(key => [key, snapshot[key]])),
    windowStart: snapshot.windowStart, windowEnd: snapshot.windowEnd, asOf: snapshot.asOf,
    sourceId: snapshot.sourceId, sourceRevision: snapshot.sourceRevision, evidenceRef: snapshot.evidenceRef,
    actionCount: snapshot.events.length, distinctWorkflowCount: seenWorkflows.size,
    declaredTouchMinutes, minutesByWorkflow, eventEvidence,
    claimBoundary: 'SUPPLIED_MANUAL_INTERVALS_ONLY', sourceAuthenticated: false,
    executionAuthority: false, claimedSavingsPence: null };
};
