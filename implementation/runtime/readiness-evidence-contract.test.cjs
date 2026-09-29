'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateStrictReadinessEvidence } = require('./readiness-evidence-contract.cjs');

test('tenant environment refuses weak, fixture or human-assisted evidence', () => {
  assert.match(validateStrictReadinessEvidence('tenant-environment', 'PASS', { checked: true }), /non-fixture/);
  assert.match(validateStrictReadinessEvidence('tenant-environment', 'PASS', {
    fixtureOnly: false,
    zeroHuman: false,
    humanInterventions: 1
  }), /zero-human/);
  const deploymentCreatedAt = new Date(Date.now() - 60000).toISOString();
  assert.equal(validateStrictReadinessEvidence('tenant-environment', 'PASS', {
    fixtureOnly: false, zeroHuman: true, humanInterventions: 0,
    provisioned: true, tenantExists: true, environmentId: 'railway-runtime/tenant-alpha',
    provisioningMode: 'cloud-runtime', runtimeHealthPassed: true, healthcheckPassed: true,
    tenantIsolationVerified: true, crossTenantNegativeTests: 1, durableStateVerified: true,
    exactCandidateSha: 'a'.repeat(40), exactTargetDeploymentId: 'deployment-current',
    tenant: 'alpha', implementationRunId: 'run-1', verifierRunId: 'verifier-1',
    proofRunnerIdentity: 'unit-test-runner', targetDeploymentCreatedAt: deploymentCreatedAt,
    evidenceGeneratedAt: new Date().toISOString()
  }), null);
});

test('source systems require zero-human discovery, authorisation and a real provider receipt', () => {
  assert.match(validateStrictReadinessEvidence('source-systems', 'PASS', {
    fixtureOnly: true,
    authorizationVerified: true,
    providers: []
  }), /fixtures/);
  assert.match(validateStrictReadinessEvidence('source-systems', 'PASS', {
    fixtureOnly: false,
    zeroHuman: true,
    humanInterventions: 0,
    discoveryCompleted: true,
    authorizationVerified: true,
    providers: [{ provider: 'Example', discovered: true, authorized: true, connected: true, mode: 'live' }]
  }), /live verification/);
  assert.equal(validateStrictReadinessEvidence('source-systems', 'PASS', {
    fixtureOnly: false,
    zeroHuman: true,
    humanInterventions: 0,
    discoveryCompleted: true,
    authorizationVerified: true,
    providers: [{ provider: 'Example Sandbox', discovered: true, authorized: true, connected: true, mode: 'sandbox' }]
  }), null);
});

test('historical replay labels its data class and requires independent exact payroll reconciliation', () => {
  assert.match(validateStrictReadinessEvidence('historical-replay', 'PASS', {
    independentCalculation: true,
    expectedTotal: 15180000,
    calculatedTotal: 15180020,
    unexplainedVariance: 20
  }), /declare/);
  assert.match(validateStrictReadinessEvidence('historical-replay', 'PASS', {
    dataClass: 'synthetic-scale',
    independentCalculation: true,
    expectedTotal: 15180000,
    calculatedTotal: 15180020,
    unexplainedVariance: 20
  }), /match exactly/);
  assert.equal(validateStrictReadinessEvidence('historical-replay', 'PASS', {
    dataClass: 'synthetic-scale',
    independentCalculation: true,
    expectedTotal: 15180000,
    calculatedTotal: 15180000,
    unexplainedVariance: 0
  }), null);
});

test('security, scenario and live import evidence are fail-closed without overstating synthetic tests', () => {
  assert.match(validateStrictReadinessEvidence('security-controls', 'PASS', {
    cloudRuntime: true,
    tenantIsolationVerified: true,
    crossTenantNegativeTests: 0,
    criticalFailures: 0
  }), /cross-tenant/);
  assert.match(validateStrictReadinessEvidence('scenario-validation', 'PASS', {
    cloudRuntime: false,
    testDataClass: 'synthetic-edge-suite'
  }), /cloud runtime/);
  assert.equal(validateStrictReadinessEvidence('scenario-validation', 'PASS', {
    cloudRuntime: true,
    testDataClass: 'synthetic-edge-suite'
  }), null);
  assert.match(validateStrictReadinessEvidence('live-data-import', 'PASS', {
    fixtureOnly: false,
    zeroHuman: true,
    humanInterventions: 0,
    sourceAuthoritative: false
  }), /authoritative/);
});

test('non-PASS evidence remains recordable for diagnostics', () => {
  assert.equal(validateStrictReadinessEvidence('source-systems', 'FAIL', { fixtureOnly: true }), null);
  assert.equal(validateStrictReadinessEvidence('tenant-environment', 'WARN', {}), null);
});
