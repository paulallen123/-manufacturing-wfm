#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const file = (p) => path.join(root, p);
const exists = (p) => fs.existsSync(file(p));
const read = (p) => fs.readFileSync(file(p), 'utf8');
const json = (p) => JSON.parse(read(p));

const plane = json('release/vector-engineering-plane.json');
const adaptive = json('product-factory/adaptive-intelligence-manifest.json');
const frontier = json('release/vector-frontier-convergence.json');

assert.equal(plane.contractVersion, 'VECTOR_ENGINEERING_PLANE_V1');
assert.equal(plane.operatingModel, 'HYBRID_GITHUB_SOURCE_VECTOR_EXECUTION');
assert.equal(plane.sourceControl.system, 'GitHub');
assert.equal(plane.sourceControl.sourceOfTruth, true);

for (const key of [
  'productionExecutionAllowed',
  'productionMutationAllowed',
  'rawCustomerDataAllowed',
  'directExternalSystemWritesAllowed',
  'northstarRuntimeShared',
  'northstarDatabaseShared',
  'northstarSecretsShared',
  'northstarDeploymentShared'
]) {
  assert.equal(plane.boundaries[key], false, key + ' must remain false');
}

assert.equal(plane.integration?.productFactory?.manifest, 'product-factory/adaptive-intelligence-manifest.json');
assert.equal(plane.integration?.productFactory?.role, 'EVOLUTION_AND_CANDIDATE_GOVERNANCE');
assert.equal(plane.integration?.t9Trust?.role, 'CUSTOMER_OPERATIONAL_AUTHORITY');
assert.equal(plane.integration?.northstar?.role, 'ISOLATED_EXTERNAL_SIMULATION_AND_CUSTOMER_EMULATION');
assert.equal(plane.integration?.hostedProof?.role, 'ISOLATED_ENGINEERING_BUILD_AND_PROOF');
assert.equal(plane.learningBridge?.directProductionMutation, false);
assert.equal(plane.learningBridge?.selfCertification, false);

for (const principle of [
  'no-direct-llm-production-authority',
  'every-regression-becomes-an-eval',
  'every-repeatable-win-becomes-a-skill',
  'every-manual-repeat-becomes-an-automation-candidate'
]) {
  assert.ok(adaptive.principles.includes(principle), 'adaptive intelligence missing principle: ' + principle);
}

assert.equal(adaptive.selfDevelopment.directEditOfProduction, false);
assert.equal(adaptive.selfDevelopment.branchFirst, true);
assert.equal(adaptive.selfDevelopment.canGenerateTests, true);
assert.equal(adaptive.selfDevelopment.canGenerateEvalsFromFailures, true);
assert.equal(adaptive.selfDevelopment.releaseAuthoritySeparated, true);

assert.equal(frontier.isolation?.productionModified, false);
assert.equal(frontier.isolation?.northstarModified, false);
assert.equal(frontier.proofRules?.exactSourceBinding, true);

const foundry = read('engineering/runtime/vector-tool-foundry.cjs');
assert.match(foundry, /VECTOR_FOUNDRY_RUN_RECEIPT_V1/);
assert.match(foundry, /Engineering-plane execution is prohibited in production/);
assert.match(foundry, /maySelfCertify:\s*false/);

const builtins = read('engineering/runtime/vector-tool-builtins.cjs');
assert.match(builtins, /vector\.contract\.check/);
assert.match(builtins, /vector\.regression\.compare/);
assert.match(builtins, /vector\.scenario\.assert/);

let fullRepositoryChecks = false;

if (exists('scripts/run-forge-ci.mjs')) {
  fullRepositoryChecks = true;
  const ci = read('scripts/run-forge-ci.mjs');
  assert.match(ci, /validate-vector-engineering-plane\.mjs/);
  assert.match(ci, /vector-tool-foundry\.test\.cjs/);
  assert.match(ci, /run-vector-foundry-proof\.mjs/);
}

if (exists('Dockerfile.frontier-proof')) {
  fullRepositoryChecks = true;
  const proofDocker = read('Dockerfile.frontier-proof');
  assert.match(proofDocker, /engineering\/runtime\/vector-tool-foundry\.cjs/);
  assert.match(proofDocker, /release\/vector-engineering-plane\.json/);
  assert.match(proofDocker, /run-vector-foundry-proof\.mjs/);
}

if (exists('Dockerfile')) {
  fullRepositoryChecks = true;
  const customerDocker = read('Dockerfile');
  assert.doesNotMatch(customerDocker, /engineering\/runtime\/vector-tool-foundry\.cjs/);
  assert.doesNotMatch(customerDocker, /release\/vector-engineering-plane\.json/);
}

console.log(JSON.stringify({
  contractVersion: 'VECTOR_ENGINEERING_PLANE_VALIDATION_V1',
  status: 'PASS',
  githubSourceOfTruth: true,
  productFactoryIntegrated: true,
  t9AuthoritySeparated: true,
  productionRuntimeUntouched: true,
  northstarIsolated: true,
  fullRepositoryChecks
}, null, 2));
console.log('VECTOR_ENGINEERING_PLANE_VALIDATION=PASS');
