'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');

// Exercise the real launcher through its process boundaries with fictional inputs.
// No package, browser, signer, account or hosted endpoint is used by this harness.
const activationRoot = path.resolve(process.env.PROOF_ACTIVATION_TARGET || __dirname);
const launcherPath = path.join(activationRoot, 'launcher.cjs');
const source = fs.readFileSync(launcherPath, 'utf8');
const bundle = JSON.parse(fs.readFileSync(path.join(activationRoot, 'generated/bundle.json')));
const transport = {
  PATH: '/fictional/bin', HOME: '/fictional/home', TMPDIR: '/fictional/tmp',
  LANG: 'en_GB.UTF-8', TZ: 'UTC', NODE_EXTRA_CA_CERTS: '/fictional/ca.pem',
  SSL_CERT_FILE: '/fictional/ca.pem', SSL_CERT_DIR: '/fictional/certs',
  NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: 'http://fictional-proxy.invalid', NO_PROXY: 'localhost'
};
const proof = {
  PORT: '3000', PLAYWRIGHT_BROWSERS_PATH: '/fictional/ms-playwright',
  VECTOR_PROOF_URL: 'https://vector-hardening-proof-production.up.railway.app/',
  WFM_EXPECTED_CANDIDATE_SHA: 'a'.repeat(40), VECTOR_PROOF_AUTH_PROFILE: 'signed',
  VECTOR_PROOF_ACTORS_JSON: 'FICTIONAL_ACTOR_SCOPE', PROOF_PRIVATE_KEY_B64: 'FICTIONAL_SIGNER_SENTINEL',
  EXPECTED_DEPLOYMENT_ID: 'fictional-deployment', EXPECTED_IMPLEMENTATION_TENANT: 'fictional-tenant',
  EXPECTED_IMPLEMENTATION_RUN_ID: 'fictional-run', EXPECTED_CONFIGURATION_DIGEST: 'b'.repeat(64),
  WFM_REQUIRE_VECTOR_ASSET_DIGESTS: 'true', WFM_REQUIRE_ACTION_AFFORDANCE_COVERAGE: 'true',
  VECTOR_CANONICAL_JS_SHA256: 'c'.repeat(64), VECTOR_CANONICAL_CSS_SHA256: 'd'.repeat(64),
  VECTOR_WORKFLOW_JS_SHA256: 'e'.repeat(64)
};
const forbidden = {
  STAFFOLOGY_API_KEY: 'FICTIONAL_PROVIDER_SENTINEL', CANDIDATE_STAFFOLOGY_KEY: 'FICTIONAL_PROVIDER_SENTINEL',
  OPENAI_API_KEY: 'FICTIONAL_PROVIDER_SENTINEL', WFM_IMPLEMENTATION_INTERNAL_TOKEN: 'FICTIONAL_WORKER_SENTINEL',
  WFM_IMPLEMENTATION_WORKER_TOKEN: 'FICTIONAL_WORKER_SENTINEL', WFM_IMPLEMENTATION_WORKER_ID: 'fictional-worker',
  WFM_STAGING_PASSWORD: 'FICTIONAL_PASSWORD_SENTINEL', WRAPPED_PASSKEY_CREDENTIALS: 'FICTIONAL_PASSKEY_SENTINEL',
  NODE_OPTIONS: '--require /fictional/untrusted-preload.cjs', NODE_PATH: '/fictional/untrusted-modules',
  LD_PRELOAD: '/fictional/untrusted.so', BROWSER_PROOF_SCRIPT: 'fictional_obsolete_eval()',
  BROWSER_ROLE_PROOF_SCRIPT: 'fictional_obsolete_eval()', UNKNOWN_FUTURE_CREDENTIAL: 'FICTIONAL_UNKNOWN_SENTINEL'
};

async function observeRun({ exitCode = 0, signal = null } = {}) {
  const env = { ...transport, ...proof, ...forbidden,
    RAILWAY_SERVICE_ID: 'f84fe27d-af17-451c-b164-54dfef6b6a4b',
    RAILWAY_ENVIRONMENT_ID: 'eed9f097-610a-416e-83b9-6bc7bdb3eeef' };
  const calls = [], logs = [], processFixture = { env, execPath: process.execPath, on() {}, off() {}, exitCode: 0 };
  const moduleFixture = { exports: {} };
  const load = id => {
    if (id === 'node:child_process') return {
      spawnSync(command, args, options) { calls.push({ kind: 'installer', command, args, options }); return { status: 0 }; },
      spawn(command, args, options) {
        calls.push({ kind: 'proof-child', command, args, options });
        const child = new EventEmitter(); child.kill = () => {};
        setImmediate(() => child.emit('exit', exitCode, signal)); return child;
      }
    };
    if (id === 'node:module') return { createRequire: () => request => {
      if (request === 'playwright/package.json') return { version: '1.63.0' };
      if (request === 'playwright') return { chromium: { executablePath: () => process.execPath } };
      throw Error('Unexpected local dependency');
    } };
    if (id === 'node:sqlite') return {};
    return require(id);
  };
  vm.runInNewContext(source, { require: load, module: moduleFixture, exports: moduleFixture.exports,
    process: processFixture, Buffer, URL, Uint8Array, AbortController, setTimeout, clearTimeout,
    console: { log: line => logs.push(line) } }, { filename: launcherPath });
  await moduleFixture.exports.run(bundle.payload, bundle.bundleHash, { fetchImpl: async url => {
    const response = new Response(JSON.stringify({ candidateSha: proof.WFM_EXPECTED_CANDIDATE_SHA,
      sourceBinding: 'build-file-matched', fixtureOnly: true, productionApproved: false, pilotReady: false }),
    { headers: { 'content-type': 'application/json' } });
    Object.defineProperty(response, 'url', { value: url }); return response;
  } });
  assert.equal(calls.filter(c => c.kind === 'installer').length, 1);
  assert.equal(calls.filter(c => c.kind === 'proof-child').length, 1);
  const installer = calls.find(c => c.kind === 'installer'), child = calls.find(c => c.kind === 'proof-child');
  assert.equal(fs.existsSync(child.options.cwd), false, 'Disposable source/package directory must be removed');
  return { installer, child, logs, exitCode: processFixture.exitCode };
}

test('installer excludes proof and unrelated authority while preserving transport', async () => {
  const { installer } = await observeRun();
  for (const [key, value] of Object.entries(transport)) assert.equal(installer.options.env[key], value, key);
  for (const key of [...Object.keys(proof), ...Object.keys(forbidden)]) assert.equal(installer.options.env[key], undefined, key + ' must not reach npm');
});
test('proof child retains explicit signed source, role, run, asset and transport bindings', async () => {
  const { child, logs } = await observeRun();
  for (const [key, value] of Object.entries({ ...transport, ...proof })) assert.equal(child.options.env[key], value, key);
  assert.doesNotMatch(logs.join('\n'), /FICTIONAL_(?:SIGNER|PROVIDER|WORKER|PASSWORD|PASSKEY|UNKNOWN)_SENTINEL/);
});
for (const key of Object.keys(forbidden)) test('proof child excludes unrelated authority: ' + key, async () => {
  const { child } = await observeRun();
  assert.equal(child.options.env[key], undefined, key + ' must not reach the proof child');
});
test('a real local Node child starts with only the captured proof environment', async () => {
  const { child } = await observeRun();
  const actual = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(Object.keys(process.env).sort()))'],
    { env: child.options.env, encoding: 'utf8' });
  assert.equal(actual.status, 0, 'Isolated local Node child must start without inherited preload hooks');
  assert.deepEqual(JSON.parse(actual.stdout), Object.keys({ ...transport, ...proof }).sort());
});
for (const [code, signal, expected] of [[7, null, 7], [null, 'SIGTERM', 143], [null, 'SIGINT', 130]])
  test('child exit propagates: ' + (signal || code), async () => {
    const result = await observeRun({ exitCode: code, signal });
    assert.equal(result.exitCode, expected);
  });
