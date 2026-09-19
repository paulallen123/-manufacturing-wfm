'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProviderProofPlan } = require('./provider-proof-profiles.cjs');
const { verifyProviderProofResponse } = require('./provider-proof-response-verifier.cjs');

function review(providerKey) {
  return { providerKey, transport: 'api', auth: { method: 'oauth2', credentialRef: `vault://tenant/${providerKey}` } };
}

function at(now) { return new Date(now - 250).toISOString(); }

test('SuccessFactors proof verifies pinned host, OData metadata and company identity without retaining the body', () => {
  const now = Date.now();
  const plan = buildProviderProofPlan(review('sap-successfactors'), {
    apiServer: 'api.example.successfactors.test',
    companyId: 'tenant-sandbox'
  });
  const result = verifyProviderProofResponse(plan, {
    status: 200,
    finalUrl: 'https://api.example.successfactors.test/odata/v2/User/$metadata',
    headers: {
      'content-type': 'application/xml;charset=utf-8',
      'Company-Id': 'tenant-sandbox',
      'successfactors-immutable-companyid': '11111111-2222-3333-4444-555555555555'
    },
    body: '<?xml version="1.0"?><edmx:Edmx xmlns:edmx="urn:test"><edmx:DataServices/></edmx:Edmx>',
    observedAt: at(now),
    elapsedMs: 123
  }, now);
  assert.equal(result.status, 'PASS');
  assert.equal(result.providerIdentity.companyId, 'tenant-sandbox');
  assert.equal(result.responseBodyRetained, false);
  assert.equal('body' in result, false);
});

test('SuccessFactors proof fails closed when provider-reported company identity differs', () => {
  const now = Date.now();
  const plan = buildProviderProofPlan(review('sap-successfactors'), {
    apiServer: 'api.example.successfactors.test',
    companyId: 'tenant-sandbox'
  });
  assert.throws(() => verifyProviderProofResponse(plan, {
    status: 200,
    finalUrl: 'https://api.example.successfactors.test/odata/v2/User/$metadata',
    headers: { 'content-type': 'application/xml', 'Company-Id': 'other-company' },
    body: '<edmx:Edmx><edmx:DataServices/></edmx:Edmx>',
    observedAt: at(now), elapsedMs: 50
  }, now), /company identity does not match/);
});

test('NetSuite proof verifies exact account-specific host and bounded OpenAPI metadata', () => {
  const now = Date.now();
  const plan = buildProviderProofPlan(review('netsuite'), {
    accountId: '123456_SB1',
    accountSpecificDomain: '123456-sb1.suitetalk.api.netsuite.com'
  });
  const result = verifyProviderProofResponse(plan, {
    status: 200,
    finalUrl: 'https://123456-sb1.suitetalk.api.netsuite.com/services/rest/record/v1/metadata-catalog/?select=customer',
    headers: { 'content-type': 'application/swagger+json' },
    body: JSON.stringify({ openapi: '3.0.1', paths: { '/customer': { get: {} } } }),
    observedAt: at(now), elapsedMs: 81
  }, now);
  assert.equal(result.status, 'PASS');
  assert.equal(result.providerIdentity.accountId, '123456_SB1');
  assert.equal(result.providerIdentity.accountSpecificDomain, '123456-sb1.suitetalk.api.netsuite.com');
});

test('proof rejects host drift, redirects and oversized responses', () => {
  const now = Date.now();
  const plan = buildProviderProofPlan(review('netsuite'), {
    accountId: '123456_SB1',
    accountSpecificDomain: '123456-sb1.suitetalk.api.netsuite.com'
  });
  assert.throws(() => verifyProviderProofResponse(plan, {
    status: 200,
    finalUrl: 'https://other.suitetalk.api.netsuite.com/services/rest/record/v1/metadata-catalog/?select=customer',
    headers: { 'content-type': 'application/swagger+json' },
    body: JSON.stringify({ openapi: '3.0.1', paths: { '/customer': {} } }),
    observedAt: at(now), elapsedMs: 20
  }, now), /exact pinned request target/);

  const unsafePlan = { ...plan, followRedirects: true };
  assert.throws(() => verifyProviderProofResponse(unsafePlan, {
    status: 200,
    finalUrl: 'https://123456-sb1.suitetalk.api.netsuite.com/services/rest/record/v1/metadata-catalog/?select=customer',
    headers: { 'content-type': 'application/swagger+json' }, body: '{}', observedAt: at(now), elapsedMs: 20
  }, now), /reject redirects/);

  const tinyPlan = { ...plan, request: { ...plan.request, maxResponseBytes: 8 } };
  assert.throws(() => verifyProviderProofResponse(tinyPlan, {
    status: 200,
    finalUrl: 'https://123456-sb1.suitetalk.api.netsuite.com/services/rest/record/v1/metadata-catalog/?select=customer',
    headers: { 'content-type': 'application/swagger+json' }, body: '{"openapi":"3.0.1"}', observedAt: at(now), elapsedMs: 20
  }, now), /byte limit/);
});
