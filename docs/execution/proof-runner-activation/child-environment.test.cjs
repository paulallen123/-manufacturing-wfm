'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');

// Exercise the real launcher through its process boundaries with fictional inputs.
// No package, browser, signer, account or hosted endpoint is used by this harness.
const activationRoot = path.resolve(process.env.PROOF_ACTIVATION_TARGET || __dirname);
const launcherPath = path.join(activationRoot, 'launcher.cjs');
const { source, bundle } = require('./published-source.test-fixture.cjs')(activationRoot);
const transport = {
  PATH: '/fictional/bin', HOME: '/fictional/home', TMPDIR: '/fictional/tmp',
  LANG: 'en_GB.UTF-8', TZ: 'UTC', NODE_EXTRA_CA_CERTS: '/fictional/ca.pem',
  SSL_CERT_FILE: '/fictional/ca.pem', SSL_CERT_DIR: '/fictional/certs',
  NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: 'http://fictional-proxy.invalid', NO_PROXY: 'localhost'
};
const signerKey = crypto.generateKeyPairSync('ed25519').privateKey;
const proofActors = [
  ['manager','manager','fixture'],['employee','employee','fixture'],['payroll','payroll_admin','fixture'],
  ['company-admin','director','fixture'],['isolation-manager','manager','other']
].map(([slug,role,tenant]) => ({ slug, role, tenant, email: slug + '@fixture.invalid' }));
const proof = {
  PORT: '3000', PLAYWRIGHT_BROWSERS_PATH: '/fictional/ms-playwright',
  VECTOR_PROOF_URL: 'https://vector-hardening-proof-production.up.railway.app/',
  WFM_EXPECTED_CANDIDATE_SHA: 'a'.repeat(40), VECTOR_PROOF_AUTH_PROFILE: 'signed',
  VECTOR_PROOF_ACTORS_JSON: JSON.stringify(proofActors),
  PROOF_PRIVATE_KEY_B64: Buffer.from(signerKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64'),
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

async function observeRun({ exitCode = 0, signal = null, childPid, triggerSignal,
  triggerSignalOrder = 'before-deadline', leaderExitAfterMs, kill, cleanupGraceMs,
  childTimeoutMs, expectedError } = {}) {
  const env = { ...transport, ...proof, ...forbidden,
    RAILWAY_SERVICE_ID: 'f84fe27d-af17-451c-b164-54dfef6b6a4b',
    RAILWAY_ENVIRONMENT_ID: 'eed9f097-610a-416e-83b9-6bc7bdb3eeef' };
  const calls = [], logs = [], signalHandlers = {};
  let spawnedChild, groupAlive = true, triggerSignalDelivered = false;
  const heldDeadline = { callback: null, cleared: false, released: false,
    handle: { unref() {} } };
  assert.ok(['before-deadline', 'after-hard-kill'].includes(triggerSignalOrder));
  const deliverTriggerSignal = () => {
    if (!triggerSignal || triggerSignalDelivered) return;
    triggerSignalDelivered = true;
    signalHandlers[triggerSignal]?.();
  };
  const releaseHeldDeadline = () => {
    if (!heldDeadline.callback || heldDeadline.cleared || heldDeadline.released) return;
    heldDeadline.released = true;
    heldDeadline.callback();
  };
  const fixtureSetTimeout = (callback, delay, ...args) => {
    if (triggerSignalOrder === 'before-deadline' && triggerSignal &&
      Number.isSafeInteger(childTimeoutMs) && delay === childTimeoutMs && !heldDeadline.callback) {
      heldDeadline.callback = () => callback(...args);
      return heldDeadline.handle;
    }
    return setTimeout(callback, delay, ...args);
  };
  const fixtureClearTimeout = handle => {
    if (handle === heldDeadline.handle) { heldDeadline.cleared = true; return; }
    clearTimeout(handle);
  };
  const defaultKill = (pid, sentSignal) => {
    calls.push({ kind: 'group-signal', pid, signal: sentSignal });
    if (sentSignal === 0 && !groupAlive) { const error = new Error('gone'); error.code = 'ESRCH'; throw error; }
    if (sentSignal === 'SIGKILL') { groupAlive = false; setImmediate(() => spawnedChild?.emit('exit', null, 'SIGKILL')); }
  };
  const processFixture = { env, execPath: process.execPath, platform: 'linux', getuid: () => 0, getgid: () => 0,
    kill(pid, sentSignal) {
      const result = (kill || defaultKill)(pid, sentSignal);
      if (triggerSignalOrder === 'before-deadline' && sentSignal === 'SIGTERM')
        queueMicrotask(releaseHeldDeadline);
      if (triggerSignalOrder === 'after-hard-kill' && sentSignal === 'SIGKILL') queueMicrotask(deliverTriggerSignal);
      return result;
    },
    on(name, handler) { signalHandlers[name] = handler; }, off(name) { delete signalHandlers[name]; }, exitCode: 0 };
  const moduleFixture = { exports: {} };
  const load = id => {
    if (id === 'node:fs') return { ...fs, chownSync() {} };
    if (id === 'node:child_process') return {
      spawnSync(command, args, options) {
        calls.push({ kind: 'installer', command, args, options });
        for (const [name, value] of Object.entries({
          playwright: { name: 'playwright', version: '1.63.0', dependencies: { 'playwright-core': '1.63.0' } },
          'playwright-core': { name: 'playwright-core', version: '1.63.0' }
        })) { const dir = path.join(options.cwd, 'node_modules', name); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(value)); }
        return { status: 0 };
      },
      spawn(command, args, options) {
        calls.push({ kind: 'proof-child', command, args, options });
        const child = new EventEmitter(); child.kill = () => {}; child.pid = childPid;
        spawnedChild = child;
        if (triggerSignal) {
          if (triggerSignalOrder === 'before-deadline') queueMicrotask(deliverTriggerSignal);
          if (Number.isSafeInteger(leaderExitAfterMs)) setTimeout(() => child.emit('exit', exitCode, signal), leaderExitAfterMs);
        }
        else setImmediate(() => child.emit('exit', exitCode, signal));
        return child;
      }
    };
    if (id === 'node:sqlite') return {};
    return require(id);
  };
  vm.runInNewContext(source, { require: load, module: moduleFixture, exports: moduleFixture.exports,
    process: processFixture, Buffer, URL, Uint8Array, AbortController,
    setTimeout: fixtureSetTimeout, clearTimeout: fixtureClearTimeout,
    console: { log: line => logs.push(line) } }, { filename: launcherPath });
  let runError;
  try { await moduleFixture.exports.run(bundle.payload, bundle.bundleHash, { fetchImpl: async url => {
    const response = new Response(JSON.stringify({ candidateSha: proof.WFM_EXPECTED_CANDIDATE_SHA,
      sourceBinding: 'build-file-matched', fixtureOnly: true, productionApproved: false, pilotReady: false }),
    { headers: { 'content-type': 'application/json' } });
    Object.defineProperty(response, 'url', { value: url }); return response;
  }, cleanupGraceMs, childTimeoutMs }); } catch (error) { runError = error; }
  assert.equal(calls.filter(c => c.kind === 'installer').length, 1);
  assert.equal(calls.filter(c => c.kind === 'proof-child').length, 1);
  const installer = calls.find(c => c.kind === 'installer'), child = calls.find(c => c.kind === 'proof-child');
  if (expectedError) {
    assert.match(runError?.message || '', expectedError);
    const preserved = { root: fs.existsSync(installer.options.cwd), work: fs.existsSync(child.options.cwd) };
    moduleFixture.exports.restoreProofFilesystem(installer.options.cwd);
    fs.rmSync(installer.options.cwd, { recursive: true, force: true });
    fs.rmSync(child.options.cwd, { recursive: true, force: true });
    return { installer, child, calls, logs, exitCode: processFixture.exitCode, preserved };
  }
  if (runError) throw runError;
  assert.equal(fs.existsSync(child.options.cwd), false, 'Disposable source/package directory must be removed');
  return { installer, child, calls, logs, exitCode: processFixture.exitCode };
}

test('installer excludes proof and unrelated authority while preserving transport', async () => {
  const { installer } = await observeRun();
  for (const [key, value] of Object.entries(transport)) assert.equal(installer.options.env[key], value, key);
  for (const key of [...Object.keys(proof), ...Object.keys(forbidden)]) assert.equal(installer.options.env[key], undefined, key + ' must not reach npm');
});
test('proof child retains explicit signed source, role, run, asset and transport bindings', async () => {
  const { child, logs } = await observeRun();
  for (const [key, value] of Object.entries({ ...transport, ...proof })) {
    const expected = key === 'PROOF_PRIVATE_KEY_B64' ? undefined : ['HOME','TMPDIR'].includes(key) ? child.options.cwd : value;
    assert.equal(child.options.env[key], expected, key);
  }
  assert.equal(child.options.env.TMP, child.options.cwd); assert.equal(child.options.env.TEMP, child.options.cwd);
  assert.match(child.options.env.VECTOR_PROOF_SIGNER_PORT, /^\d+$/);
  assert.match(child.options.env.VECTOR_PROOF_SIGNER_TOKEN, /^[A-Za-z0-9_-]{40,120}$/);
  assert.match(child.options.env.VECTOR_PROOF_SIGNER_EXPIRES_AT, /^\d+$/);
  assert.equal(child.options.uid, 65534); assert.equal(child.options.gid, 65534);
  assert.equal(child.options.detached, true, 'proof child must lead a separately killable process group');
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
  const expected = Object.keys({ ...transport, ...proof }).filter(key => key !== 'PROOF_PRIVATE_KEY_B64')
    .concat(['TMP','TEMP','VECTOR_PROOF_SIGNER_PORT','VECTOR_PROOF_SIGNER_TOKEN','VECTOR_PROOF_SIGNER_EXPIRES_AT']).sort();
  assert.deepEqual(JSON.parse(actual.stdout), expected);
});
for (const [code, signal, expected] of [[7, null, 7], [null, 'SIGTERM', 143], [null, 'SIGINT', 130]])
  test('child exit propagates: ' + (signal || code), async () => {
    const result = await observeRun({ exitCode: code, signal });
    assert.equal(result.exitCode, expected);
  });

test('TERM starts bounded escalation without waiting for the direct child to exit', async () => {
  const result = await observeRun({ childPid: 4242, triggerSignal: 'SIGTERM', cleanupGraceMs: 1 });
  assert.equal(result.exitCode, 137);
  assert.ok(result.calls.some(call => call.kind === 'group-signal' && call.signal === 'SIGTERM'));
  assert.ok(result.calls.some(call => call.kind === 'group-signal' && call.signal === 'SIGKILL'));
});
test('hard deadline immediately escalates an already pending graceful shutdown', async () => {
  const result = await observeRun({ childPid: 4292, triggerSignal: 'SIGTERM', cleanupGraceMs: 100, childTimeoutMs: 5 });
  const signals = result.calls.filter(call => call.kind === 'group-signal').map(call => call.signal);
  assert.deepEqual(signals.slice(0, 3), ['SIGTERM', 0, 'SIGKILL']);
  assert.equal(result.exitCode, 124);
});

test('hard deadline remains armed while descendants survive direct leader exit', async () => {
  const result = await observeRun({ childPid: 4302, exitCode: 0, cleanupGraceMs: 100, childTimeoutMs: 5 });
  const signals = result.calls.filter(call => call.kind === 'group-signal').map(call => call.signal);
  assert.deepEqual(signals.slice(0, 3), ['SIGTERM', 0, 'SIGKILL']);
  assert.equal(result.exitCode, 124);
});

test('deadline signal failure after leader exit preserves source and work files', async () => {
  let groupAlive = true;
  const result = await observeRun({ childPid: 4307, exitCode: 0, cleanupGraceMs: 100, childTimeoutMs: 5,
    kill(pid, signal) {
      if (signal === 'SIGTERM') setTimeout(() => { groupAlive = false; }, 20);
      if (signal === 'SIGKILL') { const error = new Error('deadline group signal denied'); error.code = 'EACCES'; throw error; }
      if (signal === 0 && !groupAlive) { const error = new Error('gone'); error.code = 'ESRCH'; throw error; }
    },
    expectedError: /deadline group signal denied/ });
  assert.deepEqual(result.preserved, { root: true, work: true });
});

test('graceful escalation failure remains observed after hard cleanup starts first', async () => {
  let groupAlive = true, killCount = 0; const signals = [];
  const result = await observeRun({ childPid: 4309, triggerSignal: 'SIGTERM', leaderExitAfterMs: 10,
    cleanupGraceMs: 100, childTimeoutMs: 5,
    kill(pid, signal) {
      signals.push(signal);
      if (signal === 'SIGKILL' && ++killCount === 2) {
        groupAlive = false;
        const error = new Error('graceful escalation denied'); error.code = 'EACCES'; throw error;
      }
      if (signal === 0 && !groupAlive) { const error = new Error('gone'); error.code = 'ESRCH'; throw error; }
    },
    expectedError: /graceful escalation denied/ });
  assert.deepEqual(signals.filter(signal => signal !== 0).slice(0, 3),
    ['SIGTERM', 'SIGKILL', 'SIGKILL']);
  assert.deepEqual(result.preserved, { root: true, work: true });
});

test('deadline-first late TERM coalesces into hard cleanup and preserves quarantined files', async () => {
  const signals = [];
  const result = await observeRun({ childPid: 4310, triggerSignal: 'SIGTERM',
    triggerSignalOrder: 'after-hard-kill', cleanupGraceMs: 1, childTimeoutMs: 1,
    kill(pid, signal) { signals.push(signal); },
    expectedError: /PROOF_CHILD_CLEANUP_FAILED/ });
  assert.equal(signals.filter(signal => signal === 'SIGKILL').length, 1);
  assert.equal(signals[0], 'SIGKILL');
  assert.deepEqual(result.preserved, { root: true, work: true });
});

test('group-signal failure terminates run and preserves source and work files', async () => {
  const result = await observeRun({ childPid: 4312, triggerSignal: 'SIGTERM', cleanupGraceMs: 100,
    kill() { const error = new Error('group signal denied'); error.code = 'EACCES'; throw error; },
    expectedError: /group signal denied/ });
  assert.deepEqual(result.preserved, { root: true, work: true });
});

test('failed group-disappearance verification preserves source and work files', async () => {
  const result = await observeRun({ childPid: 4343, cleanupGraceMs: 1,
    kill() {}, expectedError: /PROOF_CHILD_CLEANUP_FAILED/ });
  assert.deepEqual(result.preserved, { root: true, work: true });
});

