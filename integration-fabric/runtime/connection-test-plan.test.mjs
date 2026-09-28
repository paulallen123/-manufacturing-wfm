import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSafeConnectionTest,
  validateConnectionEvidence,
  evaluateActivation,
  fingerprint
} from './connection-test-plan.mjs';

const NOW = Date.parse('2026-09-19T10:45:00.000Z');

function plan(overrides = {}) {
  return buildSafeConnectionTest({
    providerKey: 'oracle-netsuite',
    sourceInstanceId: 'acct-sandbox-1',
    environment: 'sandbox',
    adapter: 'http-json',
    authMethod: 'oauth2',
    credentialRef: 'vault://tenant/alpha/netsuite',
    capabilities: ['query', 'metadata'],
    requestedSemanticScopes: ['finance.read'],
    ...overrides
  });
}

function evidenceFor(p, overrides = {}) {
  return {
    configurationFingerprint: p.configurationFingerprint,
    providerKey: p.configuration.providerKey,
    sourceInstanceId: p.configuration.sourceInstanceId,
    environment: p.configuration.environment,
    readOnly: true,
    rawCredentialObserved: false,
    employeeOrPayrollDataObserved: false,
    latencyMs: 82,
    observedAt: '2026-09-19T10:44:00.000Z',
    steps: p.steps.map(step => ({ id: step.id, status: 'PASS' })),
    ...overrides
  };
}

test('safe connection test is metadata-only unless data sampling is explicitly approved', () => {
  const p = plan();
  assert.equal(p.configuration.dataProbeApproved, false);
  assert.equal(p.steps.some(step => step.id === 'bounded-data-read'), false);
  assert.equal(p.configuration.allowWrites, false);
});

test('production proof and writes fail closed without explicit approval', () => {
  assert.throws(() => plan({ environment: 'production' }), /explicit approval/);
  assert.throws(() => plan({ allowWrites: true }), /cannot include write authority/);
});

test('connection evidence is bound to exact provider, tenant/system, environment and configuration', () => {
  const p = plan();
  const ok = validateConnectionEvidence(p, evidenceFor(p), { nowMs: NOW });
  assert.equal(ok.status, 'CONNECTION_VERIFIED');
  assert.deepEqual(ok.reasons, []);

  const changed = validateConnectionEvidence(p, evidenceFor(p, { sourceInstanceId: 'other-account' }), { nowMs: NOW });
  assert.equal(changed.status, 'REJECTED');
  assert.ok(changed.reasons.includes('source-instance-mismatch'));
});

test('unapproved employee/payroll data and missing latency fail connection proof', () => {
  const p = plan();
  const result = validateConnectionEvidence(p, evidenceFor(p, {
    employeeOrPayrollDataObserved: true,
    latencyMs: null
  }), { nowMs: NOW });
  assert.equal(result.status, 'REJECTED');
  assert.ok(result.reasons.includes('unapproved-business-data-observed'));
  assert.ok(result.reasons.includes('latency-not-measured'));
});

test('event/file/queue style transports require real recovery proof before activation', () => {
  const p = plan({ adapter: 'event-stream', dataProbeApproved: true });
  const connectionEvidence = validateConnectionEvidence(p, evidenceFor(p, { employeeOrPayrollDataObserved: true }), { nowMs: NOW });
  const mappingFingerprint = fingerprint({ version: 4, fields: ['employeeId', 'department'] });
  const base = {
    connectionEvidence,
    mappingApproval: { status: 'APPROVED', mappingFingerprint },
    reconciliation: {
      status: 'PASS',
      observedAt: '2026-09-19T10:44:30.000Z',
      configurationFingerprint: p.configurationFingerprint,
      mappingFingerprint
    },
    activationApproval: {
      status: 'APPROVED',
      configurationFingerprint: p.configurationFingerprint,
      mappingFingerprint
    },
    recoveryProofRequired: p.recoveryProofRequired,
    automaticActivationAllowed: p.automaticActivationAllowed
  };

  const blocked = evaluateActivation(base, { nowMs: NOW });
  assert.equal(blocked.status, 'BLOCKED');
  assert.ok(blocked.reasons.includes('recovery-not-proven'));

  const ready = evaluateActivation({
    ...base,
    recoveryEvidence: {
      status: 'PASS',
      sameOperationRecovered: true,
      reconciledAfterRecovery: true
    }
  }, { nowMs: NOW });
  assert.equal(ready.status, 'READY_FOR_ACTIVATION');
});

test('approval or reconciliation from a different mapping/configuration cannot be reused', () => {
  const p = plan({ dataProbeApproved: true });
  const connectionEvidence = validateConnectionEvidence(p, evidenceFor(p, { employeeOrPayrollDataObserved: true }), { nowMs: NOW });
  const mappingFingerprint = fingerprint({ version: 2, fields: ['employeeId'] });
  const result = evaluateActivation({
    connectionEvidence,
    mappingApproval: { status: 'APPROVED', mappingFingerprint },
    reconciliation: {
      status: 'PASS',
      observedAt: '2026-09-19T10:44:30.000Z',
      configurationFingerprint: p.configurationFingerprint,
      mappingFingerprint: 'wrong'
    },
    activationApproval: {
      status: 'APPROVED',
      configurationFingerprint: p.configurationFingerprint,
      mappingFingerprint
    },
    recoveryProofRequired: false,
    automaticActivationAllowed: true
  }, { nowMs: NOW });
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.includes('reconciliation-mapping-mismatch'));
});

test('identity provisioning profile never auto-activates even when evidence is complete', () => {
  const p = plan({ adapter: 'scim2', dataProbeApproved: true });
  const connectionEvidence = validateConnectionEvidence(p, evidenceFor(p, { employeeOrPayrollDataObserved: true }), { nowMs: NOW });
  const mappingFingerprint = fingerprint({ version: 1, fields: ['employeeId'] });
  const result = evaluateActivation({
    connectionEvidence,
    mappingApproval: { status: 'APPROVED', mappingFingerprint },
    reconciliation: {
      status: 'PASS',
      observedAt: '2026-09-19T10:44:30.000Z',
      configurationFingerprint: p.configurationFingerprint,
      mappingFingerprint
    },
    activationApproval: {
      status: 'APPROVED',
      configurationFingerprint: p.configurationFingerprint,
      mappingFingerprint
    },
    recoveryProofRequired: p.recoveryProofRequired,
    automaticActivationAllowed: p.automaticActivationAllowed
  }, { nowMs: NOW });
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.includes('manual-activation-required'));
});
