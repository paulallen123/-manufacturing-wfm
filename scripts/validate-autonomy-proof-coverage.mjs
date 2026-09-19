import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PROTECTED_PATHS } = require('../resilience/autonomous-repair-factory.cjs');

const root = process.cwd();
const portablePath = path.join(root, 'scripts/run-portable-autonomy-proof.mjs');
const workflowPath = path.join(root, '.github/workflows/wfm-zero-engineer-support-contract.yml');
const repairFactoryPath = path.join(root, 'resilience/autonomous-repair-factory.cjs');

const portableSource = fs.readFileSync(portablePath, 'utf8');
const workflowSource = fs.readFileSync(workflowPath, 'utf8');
const repairFactorySource = fs.readFileSync(repairFactoryPath, 'utf8');

const portableChecks = [...portableSource.matchAll(
  /\[\s*['"][^'"]+['"]\s*,\s*['"]([^'"]+\.mjs)['"]\s*,\s*true\s*\]/g,
)].map((match) => match[1]);

const workflowPaths = [...workflowSource.matchAll(
  /^\s*-\s*['"]([^'"]+)['"]\s*$/gm,
)].map((match) => match[1]);

const protectedPaths = [...PROTECTED_PATHS];
const portableSet = new Set(portableChecks);
const workflowSet = new Set(workflowPaths);
const protectedSet = new Set(protectedPaths);

assert.equal(portableChecks.length, portableSet.size, 'Portable proof contains duplicate required validators.');
assert.equal(workflowPaths.length, workflowSet.size, 'Exact autonomy workflow contains duplicate trigger entries.');
assert.equal(protectedPaths.length, protectedSet.size, 'Repair protected-path policy contains duplicate entries.');

// Regression for 2026-09-19: sequential contents-API edits accidentally embedded the
// two literal characters "\\n" between adjacent line-oriented authority entries. That
// silently collapsed trigger/protection entries until a later repair. Keep this check in
// the already-mandatory coverage proof instead of adding another overlapping validator.
assert.equal(
  /['"]\s*\\n\s*-\s*['"]/.test(workflowSource),
  false,
  'Exact autonomy workflow contains a literal escaped-newline joining path-trigger entries.',
);
assert.equal(
  /,\s*\\n\s*['"]/.test(repairFactorySource),
  false,
  'Repair protected-path policy contains a literal escaped-newline joining authority entries.',
);

const externalCanonicalOnly = new Set([
  'scripts/validate-release-policy.mjs',
]);

for (const script of portableChecks) {
  assert.ok(fs.existsSync(path.join(root, script)), `Portable proof validator is missing: ${script}`);
  assert.ok(workflowSet.has(script), `Portable proof validator does not trigger exact workflow: ${script}`);
  assert.ok(protectedSet.has(script), `Portable proof validator is mutable by repair agent: ${script}`);
}

const protectedAuthoritySources = protectedPaths.filter((entry) =>
  entry.startsWith('resilience/')
  && (entry.endsWith('.cjs') || entry.endsWith('.json'))
  && fs.existsSync(path.join(root, entry)));

for (const source of protectedAuthoritySources) {
  assert.ok(workflowSet.has(source), `Protected autonomy authority source does not trigger exact workflow: ${source}`);
}

const protectedValidators = protectedPaths.filter((entry) =>
  entry.startsWith('scripts/validate-') && entry.endsWith('.mjs'));

for (const script of protectedValidators) {
  if (externalCanonicalOnly.has(script) && !fs.existsSync(path.join(root, script))) continue;
  assert.ok(fs.existsSync(path.join(root, script)), `Protected validator is missing without canonical-only exemption: ${script}`);
  assert.ok(workflowSet.has(script), `Protected validator does not trigger exact autonomy workflow: ${script}`);
  assert.ok(portableSet.has(script), `Protected validator is not mandatory in portable autonomy proof: ${script}`);
}

for (const required of [
  'scripts/validate-autonomy-proof-coverage.mjs',
  'scripts/validate-deployment.mjs',
  'scripts/validate-repair-path-canonicalization.mjs',
  'scripts/validate-build-secret-boundary.mjs',
  'scripts/validate-railway-proof-failure-classifier.mjs',
  'scripts/validate-t3-sandbox-component-binding.mjs',
  'scripts/validate-t3-capability-poisoning.mjs',
]) {
  assert.ok(protectedSet.has(required), `Coverage-critical validator is not repair-protected: ${required}`);
  assert.ok(portableSet.has(required), `Coverage-critical validator is not portable-proof mandatory: ${required}`);
  assert.ok(workflowSet.has(required), `Coverage-critical validator does not trigger exact workflow: ${required}`);
}

for (const required of [
  'resilience/build-secret-boundary.cjs',
  'resilience/railway-proof-failure-classifier.cjs',
  'resilience/t4-forensic-failover-store.cjs',
]) {
  assert.ok(protectedSet.has(required), `Coverage-critical authority source is not repair-protected: ${required}`);
  assert.ok(workflowSet.has(required), `Coverage-critical authority source does not trigger exact workflow: ${required}`);
}

console.log(JSON.stringify({
  schemaVersion: 2,
  proof: 'autonomy-proof-surface-coverage',
  status: 'PASS',
  portableRequiredValidatorCount: portableChecks.length,
  protectedAuthoritySourceCount: protectedAuthoritySources.length,
  protectedValidatorCount: protectedValidators.length,
  exactWorkflowTriggerCount: workflowPaths.length,
  portableValidatorsTriggerExactProof: true,
  portableValidatorsProtectedFromRepair: true,
  protectedAuthoritySourcesTriggerExactProof: true,
  protectedValidatorsMandatoryOrCanonicalOnly: true,
  escapedLineJoinRegressionGuard: true,
  automaticCoverageAudit: true,
  productionMutation: false,
  customerMutation: false,
  payrollMutation: false,
  identityMutation: false,
  modelAuthorityGranted: false,
  executionAuthorityGranted: false,
  releaseClaimAllowed: false,
  createsResources: false,
}, null, 2));
