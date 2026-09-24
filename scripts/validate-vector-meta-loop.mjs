#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const readJson = path => JSON.parse(fs.readFileSync(path,'utf8'));
const meta = readJson('product-factory/vector-meta-loop-policy.json');
const adaptive = readJson('product-factory/adaptive-intelligence-manifest.json');
const proof = readJson('release/proof-lane-policy.json');
const blocker = readJson('resilience/blocker-autopilot-policy.json');
const scenarios = readJson('resilience/failure-scenarios.json');

assert.equal(meta.schemaVersion,1);
assert.equal(meta.contract,'VECTOR_META_LOOP_V1');
assert.equal(meta.canonicalCandidate.singleConvergenceLane,true);
assert.equal(meta.canonicalCandidate.duplicateDevelopmentBranchesAllowed,false);
assert.equal(meta.canonicalCandidate.releaseAuthoritySeparated,true);

const expected = [
  'delta-frontier','customer-value','architecture-t9','implementation','simulation',
  'trust-security','performance-scale','ux-friction','zero-human','blocker-continuity',
  'proof','learning','northstar-external-assault'
].sort();
const actual = meta.loops.map(x=>x.id).sort();
assert.deepEqual(actual,expected);
for (const loop of meta.loops) {
  assert.equal(loop.proofRequired,true,loop.id);
  assert.ok(loop.purpose && loop.purpose.length>20,loop.id);
  assert.ok(loop.routesTo==='canonical-candidate' || loop.routesTo==='evidence-ledger',loop.id);
}

assert.deepEqual(meta.evidenceLadder,[
  'concept','coded','unit-proven','integrated','simulated','adversarially-tested',
  'hosted','restart-recovery-proven','customer-journey-proven','production-eligible'
]);
assert.equal(meta.acceleration.parallelWhereIndependent,true);
assert.equal(meta.acceleration.shareEvidenceAcrossLoops,true);
assert.equal(meta.acceleration.noBlindRerun,true);
assert.equal(meta.acceleration.noSkippedGateCountsAsPass,true);
assert.equal(meta.acceleration.continueUnrelatedDevelopmentWhenOneProofScopeIsBlocked,true);
assert.equal(meta.acceleration.stopDuplicateBranches,true);

assert.equal(meta.northstarBoundary.externalOnly,true);
assert.equal(meta.northstarBoundary.separateEnvironmentRequired,true);
assert.equal(meta.northstarBoundary.mayMutateVectorProduction,false);
assert.equal(meta.northstarBoundary.mayGrantVectorAuthority,false);
assert.equal(meta.northstarBoundary.evidenceMayBeConsumedOnlyAfterVectorVerification,true);

for (const q of ['Can we build it faster?','Can we prove it sooner?','Can we make it more autonomous?','Can the learning create additional customer value?']) {
  assert.ok(meta.requiredQuestions.includes(q),q);
}

assert.ok(adaptive.loops.customerOptimization);
assert.ok(adaptive.loops.productEvolution);
assert.ok(adaptive.loops.marketEvolution);
for (const principle of ['every-regression-becomes-an-eval','every-repeatable-win-becomes-a-skill','every-manual-repeat-becomes-an-automation-candidate','competitor-gap-becomes-an-eval','leapfrog-before-copy']) {
  assert.ok(adaptive.principles.includes(principle),principle);
}
for (const signal of ['production-output','labour-cost','user-friction','support-incidents','integration-health']) {
  assert.ok(adaptive.loops.customerOptimization.signals.includes(signal),signal);
}

assert.equal(proof.rules.skippedNeverCountsAsPass,true);
assert.equal(proof.rules.exactSourceShaRequired,true);
assert.equal(proof.rules.developmentContinuesIfAnyExecutableLaneExists,true);
assert.ok(Number(proof.rules.productionPromotionRequiresIndependentProviders)>=2);

assert.equal(blocker.contract,'VECTOR_BLOCKER_AUTOPILOT_POLICY_V1');
assert.ok(blocker.classificationSloSeconds<=60);
assert.ok(blocker.fallbackDispatchSloSeconds<=90);
assert.ok(blocker.executablePathRestoreSloSeconds<=300);
assert.equal(blocker.invariants.productionMutationAuthority,false);
assert.equal(blocker.invariants.customerMutationAuthority,false);
assert.equal(blocker.invariants.testsMayBeRemovedToRestoreVelocity,false);
assert.equal(blocker.invariants.staleProofIsPass,false);

for (const path of ['resilience/blocker-autopilot.cjs','resilience/blocker-autopilot.test.cjs']) {
  assert.equal(fs.existsSync(path),true,path);
}
const ids = new Set((Array.isArray(scenarios)?scenarios:scenarios.scenarios||[]).map(x=>x.id));
for (const id of ['bad-release','cross-tenant-access-attempt','unknown-customer-reported-issue','repeat-known-customer-issue']) {
  assert.ok(ids.has(id),id);
}

const receipt = {
  schemaVersion: 1,
  contract: meta.contract,
  status: 'PASS',
  canonicalConvergence: true,
  loopCount: meta.loops.length,
  evidenceLadder: meta.evidenceLadder,
  blockerAutopilotAdmitted: true,
  marketEvolutionAdmitted: true,
  customerValueLoopAdmitted: true,
  northstarIsolationRequired: true,
  noBlindRerun: true,
  noDuplicateDevelopmentBranches: true,
  productionMutation: false,
  releaseAuthorityGranted: false,
  generatedAt: new Date().toISOString(),
  claimBoundary: 'Admission proves the loop-of-loops contract is present and internally consistent. Individual product capabilities still require their own exact-candidate runtime, hosted, restart/recovery and customer-journey evidence.'
};
fs.writeFileSync('vector-meta-loop-proof.json',JSON.stringify(receipt,null,2)+'\n');
console.log('VECTOR_META_LOOP_ADMISSION=PASS|loops='+meta.loops.length);
