'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');

test('installed clean customer factory preserves source bytes and authority refusals', () => {
  const root = path.resolve(__dirname, '..');
  const source = 'implementation/runtime/clean-customer-state.cjs';
  const destination = 'implementation-runtime/clean-customer-state.cjs';
  const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const copies = docker.split(/\r?\n/).filter(line => line.startsWith('COPY ') && line.endsWith(' /app/implementation-runtime/'));
  assert.equal(copies.filter(line => line.split(/\s+/).slice(1, -1).includes(source)).length, 1);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-customer-packaging-'));
  try {
    const runtime = path.join(temporary, 'runtime');
    const composed = spawnSync(process.execPath, [path.join(root, 'scripts/compose-vector-local-runtime.mjs'), runtime], {
      cwd: root, env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 120000
    });
    assert.equal(composed.status, 0, composed.stderr);
    const bytes = fs.readFileSync(path.join(root, source));
    assert.deepEqual(fs.readFileSync(path.join(runtime, destination)), bytes);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const provenance = JSON.parse(fs.readFileSync(path.join(runtime, 'LOCAL_PROOF_PROVENANCE.json')));
    assert.deepEqual(provenance.sourceInputs.filter(entry => entry.path === source), [{ path: source, sha256: digest }]);
    assert.deepEqual(provenance.runtimeFiles.filter(entry => entry.path === destination), [{ path: destination, sha256: digest }]);
    const result = spawnSync(process.execPath, ['--test', 'implementation/runtime/clean-customer-state.test.cjs', 'implementation/runtime/setup-customer-state.test.cjs'], {
      cwd: root, env: { PATH: '/usr/bin:/bin', CLEAN_CUSTOMER_RUNTIME_ROOT: path.join(runtime, 'implementation-runtime') }, encoding: 'utf8', timeout: 120000
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
