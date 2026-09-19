'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateStrictReadinessEvidence } = require('./readiness-evidence-contract.cjs');

test('tenant environment refuses checked-only and fixture evidence', () => {
  assert.match(validateStrictReadinessEvidence('tenant-environment', 'PASS', { checked: true }), /non-fixture/);
  assert.equal(validateStrictReadinessEvidence('tenant-environment', 'PASS', {
    fixtureOnly: false,
    provisioned: true,
    environmentId: 'railway-runtime/tenant-alpha',
    provisioningMode: 'cloud-runtime',
    healthcheckPassed: true,
    tenantIsolationVerified: true
  }), null);
});

test('source systems refuse fixture providers and unverified live claims', () => {
  assert.match(validateStrictReadinessEvidence('source-systems', 'PASS', {
    fixtureOnly: true,
    authorizationVerified: true,
    providers: []
  }), /fixtures/);
  assert.match(validateStrictReadinessEvidence('source-systems', 'PASS', {
    fixtureOnly: false,
    authorizationVerified: true,
    providers: [{ provider: 'Example', authorized: true, connected: true, mode: 'live' }]
  }), /live verification/);
  assert.equal(validateStrictReadinessEvidence('source-systems', 'PASS', {
    fixtureOnly: false,
    authorizationVerified: true,
    providers: [{ provider: 'Example Sandbox', authorized: true, connected: true, mode: 'sandbox' }]
  }), null);
});

test('historical replay requires independent exact payroll reconciliation', () => {
  assert.match(validateStrictReadinessEvidence('historical-replay', 'PASS', {
    fixtureOnly: false,
    independentCalculation: true,
    expectedTotal: 15180000,
    calculatedTotal: 15180020,
    unexplainedVariance: 20
  }), /match exactly/);
  assert.equal(validateStrictReadinessEvidence('historical-replay', 'PASS', {
    fixtureOnly: false,
    independentCalculation: true,
    expectedTotal: 15180000,
    calculatedTotal: 15180000,
    unexplainedVariance: 0
  }), null);
});

test('security, scenario and live import evidence are fail-closed', () => {
  assert.match(validateStrictReadinessEvidence('security-controls', 'PASS', {
    tenantIsolationVerified: true,
    crossTenantNegativeTests: 0,
    criticalFailures: 0
  }), /cross-tenant/);
  assert.match(validateStrictReadinessEvidence('scenario-validation', 'PASS', {
    fixtureOnly: false,
    cloudRuntime: false
  }), /cloud runtime/);
  assert.match(validateStrictReadinessEvidence('live-data-import', 'PASS', {
    fixtureOnly: false,
    sourceAuthoritative: false
  }), /authoritative/);
});

test('non-PASS evidence remains recordable for diagnostics', () => {
  assert.equal(validateStrictReadinessEvidence('source-systems', 'FAIL', { fixtureOnly: true }), null);
  assert.equal(validateStrictReadinessEvidence('tenant-environment', 'WARN', {}), null);
});
