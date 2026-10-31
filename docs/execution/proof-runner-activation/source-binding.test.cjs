'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const launcher = require('./launcher.cjs');
function env() {
  return { RAILWAY_SERVICE_ID: 'f84fe27d-af17-451c-b164-54dfef6b6a4b',
    RAILWAY_ENVIRONMENT_ID: 'eed9f097-610a-416e-83b9-6bc7bdb3eeef',
    VECTOR_PROOF_URL: 'https://vector-hardening-proof-production.up.railway.app/',
    WFM_EXPECTED_CANDIDATE_SHA: 'a'.repeat(40), VECTOR_PROOF_AUTH_PROFILE: 'signed',
    WFM_REQUIRE_VECTOR_ASSET_DIGESTS: 'true', WFM_REQUIRE_ACTION_AFFORDANCE_COVERAGE: 'true',
    VECTOR_PROOF_ACTORS_JSON: 'FICTIONAL_ACTORS', PROOF_PRIVATE_KEY_B64: 'FICTIONAL_SIGNER_NOT_TO_LOG',
    EXPECTED_DEPLOYMENT_ID: 'fictional-deployment', EXPECTED_IMPLEMENTATION_TENANT: 'fictional-tenant',
    EXPECTED_IMPLEMENTATION_RUN_ID: 'fictional-run', EXPECTED_CONFIGURATION_DIGEST: 'b'.repeat(64),
    VECTOR_CANONICAL_JS_SHA256: 'c'.repeat(64), VECTOR_CANONICAL_CSS_SHA256: 'd'.repeat(64), VECTOR_WORKFLOW_JS_SHA256: 'e'.repeat(64) };
}
test('unpublished, absent, malformed and zero source bindings fail closed', () => {
  for (const source of [undefined, null, '', launcher.SOURCE, '0'.repeat(40), 'A'.repeat(40), 'f'.repeat(39), 'f'.repeat(41), 'f'.repeat(40) + '\n'])
    assert.throws(() => launcher.validateRunnerSource(source), /UNPUBLISHED_RUNNER_SOURCE/);
  assert.equal(launcher.validateRunnerSource('76c5f4d32910d6cac6d347cfff9917dd93301ffb'), undefined);
});
test('actual unpublished run rejects before fetch, materialization, sqlite and child boundaries', async () => {
  const calls = [], m = { exports: {} }, source = fs.readFileSync(path.join(__dirname, 'launcher.cjs'), 'utf8');
  const load = id => {
    if (id === 'node:fs') return { ...fs, mkdtempSync() { calls.push('materialize'); throw Error('unexpected boundary'); } };
    if (id === 'node:child_process') return { spawnSync() { calls.push('installer'); throw Error('unexpected boundary'); }, spawn() { calls.push('child'); throw Error('unexpected boundary'); } };
    if (id === 'node:sqlite') { calls.push('sqlite'); throw Error('unexpected boundary'); }
    return require(id);
  };
  vm.runInNewContext(source, { require: load, module: m, exports: m.exports, process: { env: env() }, Buffer, URL, Uint8Array, AbortController, setTimeout, clearTimeout });
  await assert.rejects(m.exports.run('not-even-a-bundle', 'f'.repeat(64), { fetchImpl() { calls.push('fetch'); throw Error('unexpected boundary'); } }), /UNPUBLISHED_RUNNER_SOURCE/);
  assert.deepEqual(calls, []);
});
test('exact generated command rejects unpublished source without fetching, installing or reading signer', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unpublished-runner-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const marker = path.join(root, 'unexpected-fetch'), guard = path.join(root, 'offline-only.cjs');
  fs.writeFileSync(guard, 'global.fetch=async()=>{require("node:fs").writeFileSync(' + JSON.stringify(marker) + ',"called");throw Error("offline-only");};');
  const command = fs.readFileSync(path.join(__dirname, 'generated/start-command.txt'), 'utf8');
  const result = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8', timeout: 10000,
    env: { ...env(), PATH: path.dirname(process.execPath), TMPDIR: root, NODE_OPTIONS: '--require ' + guard } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /UNPUBLISHED_RUNNER_SOURCE/);
  assert.ok(!result.stdout.includes('VECTOR_PROOF_RUNNER_SOURCE='));
  assert.ok(!result.stdout.includes(env().PROOF_PRIVATE_KEY_B64));
  assert.ok(!result.stderr.includes(env().PROOF_PRIVATE_KEY_B64));
  assert.equal(fs.existsSync(marker), false);
  assert.deepEqual(fs.readdirSync(root), ['offline-only.cjs']);
});
