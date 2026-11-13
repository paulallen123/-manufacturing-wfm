'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {execFileSync, spawnSync} = require('node:child_process');
const {runtimeStageAncestry} = require('./docker-runtime-ancestry.cjs');
const root = path.resolve(__dirname, '..');
const archive = path.join(root, 'artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz');
const hash = value => createHash('sha256').update(value).digest('hex');
function fixture(t) {
  assert.equal(hash(fs.readFileSync(archive)), '3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-compiler-composition-'));
  t.after(() => fs.rmSync(temporary, {recursive: true, force: true}));
  const runtime = path.join(temporary, 'runtime');
  fs.mkdirSync(runtime);
  execFileSync('tar', ['--no-same-owner', '-xzf', archive, '-C', runtime]);
  return {temporary, runtime};
}
function input(timezone) {
  return {sites: [{code: 'AA', name: 'Factory', timezone}], modules: ['core'],
    workforce: {count: 1, languages: ['en'], shiftPatterns: 1}, integrations: [], trainingRoles: ['employee']};
}

// Missing the early Docker COPY leaves the actual composer unable to invoke its patcher.
test('Docker extracted-runtime composition has its full compiler patch dependency available', t => {
  const {temporary, runtime} = fixture(t);
  const workspace = path.join(temporary, 'workspace');
  const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const finalStage = runtimeStageAncestry(docker);
  const beforeComposition = finalStage.slice(0, finalStage.indexOf('RUN node /workspace/scripts/compose-vector-local-runtime.mjs'));
  for (const line of beforeComposition.split('\n')) {
    if (!line.startsWith('COPY ')) continue;
    const words = line.trim().split(/\s+/).slice(1);
    const destination = words.pop();
    if (!destination.startsWith('/workspace/')) continue;
    const targetDirectory = path.join(workspace, destination.slice('/workspace/'.length));
    fs.mkdirSync(targetDirectory, {recursive: true});
    for (const source of words) {
      const target = source.endsWith('/') ? targetDirectory : path.join(targetDirectory, path.basename(source));
      fs.cpSync(path.join(root, source), target, {recursive: true});
    }
  }
  const result = spawnSync(process.execPath, [path.join(workspace, 'scripts/compose-vector-local-runtime.mjs'), runtime],
    {cwd: workspace, encoding: 'utf8', timeout: 120000});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(require(path.join(runtime, 'lib/configuration-compiler.cjs')).compile(input('America/Argentina/Buenos_Aires')).scope.sites[0].timezone,
    'America/Argentina/Buenos_Aires');
  const compilerPath = path.join(runtime, 'lib/configuration-compiler.cjs');
  const beforeGuard = hash(fs.readFileSync(compilerPath));
  // Execute the later Docker guard as well; it must preserve the admitted compiler bytes.
  execFileSync(process.execPath, [path.join(root, 'scripts/patch-workspace-compiler.mjs'), compilerPath]);
  assert.equal(hash(fs.readFileSync(compilerPath)), beforeGuard);
});

test('patched sealed compiler accepts real IANA timezones while retaining strict input validation', t => {
  const {runtime} = fixture(t);
  const compilerPath = path.join(runtime, 'lib/configuration-compiler.cjs');
  const patcher = path.join(root, 'scripts/patch-workspace-compiler.mjs');
  execFileSync(process.execPath, [patcher, compilerPath]);
  const firstBytes = fs.readFileSync(compilerPath);
  execFileSync(process.execPath, [patcher, compilerPath]);
  assert.deepEqual(fs.readFileSync(compilerPath), firstBytes);
  const compiler = require(compilerPath);
  for (const timezone of ['Europe/London', 'America/Argentina/Buenos_Aires', 'Etc/GMT+5']) {
    assert.equal(compiler.compile(input(timezone)).scope.sites[0].timezone, timezone);
  }
  for (const timezone of ['', 'Mars/Olympus_Mons', 'America/Argentina/Not_A_City']) {
    assert.throws(() => compiler.compile(input(timezone)), /requires code, name and IANA timezone/);
  }
  for (const field of ['code', 'name']) {
    const invalid = input('Europe/London');
    invalid.sites[0][field] = '';
    assert.throws(() => compiler.compile(invalid), /requires code, name and IANA timezone/);
  }
  const invalidWorkforce = input('Europe/London');
  invalidWorkforce.workforce.count = 0;
  assert.throws(() => compiler.compile(invalidWorkforce), /Workforce count must be/);
  const invalidModule = input('Europe/London');
  invalidModule.modules = ['core', 'unknown'];
  assert.throws(() => compiler.compile(invalidModule), /Unsupported implementation module/);
  assert.throws(() => compiler.compile({...input('Europe/London'), unsupported: true}), /unsupported fields/);
});
