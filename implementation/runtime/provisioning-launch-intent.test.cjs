'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLaunchIntent, verifyLaunchIntent } = require('./provisioning-launch-intent.cjs');

function fixture() {
  return {
    scope: {
      graphVersion: '2026-09-19.1',
      revision: 'scope-revision-a',
      purchasedScope: ['attendance', 'time'],
      questions: [],
      operations: [
        { type: 'TEST', key: 'payroll-reconciliation' },
        { type: 'CONFIG', key: 'payroll.enabled', value: true }
      ]
    },
    contract: {
      authenticated: true,
      provider: 'contract-provider',
      contractId: 'ctr-1001',
      contractVersion: '7',
      tenantId: 'tenant-a',
      completedAt: '2026-09-19T03:00:00Z',
      status: 'completed',
      eventId: 'evt-100'
    },
    build: {
      approved: true,
      sourceRevision: 'a973f2b047411014357f09045e1305c8b41f9765',
      artifactSha256: 'a'.repeat(64),
      approvalId: 'release-approval-77'
    },
    plan: {
      provider: 'railway',
      region: 'eu-west',
      creationMode: 'fresh-provider-create',
      isolated: true,
      networkPolicy: 'private-until-ready',
      secretsPolicy: 'server-managed-per-tenant'
    }
  };
}

function expectCode(fn, code) {
  assert.throws(fn, error => error && error.code === code);
}

test('seals final scope, completed contract, exact build and isolated fresh-create plan into one deterministic intent', () => {
  const input = fixture();
  const first = createLaunchIntent(input);
  const second = createLaunchIntent({
    ...fixture(),
    scope: {
      ...fixture().scope,
      purchasedScope: ['time', 'attendance'],
      operations: [...fixture().scope.operations].reverse()
    }
  });

  assert.equal(first.intentDigest, second.intentDigest);
  assert.equal(first.queueKey, second.queueKey);
  assert.equal(first.scope.operationsDigest, second.scope.operationsDigest);
  assert.equal(verifyLaunchIntent(first, input).ok, true);
});

test('duplicate authenticated completion events for the same contract version reuse the same queue identity', () => {
  const a = fixture();
  const b = fixture();
  b.contract.eventId = 'evt-101-redelivery';

  const first = createLaunchIntent(a);
  const replay = createLaunchIntent(b);
  assert.equal(first.queueKey, replay.queueKey);
  assert.equal(first.intentDigest, replay.intentDigest);
  assert.notEqual(first.completionEvidence.eventId, replay.completionEvidence.eventId);
  assert.equal(verifyLaunchIntent(first, b).ok, true);
});

test('scope revision or machine-action drift blocks a previously sealed provisioning intent', () => {
  const input = fixture();
  const intent = createLaunchIntent(input);

  const revised = fixture();
  revised.scope.revision = 'scope-revision-b';
  expectCode(() => verifyLaunchIntent(intent, revised), 'WFM_LAUNCH_INTENT_DRIFT');

  const operationChanged = fixture();
  operationChanged.scope.operations[0] = { type: 'TEST', key: 'different-test' };
  expectCode(() => verifyLaunchIntent(intent, operationChanged), 'WFM_LAUNCH_INTENT_DRIFT');
});

test('approved build drift blocks the intent even when contract and scope are unchanged', () => {
  const input = fixture();
  const intent = createLaunchIntent(input);
  const changed = fixture();
  changed.build.artifactSha256 = 'b'.repeat(64);
  expectCode(() => verifyLaunchIntent(intent, changed), 'WFM_LAUNCH_INTENT_DRIFT');
});

test('unauthenticated or incomplete contract events cannot create a provisioning intent', () => {
  const unauthenticated = fixture();
  unauthenticated.contract.authenticated = false;
  expectCode(() => createLaunchIntent(unauthenticated), 'WFM_CONTRACT_EVENT_UNAUTHENTICATED');

  const incomplete = fixture();
  incomplete.contract.status = 'sent';
  expectCode(() => createLaunchIntent(incomplete), 'WFM_CONTRACT_NOT_COMPLETED');
});

test('unanswered launch questions cannot cross into provisioning', () => {
  const input = fixture();
  input.scope.questions = [{ id: 'payroll-system' }];
  expectCode(() => createLaunchIntent(input), 'WFM_SCOPE_INCOMPLETE');
});

test('manual/pre-created or shared environments cannot count as autonomous provisioning proof', () => {
  const manual = fixture();
  manual.plan.creationMode = 'manual-precreated';
  manual.plan.preExistingEnvironmentId = 'env-existing';
  expectCode(() => createLaunchIntent(manual), 'WFM_FRESH_CREATE_REQUIRED');

  const shared = fixture();
  shared.plan.isolated = false;
  expectCode(() => createLaunchIntent(shared), 'WFM_ENVIRONMENT_NOT_ISOLATED');
});
