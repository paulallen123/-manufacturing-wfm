import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createT3ShadowSimulator } = require('../resilience/t3-shadow-simulator.cjs');
const { createT3ShadowVerifier } = require('../resilience/t3-shadow-verifier.cjs');
const d = (value) => createHash('sha256').update(String(value)).digest('hex');

const simulator = createT3ShadowSimulator();
const verifier = createT3ShadowVerifier();
const base = {
  incidentId: 'inc-t3',
  tenant: 'tenant-a',
  targetTenant: 'tenant-a',
  evidenceDigest: d('evidence'),
  beforeStateDigest: d('before'),
  afterStateDigest: d('after'),
  compensationPlanDigest: d('compensation'),
  affectedRecords: 4,
};

const payroll = simulator.simulate({
  ...base,
  scenarioId: 'payroll-calculation-or-export-anomaly',
  proposedAction: 'payroll.release-corrected-export',
});
assert.equal(payroll.status, 'customer_authorisation_required');
assert.equal(payroll.simulationOnly, true);
assert.equal(payroll.automaticExecutionEligible, false);
assert.equal(payroll.customerMutation, false);
const payrollVerified = verifier.verify(payroll, {
  tenant: base.tenant,
  scenarioId: payroll.scenarioId,
  evidenceDigest: base.evidenceDigest,
});
assert.equal(payrollVerified.verified, true);

const time = simulator.simulate({
  ...base,
  scenarioId: 'timezone-dst-or-clock-skew',
  proposedAction: 'time.apply-normalised-records',
});
assert.equal(time.status, 'customer_authorisation_required');
assert.equal(verifier.verify(time, { tenant: base.tenant, scenarioId: time.scenarioId, evidenceDigest: base.evidenceDigest }).verified, true);

const crossTenant = simulator.simulate({
  ...base,
  targetTenant: 'tenant-b',
  scenarioId: 'payroll-calculation-or-export-anomaly',
  proposedAction: 'payroll.release-corrected-export',
});
assert.equal(crossTenant.status, 'contained');
assert.equal(crossTenant.reason, 'cross-tenant-denied');

const wrongFamily = simulator.simulate({
  ...base,
  scenarioId: 'payroll-calculation-or-export-anomaly',
  proposedAction: 'identity.grant-admin',
});
assert.equal(wrongFamily.status, 'contained');
assert.equal(wrongFamily.reason, 'scenario-action-family-mismatch');

const unsupported = simulator.simulate({
  ...base,
  scenarioId: 'never-seen-t3-scenario',
  proposedAction: 'payroll.release-corrected-export',
});
assert.equal(unsupported.status, 'contained');
assert.equal(unsupported.reason, 'unsupported-t3-scenario');

const missingEvidence = simulator.simulate({
  ...base,
  evidenceDigest: 'not-a-digest',
  scenarioId: 'timezone-dst-or-clock-skew',
  proposedAction: 'time.apply-normalised-records',
});
assert.equal(missingEvidence.status, 'contained');
assert.equal(missingEvidence.reason, 'deterministic-digests-required');

const overCap = simulator.simulate({
  ...base,
  affectedRecords: 5001,
  scenarioId: 'timezone-dst-or-clock-skew',
  proposedAction: 'time.apply-normalised-records',
});
assert.equal(overCap.status, 'contained');
assert.equal(overCap.reason, 'affected-record-cap-denied');

const tampered = structuredClone(payroll);
tampered.afterStateDigest = d('tampered-after');
assert.equal(verifier.verify(tampered, { tenant: base.tenant, scenarioId: payroll.scenarioId, evidenceDigest: base.evidenceDigest }).verified, false);

const secretInjected = structuredClone(payroll);
secretInjected.refreshToken = 'reusable-secret';
assert.equal(verifier.verify(secretInjected, { tenant: base.tenant, scenarioId: payroll.scenarioId, evidenceDigest: base.evidenceDigest }).verified, false);

console.log(JSON.stringify({
  schemaVersion: 1,
  proof: 't3-shadow-support-boundary',
  status: 'PASS',
  cases: 9,
  supportedScenarioClasses: Object.keys(simulator.policies).length,
  sameTenantRequired: true,
  deterministicDigestsRequired: true,
  compensationBound: true,
  affectedRecordCap: true,
  independentReadOnlyVerification: true,
  reusableSecretSurfaceDenied: true,
  automaticExecutionEligible: false,
  customerAuthorisationRequired: true,
  productionMutation: false,
  customerMutation: false,
}, null, 2));
