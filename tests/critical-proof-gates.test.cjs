'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('release Dockerfile permanently includes critical attendance simulations', () => {
  const dockerfile = fs.readFileSync('Dockerfile', 'utf8');
  for (const required of [
    'clocking-security-v2/attendance-24x7-soak.test.mjs',
    'clocking-security-v2/attendance-enterprise-scale.test.mjs',
    'clocking-security-v2/attendance-certification-live.test.mjs',
    'security/runtime/durable-state-guard.test.cjs'
  ]) {
    assert.ok(dockerfile.includes(required), 'Missing mandatory release simulation: ' + required);
  }
});

test('browser proof image blocks syntactically invalid harnesses before deploy', () => {
  const dockerfile = fs.readFileSync('Dockerfile.current-vector-browser-proof', 'utf8');
  for (const required of [
    'node --check ./current-candidate-role-browser-proof.mjs',
    'node --check ./current-candidate-role-browser-proof-server.mjs',
    'node --check ./vector-proof-result.mjs'
  ]) {
    assert.ok(dockerfile.includes(required), 'Missing browser proof syntax gate: ' + required);
  }
});

test('hosted runtime retains durable-state admission control', () => {
  const bootstrap = fs.readFileSync('security/runtime/bootstrap.cjs', 'utf8');
  const guard = fs.readFileSync('security/runtime/durable-state-guard.cjs', 'utf8');
  assert.ok(bootstrap.includes("require('./durable-state-guard.cjs')"));
  assert.ok(bootstrap.includes('enforceDurableState()'));
  assert.ok(guard.includes("process.env.WFM_REQUIRE_DURABLE_STATE === 'true'"));
  assert.ok(guard.includes("distinct mounted volume"));
});
