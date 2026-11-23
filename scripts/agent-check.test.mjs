import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'wfm-agent-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['scripts', 'security', 'resilience', 'ux-overlay', 'legacy-redirect']) {
    mkdirSync(join(root, dir));
  }
  copyFileSync(fileURLToPath(new URL('./agent-check.mjs', import.meta.url)), join(root, 'scripts/agent-check.mjs'));
  for (const name of ['validate-deployment', 'validate-vector-only-ui', 'validate-release-policy', 'run-zero-cost-ci']) {
    writeFileSync(join(root, `scripts/${name}.mjs`), `console.log(${JSON.stringify(`RAN:${name}`)});`);
  }
  return {
    root,
    run: (...args) => spawnSync(process.execPath, [join(root, 'scripts/agent-check.mjs'), ...args], {
      cwd: tmpdir(), encoding: 'utf8', timeout: 30000
    })
  };
}

test('help succeeds without executing validators', t => {
  const result = fixture(t).run('--help');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.doesNotMatch(result.stdout, /RAN:/);
});

test('unknown or duplicate arguments fail without executing validators', t => {
  const { run } = fixture(t);
  for (const args of [['--typo'], ['--full', '--full'], ['--help', '--full']]) {
    const result = run(...args);
    assert.equal(result.status, 2);
    assert.doesNotMatch(result.stdout, /RAN:/);
  }
});

test('fast checks work from outside the root and skip the full suite', t => {
  const result = fixture(t).run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /RAN:validate-deployment/);
  assert.match(result.stdout, /RAN:validate-vector-only-ui/);
  assert.match(result.stdout, /RAN:validate-release-policy/);
  assert.doesNotMatch(result.stdout, /RAN:run-zero-cost-ci/);
  assert.match(result.stdout, /AGENT_CHECK=PASS mode=fast.*elapsedSeconds=/);
});

test('full mode executes the existing suite', t => {
  const result = fixture(t).run('--full');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /RAN:run-zero-cost-ci/);
  assert.match(result.stdout, /AGENT_CHECK=PASS mode=full/);
});

test('syntax errors fail before validators run', t => {
  const { root, run } = fixture(t);
  writeFileSync(join(root, 'ux-overlay/broken.js'), 'const = ;');
  const result = run('--full');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /FAIL syntax/);
  assert.doesNotMatch(result.stdout, /RAN:|AGENT_CHECK=PASS/);
});

test('validator failure propagates its exit code and stops subsequent checks', t => {
  const { root, run } = fixture(t);
  writeFileSync(join(root, 'scripts/validate-deployment.mjs'), 'process.exit(7);');
  const result = run('--full');
  assert.equal(result.status, 7);
  assert.match(result.stderr, /FAIL validate-deployment/);
  assert.doesNotMatch(result.stdout, /RAN:|AGENT_CHECK=PASS/);
});
