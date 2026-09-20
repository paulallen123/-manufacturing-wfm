'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assessCustomerSetup } = require('./customer-setup-readiness.cjs');

function review(transport) {
  return {
    transport,
    providerKey: 'enterprise-provider',
    targetIdentity: 'sandbox-a',
    environment: 'sandbox',
    reviewedDigest: 'a'.repeat(64)
  };
}

test('identity setup becomes test-ready from metadata plus a protected credential reference', () => {
  const result = assessCustomerSetup(review('identity'), {
    issuerOrDirectoryId: 'directory-sandbox',
    credentialRef: 'vault://integration/identity'
  });
  assert.equal(result.readyForSafeConnectionTest, true);
  assert.deepEqual(result.missingFields, []);
  assert.equal(result.mappingConfiguredSeparately, true);
  assert.equal(result.businessRulesConfiguredSeparately, true);
  assert.equal(result.explicitActivationApprovalRequired, true);
});

test('read-only database setup reports only missing metadata and never requires mapping at connection time', () => {
  const result = assessCustomerSetup(review('read-only-db'), {
    endpoint: 'db.internal',
    database: 'workforce',
    allowedObjects: ['employees_view'],
    credentialRef: 'vault://integration/db'
  });
  assert.equal(result.readyForSafeConnectionTest, true);
  assert.deepEqual(result.missingFields, []);
  assert.ok(result.acceptedFieldNames.includes('allowedObjects'));
});

test('raw secret fields are rejected without echoing secret values', () => {
  const secret = 'do-not-echo-this-value';
  const result = assessCustomerSetup(review('read-only-db'), {
    endpoint: 'db.internal',
    database: 'workforce',
    allowedObjects: ['employees_view'],
    credentialRef: 'vault://integration/db',
    password: secret
  });
  assert.equal(result.readyForSafeConnectionTest, false);
  assert.deepEqual(result.rejectedRawSecretFields, ['password']);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('missing identity metadata is actionable and does not consume a connection test', () => {
  const result = assessCustomerSetup(review('identity'), {
    credentialRef: 'vault://integration/identity'
  });
  assert.equal(result.readyForSafeConnectionTest, false);
  assert.deepEqual(result.missingFields, ['issuerOrDirectoryId']);
  assert.match(result.nextAction, /complete only the missing metadata/i);
});
