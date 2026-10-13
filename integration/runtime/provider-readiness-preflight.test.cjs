'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { providerReadinessPreflight } = require('./provider-readiness-preflight.cjs');

const connection = () => ({ id: 'synthetic-connection', productKey: 'workday', sourceInstanceId: 'synthetic-instance',
  authMethod: 'oauth2', mappingVersion: 2, grantedScopes: ['people.read'], state: 'ACTIVE',
  lastHealthAt: '2026-10-13T12:00:00Z', lastReconciliation: { status: 'PASS' },
  canonicalImport: { status: 'PASS', mappingVersion: 2 }, credentialRef: 'managed://secret-ref' });

test('complete connection metadata separates configuration from unproven auth and recovery', () => {
  const result = providerReadinessPreflight(connection());
  assert.equal(result.configuration.state, 'PRESENT');
  assert.equal(result.authentication.state, 'UNPROVEN');
  assert.equal(result.recovery.state, 'UNPROVEN');
  assert.equal(result.providerReady, false);
  assert.ok(result.authentication.blockers.includes('CURRENT_PROVIDER_AUTH_RECEIPT_REQUIRED'));
  assert.ok(result.recovery.blockers.includes('OUTAGE_REPLAY_AND_READBACK_RECEIPT_REQUIRED'));
});

test('missing config is distinct from denied auth', () => {
  const value = connection();
  value.sourceInstanceId = null;
  value.state = 'REAUTH_REQUIRED';
  const result = providerReadinessPreflight(value);
  assert.ok(result.configuration.blockers.includes('SOURCE_INSTANCE_MISSING'));
  assert.ok(result.authentication.blockers.includes('PROVIDER_AUTHORIZATION_REQUIRED'));
});

test('partial or stale import does not satisfy recovery', () => {
  const value = connection();
  value.canonicalImport.mappingVersion = 1;
  value.lastReconciliation.status = 'NEEDS_REVIEW';
  const result = providerReadinessPreflight(value);
  assert.ok(result.recovery.blockers.includes('COMPLETE_RECONCILIATION_UNPROVEN'));
  assert.ok(result.recovery.blockers.includes('CURRENT_MAPPING_IMPORT_UNPROVEN'));
});

test('missing scope and provider failure are separately visible', () => {
  const value = connection();
  value.grantedScopes = [];
  value.failureClass = 'auth_error';
  const result = providerReadinessPreflight(value);
  assert.ok(result.authentication.blockers.includes('REQUIRED_SCOPE_NOT_GRANTED'));
  assert.ok(result.authentication.blockers.includes('CURRENT_PROVIDER_FAILURE'));
});

test('invalid required scope contract fails closed', () => {
  const result = providerReadinessPreflight(connection(), { requiredScopes: [null] });
  assert.ok(result.authentication.blockers.includes('REQUIRED_SCOPE_CONTRACT_INVALID'));
});

test('credential references and source records are never returned', () => {
  const value = connection();
  value.employeeEmail = 'private@example.test';
  const output = JSON.stringify(providerReadinessPreflight(value));
  assert.ok(!output.includes('managed://'));
  assert.ok(!output.includes('private@example.test'));
});
