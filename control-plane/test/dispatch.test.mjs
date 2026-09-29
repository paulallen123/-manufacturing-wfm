import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  createDispatchEnvelope,
  dispatchProofTask,
  resolveDispatchConfig,
} from '../lib/dispatch.js';

const candidate = {
  repository: 'paulallen123/-manufacturing-wfm',
  ref: 'release/vector-customer-ready-candidate-20260925',
  commitSha: 'ebf723ddc97c62e9286b825413358d3ad132364f',
  deploymentId: '8010b43e-0d50-4cea-bd1b-2a401d5c4a3a',
  runtimeSha: 'ebf723ddc97c62e9286b825413358d3ad132364f',
  releaseId: 'vector-customer-ready-candidate-20260925',
  environment: 'customer-proof-staging',
  provider: 'railway',
  failureDomainId: 'railway',
  claimBoundary: 'customer-proof-staging',
};

function task(overrides = {}) {
  return {
    taskId: 'task_123',
    candidateToken: 'candidate-token-123',
    candidateSha: candidate.commitSha,
    gateId: 'golden_journey',
    taskKind: 'proof',
    targetDeploymentId: candidate.deploymentId,
    targetRuntimeSha: candidate.runtimeSha,
    failureDomainId: 'railway',
    provider: 'railway',
    laneId: 'railway-proof-workers',
    idempotencyKey: 'idem-123',
    attempt: 1,
    retentionToken: 'candidate-token-123',
    exactCandidate: candidate,
    ...overrides,
  };
}

test('dispatcher remains fail-closed shadow unless LIVE_PROOF is explicitly enabled', async () => {
  let called = false;
  const result = await dispatchProofTask(task(), {
    env: {},
    fetchImpl: async () => {
      called = true;
      return { ok: true, status: 202 };
    },
  });
  assert.equal(result.status, 'SHADOW_WOULD_DISPATCH');
  assert.equal(called, false);
});

test('live dispatch uses only the allow-listed lane endpoint and ignores task-supplied URLs', async () => {
  let observed;
  const malicious = task({ url: 'https://attacker.invalid/proof' });
  const env = {
    VECTOR_CONTROL_PLANE_DISPATCH_MODE: 'LIVE_PROOF',
    VECTOR_DISPATCH_RAILWAY_URL: 'https://proof-worker.example.invalid/vector-proof',
    VECTOR_DISPATCH_RAILWAY_SECRET: 'test-secret',
  };
  const result = await dispatchProofTask(malicious, {
    env,
    now: () => new Date('2026-09-29T06:30:00.000Z'),
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return { ok: true, status: 202 };
    },
  });
  assert.equal(result.status, 'DISPATCHED');
  assert.equal(observed.url, env.VECTOR_DISPATCH_RAILWAY_URL);
  assert.notEqual(observed.url, malicious.url);
  const body = JSON.parse(observed.options.body);
  assert.equal(body.eventType, 'VECTOR_PROOF_TASK');
  assert.equal(body.task.taskId, malicious.taskId);
  assert.equal(body.task.exactCandidate.commitSha, candidate.commitSha);
});

test('live dispatch signs timestamp plus exact JSON body and carries the idempotency key', async () => {
  let observed;
  const env = {
    VECTOR_CONTROL_PLANE_DISPATCH_MODE: 'LIVE_PROOF',
    VECTOR_DISPATCH_RAILWAY_URL: 'https://proof-worker.example.invalid/vector-proof',
    VECTOR_DISPATCH_RAILWAY_SECRET: 'signing-secret',
  };
  const timestamp = '2026-09-29T06:31:00.000Z';
  await dispatchProofTask(task(), {
    env,
    now: () => new Date(timestamp),
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return { ok: true, status: 200 };
    },
  });
  const expected = crypto
    .createHmac('sha256', env.VECTOR_DISPATCH_RAILWAY_SECRET)
    .update(`${timestamp}.${observed.options.body}`)
    .digest('hex');
  assert.equal(observed.options.headers['x-vector-dispatch-signature'], expected);
  assert.equal(observed.options.headers['x-vector-idempotency-key'], 'idem-123');
  assert.equal(observed.options.headers['x-vector-candidate-token'], 'candidate-token-123');
});

test('live dispatch refuses non-HTTPS endpoints', () => {
  assert.throws(
    () => resolveDispatchConfig(task(), {
      VECTOR_CONTROL_PLANE_DISPATCH_MODE: 'LIVE_PROOF',
      VECTOR_DISPATCH_RAILWAY_URL: 'http://proof-worker.example.invalid/vector-proof',
      VECTOR_DISPATCH_RAILWAY_SECRET: 'secret',
    }),
    /DISPATCH_ENDPOINT_REQUIRES_HTTPS/,
  );
});

test('live dispatch refuses missing lane secrets rather than sending unsigned work', () => {
  assert.throws(
    () => resolveDispatchConfig(task(), {
      VECTOR_CONTROL_PLANE_DISPATCH_MODE: 'LIVE_PROOF',
      VECTOR_DISPATCH_RAILWAY_URL: 'https://proof-worker.example.invalid/vector-proof',
    }),
    /DISPATCH_SECRET_MISSING/,
  );
});

test('candidate drift fails before any outbound request', async () => {
  let called = false;
  const drifted = task({
    candidateSha: 'wrong-sha',
  });
  await assert.rejects(
    () => dispatchProofTask(drifted, {
      env: {
        VECTOR_CONTROL_PLANE_DISPATCH_MODE: 'LIVE_PROOF',
        VECTOR_DISPATCH_RAILWAY_URL: 'https://proof-worker.example.invalid/vector-proof',
        VECTOR_DISPATCH_RAILWAY_SECRET: 'secret',
      },
      fetchImpl: async () => {
        called = true;
        return { ok: true, status: 200 };
      },
    }),
    /DISPATCH_EXACT_CANDIDATE_DRIFT/,
  );
  assert.equal(called, false);
});

test('lane/provider/failure-domain mismatch fails closed', () => {
  assert.throws(
    () => createDispatchEnvelope(task({ provider: 'github' })),
    /DISPATCH_LANE_BINDING_MISMATCH/,
  );
});

test('repair regression tasks use the same signed boundary without granting direct product mutation', async () => {
  let observedBody;
  const repair = task({ taskKind: 'repair_regression' });
  const result = await dispatchProofTask(repair, {
    env: {
      VECTOR_CONTROL_PLANE_DISPATCH_MODE: 'LIVE_PROOF',
      VECTOR_DISPATCH_RAILWAY_URL: 'https://proof-worker.example.invalid/vector-proof',
      VECTOR_DISPATCH_RAILWAY_SECRET: 'secret',
    },
    fetchImpl: async (url, options) => {
      observedBody = JSON.parse(options.body);
      return { ok: true, status: 202 };
    },
  });
  assert.equal(result.status, 'DISPATCHED');
  assert.equal(observedBody.task.taskKind, 'repair_regression');
});

test('provider rejection is terminal to the callback attempt and never reported as dispatched', async () => {
  await assert.rejects(
    () => dispatchProofTask(task(), {
      env: {
        VECTOR_CONTROL_PLANE_DISPATCH_MODE: 'LIVE_PROOF',
        VECTOR_DISPATCH_RAILWAY_URL: 'https://proof-worker.example.invalid/vector-proof',
        VECTOR_DISPATCH_RAILWAY_SECRET: 'secret',
      },
      fetchImpl: async () => ({ ok: false, status: 503 }),
    }),
    /DISPATCH_PROVIDER_REJECTED:503/,
  );
});
