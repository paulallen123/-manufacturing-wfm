'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const launcher = require('./launcher.cjs');
const publishedSourceFixture = require('./published-source.test-fixture.cjs');
const UNPUBLISHED = 'UNPUBLISHED_BROWSER_ENV_REPAIR_20261031';
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
test('unpublished, null, malformed and zero explicit source bindings fail closed', () => {
  for (const source of [null, '', UNPUBLISHED, '0'.repeat(40), 'A'.repeat(40), 'f'.repeat(39), 'f'.repeat(41), 'f'.repeat(40) + '\n'])
    assert.throws(() => launcher.validateRunnerSource(source), /UNPUBLISHED_RUNNER_SOURCE/);
  assert.equal(launcher.validateRunnerSource('76c5f4d32910d6cac6d347cfff9917dd93301ffb'), undefined);
});
test('unpublished launcher copy rejects before fetch, materialization, sqlite and child boundaries', async () => {
  for (const literal of ['undefined', 'null', "''", JSON.stringify(UNPUBLISHED)]) {
  const calls = [], m = { exports: {} }, source = fs.readFileSync(path.join(__dirname, 'launcher.cjs'), 'utf8')
    .replace(/^const SOURCE = '[^']+';$/m, 'const SOURCE = ' + literal + ';');
  const load = id => {
    if (id === 'node:fs') return { ...fs, mkdtempSync() { calls.push('materialize'); throw Error('unexpected boundary'); } };
    if (id === 'node:child_process') return { spawnSync() { calls.push('installer'); throw Error('unexpected boundary'); }, spawn() { calls.push('child'); throw Error('unexpected boundary'); } };
    if (id === 'node:sqlite') { calls.push('sqlite'); throw Error('unexpected boundary'); }
    return require(id);
  };
  vm.runInNewContext(source, { require: load, module: m, exports: m.exports, process: { env: env() }, Buffer, URL, Uint8Array, AbortController, setTimeout, clearTimeout });
  await assert.rejects(m.exports.run('not-even-a-bundle', 'f'.repeat(64), { fetchImpl() { calls.push('fetch'); throw Error('unexpected boundary'); } }), /UNPUBLISHED_RUNNER_SOURCE/);
  assert.deepEqual(calls, []);
  }
});
test('unpublished command copy rejects without fetching, installing or reading signer', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unpublished-runner-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const marker = path.join(root, 'unexpected-fetch'), guard = path.join(root, 'offline-only.cjs');
  fs.writeFileSync(guard, 'global.fetch=async()=>{require("node:fs").writeFileSync(' + JSON.stringify(marker) + ',"called");throw Error("offline-only");};');
  const command = publishedSourceFixture(__dirname, UNPUBLISHED).command;
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

test('prepared launcher names the immutable published six-file source', () => {
  assert.equal(launcher.SOURCE, '497a5b3707389dcef0bdd72cb3bad7eeb6781a11');
  assert.doesNotThrow(() => launcher.validateRunnerSource());
});
test('prepared manifest binds the bundle and exact command while leaving activation gated', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'generated/manifest.json'), 'utf8'));
  const bundle = JSON.parse(fs.readFileSync(path.join(__dirname, 'generated/bundle.json'), 'utf8'));
  const command = fs.readFileSync(path.join(__dirname, 'generated/start-command.txt'));
  assert.equal(manifest.sourceCommitBinding, '497a5b3707389dcef0bdd72cb3bad7eeb6781a11');
  assert.equal(manifest.source, launcher.SOURCE);
  assert.equal(manifest.runnerSource, launcher.SOURCE);
  assert.equal(manifest.bundleSha256, bundle.bundleHash);
  assert.equal(manifest.startCommandSha256, createHash('sha256').update(command).digest('hex'));
  assert.deepEqual(manifest.files, launcher.FILES);
  assert.equal(launcher.validateBundle(bundle.payload, bundle.bundleHash).length, 6);
  for (const [file, digest] of Object.entries(launcher.FILES))
    assert.equal(createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '../../..', file))).digest('hex'), digest);
  assert.equal(manifest.intendedReviewedTargetSha, null);
  assert.match(manifest.targetSelection, /explicit WFM_EXPECTED_CANDIDATE_SHA/);
  assert.match(manifest.activationBlocked, /protected|signer|actor|authority|review/i);
  assert.deepEqual(manifest.proof, { materializationOnly: true, hosted: false, provider: false, customer: false });
});

test('preparation rejects an unbound source before reading inputs or writing artifacts', () => {
  const calls = [];
  const source = fs.readFileSync(path.join(__dirname, 'prepare.cjs'), 'utf8');
  const load = id => {
    if (id === './launcher.cjs') return { ...launcher, SOURCE: UNPUBLISHED,
      validateRunnerSource() { launcher.validateRunnerSource(UNPUBLISHED); } };
    if (id === 'node:fs') return { readFileSync() { calls.push('read'); throw Error('unexpected input read'); },
      mkdirSync() { calls.push('mkdir'); throw Error('unexpected artifact directory'); },
      writeFileSync() { calls.push('write'); throw Error('unexpected artifact write'); } };
    return require(id);
  };
  assert.throws(() => vm.runInNewContext(source, { require: load, __dirname, Buffer,
    process: { argv: ['node', 'prepare.cjs', '/unread-source', '/unwritten-artifacts'] }, console }), /UNPUBLISHED_RUNNER_SOURCE/);
  assert.deepEqual(calls, []);
});

test('exact published command rejects a wrong target before materialization or installation', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'published-runner-target-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const guard = path.join(root, 'offline-target.cjs'), fetched = path.join(root, 'fetch'), forbidden = path.join(root, 'forbidden');
  const identity = { candidateSha: 'b'.repeat(40), sourceBinding: 'build-file-matched',
    fixtureOnly: true, productionApproved: false, pilotReady: false };
  fs.writeFileSync(guard, 'const fs=require("node:fs");const stop=()=>{fs.writeFileSync(' + JSON.stringify(forbidden) + ',"called");throw Error("unexpected boundary");};fs.mkdtempSync=stop;require("node:child_process").spawnSync=stop;global.fetch=async url=>{fs.writeFileSync(' + JSON.stringify(fetched) + ',String(url));const response=new Response(' + JSON.stringify(JSON.stringify(identity)) + ',{status:200,headers:{"content-type":"application/json"}});Object.defineProperty(response,"url",{value:String(url)});return response;};');
  const command = fs.readFileSync(path.join(__dirname, 'generated/start-command.txt'), 'utf8');
  const result = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8', timeout: 10000,
    env: { ...env(), PATH: path.dirname(process.execPath), TMPDIR: root, NODE_OPTIONS: '--require ' + guard } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /RUNTIME_IDENTITY_TARGET_MISMATCH/);
  assert.equal(fs.readFileSync(fetched, 'utf8'), 'https://vector-hardening-proof-production.up.railway.app/api/runtime-identity');
  assert.equal(fs.existsSync(forbidden), false);
  assert.deepEqual(fs.readdirSync(root).sort(), ['fetch', 'offline-target.cjs']);
  assert.ok(!result.stdout.includes(env().PROOF_PRIVATE_KEY_B64));
  assert.ok(!result.stderr.includes(env().PROOF_PRIVATE_KEY_B64));
});
