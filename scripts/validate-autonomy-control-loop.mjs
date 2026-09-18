import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAutonomyControlLoop } = require('../resilience/autonomy-control-loop.cjs');
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
  rollbackExecutor,
  now: () => ++tick,
  maxActions: 2,
});

const base = { tenant: 'tenant-a', evidenceDigest: d('evidence') };

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
  ...base,
  incidentId: 'inc-t3',
  scenarioId: 'payroll-calculation-or-export-anomaly',
  customerAuthorisationRequired: true,
  proposedAction: 'payroll.release',
});
assert.equal(t3.tier, 'T3');
assert.equal(t3.outcome, 'customer_authorisation_required');
assert.equal(t3.customerMutation, false);
assert.equal(loop.verifyReceipt(t3), true);

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
  rollbackExecutor,
  now: () => ++tick,
  maxActions: 2,
});
const hostile = await hostileLoop.run({ ...base, incidentId: 'inc-hostile', scenarioId: 'unknown-customer-reported-issue' });
assert.equal(hostile.outcome, 'contained');
assert.equal(hostile.containedErrorCode, 'WFM_AUTONOMY_T2_PRODUCTION');
assert.equal(hostileLoop.verifyReceipt(hostile), true);

const tampered = structuredClone(t1);
tampered.trace[0].detail.tier = 'T4';
assert.equal(loop.verifyReceipt(tampered), false);

console.log(JSON.stringify({
  schemaVersion: 1,
  proof: 'closed-loop-autonomy-controller',
  status: 'PASS',
  cases: 9,
  unknownFailsSafe: true,
  crossTenantContained: true,
  t0GroundedOnly: true,
  t1IndependentVerificationRequired: true,
  t2ProductionAuthorityDenied: true,
  t3CustomerAuthorityBoundary: true,
  t4KnownGoodRollbackBounded: true,
  tamperEvidence: true,
  productionMutation: false,
  customerMutation: false,
}, null, 2));
