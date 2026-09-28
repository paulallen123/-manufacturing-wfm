'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'bootstrap.cjs'), 'utf8');

test('exact bootstrap enables the signed proof runner only through explicit staging configuration', () => {
  assert.match(source, /createProofRunnerAuth/);
  assert.match(source, /WFM_PROOF_RUNNER_AUTH === 'enabled'/);
  assert.match(source, /hosted && proofRunnerEnabled && !process\.env\.WFM_STAGING_PASSWORD/);
});

test('identity guard executes before the proof runner session exchange', () => {
  const guardIndex = source.indexOf('guard.beforeRequest(req, res)');
  const proofIndex = source.indexOf('proofRunnerAuth.handleRequest(req, res)');
  assert.ok(guardIndex >= 0, 'identity guard route is missing');
  assert.ok(proofIndex > guardIndex, 'proof runner must execute after injected-identity rejection');
});
