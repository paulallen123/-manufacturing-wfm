'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateStrictReadinessEvidence, MANDATORY_GOLDEN_JOURNEY_STEPS } = require('./readiness-evidence-contract.cjs');

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
  assert.match(validateStrictReadinessEvidence('scenario-validation', 'PASS', {
    cloudRuntime: true,
    testDataClass: 'synthetic-edge-suite',
    criticalFailures: 0,
    steps: []
  }), /Golden Journey step/);
  assert.equal(validateStrictReadinessEvidence('scenario-validation', 'PASS', {
    cloudRuntime: true,
    testDataClass: 'synthetic-edge-suite',
    criticalFailures: 0,
    correlationId: 'journey-contract-test',
    steps: MANDATORY_GOLDEN_JOURNEY_STEPS.map(id => ({ id, status: 'PASS', evidenceRef: 'proof:' + id, correlationId: 'journey-contract-test' })),
    payrollProvider:{correlationId:'journey-contract-test',batchId:'B-current',batchChecksum:'a'.repeat(64),providerBindingDigest:'b'.repeat(64),batchReceiptDigest:'c'.repeat(64),readbackDigest:'d'.repeat(64),fullPayrollVerified:true}
  }), null);
  assert.match(validateStrictReadinessEvidence('scenario-validation', 'PASS', {
    cloudRuntime: true,
    testDataClass: 'synthetic-edge-suite',
    criticalFailures: 0,
    correlationId: 'journey-a',
    steps: MANDATORY_GOLDEN_JOURNEY_STEPS.map((id,index) => ({ id, status: 'PASS', evidenceRef: 'proof:' + id, correlationId: index===0?'journey-b':'journey-a' }))
  }), /correlate every mandatory Golden Journey step/);
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


test('runtime identity defeats contradictory tenant-environment claims', () => {
  const detail = {
    fixtureOnly: false, zeroHuman: true, humanInterventions: 0,
    provisioned: true, tenantExists: true, environmentId: 'railway-runtime/tenant-alpha',
    provisioningMode: 'cloud-runtime', runtimeHealthPassed: true,
    tenantIsolationVerified: true, durableStateVerified: true,
    exactCandidateSha: 'a'.repeat(40), exactTargetDeploymentId: 'deployment-current',
    tenant: 'alpha', implementationRunId: 'run-1', verifierRunId: 'verifier-1'
  };
  assert.match(validateStrictReadinessEvidence('tenant-environment', 'PASS', detail, {
    runtimeIdentity: { candidateSha: 'a'.repeat(40), fixtureOnly: true, productionApproved: false }
  }), /runtime fixture boundary/);
});

test('semantic readiness gates reject generic candidate-bound booleans', () => {
  for (const kind of ['scheduling','approvals','clocking','payroll-mapping','resilience']) {
    assert.ok(validateStrictReadinessEvidence(kind, 'PASS', { cloudRuntime: true }), kind);
  }
  assert.match(validateStrictReadinessEvidence('payroll-mapping', 'PASS', {
    readinessClass: 'synthetic-scale', dataClass: 'synthetic-scale'
  }), /customer-specific/);
  assert.equal(validateStrictReadinessEvidence('payroll-mapping', 'PASS', {
    readinessClass: 'customer-specific', dataClass: 'customer-authorised',
    mappingAuthorityVerified: true, providerTargetVerified: true, employeeIdentityMappingVerified: true,
    payCodesVerified: true, absenceMappingVerified: true, roundingPolicyVerified: true,
    releasedBatchId: 'B-current', batchChecksum: 'a'.repeat(64), fullPayrollVerified: true
  }), null);
});

test('operational freshness expires current-state evidence', () => {
  const now = Date.now();
  const result = validateStrictReadinessEvidence('resilience', 'PASS', {
    hostedRuntime: true, faultInjected: true, detected: true, classified: true,
    repairOrContainmentApplied: true, independentVerificationPassed: true,
    durableAuditVerified: true, replaySafetyVerified: true, criticalFailures: 0
  }, { evidenceCreatedAt: new Date(now - 10000).toISOString(), nowMs: now, freshnessMaxAgeMs: 1000 });
  assert.match(result, /stale/);
});
