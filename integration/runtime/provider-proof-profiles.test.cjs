'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProviderProofPlan } = require('./provider-proof-profiles.cjs');

function review(providerKey, authMethod = 'oauth2') {
  return {
    providerKey,
    transport: 'api',
    auth: { method: authMethod, credentialRef: `vault://tenant/${providerKey}` }
  };
}

test('SuccessFactors proof reads bounded service metadata only', () => {
  const plan = buildProviderProofPlan(review('sap-successfactors'), {
    apiServer: 'api.example.successfactors.test',
    companyId: 'tenant-sandbox'
  });
  assert.equal(plan.request.method, 'GET');
  assert.match(plan.request.path, /\$metadata$/);
  assert.equal(plan.request.headers.Accept, 'application/atom+xml');
  assert.equal(plan.request.recordsAllowed, false);
  assert.equal(plan.request.redirectPolicy, 'error');
  assert.equal(plan.targetOrigin, 'https://api.example.successfactors.test');
  assert.equal(plan.followRedirects, false);
  assert.equal(plan.nonMutating, true);
  assert.equal(plan.activationAllowedFromThisProofAlone, false);
});

test('NetSuite proof binds account id to the account-specific REST domain', () => {
  const plan = buildProviderProofPlan(review('netsuite'), {
    accountId: '123456_SB1',
    accountSpecificDomain: '123456-sb1.suitetalk.api.netsuite.com'
  });
  assert.match(plan.request.path, /metadata-catalog/);
  assert.equal(plan.request.headers.Accept, 'application/swagger+json');
  assert.equal(plan.pinnedHost, '123456-sb1.suitetalk.api.netsuite.com');
  assert.equal(plan.boundedMetadataOnly, true);

  assert.throws(() => buildProviderProofPlan(review('netsuite'), {
    accountId: '123456_SB1',
    accountSpecificDomain: 'other.suitetalk.api.netsuite.com'
  }), /does not match/);
});

test('provider proof refuses redirect-prone or ambiguous target strings', () => {
  assert.throws(() => buildProviderProofPlan(review('sap-successfactors'), {
    apiServer: 'https://api.example.successfactors.test/odata/v2',
    companyId: 'tenant-sandbox'
  }), /plain HTTPS hostname/);

  assert.throws(() => buildProviderProofPlan(review('sap-successfactors'), {
    apiServer: 'api.example.successfactors.test:8443',
    companyId: 'tenant-sandbox'
  }), /plain HTTPS hostname/);
});

test('provider proof refuses transport-valid authentication that is not approved for that provider', () => {
  assert.throws(() => buildProviderProofPlan(review('netsuite', 'service-account'), {
    accountId: '123456_SB1',
    accountSpecificDomain: '123456-sb1.suitetalk.api.netsuite.com'
  }), /not approved/);
});

test('provider proof profile remains separate from mapping and WFM rules', () => {
  const plan = buildProviderProofPlan(review('sap-successfactors'), {
    apiServer: 'api.example.successfactors.test',
    companyId: 'tenant-sandbox'
  });
  assert.equal('mapping' in plan, false);
  assert.equal('businessRules' in plan, false);
  assert.equal(plan.containsSensitiveData, false);
});
