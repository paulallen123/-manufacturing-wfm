import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createIncidentLearningPlanner } = require('../resilience/incident-learning-planner.cjs');
const { createIncidentRegressionCorpus, createLearningRecordingControlLoop } = require('../resilience/incident-regression-corpus.cjs');

const root = process.cwd();
const contract = JSON.parse(fs.readFileSync(path.join(root, 'resilience/support-tier-contract.json'), 'utf8'));
const failureScenarios = JSON.parse(fs.readFileSync(path.join(root, 'resilience/failure-scenarios.json'), 'utf8'));
const sha = (value) => createHash('sha256').update(String(value)).digest('hex');
const planner = createIncidentLearningPlanner();
const corpus = createIncidentRegressionCorpus();

function tierFor(scenario) {
  return contract.scenario_tier_overrides?.[scenario.id]
    || contract.category_defaults?.[scenario.category]
    || 'T4';
}

function learnedReceipt({ incidentId, tenant = 'corpus-tenant-a', scenarioId, tier, outcome = 'contained', safeTerminal = true, context = {} }) {
  const evidenceDigest = sha(`evidence:${incidentId}:${scenarioId}`);
  const receiptDigest = sha(`receipt:${incidentId}:${tenant}:${scenarioId}:${tier}:${outcome}:${safeTerminal}`);
  const receipt = {
    schemaVersion: 1,
    incidentId,
    tenant,
    scenarioId,
    tier,
    outcome,
    safeTerminal,
    evidenceDigest,
    receiptDigest,
    productionMutation: false,
    productionAuthorityGranted: false,
    customerMutation: false,
  };
  const learning = planner.plan(receipt, { historicalRegression: true, ...context });
  assert.equal(planner.verify(learning), true, `${scenarioId} learning record must verify before corpus append.`);
  return { ...receipt, learning };
}

assert.ok(Array.isArray(failureScenarios.scenarios) && failureScenarios.scenarios.length > 0, 'Failure scenario catalog must not be empty.');

const appendResults = [];
for (const [index, scenario] of failureScenarios.scenarios.entries()) {
  const tier = tierFor(scenario);
  const allowed = contract.tiers?.[tier]?.allowed_terminal_outcomes || [];
  assert.ok(allowed.includes('contained'), `${scenario.id} must permit safe containment for deterministic corpus seeding.`);
  const receipt = learnedReceipt({
    incidentId: `corpus-historical-${String(index + 1).padStart(3, '0')}`,
    scenarioId: scenario.id,
    tier,
  });
  const result = corpus.record(receipt);
  assert.equal(result.status, 'APPENDED_MANDATORY_CASE', `${scenario.id} must append as a mandatory regression case.`);
  assert.equal(result.mandatoryReplay, true);
  appendResults.push(result);
}

const seeded = corpus.snapshot();
assert.equal(seeded.entryCount, failureScenarios.scenarios.length, 'Every current failure class must enter the mandatory corpus exactly once.');
assert.equal(corpus.verifySnapshot(seeded), true, 'Seeded corpus snapshot must verify.');
assert.equal(corpus.mandatoryCases().every((item) => item.mandatoryReplay === true), true, 'Every corpus entry must remain mandatory replay evidence.');
assert.equal(new Set(corpus.mandatoryCases().map((item) => item.caseKeyDigest)).size, seeded.entryCount, 'Mandatory case keys must be unique.');

const firstScenario = failureScenarios.scenarios[0];
const duplicate = learnedReceipt({ incidentId: 'corpus-duplicate-observation', scenarioId: firstScenario.id, tier: tierFor(firstScenario) });
const duplicateResult = corpus.record(duplicate);
assert.equal(duplicateResult.status, 'DEDUPLICATED_EXISTING_MANDATORY_CASE', 'Equivalent incident class must deduplicate without weakening mandatory replay.');
assert.equal(corpus.snapshot().entryCount, seeded.entryCount, 'Deduplication must not append a second logical case.');

const failedEvidenceReceipt = learnedReceipt({
  incidentId: 'corpus-false-green-001',
  scenarioId: 'false-green-proof-evidence',
  tier: 'T4',
  safeTerminal: false,
  context: { falseGreenDetected: true, defectDetected: true, novelFailure: true },
});
const failedEvidenceResult = corpus.record(failedEvidenceReceipt);
assert.equal(failedEvidenceResult.status, 'APPENDED_MANDATORY_CASE', 'False-green evidence must be preserved as a mandatory regression case.');
const afterFalseGreen = corpus.snapshot();
const falseGreenEntry = afterFalseGreen.entries.find((entry) => entry.caseKeyDigest === failedEvidenceResult.caseKeyDigest);
assert.ok(falseGreenEntry, 'False-green corpus entry must be present.');
assert.equal(falseGreenEntry.safeTerminalObserved, false, 'Corpus must preserve that safe terminal was not established.');
assert.equal(falseGreenEntry.runbookDecision, 'NEVER_AUTOMATE', 'Unsafe evidence must remain NEVER_AUTOMATE.');

const tampered = structuredClone(afterFalseGreen);
tampered.entries[0].expectedOutcome = 'recovered';
assert.equal(corpus.verifySnapshot(tampered), false, 'Entry tamper must invalidate the append-only corpus chain.');
const chainTampered = structuredClone(afterFalseGreen);
chainTampered.entries[1].previousEntryDigest = sha('forged-previous-entry');
assert.equal(corpus.verifySnapshot(chainTampered), false, 'Hash-chain tamper must be rejected.');
const authorityTampered = structuredClone(afterFalseGreen);
authorityTampered.entries[0].authority.productionAuthority = true;
assert.equal(corpus.verifySnapshot(authorityTampered), false, 'Corpus entries must never acquire production authority.');

const restored = createIncidentRegressionCorpus({ initialSnapshot: afterFalseGreen });
assert.equal(restored.verifySnapshot(restored.snapshot()), true, 'Verified corpus snapshot must restore without mutation.');
assert.equal(restored.snapshot().corpusDigest, afterFalseGreen.corpusDigest, 'Restored corpus must preserve exact digest.');

const wrapperReceipt = learnedReceipt({
  incidentId: 'corpus-wrapper-observed-001',
  scenarioId: 'wrapper-observed-novel-support-failure',
  tier: 'T4',
  context: { defectDetected: true, novelFailure: true },
});
const verifiedLoop = {
  run: async () => structuredClone(wrapperReceipt),
  verifyReceipt: (receipt) => receipt?.receiptDigest === wrapperReceipt.receiptDigest,
};
const recordingLoop = createLearningRecordingControlLoop({ controlLoop: verifiedLoop, corpus: restored });
const beforeWrapper = recordingLoop.corpusSnapshot().entryCount;
const returnedReceipt = await recordingLoop.run({});
assert.equal(returnedReceipt.receiptDigest, wrapperReceipt.receiptDigest, 'Recording wrapper must preserve the original terminal receipt.');
assert.equal(recordingLoop.corpusSnapshot().entryCount, beforeWrapper + 1, 'Verified terminal learning must append automatically through the recording control loop.');
assert.equal(recordingLoop.mandatoryCases().at(-1)?.mandatoryReplay, true, 'Automatically recorded case must become mandatory future replay evidence.');

const rejectingLoop = createLearningRecordingControlLoop({
  controlLoop: { run: async () => structuredClone(wrapperReceipt), verifyReceipt: () => false },
  corpus: restored,
});
const beforeRejected = restored.snapshot().entryCount;
let rejectedCode = null;
try {
  await rejectingLoop.run({});
} catch (error) {
  rejectedCode = error.code;
}
assert.equal(rejectedCode, 'WFM_CORPUS_RECEIPT_VERIFY', 'Unverified terminal receipts must not enter learning corpus.');
assert.equal(restored.snapshot().entryCount, beforeRejected, 'Rejected receipt must not mutate corpus.');

const finalSnapshot = restored.snapshot();
assert.equal(restored.verifySnapshot(finalSnapshot), true, 'Final append-only corpus must verify.');
assert.equal(finalSnapshot.entries.every((entry) => entry.containsCustomerText === false && entry.containsReusableSecret === false), true, 'Corpus must never persist raw customer text or reusable secrets.');
assert.equal(finalSnapshot.entries.every((entry) => entry.authority.productionAuthority === false && entry.authority.releaseAuthority === false && entry.authority.crossTenantMutation === false), true, 'Corpus must remain evidence-only with no action/release/cross-tenant authority.');
assert.equal(finalSnapshot.entries.some((entry) => entry.tenantScopeDigest === sha('corpus-tenant-a')), true, 'Tenant scope must be represented only by digest in corpus entries.');
assert.equal(finalSnapshot.entries.some((entry) => Object.hasOwn(entry, 'tenant')), false, 'Raw tenant identifiers must not be persisted in corpus entries.');

console.log(JSON.stringify({
  schemaVersion: 1,
  proof: 'append-only-incident-regression-corpus',
  status: 'PASS',
  historicalScenarioClassesSeeded: failureScenarios.scenarios.length,
  falseGreenEvidencePreserved: true,
  equivalentIncidentsDeduplicated: true,
  appendOnlyHashChainVerified: true,
  entryTamperRejected: true,
  chainTamperRejected: true,
  authorityTamperRejected: true,
  verifiedTerminalAutomaticallyRecorded: true,
  unverifiedTerminalRejected: true,
  mandatoryFutureReplayCases: finalSnapshot.entryCount,
  rawCustomerTextPersisted: false,
  rawTenantIdentifierPersisted: false,
  reusableSecretsPersisted: false,
  productionAuthorityGranted: false,
  releaseAuthorityGranted: false,
  crossTenantMutation: false,
  productionMutation: false,
  customerMutation: false,
}, null, 2));
