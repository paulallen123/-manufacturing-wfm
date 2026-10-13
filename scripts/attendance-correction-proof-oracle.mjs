import { createHash } from 'node:crypto';
import { types } from 'node:util';

// Pure, deliberately narrow evidence oracle. It neither executes corrections nor
// authenticates receipts. The owner must authenticate contract and collector first.
export const SOURCE_SHA = '8632e5bb5c84e4fc258311d31d973714be169866';
export const SCHEMA = 'attendance-correction-proof/v1';
export const CALCULATION = 'elapsed-utc-minutes-minus-unpaid-breaks/v1';
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const positive = value => integer(value) && value > 0;
const bool = value => typeof value === 'boolean';
const literal = expected => value => value === expected;
const oneOf = (...values) => value => values.includes(value);
const utc = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:00\.000Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const list = (shape, max) => ({ $list: shape, $max: max });
const binding = {
  oracleBaseSha: literal(SOURCE_SHA),
  candidateSha: value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value),
  buildHash: hash, deploymentId: id,
  tenantId: id, runId: id, runnerId: id, ownerLeaseId: id, fence: positive,
};
const scope = { recordId: id, periodId: id, teamId: id, employeeId: id, sourceVersion: positive };
const interval = {
  kind: literal('worked'), clockIn: utc, clockOut: utc,
  breaks: list({ start: utc, end: utc, paid: bool }, 20),
  breaksConfirmed: literal(true), pendingSync: literal(false), absenceMinutes: literal(0),
};
const review = {
  revision: positive, status: oneOf('draft', 'returned'),
  acknowledgements: {}, employeeChecks: {}, reviewBasis: literal(null), signature: literal(null),
};
const state = {
  binding, scope, rawHash: hash, effective: interval, workedMinutes: integer,
  sourceFingerprint: hash, timeReviewTreatment: literal(null),
  payrollLocked: literal(false), exported: literal(false), review,
  payroll: { reviewRevision: positive, ready: literal(false), status: literal('review_required') },
};
const session = {
  id, personId: id, role: oneOf('employee', 'manager', 'payroll'),
  issuedAt: utc, expiresAt: utc, assertionReceiptId: id,
};
const target = { requestId: id, revision: positive, status: id, applied: bool };
const action = {
  binding, scope, receiptId: id, session, at: utc, command: id,
  sourceVersionBefore: positive, sourceVersionAfter: positive,
  versionBefore: positive, versionAfter: positive,
  ui: { eventId: id, responseId: id, completed: literal(true), rendered: literal(true), generation: positive },
  httpStatus: literal(200), result: target, state,
  replay: { receiptId: id, requestId: id, revision: positive, status: id, replayed: literal(true), writes: literal(0) },
  writes: literal(1),
};
const audit = {
  binding, scope, receiptId: id, requestId: id, revision: positive,
  type: id, actorId: id, at: utc, version: positive,
};
const observation = {
  binding, scope, receiptId: id, mode: oneOf('refresh', 'fresh'), role: oneOf('employee', 'manager', 'payroll'),
  session, at: utc, version: positive, result: target, state,
  auditHash: hash, responseComplete: literal(true), rendered: literal(true),
};
const baseContract = {
  schema: literal(SCHEMA), scenario: oneOf('reject', 'apply'), binding, scope,
  authority: { receiptId: id, approved: literal(true), mutation: oneOf('reject_only', 'apply_nonzero'),
    startsAt: utc, endsAt: utc, reconciliationId: id },
  actors: { employee: id, proposer: id, approver: id, payroll: id },
  calculation: literal(CALCULATION), preState: state, preStateHash: hash,
  requested: { clockIn: utc, clockOut: utc }, approvedProposal: interval,
  expectedWorkedMinutes: integer, expectedDeltaMinutes: Number.isSafeInteger,
};
const evidenceShape = {
  schema: literal(SCHEMA), scenario: oneOf('reject', 'apply'), binding, scope,
  before: state, beforeAt: utc, beforeVersion: positive, requestId: id,
  requested: { clockIn: utc, clockOut: utc }, proposal: interval,
  actions: list(action, 3), audit: list(audit, 3), observations: list(observation, 6),
};

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

// Receipt packets are JSON data. Reject executable property reads before the
// schema or semantic checks touch any caller-owned object.
function plainJsonTree(value) {
  const pending = [value], seen = new Set();
  let visited = 0;
  while (pending.length) {
    const item = pending.pop();
    if (item === null || typeof item !== 'object') continue;
    if (++visited > 10000 || types.isProxy(item) || seen.has(item)) return false;
    seen.add(item);
    const array = Array.isArray(item);
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) return false;
    const descriptors = Object.getOwnPropertyDescriptors(item);
    const keys = Reflect.ownKeys(descriptors);
    if (array && Object.keys(item).length !== item.length) return false;
    for (const key of keys) {
      if (typeof key === 'symbol') return false;
      const descriptor = descriptors[key];
      if (array && key === 'length') continue;
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
      pending.push(descriptor.value);
    }
  }
  return true;
}

// For schema-valid JSON only; no I/O, clock, randomness, environment or secrets.
export function evidenceHash(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function validateShape(value, shape, path, issues) {
  const fail = (code, message) => issues.push({ path, code, message });
  if (value === undefined) { fail('MISSING', 'Supply this required evidence field.'); return; }
  if (typeof shape === 'function') {
    if (!shape(value)) fail('UNSUPPORTED_VALUE', 'Supply the declared v1 type, bound or supported semantics.');
    return;
  }
  if (shape.$list) {
    if (!Array.isArray(value) || value.length > shape.$max) { fail('INVALID_ARRAY', 'Supply a bounded receipt array.'); return; }
    for (let i = 0; i < value.length; i++) validateShape(value[i], shape.$list, `${path}[${i}]`, issues);
    return;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail('INVALID_OBJECT', 'Supply a plain JSON object.'); return;
  }
  for (const key of Object.keys(shape)) validateShape(value[key], shape[key], `${path}.${key}`, issues);
  // Do not echo unknown field names: they can themselves contain private data.
  if (Object.keys(value).some(k => !Object.hasOwn(shape, k))) fail('UNKNOWN_FIELD', 'Remove undeclared fields; credentials, names and success labels are not accepted.');
}

function worked(value, path, check) {
  const start = Date.parse(value.clockIn), end = Date.parse(value.clockOut);
  check(end > start && end - start <= 24 * 60 * 60000, path, 'INTERVAL', 'Use a positive elapsed interval of at most 24 hours.');
  let unpaid = 0, previousEnd = start;
  value.breaks.forEach((b, i) => {
    const a = Date.parse(b.start), z = Date.parse(b.end);
    check(a >= start && z <= end && z > a && a >= previousEnd,
      `${path}.breaks[${i}]`, 'BREAK_INTERVAL', 'Order non-overlapping, positive breaks inside the shift.');
    previousEnd = z;
    if (!b.paid) unpaid += (z - a) / 60000;
  });
  return (end - start) / 60000 - unpaid;
}

function validate(contract, evidence, scenario) {
  const issues = [];
  const finish = () => {
    issues.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
    return { schema: SCHEMA, scenario,
      status: issues.length ? (issues.some(i => i.code === 'MISSING') ? 'BLOCKED_REQUIRED_DATA' : 'INVALID_EVIDENCE') : 'EVIDENCE_CONSISTENT',
      mutationProven: !issues.length && scenario === 'apply', issues };
  };
  if (!plainJsonTree(contract) || !plainJsonTree(evidence)) {
    issues.push({ path: 'packet', code: 'INVALID_JSON', message: 'Supply inert JSON receipt data without accessors, proxies, hidden fields or cycles.' });
    return finish();
  }
  validateShape(contract, baseContract, 'contract', issues);
  validateShape(evidence, evidenceShape, 'evidence', issues);
  if (issues.length) return finish();
  const check = (ok, path, code, message) => { if (!ok) issues.push({ path, code, message }); };
  const equal = (actual, expected, path) => check(canonical(actual) === canonical(expected), path, 'MISMATCH', 'Match the independently approved contract or correlated authoritative receipt exactly.');
  equal(contract.scenario, scenario, 'contract.scenario');
  equal(evidence.scenario, scenario, 'evidence.scenario');
  equal(contract.authority.mutation, scenario === 'apply' ? 'apply_nonzero' : 'reject_only', 'contract.authority.mutation');
  const windowStart = Date.parse(contract.authority.startsAt), windowEnd = Date.parse(contract.authority.endsAt);
  check(windowEnd > windowStart, 'contract.authority.endsAt', 'WINDOW', 'End the approved mutation window after its start.');
  const inWindow = (at, path) => check(Date.parse(at) >= windowStart && Date.parse(at) <= windowEnd, path, 'WINDOW', 'Receipt must fall inside the approved window.');
  const bind = (item, path) => {
    equal(item.binding, contract.binding, `${path}.binding`);
    equal(item.scope, contract.scope, `${path}.scope`);
  };
  const actors = contract.actors;
  check(new Set(Object.values(actors)).size === 4, 'contract.actors', 'DUPLICATE_ACTOR', 'Use distinct employee, proposer, approver and payroll person IDs.');
  equal(contract.scope.employeeId, actors.employee, 'contract.scope.employeeId');
  bind(evidence, 'evidence');
  const verifyState = (s, path) => {
    bind(s, path);
    equal(s.workedMinutes, worked(s.effective, `${path}.effective`, check), `${path}.workedMinutes`);
    equal(s.payroll.reviewRevision, s.review.revision, `${path}.payroll.reviewRevision`);
    equal(s.sourceFingerprint, evidenceHash({ sourceVersion: s.scope.sourceVersion, rawHash: s.rawHash, effective: s.effective }), `${path}.sourceFingerprint`);
  };
  verifyState(contract.preState, 'contract.preState');
  verifyState(evidence.before, 'evidence.before');
  equal(evidence.before, contract.preState, 'evidence.before');
  equal(evidenceHash(contract.preState), contract.preStateHash, 'contract.preStateHash');
  equal(evidence.requested, contract.requested, 'evidence.requested');
  equal(evidence.proposal, contract.approvedProposal, 'evidence.proposal');
  check(Date.parse(contract.requested.clockOut) > Date.parse(contract.requested.clockIn), 'contract.requested', 'INTERVAL', 'Requested finish must follow start.');
  const approvedMinutes = worked(contract.approvedProposal, 'contract.approvedProposal', check);
  equal(contract.expectedWorkedMinutes, approvedMinutes, 'contract.expectedWorkedMinutes');
  equal(contract.expectedDeltaMinutes, approvedMinutes - contract.preState.workedMinutes, 'contract.expectedDeltaMinutes');
  if (scenario === 'apply') {
    check(contract.expectedDeltaMinutes !== 0, 'contract.expectedDeltaMinutes', 'ZERO_DELTA', 'An application needs an explicitly approved non-zero worked-minute delta.');
    check(evidenceHash(contract.approvedProposal) !== evidenceHash(contract.preState.effective), 'contract.approvedProposal', 'ZERO_DELTA', 'Approved effective state must change.');
    check(contract.requested.clockIn !== contract.preState.effective.clockIn || contract.requested.clockOut !== contract.preState.effective.clockOut,
      'contract.requested', 'ZERO_DELTA', 'Supply the approved non-zero request rather than copying current times.');
  } else {
    equal(contract.approvedProposal, contract.preState.effective, 'contract.approvedProposal');
    equal(contract.requested, { clockIn: contract.preState.effective.clockIn, clockOut: contract.preState.effective.clockOut }, 'contract.requested');
    equal(contract.expectedDeltaMinutes, 0, 'contract.expectedDeltaMinutes');
  }
  const phases = scenario === 'apply' ? [
    ['correction-submit', 'submitted', actors.employee, 'employee', 'attendance-correction-submitted'],
    ['correction-propose', 'awaiting_approval', actors.proposer, 'manager', 'attendance-correction-proposed'],
    ['correction-decide', 'applied', actors.approver, 'manager', 'attendance-correction-applied'],
  ] : [
    ['correction-submit', 'submitted', actors.employee, 'employee', 'attendance-correction-submitted'],
    ['correction-review', 'rejected', actors.approver, 'manager', 'attendance-correction-reject'],
  ];
  equal(evidence.actions.length, phases.length, 'evidence.actions.length');
  equal(evidence.audit.length, phases.length, 'evidence.audit.length');
  equal(evidence.observations.length, 6, 'evidence.observations.length');
  inWindow(evidence.beforeAt, 'evidence.beforeAt');
  const uniqueIds = new Set();
  const unique = (value, path) => {
    check(!uniqueIds.has(value), path, 'DUPLICATE_RECEIPT', 'Collect a distinct receipt or UI correlation ID.'); uniqueIds.add(value);
  };
  // Packet consistency only: the collector must still authenticate the referenced
  // assertion. Each session/assertion pair has immutable metadata across receipts.
  // An unchanged same-actor action session may be reused for refresh, never fresh.
  const sessionsById = new Map(), sessionsByAssertion = new Map();
  const useSession = (s, person, role, at, path, usage) => {
    equal(s.personId, person, `${path}.personId`); equal(s.role, role, `${path}.role`);
    check(Date.parse(s.issuedAt) <= Date.parse(at) && Date.parse(s.expiresAt) > Date.parse(at), path, 'SESSION_TIME', 'Use a session issued before the observation and not expired.');
    for (const [field, registry] of [['id', sessionsById], ['assertionReceiptId', sessionsByAssertion]]) {
      const previous = registry.get(s[field]);
      if (previous) {
        check(previous.identity === canonical(s), `${path}.${field}`, 'SESSION_IDENTITY_CONFLICT', 'Reuse a session or assertion ID only with its unchanged person, role, paired ID and validity timestamps.');
        check(usage !== 'fresh' && !previous.fresh, `${path}.${field}`, 'DUPLICATE_SESSION', 'Fresh-session identities must not occur in any other action or observation.');
        previous.fresh ||= usage === 'fresh';
      } else registry.set(s[field], { identity: canonical(s), fresh: usage === 'fresh' });
    }
  };
  let previousAt = Date.parse(evidence.beforeAt), previousVersion = evidence.beforeVersion;
  const expectedState = index => {
    const s = structuredClone(contract.preState);
    if (scenario === 'apply' && index > 0) {
      s.review.revision += index;
      s.review.status = 'draft';
      s.payroll.reviewRevision = s.review.revision;
      if (index === 2) { s.effective = contract.approvedProposal; s.workedMinutes = approvedMinutes; }
    }
    s.sourceFingerprint = evidenceHash({ sourceVersion: s.scope.sourceVersion, rawHash: s.rawHash, effective: s.effective });
    return s;
  };
  evidence.actions.forEach((a, i) => {
    const path = `evidence.actions[${i}]`, phase = phases[i];
    if (!phase) return;
    const [command, status, person, role, type] = phase;
    bind(a, path); verifyState(a.state, `${path}.state`); inWindow(a.at, `${path}.at`);
    useSession(a.session, person, role, a.at, `${path}.session`, 'action');
    unique(a.receiptId, `${path}.receiptId`); unique(a.ui.eventId, `${path}.ui.eventId`); unique(a.ui.responseId, `${path}.ui.responseId`);
    unique(a.replay.receiptId, `${path}.replay.receiptId`);
    equal(a.command, command, `${path}.command`);
    check(Date.parse(a.at) > previousAt, `${path}.at`, 'ORDER', 'Collect actions strictly after pre-state and preceding action.');
    equal(a.versionBefore, previousVersion, `${path}.versionBefore`);
    equal(a.versionAfter, a.versionBefore + 1, `${path}.versionAfter`);
    equal(a.sourceVersionBefore, contract.scope.sourceVersion, `${path}.sourceVersionBefore`);
    equal(a.sourceVersionAfter, contract.scope.sourceVersion, `${path}.sourceVersionAfter`);
    const applied = scenario === 'apply' && i === 2;
    equal(a.result, { requestId: evidence.requestId, revision: i + 1, status, applied }, `${path}.result`);
    equal(a.replay.requestId, evidence.requestId, `${path}.replay.requestId`);
    equal(a.replay.revision, i + 1, `${path}.replay.revision`);
    equal(a.replay.status, status, `${path}.replay.status`);
    const expected = expectedState(i);
    if (applied) {
      check(a.state.sourceFingerprint !== contract.preState.sourceFingerprint, `${path}.state.sourceFingerprint`, 'SOURCE_FINGERPRINT', 'Applied correction must change its source fingerprint.');
    }
    equal(a.state, expected, `${path}.state`);
    const h = evidence.audit[i];
    if (h) {
      bind(h, `evidence.audit[${i}]`); unique(h.receiptId, `evidence.audit[${i}].receiptId`);
      equal(h, { binding: contract.binding, scope: contract.scope, receiptId: h.receiptId,
        requestId: evidence.requestId, revision: i + 1, type, actorId: person, at: a.at, version: a.versionAfter }, `evidence.audit[${i}]`);
    }
    previousAt = Date.parse(a.at); previousVersion = a.versionAfter;
  });
  const terminal = evidence.actions[phases.length - 1];
  const observed = new Set();
  evidence.observations.forEach((o, i) => {
    const path = `evidence.observations[${i}]`, key = `${o.role}:${o.mode}`;
    bind(o, path); verifyState(o.state, `${path}.state`); unique(o.receiptId, `${path}.receiptId`); inWindow(o.at, `${path}.at`);
    check(!observed.has(key), path, 'DUPLICATE_OBSERVATION', 'Supply one refresh and one fresh-session readback for each role.'); observed.add(key);
    const person = o.role === 'manager' ? actors.approver : actors[o.role];
    useSession(o.session, person, o.role, o.at, `${path}.session`, o.mode);
    check(Date.parse(o.at) > previousAt, `${path}.at`, 'STALE_OBSERVATION', 'Observe the committed result after the final decision.');
    equal(o.version, previousVersion, `${path}.version`);
    if (terminal) { equal(o.state, terminal.state, `${path}.state`); equal(o.result, terminal.result, `${path}.result`); }
    equal(o.auditHash, evidenceHash(evidence.audit), `${path}.auditHash`);
    if (o.mode === 'fresh') {
      check(Date.parse(o.session.issuedAt) > previousAt, `${path}.session.issuedAt`, 'STALE_SESSION', 'Authenticate a new signed session after the final decision.');
    }
  });
  for (const role of ['employee', 'manager', 'payroll']) {
    for (const mode of ['refresh', 'fresh']) check(observed.has(`${role}:${mode}`), 'evidence.observations', 'MISSING', 'Supply refresh and fresh-session observations for employee, manager and payroll.');
    const refresh = evidence.observations.find(o => o.role === role && o.mode === 'refresh');
    const fresh = evidence.observations.find(o => o.role === role && o.mode === 'fresh');
    if (refresh && fresh) check(refresh.session.id !== fresh.session.id && refresh.session.assertionReceiptId !== fresh.session.assertionReceiptId,
      'evidence.observations', 'DUPLICATE_SESSION', 'Fresh login must differ from the refresh session and assertion.');
    if (refresh && fresh) check(Date.parse(fresh.session.issuedAt) > Date.parse(refresh.at) && Date.parse(fresh.at) > Date.parse(refresh.at),
      'evidence.observations', 'ORDER', 'Refresh first, then authenticate and observe the result with a new session.');
  }
  return finish();
}

export function validateRejection(contract, evidence) { return validate(contract, evidence, 'reject'); }
export function validateApplication(contract, evidence) { return validate(contract, evidence, 'apply'); }
