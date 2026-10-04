'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createImplementationWorkController } = require('./implementation-work-controller.cjs');

const requirements = [
  { key: 'configuration-scope', dependsOn: [] },
  { key: 'tenant-environment', dependsOn: ['configuration-scope'] },
  { key: 'source-systems', dependsOn: ['tenant-environment'] },
  { key: 'people-data', dependsOn: ['source-systems'] }
];

function readiness(states = {}) {
  return {
    requirements: requirements.map(item => ({
      ...item,
      status: states[item.key]?.status || 'MISSING',
      satisfied: states[item.key]?.satisfied === true,
      source: states[item.key]?.source || null,
      detail: states[item.key]?.detail || null
    }))
  };
}

test('readiness becomes an executable dependency plan instead of a passive checklist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-work-controller-'));
  const dbPath = path.join(dir, 'state.sqlite');
  const controller = createImplementationWorkController({ dbPath, requirements });
  const plan = controller.reconcile({ runId: 'run-1', tenant: 'tenant-a', readiness: readiness() });
  assert.equal(plan.jobs.find(x => x.requirementKey === 'configuration-scope').status, 'BLOCKED_RESUMABLE');
  assert.equal(plan.jobs.find(x => x.requirementKey === 'configuration-scope').blockedReason, 'CUSTOMER_SCOPE_REQUIRED');
  assert.equal(plan.jobs.find(x => x.requirementKey === 'tenant-environment').status, 'WAITING_DEPENDENCY');
  assert.equal(plan.runnable.length, 0);
  controller.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('independent safe work becomes runnable immediately when dependencies are satisfied', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-work-controller-'));
  const controller = createImplementationWorkController({ dbPath: path.join(dir, 'state.sqlite'), requirements });
  const plan = controller.reconcile({
    runId: 'run-2',
    tenant: 'tenant-a',
    readiness: readiness({
      'configuration-scope': { status: 'PASS', satisfied: true, source: 'trusted-contract', detail: { scopeDigest: 'a' } },
      'tenant-environment': { status: 'PASS', satisfied: true, source: 'cloud-runtime', detail: { environmentId: 'env-a' } }
    })
  });
  assert.equal(plan.jobs.find(x => x.requirementKey === 'source-systems').status, 'BLOCKED_RESUMABLE');
  assert.equal(plan.jobs.find(x => x.requirementKey === 'people-data').status, 'WAITING_DEPENDENCY');
  controller.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('claimed work is effect-once and stale results fail closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-work-controller-'));
  let now = 1_000;
  const customRequirements = [
    { key: 'configuration-scope', dependsOn: [] },
    { key: 'tenant-environment', dependsOn: ['configuration-scope'] }
  ];
  const controller = createImplementationWorkController({
    dbPath: path.join(dir, 'state.sqlite'),
    requirements: customRequirements,
    clock: () => now,
    blockerFor: () => null
  });
  controller.reconcile({
    runId: 'run-3',
    tenant: 'tenant-a',
    readiness: {
      requirements: [
        { key: 'configuration-scope', dependsOn: [], satisfied: true, status: 'PASS', source: 'trusted-contract', detail: { version: 1 } },
        { key: 'tenant-environment', dependsOn: ['configuration-scope'], satisfied: false, status: 'MISSING', source: null, detail: null }
      ]
    },
    blockerFor: () => null
  });
  const claimed = controller.claim({ runId: 'run-3', tenant: 'tenant-a', requirementKey: 'tenant-environment', ownerId: 'test-worker' });
  assert.equal(claimed.status, 'RUNNING');
  const first = controller.complete({
    jobId: claimed.id,
    runId: 'run-3',
    tenant: 'tenant-a',
    intentDigest: claimed.intentDigest,
    ownerId: claimed.ownerId, fence: claimed.fence, leaseToken: claimed.leaseToken,
    outcome: 'PROVISION_REQUESTED',
    detail: { requestId: 'req-1' }
  });
  assert.equal(first.replayed, false);
  const replay = controller.complete({
    jobId: claimed.id,
    runId: 'run-3',
    tenant: 'tenant-a',
    intentDigest: claimed.intentDigest,
    ownerId: claimed.ownerId, fence: claimed.fence, leaseToken: claimed.leaseToken,
    outcome: 'PROVISION_REQUESTED',
    detail: { requestId: 'req-1' }
  });
  assert.equal(replay.replayed, true);

  controller.reconcile({
    runId: 'run-3',
    tenant: 'tenant-a',
    readiness: {
      requirements: [
        { key: 'configuration-scope', dependsOn: [], satisfied: true, status: 'PASS', source: 'trusted-contract', detail: { version: 2 } },
        { key: 'tenant-environment', dependsOn: ['configuration-scope'], satisfied: false, status: 'MISSING', source: null, detail: null }
      ]
    },
    blockerFor: () => null
  });
  assert.throws(() => controller.complete({
    jobId: claimed.id,
    runId: 'run-3',
    tenant: 'tenant-a',
    intentDigest: claimed.intentDigest,
    ownerId: claimed.ownerId, fence: claimed.fence, leaseToken: claimed.leaseToken,
    outcome: 'PROVISION_REQUESTED',
    detail: { requestId: 'req-1' }
  }), /stale result/i);
  controller.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('retry and blocked states survive restart without idling unrelated work', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-work-controller-'));
  const dbPath = path.join(dir, 'state.sqlite');
  let now = 2_000;
  const customRequirements = [
    { key: 'configuration-scope', dependsOn: [] },
    { key: 'tenant-environment', dependsOn: ['configuration-scope'] },
    { key: 'security-controls', dependsOn: ['configuration-scope'] }
  ];
  let controller = createImplementationWorkController({
    dbPath,
    requirements: customRequirements,
    clock: () => now,
    retryDelayMs: 100
  });
  controller.reconcile({
    runId: 'run-4',
    tenant: 'tenant-a',
    readiness: {
      requirements: [
        { key: 'configuration-scope', dependsOn: [], satisfied: true, status: 'PASS', source: 'trusted-contract', detail: {} },
        { key: 'tenant-environment', dependsOn: ['configuration-scope'], satisfied: false, status: 'MISSING', source: null, detail: null },
        { key: 'security-controls', dependsOn: ['configuration-scope'], satisfied: false, status: 'MISSING', source: null, detail: null }
      ]
    },
    blockerFor: () => null
  });
  const first = controller.claim({ runId: 'run-4', tenant: 'tenant-a', requirementKey: 'tenant-environment', ownerId: 'test-worker' });
  controller.fail({ jobId: first.id, runId: 'run-4', tenant: 'tenant-a', intentDigest: first.intentDigest, ownerId: first.ownerId, fence: first.fence, leaseToken: first.leaseToken, error: 'temporary provider outage', retryable: true });
  const second = controller.claim({ runId: 'run-4', tenant: 'tenant-a', requirementKey: 'security-controls', ownerId: 'test-worker' });
  assert.equal(second.requirementKey, 'security-controls');
  controller.block({ jobId: second.id, runId: 'run-4', tenant: 'tenant-a', intentDigest: second.intentDigest, ownerId: second.ownerId, fence: second.fence, leaseToken: second.leaseToken, reason: 'EXTERNAL_AUTHORITY_REQUIRED' });
  controller.close();

  controller = createImplementationWorkController({ dbPath, requirements: customRequirements, clock: () => now, retryDelayMs: 100 });
  let plan = controller.plan('run-4', 'tenant-a');
  assert.equal(plan.jobs.find(x => x.requirementKey === 'tenant-environment').status, 'RETRY_WAIT');
  assert.equal(plan.jobs.find(x => x.requirementKey === 'security-controls').status, 'BLOCKED_RESUMABLE');
  now += 101;
  plan = controller.reconcile({
    runId: 'run-4',
    tenant: 'tenant-a',
    readiness: {
      requirements: [
        { key: 'configuration-scope', dependsOn: [], satisfied: true, status: 'PASS', source: 'trusted-contract', detail: {} },
        { key: 'tenant-environment', dependsOn: ['configuration-scope'], satisfied: false, status: 'MISSING', source: null, detail: null },
        { key: 'security-controls', dependsOn: ['configuration-scope'], satisfied: false, status: 'MISSING', source: null, detail: null }
      ]
    },
    blockerFor: item => item.key === 'security-controls' ? 'EXTERNAL_AUTHORITY_REQUIRED' : null
  });
  assert.ok(plan.runnable.includes('tenant-environment'));
  assert.equal(plan.blocked.some(x => x.requirementKey === 'security-controls'), true);
  controller.close();
  fs.rmSync(dir, { recursive: true, force: true });
});



test('external authority is explicit while unrelated autonomous work remains visible', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-work-controller-'));
  const customRequirements = [
    { key: 'configuration-scope', dependsOn: [] },
    { key: 'source-systems', dependsOn: ['configuration-scope'] },
    { key: 'tenant-environment', dependsOn: ['configuration-scope'] },
    { key: 'absence-policies', dependsOn: ['configuration-scope'] },
    { key: 'privileged-competency', dependsOn: ['configuration-scope'] }
  ];
  const controller = createImplementationWorkController({
    dbPath: path.join(dir, 'state.sqlite'), requirements: customRequirements
  });
  const plan = controller.reconcile({
    runId: 'run-authority', tenant: 'tenant-a',
    readiness: { requirements: [
      { key: 'configuration-scope', satisfied: true, status: 'PASS', source: 'contract', detail: {} },
      { key: 'source-systems', satisfied: false, status: 'MISSING', source: null, detail: null },
      { key: 'tenant-environment', satisfied: false, status: 'MISSING', source: null, detail: null },
      { key: 'absence-policies', satisfied: false, status: 'MISSING', source: null, detail: null },
      { key: 'privileged-competency', satisfied: false, status: 'MISSING', source: null, detail: null }
    ]},
    blockerFor: item => ({
      'source-systems': 'SOURCE_AUTHORIZATION_OR_VALIDATION_REQUIRED',
      'absence-policies': 'CUSTOMER_POLICY_AUTHORITY_REQUIRED',
      'privileged-competency': 'CUSTOMER_COMPETENCY_EVIDENCE_REQUIRED'
    }[item.key] || null)
  });
  assert.deepEqual(plan.runnable, ['tenant-environment']);
  assert.equal(plan.autonomousWorkRemaining, true);
  assert.deepEqual(plan.awaitingExternalAuthority.map(x => x.requirementKey),
    ['source-systems', 'absence-policies', 'privileged-competency']);
  controller.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('authority-only state has no autonomous work and resumes when authority arrives', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-work-controller-'));
  const customRequirements = [
    { key: 'configuration-scope', dependsOn: [] },
    { key: 'absence-policies', dependsOn: ['configuration-scope'] }
  ];
  const controller = createImplementationWorkController({
    dbPath: path.join(dir, 'state.sqlite'), requirements: customRequirements
  });
  const base = {
    requirements: [
      { key: 'configuration-scope', satisfied: true, status: 'PASS', source: 'contract', detail: {} },
      { key: 'absence-policies', satisfied: false, status: 'MISSING', source: null, detail: null }
    ]
  };
  let plan = controller.reconcile({
    runId: 'run-resume', tenant: 'tenant-a', readiness: base,
    blockerFor: item => item.key === 'absence-policies' ? 'CUSTOMER_POLICY_AUTHORITY_REQUIRED' : null
  });
  assert.equal(plan.autonomousWorkRemaining, false);
  assert.equal(plan.awaitingExternalAuthority.length, 1);
  plan = controller.reconcile({
    runId: 'run-resume', tenant: 'tenant-a', readiness: base,
    blockerFor: () => null
  });
  assert.deepEqual(plan.runnable, ['absence-policies']);
  assert.equal(plan.awaitingExternalAuthority.length, 0);
  assert.equal(plan.autonomousWorkRemaining, true);
  controller.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
