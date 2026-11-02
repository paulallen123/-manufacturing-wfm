'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const launcher = require('./launcher.cjs');
const bundle = JSON.parse(fs.readFileSync(path.join(__dirname, 'generated/bundle.json')));
const unpack = () => JSON.parse(zlib.gunzipSync(Buffer.from(bundle.payload, 'base64')));
const pack = value => { const bytes = zlib.gzipSync(Buffer.from(JSON.stringify(value))); return [bytes.toString('base64'), launcher.hash(bytes)]; };
function env() {
  return {
    RAILWAY_SERVICE_ID: 'f84fe27d-af17-451c-b164-54dfef6b6a4b',
    RAILWAY_ENVIRONMENT_ID: 'eed9f097-610a-416e-83b9-6bc7bdb3eeef',
    VECTOR_PROOF_URL: 'https://vector-hardening-proof-production.up.railway.app/',
    WFM_EXPECTED_CANDIDATE_SHA: 'a'.repeat(40), VECTOR_PROOF_AUTH_PROFILE: 'signed',
    WFM_REQUIRE_VECTOR_ASSET_DIGESTS: 'true', WFM_REQUIRE_ACTION_AFFORDANCE_COVERAGE: 'true',
    VECTOR_PROOF_ACTORS_JSON: 'SYNTHETIC_TEST_ONLY', PROOF_PRIVATE_KEY_B64: 'SYNTHETIC_SECRET_NOT_TO_LOG',
    EXPECTED_DEPLOYMENT_ID: 'test-only', EXPECTED_IMPLEMENTATION_TENANT: 'test-only',
    EXPECTED_IMPLEMENTATION_RUN_ID: 'test-only', EXPECTED_CONFIGURATION_DIGEST: 'test-only',
    VECTOR_CANONICAL_JS_SHA256: 'test-only', VECTOR_CANONICAL_CSS_SHA256: 'test-only', VECTOR_WORKFLOW_JS_SHA256: 'test-only'
  };
}
test('materializes exact six files in private isolated layout and loads real serializer', t => {
  const root = launcher.materialize(bundle.payload, bundle.bundleHash);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(fs.statSync(root).mode & 0o777, 0o700);
  for (const [file, digest] of Object.entries(launcher.FILES)) {
    const target = path.join(root, file);
    assert.equal(launcher.hash(fs.readFileSync(target)), digest);
    assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  }
  const actual = createRequire(path.join(root, 'scripts/current-candidate-role-browser-proof.mjs'))('../security/runtime/proof-runner-auth.cjs');
  assert.equal(typeof actual.canonicalAssertion, 'function');
});
test('separate materializations cannot overwrite one another', t => {
  const a = launcher.materialize(bundle.payload, bundle.bundleHash), b = launcher.materialize(bundle.payload, bundle.bundleHash);
  t.after(() => [a,b].forEach(root => fs.rmSync(root, {recursive:true,force:true})));
  assert.notEqual(a,b);
});
test('rejects changed compressed bytes and noncanonical base64', () => {
  const bytes = Buffer.from(bundle.payload, 'base64'); bytes[20] ^= 1;
  assert.throws(() => launcher.validateBundle(bytes.toString('base64'), bundle.bundleHash), /BUNDLE_HASH_MISMATCH/);
  assert.throws(() => launcher.validateBundle(bundle.payload + '\n', bundle.bundleHash), /INVALID_BASE64/);
});
test('rejects altered source bytes even with recomputed outer bundle hash', () => {
  const value = unpack(); value.files[0].base64 = Buffer.from('console.log("forged")').toString('base64');
  assert.throws(() => launcher.validateBundle(...pack(value)), /SOURCE_FILE_HASH_MISMATCH/);
});
for (const name of ['../escape.cjs', '/tmp/escape.cjs', '__proto__']) test('rejects unapproved path ' + name, () => {
  const value = unpack(); value.files[0].path = name;
  assert.throws(() => launcher.validateBundle(...pack(value)), /BUNDLE_FILE_SET_MISMATCH/);
});
test('rejects missing, extra and duplicate files', () => {
  for (const mutate of [v => v.files.pop(), v => v.files.push(v.files[3]), v => v.files[0] = v.files[3]]) {
    const value = unpack(); mutate(value);
    assert.throws(() => launcher.validateBundle(...pack(value)), /BUNDLE_FILE_SET_MISMATCH/);
  }
});
test('rejects different source and decompression bombs', () => {
  const value = unpack(); value.source = '0'.repeat(40);
  assert.throws(() => launcher.validateBundle(...pack(value)), /BUNDLE_SOURCE_MISMATCH/);
  assert.throws(() => launcher.validateBundle(...pack('x'.repeat(200001))));
});
test('environment requirements are exact; no presence check is treated as proof', () => {
  assert.equal(launcher.validateEnvironment(env()), undefined);
  assert.equal(launcher.validateEnvironment({...env(),WFM_EXPECTED_CANDIDATE_SHA:'a'.repeat(40)}), undefined);
  for(const value of ['abc','A'.repeat(40),'f'.repeat(39),'f'.repeat(41),'f'.repeat(40)+'\n'])assert.throws(()=>launcher.validateEnvironment({...env(),WFM_EXPECTED_CANDIDATE_SHA:value}),/INVALID_EXPECTED_TARGET_SOURCE/);
  for (const key of Object.keys(env())) {
    const missing = env(); delete missing[key]; assert.throws(() => launcher.validateEnvironment(missing));
  }
  for (const [key, value] of [
    ['VECTOR_PROOF_AUTH_PROFILE','fixture-password'], ['VECTOR_PROOF_URL','https://vector-customer-ready-candidate-production.up.railway.app/'],
    ['RAILWAY_SERVICE_ID','different-runner'], ['WFM_EXPECTED_CANDIDATE_SHA','0'.repeat(40)],
    ['WFM_REQUIRE_ACTION_AFFORDANCE_COVERAGE','false'], ['WFM_REQUIRE_VECTOR_ASSET_DIGESTS','false']
  ]) assert.throws(() => launcher.validateEnvironment({...env(),[key]:value}));
});
test('generated shell command fails closed before installing when bindings are missing', () => {
  const command = fs.readFileSync(path.join(__dirname,'generated/start-command.txt'),'utf8');
  const result = spawnSync('/bin/sh',['-c',command],{encoding:'utf8',env:{PATH:path.dirname(process.execPath)}});
  assert.equal(result.status,1); assert.match(result.stderr,/WRONG_EXISTING_RUNNER/);
  assert.ok(Buffer.byteLength(command) < 90000);
});
test('install failure propagates, cleans materialized files and never logs private values', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'runner-install-failure-')); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const bin=path.join(root,'bin'),tmp=path.join(root,'tmp');fs.mkdirSync(bin);fs.mkdirSync(tmp);
  fs.symlinkSync(process.execPath,path.join(bin,'node'));
  const captured=path.join(root,'installer-environment.json');
  fs.writeFileSync(path.join(bin,'npm'),'#!'+process.execPath+'\nrequire("node:fs").writeFileSync('+JSON.stringify(captured)+',JSON.stringify(process.env));process.exit(7);\n',{mode:0o700});
  const preflight=path.join(root,'preflight-fixture.cjs');
  fs.writeFileSync(preflight,`global.fetch=async url=>{const response=new Response(JSON.stringify({candidateSha:process.env.WFM_EXPECTED_CANDIDATE_SHA,sourceBinding:'build-file-matched',fixtureOnly:true,productionApproved:false,pilotReady:false}),{headers:{'content-type':'application/json'}});Object.defineProperty(response,'url',{value:url});return response;};`);
  const { command } = require('./published-source.test-fixture.cjs')();
  const result=spawnSync('/bin/sh',['-c',command],{encoding:'utf8',env:{...env(),PATH:bin,TMPDIR:tmp,NODE_OPTIONS:'--require '+preflight,SSL_CERT_FILE:'/trusted/ca.pem',HTTPS_PROXY:'http://trusted-proxy.invalid',PROVIDER_API_TOKEN:'PROVIDER_SECRET_SENTINEL'}});
  assert.equal(result.status,1);assert.match(result.stderr,/PLAYWRIGHT_INSTALL_FAILED/);
  assert.ok(!result.stderr.includes(env().PROOF_PRIVATE_KEY_B64));assert.ok(!result.stdout.includes(env().PROOF_PRIVATE_KEY_B64));
  assert.deepEqual(fs.readdirSync(tmp),[]);
  const installed=JSON.parse(fs.readFileSync(captured));
  assert.equal(installed.SSL_CERT_FILE,'/trusted/ca.pem');assert.equal(installed.HTTPS_PROXY,'http://trusted-proxy.invalid');
  assert.equal(installed.PATH,bin);assert.equal(installed.TMPDIR,tmp);
  for(const key of [...Object.keys(env()),'PROVIDER_API_TOKEN','NODE_OPTIONS'])assert.equal(installed[key],undefined,key+' must not reach npm');
  assert.doesNotMatch(JSON.stringify(installed),/SYNTHETIC_SECRET_NOT_TO_LOG|PROVIDER_SECRET_SENTINEL/);
});
