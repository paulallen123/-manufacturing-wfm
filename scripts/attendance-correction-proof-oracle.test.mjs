import test from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA, SOURCE_SHA, CALCULATION, evidenceHash, validateApplication, validateRejection } from './attendance-correction-proof-oracle.mjs';

const copy = x => structuredClone(x);
const at = minute => `2026-10-11T12:${String(minute).padStart(2, '0')}:00.000Z`;
const fingerprint = s => evidenceHash({ sourceVersion: s.scope.sourceVersion, rawHash: s.rawHash, effective: s.effective });

// Entirely fictional, local receipt data. These objects do not authorise execution.
function fixture(scenario = 'apply') {
  const binding = { oracleBaseSha: SOURCE_SHA, candidateSha: SOURCE_SHA, buildHash: 'a'.repeat(64), deploymentId: 'deployment-1', tenantId: 'tenant-1', runId: 'run-1', runnerId: 'runner-1', ownerLeaseId: 'lease-1', fence: 7 };
  const scope = { recordId: 'record-1', periodId: 'period-1', teamId: 'team-1', employeeId: 'employee-1', sourceVersion: 4 };
  const actors = { employee: 'employee-1', proposer: 'manager-1', approver: 'manager-2', payroll: 'payroll-1' };
  const effective = { kind: 'worked', clockIn: '2026-10-10T08:00:00.000Z', clockOut: '2026-10-10T16:00:00.000Z', breaks: [{ start: '2026-10-10T12:00:00.000Z', end: '2026-10-10T12:30:00.000Z', paid: false }], breaksConfirmed: true, pendingSync: false, absenceMinutes: 0 };
  const before = { binding: copy(binding), scope: copy(scope), rawHash: 'b'.repeat(64), effective, workedMinutes: 450, sourceFingerprint: '', timeReviewTreatment: null, payrollLocked: false, exported: false,
    review: { revision: 9, status: 'draft', acknowledgements: {}, employeeChecks: {}, reviewBasis: null, signature: null },
    payroll: { reviewRevision: 9, ready: false, status: 'review_required' } };
  before.sourceFingerprint = fingerprint(before);
  const proposal = copy(effective);
  if (scenario === 'apply') proposal.clockOut = '2026-10-10T17:00:00.000Z';
  const requested = { clockIn: proposal.clockIn, clockOut: proposal.clockOut };
  const contract = { schema: SCHEMA, scenario, binding, scope,
    authority: { receiptId: 'approval-1', approved: true, mutation: scenario === 'apply' ? 'apply_nonzero' : 'reject_only', startsAt: at(0), endsAt: at(59), reconciliationId: 'reconciliation-1' },
    actors, calculation: CALCULATION, preState: copy(before), preStateHash: evidenceHash(before),
    requested: copy(requested), approvedProposal: copy(proposal), expectedWorkedMinutes: scenario === 'apply' ? 510 : 450, expectedDeltaMinutes: scenario === 'apply' ? 60 : 0 };
  const phases = scenario === 'apply' ? [
    ['correction-submit', 'submitted', 'employee', actors.employee, 'attendance-correction-submitted'],
    ['correction-propose', 'awaiting_approval', 'manager', actors.proposer, 'attendance-correction-proposed'],
    ['correction-decide', 'applied', 'manager', actors.approver, 'attendance-correction-applied'],
  ] : [
    ['correction-submit', 'submitted', 'employee', actors.employee, 'attendance-correction-submitted'],
    ['correction-review', 'rejected', 'manager', actors.approver, 'attendance-correction-reject'],
  ];
  const actions = [], audit = [], observations = [];
  phases.forEach(([command, status, role, personId, type], i) => {
    const state = copy(before);
    if (scenario === 'apply' && i > 0) { state.review.revision += i; state.payroll.reviewRevision += i; }
    if (scenario === 'apply' && i === 2) { state.effective = copy(proposal); state.workedMinutes = 510; }
    state.sourceFingerprint = fingerprint(state);
    const result = { requestId: 'request-1', revision: i + 1, status, applied: status === 'applied' };
    actions.push({ binding: copy(binding), scope: copy(scope), receiptId: `action-${i}`, session: { id: `session-${i}`, personId, role, issuedAt: at(1), expiresAt: at(59), assertionReceiptId: `assertion-${i}` }, at: at(5 + i * 5), command,
      sourceVersionBefore: 4, sourceVersionAfter: 4, versionBefore: 20 + i, versionAfter: 21 + i,
      ui: { eventId: `event-${i}`, responseId: `response-${i}`, completed: true, rendered: true, generation: 1 }, httpStatus: 200, result, state,
      replay: { receiptId: `replay-${i}`, requestId: 'request-1', revision: i + 1, status, replayed: true, writes: 0 }, writes: 1 });
    audit.push({ binding: copy(binding), scope: copy(scope), receiptId: `audit-${i}`, requestId: 'request-1', revision: i + 1, type, actorId: personId, at: at(5 + i * 5), version: 21 + i });
  });
  for (const role of ['employee', 'manager', 'payroll']) for (const mode of ['refresh', 'fresh']) {
    const personId = role === 'manager' ? actors.approver : actors[role];
    observations.push({ binding: copy(binding), scope: copy(scope), receiptId: `observe-${role}-${mode}`, mode, role,
      session: { id: `session-${role}-${mode}`, personId, role, issuedAt: mode === 'fresh' ? at(26) : at(1), expiresAt: at(59), assertionReceiptId: `assertion-${role}-${mode}` },
      at: mode === 'fresh' ? at(30) : at(25), version: actions.at(-1).versionAfter, result: copy(actions.at(-1).result), state: copy(actions.at(-1).state), auditHash: evidenceHash(audit), responseComplete: true, rendered: true });
  }
  return { contract, evidence: { schema: SCHEMA, scenario, binding: copy(binding), scope: copy(scope), before, beforeAt: at(2), beforeVersion: 20, requestId: 'request-1', requested, proposal, actions, audit, observations } };
}
const validate = f => f.contract.scenario === 'apply' ? validateApplication(f.contract, f.evidence) : validateRejection(f.contract, f.evidence);
const reject = f => {
  const r = validate(f);
  assert.notEqual(r.status, 'EVIDENCE_CONSISTENT');
  assert.equal(r.mutationProven, false);
  assert.ok(r.issues.length);
  return r;
};

for (const scenario of ['apply', 'reject']) {
  test(`${scenario}: session identity is consistent globally across actions and observations`, () => {
    for (const fields of [['id'], ['assertionReceiptId'], ['id', 'assertionReceiptId']]) {
      const original = fixture(scenario);
      const sessions = [...original.evidence.actions, ...original.evidence.observations];
      for (let from = 0; from < sessions.length; from++) for (let to = 0; to < sessions.length; to++) {
        if (sessions[from].session.personId === sessions[to].session.personId) continue;
        const f = fixture(scenario), items = [...f.evidence.actions, ...f.evidence.observations];
        for (const field of fields) items[to].session[field] = items[from].session[field];
        reject(f);
      }
    }
  });
  test(`${scenario}: same actor may refresh using its unchanged action session`, () => {
    const f = fixture(scenario);
    f.evidence.observations[0].session = copy(f.evidence.actions[0].session);
    f.evidence.observations[2].session = copy(f.evidence.actions.at(-1).session);
    assert.equal(validate(f).status, 'EVIDENCE_CONSISTENT');
  });
  test(`${scenario}: reused session metadata and assertion association are immutable`, () => {
    for (const [field, value] of [['id', 'replacement-session'], ['assertionReceiptId', 'replacement-assertion'], ['issuedAt', at(2)], ['expiresAt', at(58)]]) {
      const f = fixture(scenario);
      f.evidence.observations[0].session = copy(f.evidence.actions[0].session);
      f.evidence.observations[0].session[field] = value;
      reject(f);
    }
  });
}

test('reported manager refresh cannot reuse employee refresh session and assertion', () => {
  const f = fixture();
  for (const key of ['id', 'assertionReceiptId']) f.evidence.observations[2].session[key] = f.evidence.observations[0].session[key];
  reject(f);
});
test('fresh session cannot reuse another role refresh identity in either array order', () => {
  for (const reverse of [false, true]) {
    const f = fixture();
    for (const key of ['id', 'assertionReceiptId']) f.evidence.observations[3].session[key] = f.evidence.observations[0].session[key];
    if (reverse) f.evidence.observations.reverse();
    reject(f);
  }
});

for (const scenario of ['apply', 'reject']) {
  test(`complete ${scenario} fixture, deterministic and input-immutable`, () => {
    const f = fixture(scenario), before = copy(f);
    const expected = { schema: SCHEMA, scenario, status: 'EVIDENCE_CONSISTENT', mutationProven: scenario === 'apply', issues: [] };
    assert.deepEqual(validate(f), expected);
    assert.deepEqual(validate(f), expected);
    assert.deepEqual(f, before);
  });

  // Exhaustive required-field deletion, including each nested receipt field.
  function paths(value, prefix = []) {
    const out = [];
    for (const key of Object.keys(value)) {
      const p = [...prefix, key]; out.push(p);
      if (value[key] && typeof value[key] === 'object') out.push(...paths(value[key], p));
    }
    return out;
  }
  test(`${scenario}: every required field is fail-closed when absent`, () => {
    const f = fixture(scenario);
    for (const p of paths(f)) {
      const broken = copy(f); let parent = broken;
      for (const key of p.slice(0, -1)) parent = parent[key];
      delete parent[p.at(-1)];
      assert.notEqual((scenario === 'apply' ? validateApplication : validateRejection)(broken.contract, broken.evidence).status, 'EVIDENCE_CONSISTENT', p.join('.'));
    }
  });
  test(`${scenario}: every field rejects wrong types`, () => {
    for (const p of paths(fixture(scenario))) {
      const broken = fixture(scenario); let parent = broken;
      for (const key of p.slice(0, -1)) parent = parent[key];
      parent[p.at(-1)] = parent[p.at(-1)] === null ? 'not-null' : null;
      assert.notEqual((scenario === 'apply' ? validateApplication : validateRejection)(broken.contract, broken.evidence).status, 'EVIDENCE_CONSISTENT', p.join('.'));
    }
  });
}

const negatives = {
  'source SHA drift': f => { f.evidence.binding.candidateSha = 'c'.repeat(40); },
  'build drift': f => { f.evidence.actions[1].binding.buildHash = 'c'.repeat(64); },
  'deployment drift': f => { f.evidence.actions[1].state.binding.deploymentId = 'other'; },
  'tenant drift': f => { f.evidence.observations[0].binding.tenantId = 'other'; },
  'run drift': f => { f.evidence.audit[1].binding.runId = 'other'; },
  'runner drift': f => { f.evidence.actions[1].binding.runnerId = 'other'; },
  'owner drift': f => { f.evidence.binding.ownerLeaseId = 'other'; },
  'fence drift': f => { f.evidence.binding.fence++; },
  'record drift': f => { f.evidence.actions[1].scope.recordId = 'other'; },
  'period drift': f => { f.evidence.before.scope.periodId = 'other'; },
  'source version drift': f => { f.evidence.actions[2].sourceVersionAfter++; },
  'unapproved authority': f => { f.contract.authority.approved = false; },
  'rejection-only authority': f => { f.contract.authority.mutation = 'reject_only'; },
  'duplicate actors': f => { f.contract.actors.approver = f.contract.actors.proposer; },
  'employee identity drift': f => { f.evidence.actions[0].session.personId = 'other'; },
  'forged role': f => { f.evidence.actions[2].session.role = 'payroll'; },
  'reused action session': f => { f.evidence.actions[2].session.id = f.evidence.actions[1].session.id; },
  'reused assertion': f => { f.evidence.actions[2].session.assertionReceiptId = f.evidence.actions[1].session.assertionReceiptId; },
  'pre-state hash mismatch': f => { f.contract.preStateHash = 'f'.repeat(64); },
  'changed pre-state': f => { f.evidence.before.rawHash = 'f'.repeat(64); },
  'raw rewrite': f => { f.evidence.actions[2].state.rawHash = 'f'.repeat(64); },
  'proposal mismatch': f => { f.evidence.proposal.clockOut = '2026-10-10T18:00:00.000Z'; },
  'request mismatch': f => { f.evidence.requested.clockOut = '2026-10-10T18:00:00.000Z'; },
  'unknown formula': f => { f.contract.calculation = 'rounded-payroll/v2'; },
  'time review treatment': f => { f.evidence.before.timeReviewTreatment = {}; },
  'locked payroll': f => { f.evidence.before.payrollLocked = true; },
  'exported period': f => { f.evidence.before.exported = true; },
  'wrong calculation': f => { f.contract.expectedWorkedMinutes++; },
  'wrong delta': f => { f.contract.expectedDeltaMinutes++; },
  'zero-delta approval': f => { f.contract.approvedProposal = copy(f.contract.preState.effective); f.contract.expectedWorkedMinutes = 450; f.contract.expectedDeltaMinutes = 0; },
  'stale request revision': f => { f.evidence.actions[2].result.revision = 2; },
  'skipped revision': f => { f.evidence.actions[1].result.revision = 3; },
  'denial as application': f => { f.evidence.actions[2].result.status = 'rejected'; f.evidence.actions[2].result.applied = false; },
  'HTTP denial': f => { f.evidence.actions[2].httpStatus = 403; },
  '200 without completed response': f => { f.evidence.actions[2].ui.completed = false; },
  'response without rendering': f => { f.evidence.actions[2].ui.rendered = false; },
  'no actual write': f => { f.evidence.actions[2].writes = 0; },
  'double write': f => { f.evidence.actions[2].writes = 2; },
  'replay wrote twice': f => { f.evidence.actions[2].replay.writes = 1; },
  'replay request differs': f => { f.evidence.actions[1].replay.requestId = 'other'; },
  'duplicate receipt': f => { f.evidence.actions[2].receiptId = f.evidence.actions[1].receiptId; },
  'duplicate UI response': f => { f.evidence.actions[2].ui.responseId = f.evidence.actions[1].ui.responseId; },
  'out of order': f => { f.evidence.actions[2].at = at(5); },
  'state version skipped': f => { f.evidence.actions[2].versionAfter++; },
  'concurrent unrelated state write': f => { f.evidence.actions[2].versionBefore++; },
  'missing invalidation': f => { f.evidence.actions[1].state.review.revision = 9; },
  'stale signature': f => { f.evidence.actions[2].state.review.signature = 'signed'; },
  'stale acknowledgements': f => { f.evidence.actions[2].state.review.acknowledgements.attendance = 9; },
  'stale employee checks': f => { f.evidence.actions[2].state.review.employeeChecks.employee = 9; },
  'payroll falsely green': f => { f.evidence.actions[2].state.payroll.ready = true; },
  'payroll stale revision': f => { f.evidence.observations[4].state.payroll.reviewRevision--; },
  'audit actor drift': f => { f.evidence.audit[2].actorId = 'other'; },
  'audit timestamp mismatch': f => { f.evidence.audit[2].at = at(14); },
  'audit order drift': f => { f.evidence.audit.reverse(); },
  'audit hash mismatch': f => { f.evidence.observations[0].auditHash = 'f'.repeat(64); },
  'stale observed revision': f => { f.evidence.observations[0].result.revision--; },
  'stale observed state': f => { f.evidence.observations[0].state.effective = copy(f.evidence.before.effective); },
  'stale observation time': f => { f.evidence.observations[0].at = at(10); },
  'stale observed version': f => { f.evidence.observations[0].version--; },
  'old fresh session': f => { f.evidence.observations[1].session.issuedAt = at(1); },
  'expired session': f => { f.evidence.observations[1].session.expiresAt = at(25); },
  'session issued after observation': f => { f.evidence.observations[1].session.issuedAt = at(31); },
  'fresh login before refresh': f => { f.evidence.observations[1].session.issuedAt = at(24); },
  'zero change requested': f => { f.contract.requested = { clockIn: f.contract.preState.effective.clockIn, clockOut: f.contract.preState.effective.clockOut }; },
  'reused fresh session': f => { f.evidence.observations[1].session.id = f.evidence.actions[0].session.id; },
  'refresh reused as fresh': f => { f.evidence.observations[1].session.id = f.evidence.observations[0].session.id; },
  'action assertion reused as fresh': f => { f.evidence.observations[1].session.assertionReceiptId = f.evidence.actions[0].session.assertionReceiptId; },
  'duplicate role observation': f => { f.evidence.observations[5] = copy(f.evidence.observations[1]); },
  'missing fresh payroll': f => { f.evidence.observations.pop(); },
  'oversized observations': f => { f.evidence.observations.push(copy(f.evidence.observations[0])); },
  'outside authorised window': f => { f.contract.authority.endsAt = at(10); },
  'reversed authorised window': f => { f.contract.authority.endsAt = '2026-10-11T11:00:00.000Z'; },
  'unsupported local time': f => { f.contract.approvedProposal.clockIn = '2026-10-25T01:30'; },
  'invalid calendar rollover': f => { f.contract.approvedProposal.clockIn = '2026-02-30T08:00:00.000Z'; },
  'offset instead of canonical UTC': f => { f.contract.approvedProposal.clockIn = '2026-10-10T09:00:00.000+01:00'; },
  'fractional minute': f => { f.contract.approvedProposal.clockIn = '2026-10-10T08:00:30.000Z'; },
  'negative interval': f => { f.contract.approvedProposal.clockOut = '2026-10-10T07:00:00.000Z'; },
  'long interval': f => { f.contract.approvedProposal.clockOut = '2026-10-12T08:00:00.000Z'; },
  'outside break': f => { f.contract.approvedProposal.breaks[0].start = '2026-10-10T07:00:00.000Z'; },
  'negative break': f => { f.contract.approvedProposal.breaks[0].end = '2026-10-10T11:00:00.000Z'; },
  'overlapping breaks': f => { f.contract.approvedProposal.breaks.push(copy(f.contract.approvedProposal.breaks[0])); },
  'missing paid classification': f => { delete f.contract.approvedProposal.breaks[0].paid; },
  'unconfirmed breaks': f => { f.contract.approvedProposal.breaksConfirmed = false; },
  'nonfinite number': f => { f.evidence.beforeVersion = Infinity; },
  'unsafe integer': f => { f.evidence.beforeVersion = Number.MAX_SAFE_INTEGER + 1; },
  'unbounded ID': f => { f.evidence.requestId = 'x'.repeat(121); },
  'PII in ID': f => { f.evidence.requestId = 'person@example.com'; },
  'caller-supplied success': f => { f.evidence.success = true; },
  'credential field': f => { f.evidence.cookie = 'private-value'; },
};
for (const [name, mutate] of Object.entries(negatives)) test(name, () => { const f = fixture(); mutate(f); reject(f); });

test('missing evidence is BLOCKED_REQUIRED_DATA, never skip or pass', () => {
  assert.equal(validateApplication(undefined, undefined).status, 'BLOCKED_REQUIRED_DATA');
  assert.equal(validateRejection(fixture('reject').contract, undefined).mutationProven, false);
});
test('separate entrypoints cannot stitch rejection into successful apply', () => {
  const r = fixture('reject'), a = fixture();
  assert.equal(validateApplication(r.contract, r.evidence).mutationProven, false);
  assert.equal(validateApplication(a.contract, r.evidence).mutationProven, false);
  assert.notEqual(validateRejection(a.contract, a.evidence).status, 'EVIDENCE_CONSISTENT');
});
test('coherent zero delta cannot claim successful mutation', () => {
  const f = fixture();
  f.contract.approvedProposal = copy(f.contract.preState.effective);
  f.contract.expectedWorkedMinutes = 450; f.contract.expectedDeltaMinutes = 0;
  f.evidence.proposal = copy(f.contract.approvedProposal);
  f.evidence.actions[2].state.effective = copy(f.contract.approvedProposal);
  f.evidence.actions[2].state.workedMinutes = 450;
  f.evidence.actions[2].state.sourceFingerprint = fingerprint(f.evidence.actions[2].state);
  for (const o of f.evidence.observations) o.state = copy(f.evidence.actions[2].state);
  assert.ok(reject(f).issues.some(i => i.code === 'ZERO_DELTA'));
});

function replaceIntervals(f, before, after, beforeMinutes, afterMinutes) {
  f.contract.preState.effective = copy(before); f.contract.preState.workedMinutes = beforeMinutes;
  f.contract.preState.sourceFingerprint = fingerprint(f.contract.preState);
  f.contract.preStateHash = evidenceHash(f.contract.preState);
  f.contract.approvedProposal = copy(after); f.contract.expectedWorkedMinutes = afterMinutes; f.contract.expectedDeltaMinutes = afterMinutes - beforeMinutes;
  f.contract.requested = { clockIn: after.clockIn, clockOut: after.clockOut };
  f.evidence.before = copy(f.contract.preState); f.evidence.requested = copy(f.contract.requested); f.evidence.proposal = copy(after);
  f.evidence.actions.forEach((a, i) => {
    a.state.effective = copy(i === 2 ? after : before); a.state.workedMinutes = i === 2 ? afterMinutes : beforeMinutes;
    a.state.sourceFingerprint = fingerprint(a.state);
  });
  for (const o of f.evidence.observations) o.state = copy(f.evidence.actions[2].state);
}
test('paid breaks are not deducted; negative authorised delta is supported', () => {
  const f = fixture(), before = copy(f.contract.preState.effective), after = copy(before);
  before.breaks[0].paid = true;
  after.clockOut = '2026-10-10T15:30:00.000Z';
  replaceIntervals(f, before, after, 480, 420);
  assert.equal(validate(f).status, 'EVIDENCE_CONSISTENT');
});
test('UTC elapsed contract handles London DST crossing without guessing local wall time', () => {
  const f = fixture(), before = copy(f.contract.preState.effective), after = copy(before);
  before.clockIn = '2026-10-25T00:00:00.000Z'; before.clockOut = '2026-10-25T02:00:00.000Z'; before.breaks = [];
  Object.assign(after, before, { clockOut: '2026-10-25T03:00:00.000Z' });
  replaceIntervals(f, before, after, 120, 180);
  assert.equal(validate(f).status, 'EVIDENCE_CONSISTENT');
});
test('output never echoes private unknown keys or values', () => {
  const f = fixture(); f.evidence['SECRET-PRIVATE-NAME'] = 'SECRET-PRIVATE-VALUE';
  assert.doesNotMatch(JSON.stringify(reject(f)), /SECRET/);
});
test('canonical hashing ignores object insertion order but preserves array order', () => {
  assert.equal(evidenceHash({ b: 1, a: 2 }), evidenceHash({ a: 2, b: 1 }));
  assert.notEqual(evidenceHash([1, 2]), evidenceHash([2, 1]));
});
