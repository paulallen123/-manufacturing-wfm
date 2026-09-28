import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyControlEvent,
  candidateToken,
  checkNoIdleInvariant,
  createInitialState,
} from '../lib/engine.js';

const candidate = {
  repository: 'paulallen123/-manufacturing-wfm',
  ref: 'release/frozen-candidate',
  commitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  deploymentId: 'railway-deploy-1',
  runtimeSha: 'runtime-sha-1',
  releaseId: 'vector-proof-1',
  environment: 'staging-proof',
  provider: 'railway',
  failureDomainId: 'railway-runtime',
};

function bootstrap() {
  const state = createInitialState(candidate);
  return applyControlEvent(state, {
    eventId: 'evt-bootstrap',
    type: 'CANDIDATE_STARTED',
    candidateToken: candidateToken(candidate),
  });
}

function receiptEvent({ eventId, gateId, sequence, result = 'PASS', applicationState = 'PASS', proofLane = { laneId: 'github-actions', provider: 'github' }, candidateOverride = candidate }) {
  return {
    eventId,
    type: 'PROOF_RECEIPT',
    candidateToken: candidateToken(candidate),
    receipt: {
      receiptId: `receipt-${eventId}`,
      gateId,
      sequence,
      result,
      applicationState,
      candidate: candidateOverride,
      evidenceDigest: `digest-${eventId}`,
      proofLane,
    },
  };
}

test('bootstrap immediately queues admissible root proof and does not idle', () => {
  const result = bootstrap();
  assert.equal(result.emittedTasks.length, 1);
  assert.equal(result.emittedTasks[0].gateId, 'pre_freeze');
  assert.equal(result.invariant.ok, true);
});

test('terminal PASS fans out newly runnable work immediately', () => {
  let { state } = bootstrap();
  const result = applyControlEvent(state, receiptEvent({ eventId: 'evt-pre-freeze-pass', gateId: 'pre_freeze', sequence: 1 }));
  assert.equal(result.state.gates.pre_freeze.state, 'PASS');
  assert.ok(result.emittedTasks.some((task) => task.gateId === 'hosted_runtime'));
});

test('provider SUCCESS metadata cannot satisfy an application proof gate', () => {
  let { state } = bootstrap();
  state = applyControlEvent(state, receiptEvent({ eventId: 'evt-pre-pass', gateId: 'pre_freeze', sequence: 1 })).state;
  const result = applyControlEvent(state, {
    eventId: 'evt-railway-success',
    type: 'PROVIDER_STATUS',
    candidateToken: candidateToken(candidate),
    provider: 'railway',
    status: 'SUCCESS',
  });
  assert.notEqual(result.state.gates.hosted_runtime.state, 'PASS');
});

test('false-green receipt is rejected when terminal application PASS is absent', () => {
  let { state } = bootstrap();
  state = applyControlEvent(state, receiptEvent({ eventId: 'evt-pre-pass2', gateId: 'pre_freeze', sequence: 1 })).state;
  const result = applyControlEvent(state, receiptEvent({
    eventId: 'evt-false-green',
    gateId: 'hosted_runtime',
    sequence: 1,
    result: 'PASS',
    applicationState: 'FAIL',
    proofLane: { laneId: 'railway-proof-workers', provider: 'railway' },
  }));
  assert.notEqual(result.state.gates.hosted_runtime.state, 'PASS');
  assert.ok(result.state.rejectedReceipts.some((item) => item.reason === 'FALSE_GREEN_PROVIDER_STATUS'));
});

test('stale receipt cannot overwrite newer accepted progress', () => {
  let { state } = bootstrap();
  state = applyControlEvent(state, receiptEvent({ eventId: 'evt-new', gateId: 'pre_freeze', sequence: 2 })).state;
  const result = applyControlEvent(state, receiptEvent({ eventId: 'evt-old', gateId: 'pre_freeze', sequence: 1, result: 'FAIL' }));
  assert.equal(result.state.gates.pre_freeze.state, 'PASS');
  assert.ok(result.state.rejectedReceipts.some((item) => item.reason === 'STALE_RECEIPT'));
});

test('exact candidate mismatch fails closed before a proof can pass', () => {
  const { state } = bootstrap();
  const wrong = { ...candidate, commitSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' };
  const result = applyControlEvent(state, receiptEvent({ eventId: 'evt-wrong-sha', gateId: 'pre_freeze', sequence: 1, candidateOverride: wrong }));
  assert.equal(result.state.gates.pre_freeze.state, 'UNPROVEN');
  assert.ok(result.state.rejectedReceipts.some((item) => item.reason === 'EXACT_CANDIDATE_MISMATCH'));
});

test('duplicate events are idempotent and do not duplicate consequential tasks', () => {
  let result = bootstrap();
  const taskCount = Object.keys(result.state.tasks).length;
  const duplicate = applyControlEvent(result.state, {
    eventId: 'evt-bootstrap',
    type: 'CANDIDATE_STARTED',
    candidateToken: candidateToken(candidate),
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(Object.keys(duplicate.state.tasks).length, taskCount);
  assert.equal(duplicate.emittedTasks.length, 0);
});

test('provider degradation reroutes to a distinct healthy admitted lane when configured', () => {
  const state = createInitialState(candidate);
  const result = applyControlEvent(state, {
    eventId: 'evt-github-down',
    type: 'PROVIDER_DEGRADED',
    candidateToken: candidateToken(candidate),
    provider: 'github',
    reason: 'pre-execution outage',
  });
  assert.equal(result.emittedTasks[0].gateId, 'pre_freeze');
  assert.equal(result.emittedTasks[0].laneId, 'railway-proof-workers');
});

test('product FAIL launches permanent repair/regression work while other independent work remains active', () => {
  let { state } = bootstrap();
  state = applyControlEvent(state, receiptEvent({ eventId: 'evt-pre-pass3', gateId: 'pre_freeze', sequence: 1 })).state;
  state = applyControlEvent(state, receiptEvent({
    eventId: 'evt-hosted-pass',
    gateId: 'hosted_runtime',
    sequence: 1,
    proofLane: { laneId: 'railway-proof-workers', provider: 'railway' },
  })).state;
  state = applyControlEvent(state, receiptEvent({
    eventId: 'evt-source-pass',
    gateId: 'exact_source_binding',
    sequence: 1,
    proofLane: { laneId: 'railway-proof-workers', provider: 'railway' },
  })).state;

  const result = applyControlEvent(state, receiptEvent({
    eventId: 'evt-golden-fail',
    gateId: 'golden_journey',
    sequence: 1,
    result: 'FAIL',
    applicationState: 'FAIL',
    proofLane: { laneId: 'railway-proof-workers', provider: 'railway' },
  }));

  assert.equal(result.state.gates.golden_journey.state, 'FAIL');
  assert.ok(result.emittedTasks.some((task) => task.gateId === 'golden_journey' && task.taskKind === 'repair_regression'));
  assert.ok(Object.values(result.state.tasks).some((task) => task.gateId === 'security' && ['QUEUED', 'RUNNING'].includes(task.status)));
});

test('cleanup is refused while dependent proof remains unfinished', () => {
  const { state } = bootstrap();
  const result = applyControlEvent(state, {
    eventId: 'evt-cleanup',
    type: 'CLEANUP_REQUEST',
    candidateToken: candidateToken(candidate),
  });
  assert.equal(result.state.retention.cleanupAllowed, false);
  assert.ok(result.state.breaches.some((item) => item.code === 'FROZEN_TARGET_RETENTION_VIOLATION'));
});

test('open gates plus empty work with no explicit block is an orchestration breach', () => {
  const state = createInitialState(candidate);
  assert.deepEqual(checkNoIdleInvariant(state), { ok: false, code: 'ORCHESTRATION_INVARIANT_BREACH' });
});


test('Railway outage blocks the dependent DAG explicitly instead of creating unexplained idle', () => {
  let { state } = bootstrap();
  state = applyControlEvent(state, receiptEvent({ eventId: 'evt-pre-pass4', gateId: 'pre_freeze', sequence: 1 })).state;
  const result = applyControlEvent(state, {
    eventId: 'evt-railway-down',
    type: 'PROVIDER_DEGRADED',
    candidateToken: candidateToken(candidate),
    provider: 'railway',
    reason: 'pre-execution provider outage',
  });
  assert.equal(result.state.gates.hosted_runtime.state, 'BLOCKED');
  assert.equal(result.state.gates.hosted_runtime.blockingReason, 'NO_ADMITTED_HEALTHY_FAILURE_DOMAIN');
  assert.equal(result.state.gates.exact_source_binding.state, 'BLOCKED');
  assert.match(result.state.gates.exact_source_binding.blockingReason, /^DEPENDENCY_BLOCKED:/);
  assert.equal(result.invariant.ok, true);
});

test('dependency blocks reopen only after the upstream gate is actually proven', () => {
  let { state } = bootstrap();
  state = applyControlEvent(state, receiptEvent({ eventId: 'evt-pre-pass5', gateId: 'pre_freeze', sequence: 1 })).state;
  state = applyControlEvent(state, {
    eventId: 'evt-railway-down2',
    type: 'PROVIDER_DEGRADED',
    candidateToken: candidateToken(candidate),
    provider: 'railway',
  }).state;
  state = applyControlEvent(state, {
    eventId: 'evt-railway-back',
    type: 'PROVIDER_RECOVERED',
    candidateToken: candidateToken(candidate),
    provider: 'railway',
  }).state;
  assert.equal(state.gates.hosted_runtime.state, 'UNPROVEN');
  assert.equal(state.gates.exact_source_binding.state, 'BLOCKED');

  const result = applyControlEvent(state, receiptEvent({
    eventId: 'evt-hosted-pass-after-recovery',
    gateId: 'hosted_runtime',
    sequence: 1,
    proofLane: { laneId: 'railway-proof-workers', provider: 'railway' },
  }));
  assert.equal(result.state.gates.exact_source_binding.state, 'UNPROVEN');
  assert.ok(result.emittedTasks.some((task) => task.gateId === 'exact_source_binding'));
});

test('Railway SKIPPED remains provider metadata and never earns a proof PASS', () => {
  let { state } = bootstrap();
  state = applyControlEvent(state, receiptEvent({ eventId: 'evt-pre-pass6', gateId: 'pre_freeze', sequence: 1 })).state;
  const result = applyControlEvent(state, {
    eventId: 'evt-railway-skipped',
    type: 'PROVIDER_STATUS',
    candidateToken: candidateToken(candidate),
    provider: 'railway',
    status: 'SKIPPED',
  });
  assert.notEqual(result.state.gates.hosted_runtime.state, 'PASS');
});

test('durable state survives JSON serialization without losing candidate or task idempotency', () => {
  const initial = bootstrap();
  const restored = JSON.parse(JSON.stringify(initial.state));
  const duplicate = applyControlEvent(restored, {
    eventId: 'evt-bootstrap',
    type: 'CANDIDATE_STARTED',
    candidateToken: candidateToken(candidate),
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.state.candidateToken, candidateToken(candidate));
  assert.equal(Object.keys(duplicate.state.tasks).length, Object.keys(initial.state.tasks).length);
});
