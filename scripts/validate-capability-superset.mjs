#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifestPath = path.join(root, 'release', 'capability-superset.json');
const releasePath = path.join(root, 'release', 'vector-eow-convergence.json');

function fail(message) {
  console.error('VECTOR_CAPABILITY_SUPERSET_GATE=FAIL');
  console.error(message);
  process.exit(1);
}

if (!fs.existsSync(manifestPath)) fail('Missing release/capability-superset.json');
if (!fs.existsSync(releasePath)) fail('Missing release/vector-eow-convergence.json');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const release = JSON.parse(fs.readFileSync(releasePath, 'utf8'));

if (manifest.schemaVersion !== 1) fail('Unsupported superset manifest schema.');
if (!manifest.policy?.retireLegacyOnlyAfterSupersetProof) fail('Legacy retirement must require superset proof.');
if (manifest.policy?.functionalParityMinimum !== 1) fail('Functional parity floor must remain 100%.');

const requiredProof = new Set(manifest.proofRequiredToRetire || []);
for (const item of [
  'original-behaviour-tests',
  'exact-image-admission',
  'hosted-role-journey',
  'tenant-isolation',
  'refresh-new-login',
  'restart-durability',
  'rollback-or-safe-abstention',
  'before-after-value-evidence'
]) {
  if (!requiredProof.has(item)) fail(`Missing retirement proof requirement: ${item}`);
}

const releaseTargets = new Set((release.target || []).map(x => x.id));
const seen = new Set();
for (const capability of manifest.capabilities || []) {
  if (!capability.id || seen.has(capability.id)) fail(`Invalid or duplicate capability id: ${capability.id}`);
  seen.add(capability.id);

  if (!['retain-source', 'in-development', 'superset-proven'].includes(capability.status)) {
    fail(`${capability.id}: invalid status ${capability.status}`);
  }
  if (!Array.isArray(capability.preservedBehaviors) || capability.preservedBehaviors.length === 0) {
    fail(`${capability.id}: preserved behaviours are required.`);
  }
  if (!Array.isArray(capability.valueAddTargets) || capability.valueAddTargets.length === 0) {
    fail(`${capability.id}: value-add targets are required.`);
  }
  if (!Array.isArray(capability.sourceRefs) || capability.sourceRefs.length === 0) {
    fail(`${capability.id}: source provenance is required.`);
  }
  for (const target of capability.releaseTargetIds || []) {
    if (!releaseTargets.has(target)) fail(`${capability.id}: unknown FORGE release target ${target}`);
  }

  for (const rel of capability.integratedPaths || []) {
    const absolute = path.join(root, rel);
    if (!fs.existsSync(absolute)) fail(`${capability.id}: integrated path missing from exact candidate: ${rel}`);
  }

  if (capability.mayRetireLegacySource === true && capability.status !== 'superset-proven') {
    fail(`${capability.id}: legacy source cannot retire before superset-proven.`);
  }
  if (capability.status === 'superset-proven') {
    if (capability.mayRetireLegacySource !== true) {
      fail(`${capability.id}: superset-proven requires explicit retirement decision.`);
    }
    const proof = new Set(capability.proof || []);
    for (const item of requiredProof) {
      if (!proof.has(item)) fail(`${capability.id}: missing superset proof ${item}`);
    }
  }
}

const requiredCapabilities = [
  'factory-autopilot',
  'energy-intelligence',
  'cash-to-capacity',
  'agency-labour',
  'automatic-training-video',
  'zero-touch-secure-entry',
  'mobile-tablet-mass-clocking',
  'realtime-ui',
  'autonomous-integrations',
  'customer-outcome-learning'
];
for (const id of requiredCapabilities) {
  if (!seen.has(id)) fail(`Critical Friday capability missing from superset manifest: ${id}`);
}

console.log(`VECTOR_CAPABILITY_SUPERSET_GATE=PASS capabilities=${seen.size} retirementProofs=${requiredProof.size}`);
