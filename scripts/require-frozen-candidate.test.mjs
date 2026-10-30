import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('./require-frozen-candidate.sh', import.meta.url));
const contract = 'VECTOR_PROOF_FREEZE_V1\nsafety=no proof scope weakened; no skipped or stale result counts as PASS\n';

function fixture(t, { rootOnly = false } = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'vector-frozen-candidate-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  function git(...args) {
    const result = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@fixture.invalid', ...args], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  git('init', '--quiet');
  mkdirSync(path.join(cwd, 'artifact'));
  writeFileSync(path.join(cwd, 'artifact/vector-proof-freeze.trigger'), contract + 'candidate=initial\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'initial fixture');
  function commit(content = contract + 'candidate=reviewed\n') {
    if (content !== null) writeFileSync(path.join(cwd, 'artifact/vector-proof-freeze.trigger'), content);
    git('add', '-A');
    git('commit', '--quiet', '--allow-empty', '-m', 'candidate fixture');
    return git('rev-parse', 'HEAD');
  }
  if (!rootOnly) commit();
  function run(sourceSha = git('rev-parse', 'HEAD')) {
    return spawnSync('bash', [script], { cwd, env: { ...process.env, CIRCLE_SHA1: sourceSha }, encoding: 'utf8' });
  }
  return { cwd, git, commit, run };
}

function fails(result, reason) {
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, new RegExp('FROZEN_CANDIDATE_ADMISSION=FAIL reason=' + reason));
  assert.doesNotMatch(result.stdout, /ADMISSION=PASS/);
}

test('changed authentic trigger admits the exact committed candidate', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'FROZEN_CANDIDATE_ADMISSION=PASS sha=' + f.git('rev-parse', 'HEAD'));
});

test('existing repository freeze contract remains compatible when renewed', t => {
  const f = fixture(t);
  const existing = readFileSync(new URL('../artifact/vector-proof-freeze.trigger', import.meta.url), 'utf8');
  f.commit(existing + '\nreview_fixture=renewed_exact_candidate\n');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /FROZEN_CANDIDATE_ADMISSION=PASS sha=[0-9a-f]{40}/);
});

test('unchanged freeze trigger refuses success instead of halting a required job green', t => {
  const f = fixture(t);
  writeFileSync(path.join(f.cwd, 'product.js'), 'changed product\n');
  f.commit(null);
  fails(f.run(), 'unchanged_trigger');
});

test('deleted trigger is refused even though its path changed', t => {
  const f = fixture(t);
  rmSync(path.join(f.cwd, 'artifact/vector-proof-freeze.trigger'));
  f.commit(null);
  fails(f.run(), 'missing_or_nonregular_trigger');
});

test('symlink trigger is refused even when its target has valid marker bytes', t => {
  const f = fixture(t);
  rmSync(path.join(f.cwd, 'artifact/vector-proof-freeze.trigger'));
  writeFileSync(path.join(f.cwd, 'target'), contract);
  symlinkSync('../target', path.join(f.cwd, 'artifact/vector-proof-freeze.trigger'));
  f.commit(null);
  fails(f.run(), 'missing_or_nonregular_trigger');
});

test('arbitrary changed trigger text is not a freeze contract', t => {
  const f = fixture(t);
  f.commit('arbitrary text\n');
  fails(f.run(), 'invalid_trigger_contract');
});

test('freeze marker with weakened safety contract is refused', t => {
  const f = fixture(t);
  f.commit('VECTOR_PROOF_FREEZE_V1\nsafety=skipped counts as pass\n');
  fails(f.run(), 'missing_safety_contract');
});

test('missing comparison parent refuses admission', t => {
  fails(fixture(t, { rootOnly: true }).run(), 'missing_parent');
});

test('missing and mismatched CI source bindings refuse admission', t => {
  const f = fixture(t);
  fails(f.run(''), 'missing_or_invalid_source_sha');
  fails(f.run('0'.repeat(40)), 'source_sha_mismatch');
});

test('uncommitted trigger edits cannot supply freeze authority', t => {
  const f = fixture(t);
  writeFileSync(path.join(f.cwd, 'artifact/vector-proof-freeze.trigger'), contract + 'candidate=uncommitted\n');
  fails(f.run(), 'dirty_trigger');
});

test('both CircleCI proof jobs use the fail-closed gate and core executes its tests', () => {
  const config = readFileSync(new URL('../.circleci/config.yml', import.meta.url), 'utf8');
  assert.match(config, /command: bash scripts\/require-frozen-candidate\.sh/);
  assert.doesNotMatch(config, /circleci-agent step halt/);
  assert.equal((config.match(/^      - require_frozen_candidate$/gm) || []).length, 2);
  assert.match(config, /scripts\/require-frozen-candidate\.test\.mjs/);
});
