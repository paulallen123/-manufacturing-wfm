import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAutonomyControlLoop } = require('../resilience/autonomy-control-loop.cjs');
const {
  computeRepairEvidenceChainDigest,
  computePostStagingDecisionDigest,
} = require('../resilience/autonomous-repair-pipeline.cjs');
const { createT3ShadowSimulator } = require('../resilience/t3-shadow-simulator.cjs');
const { createT3ShadowVerifier } = require('../resilience/t3-shadow-verifier.cjs');
const { createT4ContainmentController } = require('../resilience/t4-containment-controller.cjs');
const SelfHelp = require('../resilience/support-selfhelp.cjs');

const root = process.cwd();
const contract = JSON.parse(fs.readFileSync(path.join(root, 'resilience/support-tier-contract.json'), 'utf8'));
const failureScenarios = JSON.parse(fs.readFileSync(path.join(root, 'resilience/failure-scenarios.json'), 'utf8'));
const d = (v) => createHash('sha256').update(String(v)).digest('hex');

function createT2Decision({ tenant = 'tenant-a', evidenceDigest = d('evidence'), status = 'canary_proven', suffix = 'default' } = {}) {
  const repairEvidence = {
    tenantDigest: d(tenant),
    actorSetDigest: d(`t2-repair-actors:${suffix}`),
    evidenceDigest,
    failingTestDigest: d(`t2-failing-test:${suffix}`),
    observedFailureDigest: d(`t2-observed-failure:${suffix}`),
    sourceSnapshotDigest: d(`t2-source-snapshot:${suffix}`),
    repairIntentDigest: d(`t2-repair-intent:${suffix}`),
    patchDigest: d(`t2-patch:${suffix}`),
    candidateDigest: d(`t2-candidate:${suffix}`),
    artifactDigest: d(`t2-artifact:${suffix}`),
    provenanceDigest: d(`t2-provenance:${suffix}`),
    rollbackDigest: d(`t2-rollback:${suffix}`),
    verificationDigest: d(`t2-verification:${suffix}`),
    permitDigest: d(`t2-permit:${suffix}`),
    signatureDigest: d(`t2-signature:${suffix}`),
    stagingReceiptDigest: d(`t2-staging:${suffix}`),
  };
  const repairChainDigest = computeRepairEvidenceChainDigest(repairEvidence);
  assert.match(repairChainDigest || '', /^[a-f0-9]{64}$/);
  const payload = {
    schemaVersion: 2,
    status,
    ...repairEvidence,
    repairChainDigest,
    postStagingActorSetDigest: d(`t2-post-staging-actors:${suffix}`),
    repairOutcomeReceiptDigest: d(`t2-repair-receipt:${suffix}`),
    canaryOutcomeReceiptDigest: d(`t2-canary-receipt:${suffix}`),
    canaryEvidenceDigest: d(`t2-canary-evidence:${suffix}`),
    rollbackEvidenceDigest: status === 'rolled_back_to_known_good' ? d(`t2-rollback-evidence:${suffix}`) : null,
    productionAuthorityGranted: false,
    promotionAuthorityGranted: false,
    productionMutation: false,
    customerMutation: false,
  };
  payload.decisionChainDigest = computePostStagingDecisionDigest(payload);
  assert.match(payload.decisionChainDigest || '', /^[a-f0-9]{64}$/);
  payload.compositionReceiptDigest = d(`t2-composition-receipt:${suffix}`);
  return payload;
}

const recoveryExecutor = {
  executorId: 't1-recovery-executor',
  execute: async ({ incidentId, tenant, action, evidenceDigest }) => ({
    status: 'recovered',
    executorId: 't1-recovery-executor',
    executionDigest: d(`execution:${incidentId}:${tenant}:${action}:${evidenceDigest}`),
    verified: true,
    verificationDigest: d('self-asserted-recovery-verification-must-not-suffice'),
    productionAuthorityGranted: false,
    customerMutation: false,
  }),
};

const recoveryVerifier = {
  verifierId: 't1-readonly-recovery-verifier',
  verify: async (recovery) => ({
    verified: true,
    verifierId: 't1-readonly-recovery-verifier',
    executionDigest: recovery.executionDigest,
    verificationDigest: d(`independent:${recovery.executionDigest}`),
    productionAuthorityGranted: false,
    customerMutation: false,
    modelAuthorityGranted: false,
    actionAuthorityGranted: false,
  }),
};

const repairCoordinator = {
  run: async ({ tenant, evidenceDigest }) => createT2Decision({ tenant, evidenceDigest }),
};

const t3ShadowSimulator = createT3ShadowSimulator();
const t3ShadowVerifier = createT3ShadowVerifier();

const rollbackExecutor = {
  rollback: async () => ({
    verified: true,
    rollbackDigest: d('legacy-known-good-rollback'),
    productionAuthorityGranted: false,
  }),
};

let tick = 1000;
const t4ContainmentController = createT4ContainmentController({
  forensicStore: {
    preserve: async ({ incidentId, evidenceDigest }) => ({
      verified: true,
      immutable: true,
      forensicDigest: d(`forensic:${incidentId}:${evidenceDigest}`),
    }),
  },
  containmentExecutor: {
    execute: async ({ incidentId, tenant, actions }) => ({
      verified: true,
      containmentDigest: d(`containment:${incidentId}:${tenant}:${actions.join(',')}`),
      productionAuthorityGranted: false,
      crossTenantMutation: false,
    }),
  },
  rollbackExecutor: {
    rollback: async ({ incidentId, knownGoodArtifactDigest }) => ({
      verified: true,
      rollbackDigest: d(`t4-rollback:${incidentId}:${knownGoodArtifactDigest}`),
      productionAuthorityGranted: false,
      crossTenantMutation: false,
    }),
  },
  now: () => ++tick,
  maxActions: 4,
});

const loop = createAutonomyControlLoop({
  contract,
  failureScenarios,
  selfHelp: SelfHelp,
  recoveryExecutor,
  recoveryVerifier,
  repairCoordinator,
  t3ShadowSimulator,
  t3ShadowVerifier,
  t4ContainmentController,
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
const knownGood = {
  available: true,
  schemaCompatible: true,
  independentlyVerified: true,
  signatureVerified: true,
  artifactDigest: d('known-good-artifact'),
  verificationDigest: d('known-good-verification'),
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

const crossT0 = await loop.run({
  ...base,
  incidentId: 'inc-t0-cross-tenant',
  scenarioId: 'support-guidance',
  targetTenant: 'tenant-b',
  question: 'Tell me how to change another tenant.',
  role: 'manager',
});
assert.equal(crossT0.tier, 'T0');
assert.equal(crossT0.outcome, 'safe_abstention');
assert.equal(crossT0.actionCount, 0);
assert.equal(crossT0.answer, undefined);
assert.equal(crossT0.safeTerminal, true);
assert.equal(loop.verifyReceipt(crossT0), true);

const t1 = await loop.run({ ...base, incidentId: 'inc-t1', scenarioId: 'integration-transient-failure' });
assert.equal(t1.tier, 'T1');
assert.equal(t1.outcome, 'recovered');
assert.equal(t1.actionCount, 1);
assert.equal(t1.recovery.executorId, recoveryExecutor.executorId);
assert.equal(t1.recoveryVerification.verifierId, recoveryVerifier.verifierId);
assert.notEqual(t1.recovery.executorId, t1.recoveryVerification.verifierId);
assert.equal(t1.recoveryVerification.executionDigest, t1.recovery.executionDigest);
assert.equal(t1.recoveryVerification.actionAuthorityGranted, false);
assert.equal(loop.verifyReceipt(t1), true);

const selfOnlyLoop = createAutonomyControlLoop({
  contract,
  failureScenarios,
  recoveryExecutor,
  now: () => ++tick,
  maxActions: 2,
});
const selfOnly = await selfOnlyLoop.run({ ...base, incidentId: 'inc-t1-self-only', scenarioId: 'integration-transient-failure' });
assert.equal(selfOnly.outcome, 'contained');
assert.equal(selfOnly.actionCount, 0);
assert.equal(selfOnly.recovery, undefined);
assert.equal(selfOnlyLoop.verifyReceipt(selfOnly), true);

const samePrincipalLoop = createAutonomyControlLoop({
  contract,
  failureScenarios,
  recoveryExecutor,
  recoveryVerifier: {
    verifierId: recoveryExecutor.executorId,
    verify: recoveryVerifier.verify,
  },
  now: () => ++tick,
  maxActions: 2,
});
const samePrincipal = await samePrincipalLoop.run({ ...base, incidentId: 'inc-t1-same-principal', scenarioId: 'integration-transient-failure' });
assert.equal(samePrincipal.outcome, 'contained');
assert.equal(samePrincipal.containedErrorCode, 'WFM_AUTONOMY_T1_SEPARATION');
assert.equal(samePrincipal.actionCount, 0);
assert.equal(samePrincipalLoop.verifyReceipt(samePrincipal), true);

const mismatchedVerifierLoop = createAutonomyControlLoop({
  contract,
  failureScenarios,
  recoveryExecutor,
  recoveryVerifier: {
    verifierId: 't1-mismatched-verifier',
    verify: async () => ({
      verified: true,
      verifierId: 't1-mismatched-verifier',
      executionDigest: d('different-execution'),
      verificationDigest: d('mismatched-verification'),
      productionAuthorityGranted: false,
      customerMutation: false,
      modelAuthorityGranted: false,
      actionAuthorityGranted: false,
    }),
  },
  now: () => ++tick,
  maxActions: 2,
});
const mismatchedVerifier = await mismatchedVerifierLoop.run({ ...base, incidentId: 'inc-t1-mismatch', scenarioId: 'integration-transient-failure' });
assert.equal(mismatchedVerifier.outcome, 'contained');
assert.equal(mismatchedVerifier.containedErrorCode, 'WFM_AUTONOMY_T1_VERIFY');
assert.equal(mismatchedVerifierLoop.verifyReceipt(mismatchedVerifier), true);

const authorityVerifierLoop = createAutonomyControlLoop({
  contract,
  failureScenarios,
  recoveryExecutor,
  recoveryVerifier: {
    verifierId: 't1-hostile-verifier',
    verify: async (recovery) => ({
      verified: true,
      verifierId: 't1-hostile-verifier',
      executionDigest: recovery.executionDigest,
      verificationDigest: d('hostile-verifier'),
      productionAuthorityGranted: false,
      customerMutation: false,
      modelAuthorityGranted: false,
      actionAuthorityGranted: true,
    }),
  },
  now: () => ++tick,
  maxActions: 2,
});
const authorityVerifier = await authorityVerifierLoop.run({ ...base, incidentId: 'inc-t1-verifier-authority', scenarioId: 'integration-transient-failure' });
assert.equal(authorityVerifier.outcome, 'contained');
assert.equal(authorityVerifier.containedErrorCode, 'WFM_AUTONOMY_T1_VERIFIER_AUTHORITY');
assert.equal(authorityVerifierLoop.verifyReceipt(authorityVerifier), true);

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
assert.equal(t2.repair.status, 'canary_proven');
assert.equal(t2.repair.repairChainDigest, computeRepairEvidenceChainDigest(t2.repair));
assert.equal(t2.repair.decisionChainDigest, computePostStagingDecisionDigest(t2.repair));
assert.equal(t2.productionAuthorityGranted, false);
assert.equal(loop.verifyReceipt(t2), true);

const bareStagedLoop = createAutonomyControlLoop({
  contract,
  failureScenarios,
  repairCoordinator: {
    process: async () => ({
      status: 'verified_candidate_staged',
      independentlyVerified: true,
      productionAuthorityGranted: false,
      productionMutation: false,
    }),
  },
  now: () => ++tick,
  maxActions: 2,
});
const bareStaged = await bareStagedLoop.run({ ...base, incidentId: 'inc-t2-bare-staged', scenarioId: 'unknown-customer-reported-issue' });
assert.equal(bareStaged.outcome, 'contained');
assert.equal(bareStaged.containedErrorCode, 'WFM_AUTONOMY_T2_CHAIN_REQUIRED');
assert.equal(bareStagedLoop.verifyReceipt(bareStaged), true);

const badRepairChainLoop = createAutonomyControlLoop({
  contract,
  failureScenarios,
  repairCoordinator: {
    run: async ({ tenant, evidenceDigest }) => {
      const decision = createT2Decision({ tenant, evidenceDigest, suffix: 'bad-repair-chain' });
      decision.patchDigest = d('tampered-after-repair-chain-created');
      return decision;
    },
  },
  now: () => ++tick,
  maxActions: 2,
});
const badRepairChain = await badRepairChainLoop.run({ ...base, incidentId: 'inc-t2-bad-repair-chain', scenarioId: 'unknown-customer-reported-issue' });
assert.equal(badRepairChain.outcome, 'contained');
assert.equal(badRepairChain.containedErrorCode, 'WFM_AUTONOMY_T2_REPAIR_CHAIN');
assert.equal(badRepairChainLoop.verifyReceipt(badRepairChain), true);

const badDecisionChainLoop = createAutonomyControlLoop({
  contract,
  failureScenarios,
  repairCoordinator: {
    run: async ({ tenant, evidenceDigest }) => {
      const decision = createT2Decision({ tenant, evidenceDigest, suffix: 'bad-decision-chain' });
      decision.decisionChainDigest = d('forged-post-staging-decision');
      return decision;
    },
  },
  now: () => ++tick,
  maxActions: 2,
});
const badDecisionChain = await badDecisionChainLoop.run({ ...base, incidentId: 'inc-t2-bad-decision-chain', scenarioId: 'unknown-customer-reported-issue' });
assert.equal(badDecisionChain.outcome, 'contained');
assert.equal(badDecisionChain.containedErrorCode, 'WFM_AUTONOMY_T2_DECISION_CHAIN');
assert.equal(badDecisionChainLoop.verifyReceipt(badDecisionChain), true);

const t2RollbackLoop = createAutonomyControlLoop({
  contract,
  failureScenarios,
  repairCoordinator: {
    run: async ({ tenant, evidenceDigest }) => createT2Decision({
      tenant,
      evidenceDigest,
      status: 'rolled_back_to_known_good',
      suffix: 'known-good-rollback',
    }),
  },
  now: () => ++tick,
  maxActions: 2,
});
const t2Rollback = await t2RollbackLoop.run({ ...base, incidentId: 'inc-t2-rollback', scenarioId: 'unknown-customer-reported-issue' });
assert.equal(t2Rollback.outcome, 'contained');
assert.equal(t2Rollback.repair.status, 'rolled_back_to_known_good');
assert.match(t2Rollback.repair.rollbackEvidenceDigest, /^[a-f0-9]{64}$/);
assert.equal(t2Rollback.containedErrorCode, undefined);
assert.equal(t2RollbackLoop.verifyReceipt(t2Rollback), true);

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

const t4ScenarioIds = Object.entries(contract.scenario_tier_overrides)
  .filter(([, tier]) => tier === 'T4')
  .map(([scenarioId]) => scenarioId)
  .sort();
assert.ok(t4ScenarioIds.length > 0, 'Expected explicit T4 scenario classes.');

for (const scenarioId of t4ScenarioIds) {
  const receipt = await loop.run({
    ...base,
    incidentId: `inc-t4-class-${scenarioId}`,
    scenarioId,
  });
  assert.equal(receipt.tier, 'T4', `${scenarioId} must classify T4.`);
  assert.equal(receipt.safeTerminal, true, `${scenarioId} must reach a safe terminal.`);
  assert.ok(receipt.t4, `${scenarioId} must route through the dedicated T4 controller.`);
  assert.equal(receipt.t4.safeTerminal, true);
  assert.equal(receipt.t4.productionAuthorityGranted, false);
  assert.equal(receipt.t4.modelAuthorityGranted, false);
  assert.equal(receipt.t4.customerMutation, false);
  assert.equal(receipt.t4.crossTenantMutation, false);
  assert.equal(receipt.t4.requestedActionExecuted, false);
  assert.equal(t4ContainmentController.verifyReceipt(receipt.t4), true);
  assert.equal(loop.verifyReceipt(receipt), true);
}

const t4CrossTenant = await loop.run({
  ...base,
  incidentId: 'inc-t4-cross-tenant',
  scenarioId: 'cross-tenant-access-attempt',
  targetTenant: 'tenant-b',
  requestedAction: 'identity.grant-admin',
  threat: { untrustedToolInstruction: true },
  rollbackRequested: true,
  knownGood,
});
assert.equal(t4CrossTenant.tier, 'T4');
assert.equal(t4CrossTenant.outcome, 'contained');
assert.equal(t4CrossTenant.t4.crossTenantMutation, false);
assert.ok(t4CrossTenant.t4.plannedContainmentActions.includes('deny-cross-tenant-action'));
assert.ok(t4CrossTenant.t4.plannedContainmentActions.includes('deny-model-tool-authority'));
assert.equal(t4CrossTenant.t4.rollbackReceipt, null);
assert.equal(loop.verifyReceipt(t4CrossTenant), true);

const t4Rollback = await loop.run({
  ...base,
  incidentId: 'inc-t4-rollback',
  scenarioId: 'artifact-tampering-or-provenance-drift',
  provenance: {
    expectedArtifactDigest: d('expected-artifact'),
    observedArtifactDigest: d('tampered-artifact'),
    signatureVerified: false,
  },
  rollbackRequested: true,
  knownGood,
});
assert.equal(t4Rollback.tier, 'T4');
assert.equal(t4Rollback.outcome, 'rolled_back_to_known_good');
assert.equal(t4Rollback.t4.rollbackReceipt.verified, true);
assert.equal(loop.verifyReceipt(t4Rollback), true);

const unknown = await loop.run({ ...base, incidentId: 'inc-unknown', scenarioId: 'never-seen-before' });
assert.equal(unknown.tier, 'T4');
assert.equal(unknown.outcome, 'contained');
assert.ok(unknown.t4, 'Unknown failures must enter the dedicated T4 controller.');
assert.ok(unknown.t4.plannedContainmentActions.includes('unknown-fault-isolation'));
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
  recoveryVerifier,
  repairCoordinator: hostileRepair,
  t3ShadowSimulator,
  t3ShadowVerifier,
  t4ContainmentController,
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
  recoveryVerifier,
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
  t4ContainmentController,
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

const hostileT4Loop = createAutonomyControlLoop({
  contract,
  failureScenarios,
  t4ContainmentController: {
    handle: async () => ({
      safeTerminal: true,
      outcome: 'contained',
      productionAuthorityGranted: true,
      modelAuthorityGranted: false,
      customerMutation: false,
      crossTenantMutation: false,
      requestedActionExecuted: false,
    }),
    verifyReceipt: () => true,
  },
  now: () => ++tick,
  maxActions: 2,
});
const hostileT4 = await hostileT4Loop.run({
  ...base,
  incidentId: 'inc-hostile-t4',
  scenarioId: 'data-integrity-mismatch',
});
assert.equal(hostileT4.outcome, 'contained');
assert.equal(hostileT4.containedErrorCode, 'WFM_AUTONOMY_T4_AUTHORITY');
assert.equal(hostileT4Loop.verifyReceipt(hostileT4), true);

const unverifiableT4Loop = createAutonomyControlLoop({
  contract,
  failureScenarios,
  t4ContainmentController: {
    handle: async () => ({
      safeTerminal: true,
      outcome: 'contained',
      productionAuthorityGranted: false,
      modelAuthorityGranted: false,
      customerMutation: false,
      crossTenantMutation: false,
      requestedActionExecuted: false,
    }),
    verifyReceipt: () => false,
  },
  now: () => ++tick,
  maxActions: 2,
});
const unverifiableT4 = await unverifiableT4Loop.run({
  ...base,
  incidentId: 'inc-unverifiable-t4',
  scenarioId: 'audit-trail-degraded',
});
assert.equal(unverifiableT4.outcome, 'contained');
assert.equal(unverifiableT4.containedErrorCode, 'WFM_AUTONOMY_T4_VERIFY');
assert.equal(unverifiableT4Loop.verifyReceipt(unverifiableT4), true);

const tampered = structuredClone(t1);
tampered.trace[0].detail.tier = 'T4';
assert.equal(loop.verifyReceipt(tampered), false);

const resultTampered = structuredClone(t1);
resultTampered.recovery.status = 'contained';
assert.equal(loop.verifyReceipt(resultTampered), false);

const t1VerificationTampered = structuredClone(t1);
t1VerificationTampered.recoveryVerification.executionDigest = d('tampered-execution-binding');
assert.equal(loop.verifyReceipt(t1VerificationTampered), false);

const t2ChainTampered = structuredClone(t2);
t2ChainTampered.repair.patchDigest = d('tampered-t2-patch');
assert.equal(loop.verifyReceipt(t2ChainTampered), false);

const t3ResultTampered = structuredClone(t3);
t3ResultTampered.t3Shadow.afterStateDigest = d('tampered-t3-state');
assert.equal(loop.verifyReceipt(t3ResultTampered), false);

const t4ResultTampered = structuredClone(t4Rollback);
t4ResultTampered.t4.outcome = 'contained';
assert.equal(loop.verifyReceipt(t4ResultTampered), false);

console.log(JSON.stringify({
  schemaVersion: 3,
  proof: 'closed-loop-autonomy-controller',
  status: 'PASS',
  t4ScenarioClasses: t4ScenarioIds.length,
  everyExplicitT4ScenarioRoutedThroughDedicatedController: true,
  unknownFailsSafeThroughDedicatedT4Controller: true,
  crossTenantT0SafelyAbstains: true,
  crossTenantT4ContainedInsideDedicatedController: true,
  t4ForensicsAndContainmentVerified: true,
  t4KnownGoodRollbackBounded: true,
  t4AuthorityEscapeContained: true,
  t4UnverifiableReceiptContained: true,
  t0GroundedOnly: true,
  t1IndependentVerificationRequired: true,
  t1ExecutorVerifierDistinctPrincipalsRequired: true,
  t1SelfAttestationInsufficient: true,
  t1VerifierExactExecutionBindingRequired: true,
  t1VerifierReadOnlyAuthorityRequired: true,
  t2ProductionAuthorityDenied: true,
  t2BareStagedFlagRejected: true,
  t2RepairChainRecomputed: true,
  t2PostStagingDecisionChainRecomputed: true,
  t2CanaryProvenMappedToStagedTerminal: true,
  t2KnownGoodRollbackMappedToContainment: true,
  t2ChainTamperRejected: true,
  t3ShadowSimulationConnected: true,
  t3IndependentShadowVerificationRequired: true,
  t3AutomaticExecutionEligible: false,
  t3CustomerAuthorityBoundary: true,
  tamperEvidence: true,
  resultTamperEvidence: true,
  t1VerificationTamperEvidence: true,
  t3ResultTamperEvidence: true,
  t4ResultTamperEvidence: true,
  productionMutation: false,
  customerMutation: false,
}, null, 2));