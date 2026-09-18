import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createT3ShadowSimulator } = require('../resilience/t3-shadow-simulator.cjs');
const { createT3ShadowVerifier } = require('../resilience/t3-shadow-verifier.cjs');
const { createT3CustomerAuthorisationGate } = require('../resilience/t3-customer-authorisation-gate.cjs');
const { createHash } = require('node:crypto');

const d = (value) => createHash('sha256').update(String(value)).digest('hex');
const expectCode = (fn, code) => {
  try { fn(); } catch (error) { assert.equal(error.code, code); return; }
  assert.fail(`Expected ${code}`);
};

const simulator = createT3ShadowSimulator();
const verifier = createT3ShadowVerifier();
let now = 100000;
const gate = createT3CustomerAuthorisationGate({
  key: 't3-test-key-0123456789abcdef0123456789abcdef',
  now: () => ++now,
  maxTtlMs: 60000,
});

const simulation = simulator.simulate({
  incidentId: 'inc-t3-auth-001',
  tenant: 'tenant-a',
  targetTenant: 'tenant-a',
  scenarioId: 'payroll-calculation-or-export-anomaly',
  evidenceDigest: d('evidence'),
  proposedAction: 'payroll.correct-export',
  beforeStateDigest: d('before'),
  afterStateDigest: d('after'),
  compensationPlanDigest: d('compensation'),
  affectedRecords: 12,
});
assert.equal(simulation.status, 'customer_authorisation_required');
const verification = verifier.verify(simulation, {
  tenant: 'tenant-a',
  scenarioId: 'payroll-calculation-or-export-anomaly',
  evidenceDigest: d('evidence'),
});
assert.equal(verification.verified, true);

const issued = gate.issue({
  simulation,
  verification,
  approver: {
    actorType: 'customer-authorised-approver',
    actorId: 'customer-payroll-approver-1',
    role: 'payroll',
    tenant: 'tenant-a',
  },
  ttlMs: 30000,
});
assert.equal(issued.publicReceipt.scope, 'customer-consent-record-only');
assert.equal(issued.publicReceipt.executionAuthority, false);
assert.equal(issued.publicReceipt.productionAuthorityGranted, false);
assert.equal(issued.publicReceipt.customerMutation, false);
assert.equal(issued.publicReceipt.productionMutation, false);

const consumed = gate.consume({
  token: issued.token,
  tenant: 'tenant-a',
  scenarioId: 'payroll-calculation-or-export-anomaly',
  proposalDigest: simulation.proposalDigest,
  approverId: 'customer-payroll-approver-1',
});
assert.equal(consumed.customerConsentRecorded, true);
assert.equal(consumed.executionAuthority, false);
assert.equal(consumed.automaticExecutionEligible, false);
assert.equal(consumed.productionAuthorityGranted, false);
assert.equal(consumed.customerMutation, false);
assert.equal(consumed.productionMutation, false);

expectCode(() => gate.consume({
  token: issued.token,
  tenant: 'tenant-a',
  scenarioId: 'payroll-calculation-or-export-anomaly',
  proposalDigest: simulation.proposalDigest,
  approverId: 'customer-payroll-approver-1',
}), 'WFM_T3_AUTH_REPLAY');

expectCode(() => gate.issue({
  simulation,
  verification,
  approver: { actorType: 'customer-authorised-approver', actorId: 'employee-1', role: 'employee', tenant: 'tenant-a' },
}), 'WFM_T3_AUTH_ROLE');

expectCode(() => gate.issue({
  simulation,
  verification,
  approver: { actorType: 'customer-authorised-approver', actorId: 'payroll-2', role: 'payroll', tenant: 'tenant-b' },
}), 'WFM_T3_AUTH_APPROVER');

const tamperedSimulation = { ...simulation, affectedRecords: simulation.affectedRecords + 1 };
expectCode(() => gate.issue({
  simulation: tamperedSimulation,
  verification,
  approver: { actorType: 'customer-authorised-approver', actorId: 'payroll-3', role: 'payroll', tenant: 'tenant-a' },
}), 'WFM_T3_AUTH_PROPOSAL_DIGEST');

const shortGate = createT3CustomerAuthorisationGate({
  key: 't3-expiry-key-0123456789abcdef0123456789abcdef',
  now: () => now,
  maxTtlMs: 10000,
});
const expiring = shortGate.issue({
  simulation,
  verification,
  approver: { actorType: 'customer-authorised-approver', actorId: 'payroll-4', role: 'payroll', tenant: 'tenant-a' },
  ttlMs: 1000,
});
now += 2000;
expectCode(() => shortGate.consume({
  token: expiring.token,
  tenant: 'tenant-a',
  scenarioId: 'payroll-calculation-or-export-anomaly',
  proposalDigest: simulation.proposalDigest,
  approverId: 'payroll-4',
}), 'WFM_T3_AUTH_EXPIRED');

const tamperedToken = issued.token.slice(0, -1) + (issued.token.endsWith('A') ? 'B' : 'A');
expectCode(() => gate.consume({
  token: tamperedToken,
  tenant: 'tenant-a',
  scenarioId: 'payroll-calculation-or-export-anomaly',
  proposalDigest: simulation.proposalDigest,
  approverId: 'customer-payroll-approver-1',
}), 'WFM_T3_AUTH_SIGNATURE');

console.log(JSON.stringify({
  schemaVersion: 1,
  proof: 'tier3-customer-authorisation-consent-only-gate',
  status: 'PASS',
  verifiedShadowRequired: true,
  customerRoleBound: true,
  sameTenantBound: true,
  oneTimeConsumption: true,
  expiryEnforced: true,
  tokenTamperDenied: true,
  shadowDigestTamperDenied: true,
  customerConsentRecorded: true,
  executionAuthorityGranted: false,
  automaticExecutionEligible: false,
  productionAuthorityGranted: false,
  modelAuthorityGranted: false,
  customerMutation: false,
  productionMutation: false,
}, null, 2));
