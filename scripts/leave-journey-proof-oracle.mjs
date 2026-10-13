import { types } from 'node:util';

const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const minutes = value => Number.isSafeInteger(value) && value >= 0;
const utc = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

// Captures must already be authenticated by the approved proof collector. Reject
// active JS objects before inspecting fields so a getter cannot change evidence.
function inertCopy(root) {
  const seen = new Set();
  let nodes = 0;
  function visit(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean'
        || (typeof value === 'number' && Number.isFinite(value))) return value;
    if (!value || typeof value !== 'object' || types.isProxy(value) || seen.has(value)
        || ++nodes > 10000) throw new Error('Evidence must be bounded inert JSON.');
    const array = Array.isArray(value);
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      throw new Error('Evidence must be bounded inert JSON.');
    seen.add(value);
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== 'string')
        || (array && keys.some(key => key !== 'length' && !/^(0|[1-9]\d*)$/.test(key)))
        || (array && keys.length !== value.length + 1)) throw new Error('Evidence must be bounded inert JSON.');
    const out = array ? [] : Object.create(null);
    for (const key of keys) {
      if (key === 'length' && array) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
        throw new Error('Evidence must be bounded inert JSON.');
      out[key] = visit(descriptor.value);
    }
    seen.delete(value);
    return out;
  }
  return visit(root);
}

export function assessLeaveJourneyEvidence(raw) {
  let packet;
  try { packet = inertCopy(raw); } catch { return Object.freeze({ status: 'BLOCKED', blockers: Object.freeze(['ACTIVE_OR_MALFORMED_PACKET']) }); }
  const blockers = [];
  const check = (condition, reason) => { if (!condition) blockers.push(reason); };
  const binding = packet?.binding || {};
  const { before, pending, overlap, manager, fresh } = packet?.captures || {};
  check(sha(binding.candidateSha) && id(binding.deploymentId) && id(binding.tenant)
    && id(binding.employeeId) && id(binding.requestId) && positive(binding.requestMinutes), 'BINDING_UNPROVEN');
  if (![before, pending, overlap, manager, fresh].every(row => row && typeof row === 'object')) {
    blockers.push('CAPTURES_MISSING');
    return Object.freeze({ status: 'BLOCKED', blockers: Object.freeze(blockers) });
  }
  const captures = [before, pending, overlap, manager, fresh];
  check(captures.every(row => row.candidateSha === binding.candidateSha
    && row.deploymentId === binding.deploymentId && row.tenant === binding.tenant
    && id(row.responseId) && positive(row.stateVersion) && utc(row.capturedAt)), 'CAPTURE_SCOPE_OR_SOURCE_DRIFT');
  check(captures.every((row, index) => index === 0 || Date.parse(row.capturedAt) > Date.parse(captures[index - 1].capturedAt)),
    'CAPTURE_ORDER_UNPROVEN');
  check(new Set(captures.map(row => row.responseId)).size === captures.length, 'DUPLICATE_RESPONSE');
  check(id(before.sessionId) && before.sessionId === pending.sessionId
    && pending.sessionId === overlap.sessionId && id(manager.sessionId)
    && id(fresh.sessionId) && fresh.sessionId !== before.sessionId
    && manager.sessionId !== before.sessionId && manager.sessionId !== fresh.sessionId,
  'SESSION_SEPARATION_UNPROVEN');
  check(before.role === 'employee' && pending.role === 'employee' && overlap.role === 'employee'
    && manager.role === 'manager' && fresh.role === 'employee'
    && before.actorId === binding.employeeId && pending.actorId === binding.employeeId
    && overlap.actorId === binding.employeeId && fresh.actorId === binding.employeeId
    && id(manager.actorId) && manager.actorId !== binding.employeeId, 'ACTOR_AUTHORITY_UNPROVEN');
  check(pending.stateVersion === before.stateVersion + 1
    && overlap.stateVersion === pending.stateVersion
    && manager.stateVersion === pending.stateVersion + 1
    && fresh.stateVersion === manager.stateVersion, 'VERSION_CHAIN_UNPROVEN');
  const request = pending.request || {};
  check(request.id === binding.requestId && request.employee === binding.employeeId
    && request.status === 'pending' && positive(request.revision)
    && request.minutes === binding.requestMinutes, 'PENDING_REQUEST_UNPROVEN');
  check(Number.isSafeInteger(before.requestCount) && before.requestCount >= 0
    && Number.isSafeInteger(pending.requestCount) && pending.requestCount >= 0
    && Number.isSafeInteger(overlap.requestCount) && overlap.requestCount >= 0
    && overlap.httpStatus === 409 && overlap.requestId === binding.requestId
    && overlap.requestCount === pending.requestCount && overlap.requestCount === before.requestCount + 1
    && overlap.request?.id === binding.requestId && overlap.request?.status === 'pending', 'OVERLAP_REFUSAL_UNPROVEN');
  check(manager.request?.id === binding.requestId && manager.request?.employee === binding.employeeId
    && manager.request?.status === 'approved' && manager.request?.revision === request.revision + 1
    && fresh.request?.id === binding.requestId && fresh.request?.status === 'approved'
    && fresh.request?.revision === manager.request?.revision, 'DECISION_REVISION_UNPROVEN');
  const audit = manager.audit || {};
  check(id(audit.id) && audit.type === 'leave-decision' && audit.requestId === binding.requestId
    && audit.employee === binding.employeeId && audit.by === manager.actorId
    && audit.revision === manager.request?.revision && utc(audit.at), 'REQUEST_BOUND_AUDIT_UNPROVEN');
  const a = before.leave || {}, b = pending.leave || {}, c = fresh.leave || {}, n = binding.requestMinutes;
  check([a, b, c].every(row => ['pendingMinutes', 'bookedMinutes', 'remainingMinutes', 'availableMinutes'].every(key => minutes(row[key])))
    && b.pendingMinutes === a.pendingMinutes + n && b.bookedMinutes === a.bookedMinutes
    && b.remainingMinutes === a.remainingMinutes && b.availableMinutes === a.availableMinutes - n
    && c.pendingMinutes === b.pendingMinutes - n && c.bookedMinutes === b.bookedMinutes + n
    && c.remainingMinutes === b.remainingMinutes - n && c.availableMinutes === b.availableMinutes,
  'ENTITLEMENT_TRANSITION_UNPROVEN');
  check(overlap.leave && ['pendingMinutes', 'bookedMinutes', 'remainingMinutes', 'availableMinutes']
    .every(key => overlap.leave[key] === b[key]), 'OVERLAP_CHANGED_BALANCE');
  return Object.freeze({
    contractVersion: 'VECTOR_LEAVE_JOURNEY_EVIDENCE_V1',
    status: blockers.length ? 'BLOCKED' : 'EVIDENCE_CONSISTENT',
    blockers: Object.freeze([...new Set(blockers)]),
    claimBoundary: 'Capture consistency only; authenticated source, browser action, session custody, deployment identity and hosted persistence require independent proof.'
  });
}
