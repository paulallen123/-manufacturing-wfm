import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createIncidentLearningPlanner } = require('../resilience/incident-learning-planner.cjs');
const { createIncidentRegressionCorpus } = require('../resilience/incident-regression-corpus.cjs');

const root = process.cwd();
const contract = JSON.parse(fs.readFileSync(path.join(root, 'resilience/support-tier-contract.json'), 'utf8'));
const failureScenarios = JSON.parse(fs.readFileSync(path.join(root, 'resilience/failure-scenarios.json'), 'utf8'));
const planner = createIncidentLearningPlanner();
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const inputPath = process.env.WFM_INCIDENT_CORPUS_INPUT ? path.resolve(process.env.WFM_INCIDENT_CORPUS_INPUT) : null;
const outputPath = path.resolve(process.env.WFM_INCIDENT_CORPUS_OUTPUT || path.join(root, 'incident-regression-corpus.snapshot.json'));
const continuityPath = path.resolve(process.env.WFM_INCIDENT_CORPUS_CONTINUITY_OUTPUT || path.join(root, 'incident-regression-corpus-continuity.json'));

function tierFor(scenario) {
  return contract.scenario_tier_overrides?.[scenario.id]
    || contract.category_defaults?.[scenario.category]
    || 'T4';
}

function learnedReceipt({ incidentId, tenant = 'corpus-tenant-a', scenarioId, tier, outcome = 'contained', safeTerminal = true }) {
  const evidenceDigest = sha256(Buffer.from(`evidence:${incidentId}:${scenarioId}`));
  const receiptDigest = sha256(Buffer.from(`receipt:${incidentId}:${tenant}:${scenarioId}:${tier}:${outcome}:${safeTerminal}`));
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
  const learning = planner.plan(receipt, { historicalRegression: true });
  assert.equal(planner.verify(learning), true, `${scenarioId} continuity learning record must verify.`);
  return { ...receipt, learning };
}

let priorSnapshot = null;
let priorRaw = null;
let priorSnapshotLoaded = false;
if (inputPath) {
  assert.equal(fs.existsSync(inputPath), true, `Prior corpus input does not exist: ${inputPath}`);
  priorRaw = fs.readFileSync(inputPath);
  priorSnapshot = JSON.parse(priorRaw.toString('utf8'));
  const verifier = createIncidentRegressionCorpus();
  assert.equal(verifier.verifySnapshot(priorSnapshot), true, 'Prior corpus snapshot failed append-only integrity verification.');
  priorSnapshotLoaded = true;
}

const corpus = createIncidentRegressionCorpus({ initialSnapshot: priorSnapshot });
const initialSnapshot = corpus.snapshot();
const initialEntryCount = initialSnapshot.entryCount;
const tenantScopeDigest = sha256(Buffer.from('corpus-tenant-a'));
const catalogCaseKeys = [];
let appendedCurrentClasses = 0;
let deduplicatedCurrentClasses = 0;

assert.ok(Array.isArray(failureScenarios.scenarios) && failureScenarios.scenarios.length > 0, 'Failure scenario catalog must not be empty.');
for (const [index, scenario] of failureScenarios.scenarios.entries()) {
  const tier = tierFor(scenario);
  const allowed = contract.tiers?.[tier]?.allowed_terminal_outcomes || [];
  assert.ok(allowed.includes('contained'), `${scenario.id} must permit safe containment for persistent corpus continuity.`);
  const result = corpus.record(learnedReceipt({
    incidentId: `corpus-historical-${String(index + 1).padStart(3, '0')}`,
    scenarioId: scenario.id,
    tier,
  }));
  assert.ok(
    result.status === 'APPENDED_MANDATORY_CASE' || result.status === 'DEDUPLICATED_EXISTING_MANDATORY_CASE',
    `${scenario.id} must append or match an existing mandatory regression case.`,
  );
  if (result.status === 'APPENDED_MANDATORY_CASE') appendedCurrentClasses += 1;
  else deduplicatedCurrentClasses += 1;
  catalogCaseKeys.push(result.caseKeyDigest);
}

const finalSnapshot = corpus.snapshot();
assert.equal(corpus.verifySnapshot(finalSnapshot), true, 'Persistent incident corpus output must verify before it is written.');
const mandatory = corpus.mandatoryCases();
for (const [index, scenario] of failureScenarios.scenarios.entries()) {
  const expectedTier = tierFor(scenario);
  const expectedKey = catalogCaseKeys[index];
  const entry = mandatory.find((candidate) => candidate.caseKeyDigest === expectedKey);
  assert.ok(entry, `${scenario.id} must remain present in the persistent mandatory replay corpus.`);
  assert.equal(entry.tenantScopeDigest, tenantScopeDigest, `${scenario.id} must remain tenant-digest scoped.`);
  assert.equal(entry.scenarioId, scenario.id);
  assert.equal(entry.tier, expectedTier);
  assert.equal(entry.expectedOutcome, 'contained');
  assert.equal(entry.safeTerminalObserved, true);
  assert.equal(entry.mandatoryReplay, true);
}
assert.equal(new Set(catalogCaseKeys).size, failureScenarios.scenarios.length, 'Current scenario classes must retain distinct deterministic case keys.');
assert.ok(finalSnapshot.entryCount >= failureScenarios.scenarios.length, 'Persistent corpus must retain at least every current scenario class.');
assert.ok(finalSnapshot.entryCount >= initialEntryCount, 'Persistent corpus may append but must never lose prior verified entries.');
if (priorSnapshotLoaded) {
  assert.ok(finalSnapshot.entryCount >= priorSnapshot.entryCount, 'Reloading a prior corpus must preserve every prior entry.');
  for (const priorEntry of priorSnapshot.entries) {
    const preserved = finalSnapshot.entries.find((entry) => entry.entryDigest === priorEntry.entryDigest);
    assert.ok(preserved, `Prior append-only entry ${priorEntry.entryDigest} must survive continuity replay.`);
  }
  assert.equal(appendedCurrentClasses, 0, 'A verified prior corpus must already contain every current catalog class; replay may not silently fork those cases.');
  assert.equal(deduplicatedCurrentClasses, failureScenarios.scenarios.length, 'Every current scenario class must resolve to the exact prior mandatory case on continuity replay.');
  assert.equal(finalSnapshot.entryCount, priorSnapshot.entryCount, 'Replaying an unchanged scenario catalog over a verified prior corpus must be a zero-growth exact continuity operation.');
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const outputRaw = Buffer.from(`${JSON.stringify(finalSnapshot, null, 2)}\n`);
fs.writeFileSync(outputPath, outputRaw);
const reloaded = createIncidentRegressionCorpus({ initialSnapshot: JSON.parse(fs.readFileSync(outputPath, 'utf8')) });
assert.equal(reloaded.snapshot().corpusDigest, finalSnapshot.corpusDigest, 'Written corpus must reload to the exact verified corpus digest.');
assert.equal(reloaded.snapshot().entryCount, finalSnapshot.entryCount, 'Written corpus must reload without entry loss.');

const exactPriorCatalogReplay = priorSnapshotLoaded
  ? appendedCurrentClasses === 0
    && deduplicatedCurrentClasses === failureScenarios.scenarios.length
    && finalSnapshot.entryCount === priorSnapshot.entryCount
  : null;
const continuityCore = {
  schemaVersion: 2,
  proof: 'provider-neutral-incident-regression-corpus-continuity',
  status: 'PASS',
  priorSnapshotLoaded,
  priorSnapshotSha256: priorRaw ? sha256(priorRaw) : null,
  priorCorpusDigest: priorSnapshot?.corpusDigest || null,
  priorEntryCount: priorSnapshot?.entryCount ?? 0,
  currentScenarioClasses: failureScenarios.scenarios.length,
  appendedCurrentClasses,
  deduplicatedCurrentClasses,
  exactPriorCatalogReplay,
  outputSnapshotSha256: sha256(outputRaw),
  outputCorpusDigest: finalSnapshot.corpusDigest,
  outputEntryCount: finalSnapshot.entryCount,
  allPriorEntriesPreserved: priorSnapshotLoaded ? finalSnapshot.entryCount >= priorSnapshot.entryCount : true,
  currentCatalogMandatoryReplayVerified: true,
  rawCustomerTextPersisted: false,
  rawTenantIdentifierPersisted: false,
  reusableSecretsPersisted: false,
  actionAuthorityGranted: false,
  productionAuthorityGranted: false,
  releaseAuthorityGranted: false,
  crossTenantMutation: false,
  productionMutation: false,
  customerMutation: false,
};
const continuity = {
  ...continuityCore,
  continuityDigest: sha256(Buffer.from(JSON.stringify(continuityCore))),
};
fs.writeFileSync(continuityPath, `${JSON.stringify(continuity, null, 2)}\n`);

console.log(JSON.stringify(continuity, null, 2));