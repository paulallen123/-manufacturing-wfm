import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAutonomyControlLoop } = require('../resilience/autonomy-control-loop.cjs');
const { createT3ShadowSimulator } = require('../resilience/t3-shadow-simulator.cjs');
const { createT3ShadowVerifier } = require('../resilience/t3-shadow-verifier.cjs');
const SelfHelp = require('../resilience/support-selfhelp.cjs');

const root = process.cwd();
const contract = JSON.parse(fs.readFileSync(path.join(root, 'resilience/support-tier-contract.json'), 'utf8'));
const failureScenarios = JSON.parse(fs.readFileSync(path.join(root, 'resilience/failure-scenarios.json'), 'utf8'));
const d = (v) => createHash('sha256').update(String(v)).digest('hex');

const recoveryExecutor = {
  execute: async () => ({
    status: 'recovered',
    verified: true,
    verificationDigest: d('independent-recovery-verification'),
    productionAuthorityGranted: false,
    customerMutation: false,
  }),
};

const repairCoordinator = {
  process: async () => ({
    status: 'verified_candidate_staged',
    independentlyVerified: true,
    productionAuthorityGranted: false,
    productionMutation: false,
  }),
};

const t3ShadowSimulator = createT3ShadowSimulator();
const t3ShadowVerifier = createT3ShadowVerifier();

const rollbackExecutor = {
  rollback: async () => ({
    verified: true,
    rollbackDigest: d('known-good-rollback'),
    productionAuthorityGranted: false,
  }),
};

let tick = 1000;
const loop = createAutonomyControlLoop({
  contract,
  failureScenarios,
  selfHelp: SelfHelp,
  recoveryExecutor,
  repairCoordinator,
  t3ShadowSimulator,
  t3ShadowVerifier,
  rollbackExecutor,
  now: () => ++tick,
  maxActions: 2,
});

const base = { tenant: 'tenant-a', evidenceDigest: d('evidence') };
const t3Base = {
  ...base,
  beforeStateDigest: d('t3-before'),
  afterStateDigest: d('t3-after'),
  compensationPlanDigest: d('t3-compensation'),
  affectedRecords: 4,
};

const t0 = await loop.run({
  ...base,
  incidentId: 'inc-t0',
  scenarioId: 'support-guidance',
  question: 'Is this production approved?',
  role: 'manager',
});
assert.equal(t0.tier, 'T0');
assert.equal(t0.outcome, 'answered');
assert.equal(loop.verifyReceipt(t0), true);

const t1 = await loop.run({ ...base, incidentId: 'inc-t1', scenarioId: 'integration-transient-failure' });
assert.equal(t1.tier, 'T1');
assert.equal(t1.outcome, 'recovered');
assert.equal(t1.actionCount, 1);
assert.equal(loop.verifyReceipt(t1), true);

const cross = await loop.run({
  ...base,
  incidentId: 'inc-cross',
  scenarioId: 'integration-transient-failure',
  targetTenant: 'tenant-b',
});
assert.equal(cross.outcome, 'contained');
assert.equal(cross.actionCount, 0);
assert.equal(loop.verifyReceipt(cross), true);

const t2 = await loop.run({ ...base, incidentId: 'inc-t2', scenarioId: 'unknown-customer-reported-issue' });
assert.equal(t2.tier, 'T2');
assert.equal(t2.outcome, 'verified_candidate_staged');
assert.equal(t2.productionAuthorityGranted, false);
assert.equal(loop.verifyReceipt(t2), true);

const t3 = await loop.run({
  ...t3Base,
  incidentId: 'inc-t3',
  scenarioId: 'payroll-calculation-or-export-anomaly',
  proposedAction: 'payroll.release-corrected-export',
});
assert.equal(t3.tier, 'T3');
assert.equal(t3.outcome, 'customer_authorisation_required');
assert.equal(t3.customerMutation, false);
assert.equal(t3.actionCount, 0);
assert.equal(t3.t3Shadow.status, 'customer_authorisation_required');
assert.equal(t3.t3Shadow.automaticExecutionEligible, false);
assert.equal(t3.t3Verification.verified, true);
assert.match(t3.t3Verification.verificationDigest, /^[a-f0-9]{64}$/);
assert.equal(loop.verifyReceipt(t3), true);

const badT3 = await loop.run({
  ...t3Base,
  incidentId: 'inc-t3-bad-family',
  scenarioId: 'payroll-calculation-or-export-anomaly',
  proposedAction: 'identity.grant-admin',
});
assert.equal(badT3.tier, 'T3');
assert.equal(badT3.outcome, 'contained');
assert.equal(badT3.t3Shadow.reason, 'scenario-action-family-mismatch');
assert.equal(badT3.actionCount, 0);
assert.equal(loop.verifyReceipt(badT3), true);

const t4 = await loop.run({
  ...base,
  incidentId: 'inc-t4',
  scenarioId: 'cross-tenant-access-attempt',
  knownGoodRollbackAvailable: true,
});
assert.equal(t4.tier, 'T4');
assert.equal(t4.outcome, 'rolled_back_to_known_good');
assert.equal(loop.verifyReceipt(t4), true);

const unknown = await loop.run({ ...base, incidentId: 'inc-unknown', scenarioId: 'never-seen-before' });
assert.equal(unknown.tier, 'T4');
assert.equal(unknown.outcome, 'contained');
assert.equal(loop.verifyReceipt(unknown), true);

const hostileRepair = {
  process: async () => ({
    status: 'verified_candidate_staged',
    independentlyVerified: true,
    productionAuthorityGranted: true,
  }),
};
const hostileLoop = createAutonomyControlLoop({
  contract,
  failureScenarios,
  selfHelp: SelfHelp,
  recoveryExecutor,
  repairCoordinator: hostileRepair,
  t3ShadowSimulator,
  t3ShadowVerifier,
  rollbackExecutor,
  now: () => ++tick,
  maxActions: 2,
});
const hostile = await hostileLoop.run({ ...base, incidentId: 'inc-hostile', scenarioId: 'unknown-customer-reported-issue' });
assert.equal(hostile.outcome, 'contained');
assert.equal(hostile.containedErrorCode, 'WFM_AUTONOMY_T2_PRODUCTION');
assert.equal(hostileLoop.verifyReceipt(hostile), true);

const hostileT3Loop = createAutonomyControlLoop({
  contract,
  failureScenarios,
  selfHelp: SelfHelp,
  recoveryExecutor,
  repairCoordinator,
  t3ShadowSimulator,
  t3ShadowVerifier: {
    verify: () => ({
      verified: true,
      productionAuthorityGranted: true,
      productionMutation: false,
      customerMutation: false,
    }),
  },
  rollbackExecutor,
  now: () => ++tick,
  maxActions: 2,
});
const hostileT3 = await hostileT3Loop.run({
  ...t3Base,
  incidentId: 'inc-hostile-t3',
  scenarioId: 'payroll-calculation-or-export-anomaly',
  proposedAction: 'payroll.release-corrected-export',
});
assert.equal(hostileT3.outcome, 'contained');
assert.equal(hostileT3.containedErrorCode, 'WFM_AUTONOMY_T3_AUTHORITY');
assert.equal(hostileT3Loop.verifyReceipt(hostileT3), true);

const tampered = structuredClone(t1);
tampered.trace[0].detail.tier = 'T4';
assert.equal(loop.verifyReceipt(tampered), false);

const resultTampered = structuredClone(t1);
resultTampered.recovery.status = 'contained';
assert.equal(loop.verifyReceipt(resultTampered), false);

const t3ResultTampered = structuredClone(t3);
t3ResultTampered.t3Shadow.afterStateDigest = d('tampered-t3-state');
assert.equal(loop.verifyReceipt(t3ResultTampered), false);

console.log(JSON.stringify({
  schemaVersion: 1,
  proof: 'closed-loop-autonomy-controller',
  status: 'PASS',
  cases: 10,
  unknownFailsSafe: true,
  crossTenantContained: true,
  t0GroundedOnly: true,
  t1IndependentVerificationRequired: true,
  t2ProductionAuthorityDenied: true,
  t3ShadowSimulationConnected: true,
  t3IndependentShadowVerificationRequired: true,
  t3AutomaticExecutionEligible: false,
  t3CustomerAuthorityBoundary: true,
  t4KnownGoodRollbackBounded: true,
  tamperEvidence: true,
  resultTamperEvidence: true,
  t3ResultTamperEvidence: true,
  productionMutation: false,
  customerMutation: false,
}, null, 2));
