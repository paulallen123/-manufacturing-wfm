import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// An alternate checkout makes the process negative reproducible against the prior source.
const target = process.env.BROWSER_ENV_TARGET || path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const sourcePath = path.join(target, 'scripts/current-candidate-role-browser-proof.mjs');
const source = fs.readFileSync(sourcePath, 'utf8');
const allowed = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'];
const forbidden = ['PROOF_PRIVATE_KEY_B64', 'WFM_STAGING_PASSWORD', 'VECTOR_PROOF_AUTH_PROFILE',
  'VECTOR_PROOF_ACTORS_JSON', 'VECTOR_PROOF_URL', 'WFM_EXPECTED_CANDIDATE_SHA', 'EXPECTED_DEPLOYMENT_ID',
  'EXPECTED_IMPLEMENTATION_TENANT', 'EXPECTED_IMPLEMENTATION_RUN_ID', 'EXPECTED_CONFIGURATION_DIGEST',
  'WFM_REQUIRE_VECTOR_ASSET_DIGESTS', 'WFM_REQUIRE_ACTION_AFFORDANCE_COVERAGE',
  'VECTOR_CANONICAL_JS_SHA256', 'VECTOR_CANONICAL_CSS_SHA256', 'VECTOR_WORKFLOW_JS_SHA256',
  'NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS', 'NODE_USE_ENV_PROXY', 'LD_PRELOAD', 'LD_LIBRARY_PATH',
  'PLAYWRIGHT_BROWSERS_PATH', 'PORT', 'RAILWAY_SERVICE_ID', 'PROVIDER_API_TOKEN', 'IMPLEMENTATION_WORKER_TOKEN'];

function factory() {
  const end = source.indexOf('// VECTOR_PROOF_CLIENT_RUNNER_START');
  assert.ok(end > 0);
  const prefix = source.slice(0, end).replace(/^import .*?;\r?\n/gm, '').replaceAll('export function ', 'function ');
  return vm.runInNewContext(prefix + '\n;browserProcessEnvironment;', { process: { env: {} } });
}

test('browser projection retains exact operational inputs and rejects every other name', () => {
  const project = factory(), env = {};
  for (const key of allowed) env[key] = 'allowed-' + key;
  for (const key of [...forbidden, 'proof_private_key_b64', 'PROOF_PRIVATE_KEY_B64 ', 'UNKNOWN_FUTURE_CREDENTIAL']) env[key] = 'FICTIONAL_FORBIDDEN_' + key;
  for (let i = 0; i < 1000; i++) env['UNKNOWN_' + i] = 'FICTIONAL_UNKNOWN_' + i;
  const result = project(env);
  assert.deepEqual(Object.keys(result).sort(), [...allowed].sort());
  for (const key of allowed) assert.equal(result[key], env[key]);
  assert.ok(Object.isFrozen(result));
  assert.doesNotMatch(JSON.stringify(result), /FICTIONAL_/);
  assert.equal(env.PROOF_PRIVATE_KEY_B64, 'FICTIONAL_FORBIDDEN_PROOF_PRIVATE_KEY_B64');
});

test('browser projection snapshots strings without enumerating unknown authority', () => {
  const project = factory(), env = { PATH: '/fixture/bin', HOME: null, TMPDIR: 42, LANG: 'en_GB.UTF-8' };
  const result = project(new Proxy(env, { ownKeys() { throw Error('must not enumerate authority'); } }));
  assert.deepEqual(Object.keys(result).sort(), ['LANG', 'PATH']);
  env.PATH = '/changed';
  assert.equal(result.PATH, '/fixture/bin');
  assert.throws(() => { result.PATH = '/mutation'; }, TypeError);
});

function processProbe(t, mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-env-negative-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const file of ['scripts/current-candidate-role-browser-proof.mjs', 'security/runtime/proof-runner-auth.cjs']) {
    const dest = path.join(dir, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(path.join(target, file), dest);
  }
  const receipt = path.join(dir, 'receipt.json'), probe = path.join(dir, 'browser-process.cjs');
  fs.writeFileSync(probe, `const allowed=${JSON.stringify(allowed)},forbidden=${JSON.stringify(forbidden)};process.stdout.write(JSON.stringify({keys:Object.keys(process.env).sort(),allowed:Object.fromEntries(allowed.filter(k=>Object.hasOwn(process.env,k)).map(k=>[k,process.env[k]])),forbidden:forbidden.filter(k=>Object.hasOwn(process.env,k)),fictionalUnknownPresent:Object.entries(process.env).some(([k,v])=>k.startsWith('UNKNOWN_')||v.startsWith('FICTIONAL_FORBIDDEN'))}));`);
  const moduleDir = path.join(dir, 'node_modules/playwright'); fs.mkdirSync(moduleDir, { recursive: true });
  fs.writeFileSync(path.join(moduleDir, 'package.json'), JSON.stringify({ type: 'module', exports: './index.mjs' }));
  // Stable Playwright launch seam: absent env inherits the proof process; explicit env replaces it.
  // The final inspection happens inside a real local OS child, not in the mock object.
  fs.writeFileSync(path.join(moduleDir, 'index.mjs'), `import fs from 'node:fs';import {spawnSync} from 'node:child_process';export const chromium={async launch(options){const r=spawnSync(process.execPath,[${JSON.stringify(probe)}],{encoding:'utf8',env:options.env??process.env});if(r.status!==0)throw Error('PROBE_CHILD_FAILED');fs.writeFileSync(${JSON.stringify(receipt)},JSON.stringify({headless:options.headless,explicitEnv:options.env!==undefined,process:JSON.parse(r.stdout)}));throw Error('PROCESS_PROBE_COMPLETE');}};`);
  const bootstrap = path.join(dir, 'bootstrap.mjs');
  fs.writeFileSync(bootstrap, `globalThis.fetch=async()=>({status:200,json:async()=>({fixtureOnly:true,productionApproved:false})});await import('./scripts/current-candidate-role-browser-proof.mjs').then(()=>{process.exitCode=2;},e=>{if(e.message!=='PROCESS_PROBE_COMPLETE'){console.error('UNEXPECTED_PROBE_FAILURE');process.exitCode=3;}});`);
  const env = Object.fromEntries(allowed.map(key => [key, 'allowed-' + key]));
  // Operational values are inert and no external URL is fetched by this harness.
  Object.assign(env, { PATH: path.dirname(process.execPath), HOME: dir, TMPDIR: dir, LANG: 'C',
    VECTOR_PROOF_AUTH_PROFILE: mode, VECTOR_PROOF_URL: mode === 'signed' ? 'https://proof.fixture.invalid' : 'http://127.0.0.1:3000',
    WFM_EXPECTED_CANDIDATE_SHA: 'a'.repeat(40), EXPECTED_DEPLOYMENT_ID: 'fixture-deployment',
    EXPECTED_IMPLEMENTATION_TENANT: 'fixture-tenant', EXPECTED_IMPLEMENTATION_RUN_ID: 'fixture-run',
    EXPECTED_CONFIGURATION_DIGEST: 'b'.repeat(64), WFM_STAGING_PASSWORD: 'FICTIONAL_FORBIDDEN_password_at_least20',
    NODE_OPTIONS: '--no-warnings', NODE_PATH: '/fixture/node-path', PLAYWRIGHT_BROWSERS_PATH: '/fixture/browser-path',
    PROVIDER_API_TOKEN: 'FICTIONAL_FORBIDDEN_provider', IMPLEMENTATION_WORKER_TOKEN: 'FICTIONAL_FORBIDDEN_worker',
    UNKNOWN_FUTURE_CREDENTIAL: 'FICTIONAL_FORBIDDEN_unknown' });
  const descriptors = [['manager', 'manager'], ['employee', 'employee'], ['payroll', 'payroll_admin'], ['company-admin', 'director'], ['isolation-manager', 'manager']];
  env.VECTOR_PROOF_ACTORS_JSON = JSON.stringify(descriptors.map(([slug, role], i) => ({ slug, role, email: slug + '@fixture.invalid', tenant: i === 4 ? 'other-tenant' : 'fixture-tenant' })));
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  env.PROOF_PRIVATE_KEY_B64 = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
  const result = spawnSync(process.execPath, [bootstrap], { cwd: dir, env, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, 'Fictional process harness must reach launch');
  assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
  const observed = JSON.parse(fs.readFileSync(receipt));
  assert.equal(observed.headless, true);
  assert.deepEqual(observed.process.forbidden, [], 'No proof authority may cross the browser OS process boundary');
  assert.equal(observed.explicitEnv, true, 'Browser launch must provide an explicit environment');
  assert.equal(observed.process.fictionalUnknownPresent, false);
  assert.deepEqual(observed.process.keys, [...allowed].sort());
  for (const key of allowed) assert.equal(observed.process.allowed[key], env[key]);
  assert.ok(!fs.readFileSync(receipt, 'utf8').includes(env.PROOF_PRIVATE_KEY_B64));
}

test('actual signed runner excludes the ephemeral signer from a real browser-seam OS child', t => processProbe(t, 'signed'));
test('actual loopback fixture runner excludes its password and unrelated authority from the OS child', t => processProbe(t, 'fixture-password'));
