import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAutonomyControlLoop } = require('../resilience/autonomy-control-loop.cjs');
const { createT3ShadowSimulator } = require('../resilience/t3-shadow-simulator.cjs');
const { createT3ShadowVerifier } = require('../resilience/t3-shadow-verifier.cjs');
const { createT4ContainmentController } = require('../resilience/t4-containment-controller.cjs');
const SelfHelp = require('../resilience/support-selfhelp.cjs');

const root = process.cwd();
const contract = JSON.parse(fs.readFileSync(path.join(root, 'resilience/support-tier-contract.json'), 'utf8'));
const failureScenarios = JSON.parse(fs.readFileSync(path.join(root, 'resilience/failure-scenarios.json'), 'utf8'));
const sha = (value) => createHash('sha256').update(String(value)).digest('hex');

assert.ok(Array.isArray(failureScenarios.scenarios) && failureScenarios.scenarios.length > 0, 'Historical scenario catalog must not be empty.');
assert.equal(new Set(failureScenarios.scenarios.map((item) => item.id)).size, failureScenarios.scenarios.length, 'Historical scenario IDs must be unique.');

const recoveryInvocations = new Map();
const recoveryExecutor = {
  executorId: 'historical-t1-recovery-executor',
  execute: async ({ incidentId, tenant, scenario, action, evidenceDigest }) => {
    recoveryInvocations.set(incidentId, (recoveryInvocations.get(incidentId) || 0) + 1);
    return {
      status: 'recovered',
      executorId: 'historical-t1-recovery-executor',
      executionDigest: sha(`historical-execution:${incidentId}:${tenant}:${scenario?.id}:${action}:${evidenceDigest}`),
      reconciliationGreen: true,
      duplicateBusinessOutcomes: 0,
      productionAuthorityGranted: false,
      customerMutation: false,
    };
  },
};

const recoveryVerificationInvocations = new Map();
const recoveryVerifier = {
  verifierId: 'historical-t1-readonly-verifier',
  verify: async (recovery, { incidentId }) => {
    recoveryVerificationInvocations.set(incidentId, (recoveryVerificationInvocations.get(incidentId) || 0) + 1);
    return {
      verified: true,
      verifierId: 'historical-t1-readonly-verifier',
      executionDigest: recovery.executionDigest,
      verificationDigest: sha(`historical-independent-verification:${recovery.executionDigest}`),
      productionAuthorityGranted: false,
      customerMutation: false,
      modelAuthorityGranted: false,
      actionAuthorityGranted: false,
    };
  },
};

const repairInvocations = new Map();
const repairCoordinator = {
  process: async ({ incidentId, tenant, scenario, evidenceDigest }) => {
    repairInvocations.set(incidentId, (repairInvocations.get(incidentId) || 0) + 1);
    return {
      status: 'verified_candidate_staged',
      independentlyVerified: true,
      artifactDigest: sha(`historical-artifact:${incidentId}:${tenant}:${scenario?.id}:${evidenceDigest}`),
      provenanceDigest: sha(`historical-provenance:${incidentId}:${tenant}:${scenario?.id}:${evidenceDigest}`),
      productionAuthorityGranted: false,
      productionMutation: false,
    };
  },
};

const t3ShadowSimulator = createT3ShadowSimulator();
const t3ShadowVerifier = createT3ShadowVerifier();
let tick = 50000;
const t4ContainmentController = createT4ContainmentController({
  forensicStore: {
    preserve: async ({ incidentId, evidenceDigest }) => ({
      verified: true,
      immutable: true,
      forensicDigest: sha(`historical-forensic:${incidentId}:${evidenceDigest}`),
    }),
  },
  containmentExecutor: {
    execute: async ({ incidentId, tenant, actions }) => ({
      verified: true,
      containmentDigest: sha(`historical-containment:${incidentId}:${tenant}:${actions.join(',')}`),
      productionAuthorityGranted: false,
      crossTenantMutation: false,
    }),
  },
  rollbackExecutor: {
    rollback: async ({ incidentId, knownGoodArtifactDigest }) => ({
      verified: true,
      rollbackDigest: sha(`historical-rollback:${incidentId}:${knownGoodArtifactDigest}`),
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
  now: () => ++tick,
  maxActions: 3,
});

function expectedTier(scenario) {
  return contract.scenario_tier_overrides?.[scenario.id]
    || contract.category_defaults?.[scenario.category]
    || 'T4';
}

function scenarioInput(scenario, index) {
  const evidenceDigest = sha(`historical-evidence:${scenario.id}`);
  const input = {
    incidentId: `historical-${String(index + 1).padStart(3, '0')}-${scenario.id}`,
    tenant: 'historical-tenant-a',
    scenarioId: scenario.id,
    evidenceDigest,
    historicalRegression: true,
  };

  if (scenario.id === 'payroll-calculation-or-export-anomaly') {
    Object.assign(input, {
      proposedAction: 'payroll.prepare-corrected-export',
      beforeStateDigest: sha(`${scenario.id}:before`),
      afterStateDigest: sha(`${scenario.id}:after`),
      compensationPlanDigest: sha(`${scenario.id}:compensation`),
      affectedRecords: 3,
    });
  }
  if (scenario.id === 'timezone-dst-or-clock-skew') {
    Object.assign(input, {
      proposedAction: 'time.prepare-correction',
      beforeStateDigest: sha(`${scenario.id}:before`),
      afterStateDigest: sha(`${scenario.id}:after`),
      compensationPlanDigest: sha(`${scenario.id}:compensation`),
      affectedRecords: 3,
    });
  }
  return input;
}

const replay = [];
for (const [index, scenario] of failureScenarios.scenarios.entries()) {
  assert.ok(scenario?.id && scenario?.category, `Historical scenario ${index} must have id and category.`);
  const tier = expectedTier(scenario);
  assert.ok(contract.tiers?.[tier], `${scenario.id} maps to unknown tier ${tier}.`);

  const input = scenarioInput(scenario, index);
  const receipt = await loop.run(input);
  const allowed = contract.tiers[tier].allowed_terminal_outcomes || [];

  assert.equal(receipt.tier, tier, `${scenario.id} tier drifted.`);
  assert.ok(allowed.includes(receipt.outcome), `${scenario.id} reached disallowed terminal ${receipt.outcome}.`);
  assert.equal(receipt.safeTerminal, true, `${scenario.id} did not establish a safe terminal.`);
  assert.equal(receipt.productionMutation, false, `${scenario.id} mutated production.`);
  assert.equal(receipt.productionAuthorityGranted, false, `${scenario.id} minted production authority.`);
  assert.equal(receipt.customerMutation, false, `${scenario.id} mutated customer state.`);
  assert.equal(loop.verifyReceipt(receipt), true, `${scenario.id} produced an unverifiable terminal receipt.`);

  assert.ok(receipt.learning, `${scenario.id} did not produce an incident-learning record.`);
  assert.equal(receipt.learning.sourceReceiptDigest, receipt.receiptDigest, `${scenario.id} learning is not bound to terminal receipt.`);
  assert.equal(receipt.learning.sourceEvidenceDigest, receipt.evidenceDigest, `${scenario.id} learning is not bound to source evidence.`);
  assert.equal(receipt.learning.regressionFixture?.required, true, `${scenario.id} historical replay did not require regression preservation.`);
  assert.match(receipt.learning.regressionFixture?.fixtureDigest || '', /^[a-f0-9]{64}$/, `${scenario.id} did not produce a deterministic regression fixture digest.`);
  assert.ok(receipt.learning.detectionRuleProposal, `${scenario.id} did not produce a deterministic detection proposal.`);
  assert.ok(receipt.learning.supportKnowledgeProposal, `${scenario.id} did not produce a support-knowledge proposal.`);
  assert.equal(receipt.learning.detectionRuleProposal.tenantScoped, true, `${scenario.id} detection rule lost tenant scope.`);
  assert.equal(receipt.learning.detectionRuleProposal.crossTenantMatching, false, `${scenario.id} detection rule permitted cross-tenant matching.`);
  assert.equal(receipt.learning.detectionRuleProposal.productionWriteAuthority, false, `${scenario.id} detection rule gained production authority.`);
  assert.equal(receipt.learning.supportKnowledgeProposal.mode, 'proposal-only', `${scenario.id} support knowledge stopped being proposal-only.`);
  assert.equal(receipt.learning.authority?.actionAuthority, false, `${scenario.id} learning minted action authority.`);
  assert.equal(receipt.learning.authority?.productionAuthority, false, `${scenario.id} learning minted production authority.`);
  assert.equal(receipt.learning.authority?.releaseAuthority, false, `${scenario.id} learning minted release authority.`);
  assert.equal(receipt.learning.authority?.credentialAuthority, false, `${scenario.id} learning minted credential authority.`);
  assert.equal(receipt.learning.authority?.customerMutation, false, `${scenario.id} learning minted customer mutation.`);
  assert.equal(receipt.learning.authority?.crossTenantMutation, false, `${scenario.id} learning minted cross-tenant mutation.`);

  if (tier === 'T3' || tier === 'T4') {
    assert.equal(receipt.learning.runbookDecision?.decision, 'NEVER_AUTOMATE', `${scenario.id} consequential class must remain NEVER_AUTOMATE by default.`);
  }

  if (tier === 'T1' && scenario.autonomous_action) {
    assert.equal(recoveryInvocations.get(input.incidentId), 1, `${scenario.id} deterministic recovery must execute at most once in replay.`);
    assert.equal(recoveryVerificationInvocations.get(input.incidentId), 1, `${scenario.id} deterministic recovery must be independently verified exactly once in replay.`);
    assert.equal(receipt.recovery?.duplicateBusinessOutcomes, 0, `${scenario.id} replay observed a duplicate business outcome.`);
    assert.equal(receipt.recoveryVerification?.executionDigest, receipt.recovery?.executionDigest, `${scenario.id} verification was not bound to exact execution.`);
    assert.notEqual(receipt.recoveryVerification?.verifierId, receipt.recovery?.executorId, `${scenario.id} recovery self-verified.`);
  } else {
    assert.ok((recoveryInvocations.get(input.incidentId) || 0) <= 1, `${scenario.id} repeated deterministic recovery unexpectedly.`);
    assert.ok((recoveryVerificationInvocations.get(input.incidentId) || 0) <= 1, `${scenario.id} repeated recovery verification unexpectedly.`);
  }
  if (tier === 'T2') {
    assert.equal(repairInvocations.get(input.incidentId), 1, `${scenario.id} repair pipeline must execute once in historical replay.`);
  }

  replay.push({ scenarioId: scenario.id, tier, outcome: receipt.outcome, learningDecision: receipt.learning.runbookDecision?.decision || null });
}

const unknown = await loop.run({
  incidentId: 'historical-unknown-future-class',
  tenant: 'historical-tenant-a',
  scenarioId: 'historical-never-seen-before',
  evidenceDigest: sha('historical-never-seen-before-evidence'),
  historicalRegression: true,
});
assert.equal(unknown.tier, 'T4');
assert.equal(unknown.outcome, 'contained');
assert.equal(unknown.safeTerminal, true);
assert.equal(unknown.learning.regressionFixture?.required, true);
assert.equal(unknown.learning.runbookDecision?.decision, 'NEVER_AUTOMATE');
assert.equal(loop.verifyReceipt(unknown), true);

const learningTampered = structuredClone(replay.length ? await loop.run(scenarioInput(failureScenarios.scenarios[0], failureScenarios.scenarios.length + 1)) : unknown);
learningTampered.learning.sourceEvidenceDigest = sha('tampered-learning-source');
assert.equal(loop.verifyReceipt(learningTampered), false, 'Outer receipt verifier must reject tampered incident-learning evidence binding.');

const tierCounts = replay.reduce((acc, item) => {
  acc[item.tier] = (acc[item.tier] || 0) + 1;
  return acc;
}, {});

console.log(JSON.stringify({
  schemaVersion: 2,
  proof: 'historical-incident-replay-and-learning',
  status: 'PASS',
  scenarioClassesReplayed: replay.length,
  tierCounts,
  everyCatalogScenarioReachedAllowedSafeTerminal: true,
  everyHistoricalScenarioGeneratedVerifiedLearning: true,
  everyHistoricalScenarioGeneratedRegressionFixture: true,
  deterministicDetectionRulesTenantScoped: true,
  consequentialClassesDefaultNeverAutomate: true,
  t1IndependentVerifierReplayed: true,
  t1ExecutorVerifierSeparationReplayed: true,
  duplicateBusinessOutcomes: 0,
  unknownFutureClassContainedAndLearned: true,
  learningTamperRejected: true,
  productionAuthorityGranted: false,
  productionMutation: false,
  customerMutation: false,
}, null, 2));
