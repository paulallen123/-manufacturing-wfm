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
  assert.deepEqual(result.invalidProtectedReferenceFields, []);
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

test('credentialRef must be an approved protected reference, not an opaque credential value', () => {
  const secretLikeValue = 'plain-client-secret-value';
  const result = assessCustomerSetup(review('identity'), {
    issuerOrDirectoryId: 'directory-sandbox',
    credentialRef: secretLikeValue
  });
  assert.equal(result.readyForSafeConnectionTest, false);
  assert.deepEqual(result.invalidProtectedReferenceFields, ['credentialRef']);
  assert.equal(result.acceptedFieldNames.includes('credentialRef'), false);
  assert.equal(JSON.stringify(result).includes(secretLikeValue), false);
});

test('empty collection metadata is treated as missing instead of test-ready', () => {
  const result = assessCustomerSetup(review('read-only-db'), {
    endpoint: 'db.internal',
    database: 'workforce',
    allowedObjects: [],
    credentialRef: 'vault://integration/db'
  });
  assert.equal(result.readyForSafeConnectionTest, false);
  assert.deepEqual(result.missingFields, ['allowedObjects']);
});

test('missing identity metadata is actionable and does not consume a connection test', () => {
  const result = assessCustomerSetup(review('identity'), {
    credentialRef: 'vault://integration/identity'
  });
  assert.equal(result.readyForSafeConnectionTest, false);
  assert.deepEqual(result.missingFields, ['issuerOrDirectoryId']);
  assert.match(result.nextAction, /complete only the missing metadata/i);
});
