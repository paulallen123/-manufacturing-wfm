'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ENVIRONMENT_BINDING_VERSION,
  deriveProvisioningEnvironmentBinding,
  assertProvisioningEnvironmentBinding
} = require('./provisioning-environment-binding.cjs');

function record(overrides = {}) {
  return {
    queueKey: 'wfm-provision:v1:' + 'a'.repeat(64),
    intentDigest: 'b'.repeat(64),
    providerRequestId: 'wfm-create-' + 'c'.repeat(40),
    payload: {
      plan: { provider: 'railway', region: 'eu-west' },
      contract: { tenantId: 'Tenant / North #42' }
    },
    ...overrides
  };
}

test('derives the same exact environment binding after a process restart', () => {
  const original = deriveProvisioningEnvironmentBinding(record());
  const restarted = deriveProvisioningEnvironmentBinding(structuredClone(record()));
  assert.deepEqual(restarted, original);
  assert.equal(original.bindingVersion, ENVIRONMENT_BINDING_VERSION);
  assert.match(original.environmentName, /^wfm-tenant-north-42-[a-f0-9]{12}$/);
  assert.match(original.bindingDigest, /^[a-f0-9]{64}$/);
});

test('changing request or sealed intent changes the environment binding', () => {
  const original = deriveProvisioningEnvironmentBinding(record());
  const changedRequest = deriveProvisioningEnvironmentBinding(record({ providerRequestId: 'wfm-create-' + 'd'.repeat(40) }));
  const changedIntent = deriveProvisioningEnvironmentBinding(record({ intentDigest: 'e'.repeat(64) }));
  assert.notEqual(changedRequest.environmentName, original.environmentName);
  assert.notEqual(changedIntent.environmentName, original.environmentName);
  assert.notEqual(changedRequest.bindingDigest, original.bindingDigest);
  assert.notEqual(changedIntent.bindingDigest, original.bindingDigest);
});

test('tampered recovered names are rejected rather than silently redirected', () => {
  const expected = deriveProvisioningEnvironmentBinding(record());
  assert.deepEqual(assertProvisioningEnvironmentBinding(record(), expected), expected);
  assert.throws(
    () => assertProvisioningEnvironmentBinding(record(), { ...expected, environmentName: 'wfm-manual-environment' }),
    error => error.code === 'WFM_ENV_BINDING_MISMATCH'
  );
});
