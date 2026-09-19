'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac, timingSafeEqual } = require('node:crypto');
const { createLaunchIntent, verifyLaunchIntent } = require('./provisioning-launch-intent.cjs');
const { createContractCompletionIngress } = require('./contract-completion-ingress.cjs');

const RECEIPT_KEY = 'internal-receipt-key-0123456789abcdef0123456789abcdef';
const PROVIDER_KEY = 'provider-test-key-0123456789abcdef0123456789abcdef';
const TRUST = { contractReceiptKey: RECEIPT_KEY };

function makeStore() {
  const data = new Map();
  return {
    durability: 'DURABLE_TRANSACTIONAL',
    transaction(fn) {
      const tx = {
        get(key) { return data.has(key) ? structuredClone(data.get(key)) : null; },
        insert(key, value) { if (data.has(key)) throw new Error('duplicate'); data.set(key, structuredClone(value)); }
      };
      return fn(tx);
    }
  };
}

function signedContract(eventId = 'evt-100') {
  const attemptTimestamp = '2026-09-19T09:41:00Z';
  const rawBody = JSON.stringify({
    type: 'contract.completed',
    contract: {
      contractId: 'ctr-1001',
      contractVersion: '7',
      tenantId: 'tenant-a',
      completedAt: '2026-09-19T03:00:00Z',
      status: 'completed'
    }
  });
  const sign = (id, ts, body) => createHmac('sha256', PROVIDER_KEY).update(id).update('\n').update(ts).update('\n').update(body).digest('hex');
  const ingress = createContractCompletionIngress(makeStore(), {
    now: () => Date.parse('2026-09-19T09:42:00Z'),
    receiptKey: RECEIPT_KEY,
    providerVerifiers: {
      'contract-provider': ({ eventId: id, attemptTimestamp: ts, rawBody: body, headers }) => {
        const expected = sign(id, String(ts), body);
        const actual = String(headers.signature || '');
        const authenticated = /^[a-f0-9]{64}$/i.test(actual) && timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
        return {
          authenticated,
          binding: { eventId: true, attemptTimestamp: true, rawBody: true },
          keyId: 'test-provider-key-v1',
          event: authenticated ? JSON.parse(body.toString('utf8')) : null
        };
      }
    }
  });
  return ingress.receive({
    provider: 'contract-provider', eventId, attemptTimestamp, rawBody,
    headers: { signature: sign(eventId, attemptTimestamp, rawBody) }
  }).contract;
}

function fixture() {
  return {
    scope: {
      graphVersion: '2026-09-19.1',
      graphFingerprint: '1'.repeat(64),
      revision: 'scope-revision-a',
      purchasedScope: ['attendance', 'time'],
      questions: [],
      operations: [
        { type: 'TEST', key: 'payroll-reconciliation' },
        { type: 'CONFIG', key: 'payroll.enabled', value: true }
      ]
    },
    contract: signedContract(),
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

test('seals final scope, verified completed contract, exact build and isolated fresh-create plan into one deterministic intent', () => {
  const input = fixture();
  const first = createLaunchIntent(input, TRUST);
  const second = createLaunchIntent({
    ...fixture(),
    scope: {
      ...fixture().scope,
      purchasedScope: ['time', 'attendance'],
      operations: [...fixture().scope.operations].reverse()
    }
  }, TRUST);

  assert.equal(first.intentDigest, second.intentDigest);
  assert.equal(first.queueKey, second.queueKey);
  assert.equal(first.scope.operationsDigest, second.scope.operationsDigest);
  assert.equal(first.scope.graphFingerprint, input.scope.graphFingerprint);
  assert.match(first.completionEvidence.receiptSha256, /^[a-f0-9]{64}$/);
  assert.equal(verifyLaunchIntent(first, input, TRUST).ok, true);
});

test('separately authenticated completion deliveries for the same contract version reuse the same queue identity', () => {
  const a = fixture();
  const b = fixture();
  b.contract = signedContract('evt-101-redelivery');

  const first = createLaunchIntent(a, TRUST);
  const replay = createLaunchIntent(b, TRUST);
  assert.equal(first.queueKey, replay.queueKey);
  assert.equal(first.intentDigest, replay.intentDigest);
  assert.notEqual(first.completionEvidence.eventId, replay.completionEvidence.eventId);
  assert.notEqual(first.completionEvidence.receiptSha256, replay.completionEvidence.receiptSha256);
  assert.equal(verifyLaunchIntent(first, b, TRUST).ok, true);
});

test('scope revision, graph definition or machine-action drift blocks a previously sealed provisioning intent', () => {
  const input = fixture();
  const intent = createLaunchIntent(input, TRUST);

  const revised = fixture();
  revised.scope.revision = 'scope-revision-b';
  expectCode(() => verifyLaunchIntent(intent, revised, TRUST), 'WFM_LAUNCH_INTENT_DRIFT');

  const redefined = fixture();
  redefined.scope.graphFingerprint = '2'.repeat(64);
  expectCode(() => verifyLaunchIntent(intent, redefined, TRUST), 'WFM_LAUNCH_INTENT_DRIFT');

  const operationChanged = fixture();
  operationChanged.scope.operations[0] = { type: 'TEST', key: 'different-test' };
  expectCode(() => verifyLaunchIntent(intent, operationChanged, TRUST), 'WFM_LAUNCH_INTENT_DRIFT');
});

test('scope graph fingerprint is mandatory and must be a SHA-256 value', () => {
  const missing = fixture();
  delete missing.scope.graphFingerprint;
  expectCode(() => createLaunchIntent(missing, TRUST), 'WFM_SCOPE_FINGERPRINT_REQUIRED');

  const malformed = fixture();
  malformed.scope.graphFingerprint = 'not-a-digest';
  expectCode(() => createLaunchIntent(malformed, TRUST), 'WFM_SCOPE_FINGERPRINT_INVALID');
});

test('approved build drift blocks the intent even when contract and scope are unchanged', () => {
  const input = fixture();
  const intent = createLaunchIntent(input, TRUST);
  const changed = fixture();
  changed.build.artifactSha256 = 'b'.repeat(64);
  expectCode(() => verifyLaunchIntent(intent, changed, TRUST), 'WFM_LAUNCH_INTENT_DRIFT');
});

test('a bare authenticated flag, missing trust key or incomplete contract cannot create a provisioning intent', () => {
  const bare = fixture();
  delete bare.contract.verificationReceipt;
  expectCode(() => createLaunchIntent(bare, TRUST), 'WFM_CONTRACT_RECEIPT_REQUIRED');

  expectCode(() => createLaunchIntent(fixture()), 'WFM_CONTRACT_RECEIPT_KEY_REQUIRED');

  const incomplete = fixture();
  incomplete.contract.status = 'sent';
  expectCode(() => createLaunchIntent(incomplete, TRUST), 'WFM_CONTRACT_NOT_COMPLETED');
});

test('tampering with a receipt-bound contract identity blocks launch', () => {
  const changed = fixture();
  changed.contract.tenantId = 'tenant-b';
  expectCode(() => createLaunchIntent(changed, TRUST), 'WFM_CONTRACT_RECEIPT_SUBJECT_MISMATCH');
});

test('unanswered launch questions cannot cross into provisioning', () => {
  const input = fixture();
  input.scope.questions = [{ id: 'payroll-system' }];
  expectCode(() => createLaunchIntent(input, TRUST), 'WFM_SCOPE_INCOMPLETE');
});

test('manual/pre-created or shared environments cannot count as autonomous provisioning proof', () => {
  const manual = fixture();
  manual.plan.creationMode = 'manual-precreated';
  manual.plan.preExistingEnvironmentId = 'env-existing';
  expectCode(() => createLaunchIntent(manual, TRUST), 'WFM_FRESH_CREATE_REQUIRED');

  const shared = fixture();
  shared.plan.isolated = false;
  expectCode(() => createLaunchIntent(shared, TRUST), 'WFM_ENVIRONMENT_NOT_ISOLATED');
});
