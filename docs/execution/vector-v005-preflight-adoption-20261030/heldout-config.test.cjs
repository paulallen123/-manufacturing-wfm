'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(process.env.V005_SOURCE_ROOT || process.cwd());
const script = path.join(root, 'scripts/proof-access-preflight.cjs');
const { inspectProofAccess } = require(script);
const required = ['VECTOR_PROOF_AUTH_PROFILE', 'VECTOR_PROOF_URL',
  'WFM_EXPECTED_CANDIDATE_SHA', 'EXPECTED_DEPLOYMENT_ID',
  'EXPECTED_IMPLEMENTATION_TENANT', 'EXPECTED_IMPLEMENTATION_RUN_ID',
  'EXPECTED_CONFIGURATION_DIGEST', 'VECTOR_PROOF_ACTORS_JSON', 'PROOF_PRIVATE_KEY_B64'];
function config() {
  return { VECTOR_PROOF_AUTH_PROFILE: 'signed', VECTOR_PROOF_URL: 'https://fixture.invalid/',
    WFM_EXPECTED_CANDIDATE_SHA: 'a'.repeat(40), EXPECTED_DEPLOYMENT_ID: 'fictional-deployment',
    EXPECTED_IMPLEMENTATION_TENANT: 'fictional-main', EXPECTED_IMPLEMENTATION_RUN_ID: 'fictional-run',
    EXPECTED_CONFIGURATION_DIGEST: 'b'.repeat(64),
    VECTOR_PROOF_ACTORS_JSON: JSON.stringify([
      ['manager', 'manager'], ['employee', 'employee'], ['payroll', 'payroll_admin'],
      ['company-admin', 'director'], ['isolation-manager', 'manager']
    ].map(([slug, role]) => ({ slug, role, email: slug + '@fixture.invalid',
      tenant: slug === 'isolation-manager' ? 'fictional-other' : 'fictional-main' }))),
    PROOF_PRIVATE_KEY_B64: Buffer.from(generateKeyPairSync('ed25519').privateKey.export({
      format: 'pem', type: 'pkcs8' })).toString('base64') };
}

// Generated keys and fictional actors are held only in this local test process.
// Valid structure never establishes protected signer trust or business authority.
for (const field of required) {
  test('missing or empty required binding fails closed: ' + field, () => {
    for (const value of [undefined, '', null, false, 0]) {
      const env = { ...config(), [field]: value };
      const result = inspectProofAccess(env);
      assert.equal(result.status, 'BLOCKED');
      assert.ok(result.missing.includes(field));
      assert.deepEqual(Object.keys(result), ['status', 'missing', 'invalid', 'scope']);
      assert.match(result.scope, /no session issued, server authorization or customer proof established/);
    }
  });
}

test('CLI with zero bindings exits1 and reports only missing field names', () => {
  const child = spawnSync(process.execPath, [script], { env: {}, encoding: 'utf8', timeout: 10000 });
  assert.ifError(child.error);
  assert.equal(child.status, 1);
  const result = JSON.parse(child.stdout);
  assert.equal(result.status, 'BLOCKED');
  assert.deepEqual(result.missing, required);
  assert.deepEqual(result.invalid, []);
});

test('synthetic structurally valid inputs retain offline-only claim and issue no request', () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = () => { requests++; throw Error('Unexpected preflight transport'); };
  try {
    const env = config();
    const result = inspectProofAccess(env);
    assert.equal(result.status, 'CONFIGURATION_VALID');
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.invalid, []);
    assert.deepEqual(Object.keys(result), ['status', 'missing', 'invalid', 'scope']);
    assert.equal(requests, 0);
    for (const value of [env.PROOF_PRIVATE_KEY_B64, env.VECTOR_PROOF_ACTORS_JSON,
      env.EXPECTED_IMPLEMENTATION_TENANT, env.EXPECTED_IMPLEMENTATION_RUN_ID])
      assert.ok(!JSON.stringify(result).includes(value));
  } finally { globalThis.fetch = originalFetch; }
});
