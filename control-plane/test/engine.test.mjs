import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyControlEvent,
  candidateToken,
  checkNoIdleInvariant,
  createInitialState,
  validateCandidateIdentity,
} from '../lib/engine.js';

const sha = 'a'.repeat(40);
const candidate = {
  repository: 'paulallen123/-manufacturing-wfm',
  ref: 'release/frozen-candidate',
  commitSha: sha,
  deploymentId: 'railway-deploy-1',
  runtimeSha: sha,
  releaseId: 'vector-proof-1',
  environment: 'staging-proof',
  provider: 'railway',
  failureDomainId: 'railway-runtime',
  claimBoundary: 'customer-proof-staging',
};

function bootstrap() {
  const state = createInitialState(candidate);
  return applyControlEvent(state, {
    eventId: 'evt-bootstrap',
    type: 'CANDIDATE_STARTED',
    candidateToken: candidateToken(candidate),
  });
}

function activeTask(state, gateId) {
  return Object.values(state.tasks).find((task) => task.gateId === gateId && ['QUEUED', 'RUNNING'].includes(task.status));
}

function receiptEvent(state, { eventId, gateId, sequence, result = 'PASS', applicationState = 'PASS', proofLane = null, candidateOverride = candidate }) {
  const task = activeTask(state, gateId);
  const boundLane = task ? {
    laneId: task.laneId,
    provider: task.provider,
    failureDomainId: task.failureDomainId,
  } : undefined;
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
      taskId: task?.taskId,
      idempotencyKey: task?.idempotencyKey,
      proofLane: proofLane ? { ...boundLane, ...proofLane } : boundLane,
    },
  };
}

test('candidate identity rejects source/runtime drift before orchestration starts', () => {
  assert.equal(validateCandidateIdentity(candidate).ok, true);
  const mismatch = { ...candidate, runtimeSha: 'b'.repeat(40) };
  assert.equal(validateCandidateIdentity(mismatch).reason, 'SOURCE_RUNTIME_SHA_MISMATCH');
  assert.throws(() => createInitialState(mismatch), /SOURCE_RUNTIME_SHA_MISMATCH/);
});

test('production claim boundary is structurally rejected by the customer-proof control plane', () => {
  const production = { ...candidate, claimBoundary: 'production' };
  assert.equal(validateCandidateIdentity(production).reason, 'UNSUPPORTED_CLAIM_BOUNDARY');
  assert.throws(() => createInitialState(production), /UNSUPPORTED_CLAIM_BOUNDARY/);
});

test('bootstrap immediately queues admissible root proof and does not idle', () => {
  const result = bootstrap();
  assert.equal(result.emittedTasks.length, 1);
  assert.equal(result.emittedTasks[0].gateId, 'pre_freeze');
  assert.equal(result.invariant.ok, true);
});

test('terminal PASS fans out newly runnable work immediately', () => {
  let { state } = bootstrap();
  const result = applyControlEvent(state, receiptEvent(state, { eventId: 'evt-pre-freeze-pass', gateId: 'pre_freeze', sequence: 1 }));
  assert.equal(result.state.gates.pre_freeze.state, 'PASS');
  assert.ok(result.emittedTasks.some((task) => task.gateId === 'hosted_runtime'));
});

test('provider SUCCESS metadata cannot satisfy an application proof gate', () => {
  let { state } = bootstrap();
  state = applyControlEvent(state, receiptEvent(state, { eventId: 'evt-pre-pass', gateId: 'pre_freeze', sequence: 1 })).state;
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
  state = applyControlEvent(state, receiptEvent(state, { eventId: 'evt-pre-pass2', gateId: 'pre_freeze', sequence: 1 })).state;
  const result = applyControlEvent(state, receiptEvent(state, {
    eventId: 'evt-false-green',
    gateId: 'hosted_runtime',
    sequence: 1,
    result: 'PASS',
    applicationState: 'FAIL',
    proofLane: { laneId: 'railway-proof-workers', provider: 'railway' },
  }));
  assert.notEqual(result.state.gates.hosted_runtime.state, 'PASS');
  assert.equal(result.state.gates.hosted_runtime.latestReceiptSequence, -1);
  assert.ok(result.state.rejectedReceipts.some((item) => item.reason === 'FALSE_GREEN_PROVIDER_STATUS'));
  assert.ok(Object.values(result.state.tasks).some((task) => task.gateId === 'hosted_runtime' && ['QUEUED', 'RUNNING'].includes(task.status)));
});

test('receipt lane must match the exact dispatched task', () => {
  const { state } = bootstrap();
  const result = applyControlEvent(state, receiptEvent(state, {
    eventId: 'evt-forged-lane',
    gateId: 'pre_freeze',
    sequence: 1,
    proofLane: { laneId: 'forged-lane' },
  }));
  assert.equal(result.state.gates.pre_freeze.state, 'UNPROVEN');
  assert.ok(result.state.rejectedReceipts.some((item) => item.reason === 'PROOF_LANE_MISMATCH'));
});

test('stale receipt cannot overwrite newer accepted progress', () => {
  let { state } = bootstrap();
  state = applyControlEvent(state, receiptEvent(state, { eventId: 'evt-new', gateId: 'pre_freeze', sequence: 2 })).state;
  const result = applyControlEvent(state, receiptEvent(state, { eventId: 'evt-old', gateId: 'pre_freeze', sequence: 1, result: 'FAIL' }));
  assert.equal(result.state.gates.pre_freeze.state, 'PASS');
  assert.ok(result.state.rejectedReceipts.some((item) => item.reason === 'STALE_RECEIPT'));
});

test('exact candidate mismatch fails closed before a proof can pass', () => {
  const { state } = bootstrap();
  const wrong = { ...candidate, commitSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' };
  const result = applyControlEvent(state, receiptEvent(state, { eventId: 'evt-wrong-sha', gateId: 'pre_freeze', sequence: 1, candidateOverride: wrong }));
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
  state = applyControlEvent(state, receiptEvent(state, { eventId: 'evt-pre-pass3', gateId: 'pre_freeze', sequence: 1 })).state;
  state = applyControlEvent(state, receiptEvent(state, {
    eventId: 'evt-hosted-pass',
    gateId: 'hosted_runtime',
    sequence: 1,
    proofLane: { laneId: 'railway-proof-workers', provider: 'railway' },
  })).state;
  state = applyControlEvent(state, receiptEvent(state, {
    eventId: 'evt-source-pass',
    gateId: 'exact_source_binding',
    sequence: 1,
    proofLane: { laneId: 'railway-proof-workers', provider: 'railway' },
  })).state;

  const result = applyControlEvent(state, receiptEvent(state, {
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


test('customer-proof authority is derived only after every required evidence gate passes', () => {
  const state = createInitialState(candidate);
  for (const [id, gate] of Object.entries(state.gates)) {
    if (id === 'customer_proof_authority') continue;
    gate.state = 'PASS';
    gate.lastEvidenceDigest = `evidence-${id}`;
  }
  const result = applyControlEvent(state, {
    eventId: 'evt-derive-customer-proof-authority',
    type: 'PROVIDER_STATUS',
    candidateToken: candidateToken(candidate),
    provider: 'railway',
    status: 'SUCCESS',
  });
  assert.equal(result.state.gates.customer_proof_authority.state, 'PASS');
  assert.equal(result.state.gates.customer_proof_authority.latestReceiptId, 'derived:policy');
  assert.ok(result.state.audit.some((item) => item.type === 'DERIVED_AUTHORITY_PASS'));
  assert.equal(result.emittedTasks.length, 0);
});
