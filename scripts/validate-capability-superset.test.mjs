import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const script = new URL('./validate-capability-superset.mjs', import.meta.url);
const required = [
  'factory-autopilot', 'energy-intelligence', 'cash-to-capacity', 'agency-labour',
  'automatic-training-video', 'zero-touch-secure-entry', 'mobile-tablet-mass-clocking',
  'realtime-ui', 'autonomous-integrations', 'customer-outcome-learning'
];

function fixture(integratedPath) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-superset-'));
  fs.mkdirSync(path.join(root, 'release'));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.writeFileSync(path.join(root, 'scripts', 'validate-capability-superset.mjs'), fs.readFileSync(script));
  fs.writeFileSync(path.join(root, 'release', 'vector-eow-convergence.json'), JSON.stringify({target: required.map(id => ({id}))}));
  fs.writeFileSync(path.join(root, 'release', 'capability-superset.json'), JSON.stringify({
    schemaVersion: 1,
    policy: {retireLegacyOnlyAfterSupersetProof: true, functionalParityMinimum: 1},
    proofRequiredToRetire: [
      'original-behaviour-tests', 'exact-image-admission', 'hosted-role-journey',
      'tenant-isolation', 'refresh-new-login', 'restart-durability',
      'rollback-or-safe-abstention', 'before-after-value-evidence'
    ],
    capabilities: required.map(id => ({
      id, status: 'in-development', mayRetireLegacySource: false,
      preservedBehaviors: ['retained'], valueAddTargets: ['better'], sourceRefs: ['PR#1'],
      integratedPaths: [integratedPath]
    }))
  }));
  return root;
}

function validate(root) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'validate-capability-superset.mjs')],
    {cwd: root, encoding: 'utf8'});
}

test('integrated source must be a regular file within the candidate tree', t => {
  const root = fixture('source.cjs');
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.writeFileSync(path.join(root, 'source.cjs'), 'module.exports = true;');
  assert.equal(validate(root).status, 0);

  const outside = path.join(path.dirname(root), `${path.basename(root)}-outside-source.cjs`);
  fs.writeFileSync(outside, 'module.exports = false;');
  t.after(() => fs.rmSync(outside, {force: true}));
  const manifest = path.join(root, 'release', 'capability-superset.json');
  const original = JSON.parse(fs.readFileSync(manifest));
  for (const badPath of [`../${path.basename(outside)}`, 'release', 'source-link.cjs']) {
    fs.symlinkSync(outside, path.join(root, 'source-link.cjs'));
    const altered = structuredClone(original);
    altered.capabilities[0].integratedPaths = [badPath];
    fs.writeFileSync(manifest, JSON.stringify(altered));
    const result = validate(root);
    assert.notEqual(result.status, 0, `${badPath} was accepted: ${result.stdout}`);
    fs.rmSync(path.join(root, 'source-link.cjs'));
  }
  for (const missing of [[], undefined]) {
    const altered = structuredClone(original);
    altered.capabilities[0].integratedPaths = missing;
    fs.writeFileSync(manifest, JSON.stringify(altered));
    const result = validate(root);
    assert.notEqual(result.status, 0, `missing integrated source accepted: ${result.stdout}`);
  }
});
