'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const sourceRoot = path.resolve(process.env.WFM_EXACT_SOURCE_ROOT || repositoryRoot);
const archive = path.join(repositoryRoot, 'artifact', 'wfm-0.6.76-hosted-staging-rc1.tar.gz');
const composer = path.join(sourceRoot, 'scripts', 'compose-vector-local-runtime.mjs');
const patcher = path.join(sourceRoot, 'scripts', 'patch-workspace-compiler.mjs');
const marker = '// VECTOR_REAL_IANA_TIMEZONES';
const archiveSha256 = '3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function extractRuntime(target) {
  fs.mkdirSync(target, {recursive: true});
  const result = spawnSync('tar', ['--no-same-owner', '-xzf', archive, '-C', target], {
    encoding: 'utf8', timeout: 120_000
  });
  assert.equal(result.status, 0, `Sealed runtime extraction failed. Actual stderr:\n${result.stderr}`);
}

function compileTimezone(runtime, timezone) {
  const compilerPath = path.join(runtime, 'lib', 'configuration-compiler.cjs');
  delete require.cache[require.resolve(compilerPath)];
  try {
    const compiled = require(compilerPath).compile({
      sites: [{code: 'AA', name: 'Factory', timezone}],
      modules: ['core'],
      workforce: {count: 1, languages: ['en'], shiftPatterns: 1},
      integrations: [],
      trainingRoles: ['employee']
    });
    return {ok: true, status: compiled.status, timezone: compiled.scope.sites[0].timezone, error: null};
  } catch (error) {
    return {ok: false, status: null, timezone: null, error: String(error && error.message || error)};
  }
}

test('existing-output composition applies the exact fresh-output compiler patch contract', t => {
  assert.equal(sha256(fs.readFileSync(archive)), archiveSha256, 'sealed runtime archive changed');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'existing-output-compiler-'));
  const existingRuntime = path.join(temporary, 'existing-runtime');
  const freshPatchReference = path.join(temporary, 'fresh-output-patch-reference');
  t.after(() => fs.rmSync(temporary, {recursive: true, force: true}));

  extractRuntime(existingRuntime);
  extractRuntime(freshPatchReference);
  const sealedCompilerHash = sha256(fs.readFileSync(path.join(existingRuntime, 'lib', 'configuration-compiler.cjs')));
  assert.equal(
    sha256(fs.readFileSync(path.join(freshPatchReference, 'lib', 'configuration-compiler.cjs'))),
    sealedCompilerHash,
    'both paths must begin with the same unchanged sealed compiler'
  );

  // This is the exact patch command used by the fresh-output branch, not a compiler stand-in.
  const freshPatch = spawnSync(process.execPath, [
    patcher, path.join(freshPatchReference, 'lib', 'configuration-compiler.cjs')
  ], {cwd: sourceRoot, encoding: 'utf8', timeout: 120_000});
  assert.equal(freshPatch.status, 0, `Fresh-output patch stage failed. Actual stderr:\n${freshPatch.stderr}`);

  const existingCompose = spawnSync(process.execPath, [composer, existingRuntime], {
    cwd: sourceRoot,
    env: process.platform === 'win32'
      ? {PATH: process.env.SystemRoot + '\\System32', SystemRoot: process.env.SystemRoot, HOME: temporary, USERPROFILE: temporary, TEMP: temporary, TMP: temporary}
      : {PATH: '/usr/bin:/bin', HOME: temporary},
    encoding: 'utf8',
    timeout: 120_000
  });
  assert.equal(existingCompose.status, 0, `Existing-output composition failed environmentally. Actual stderr:\n${existingCompose.stderr}`);

  const existingCompiler = fs.readFileSync(path.join(existingRuntime, 'lib', 'configuration-compiler.cjs'), 'utf8');
  const freshCompiler = fs.readFileSync(path.join(freshPatchReference, 'lib', 'configuration-compiler.cjs'), 'utf8');
  const actual = {
    sealedCompilerSha256: sealedCompilerHash,
    freshOutputPatch: {
      marker: freshCompiler.includes(marker),
      compilerSha256: sha256(Buffer.from(freshCompiler)),
      compile: compileTimezone(freshPatchReference, 'America/Argentina/Buenos_Aires')
    },
    existingOutputCompose: {
      marker: existingCompiler.includes(marker),
      compilerSha256: sha256(Buffer.from(existingCompiler)),
      compile: compileTimezone(existingRuntime, 'America/Argentina/Buenos_Aires')
    }
  };
  t.diagnostic(JSON.stringify(actual, null, 2));

  assert.deepEqual({
    freshMarker: actual.freshOutputPatch.marker,
    freshCompile: actual.freshOutputPatch.compile.ok,
    freshTimezone: actual.freshOutputPatch.compile.timezone,
    existingMarker: actual.existingOutputCompose.marker,
    existingCompile: actual.existingOutputCompose.compile.ok,
    existingTimezone: actual.existingOutputCompose.compile.timezone
  }, {
    freshMarker: true,
    freshCompile: true,
    freshTimezone: 'America/Argentina/Buenos_Aires',
    existingMarker: true,
    existingCompile: true,
    existingTimezone: 'America/Argentina/Buenos_Aires'
  });
});
