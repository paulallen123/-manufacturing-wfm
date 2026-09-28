import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const admissionScript = resolve('scripts/require-frozen-candidate.sh');

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function candidateRepository() {
  const cwd = mkdtempSync(join(tmpdir(), 'vector-freeze-admission-'));
  git(cwd, 'init', '-q');
  git(cwd, 'config', 'user.name', 'Vector Proof');
  git(cwd, 'config', 'user.email', 'vector-proof@example.invalid');
  mkdirSync(join(cwd, 'artifact'));
  writeFileSync(join(cwd, 'artifact/vector-proof-freeze.trigger'), 'freeze=1\n');
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-qm', 'initial frozen candidate');
  return cwd;
}

function admit(cwd) {
  return spawnSync('bash', [admissionScript], { cwd, encoding: 'utf8' });
}

test('an ordinary commit is NO_PROOF and cannot return a successful proof status', () => {
  const cwd = candidateRepository();
  writeFileSync(join(cwd, 'product-change.txt'), 'untested candidate change\n');
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-qm', 'ordinary candidate change');
  const head = git(cwd, 'rev-parse', 'HEAD');

  const result = admit(cwd);

  assert.equal(result.status, 78, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), {
    contract: 'VECTOR_FROZEN_CANDIDATE_ADMISSION_V1',
    sourceSha: head,
    status: 'NO_PROOF',
    reason: 'FREEZE_TRIGGER_UNCHANGED'
  });
});

test('a commit changing the canonical freeze trigger is admitted', () => {
  const cwd = candidateRepository();
  writeFileSync(join(cwd, 'artifact/vector-proof-freeze.trigger'), 'freeze=2\n');
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-qm', 'freeze exact candidate');
  const head = git(cwd, 'rev-parse', 'HEAD');

  const result = admit(cwd);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), {
    contract: 'VECTOR_FROZEN_CANDIDATE_ADMISSION_V1',
    sourceSha: head,
    status: 'ADMITTED',
    reason: 'FREEZE_TRIGGER_CHANGED'
  });
});

test('missing Git identity fails closed rather than inventing admission', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'vector-freeze-no-git-'));

  const result = admit(cwd);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'FAIL_CLOSED');
  assert.equal(receipt.sourceSha, null);
});
