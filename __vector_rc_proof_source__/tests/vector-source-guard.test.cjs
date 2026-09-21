const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-guard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of ['scripts/validate-vector-only-ui.mjs', 'ux-overlay/vector-shell.js', 'operations/runtime/workflow-action-evidence-contract.cjs']) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.copyFileSync(path.join(root, name), path.join(dir, name));
  }
  return dir;
}
function run(dir) {
  return spawnSync(process.execPath, ['scripts/validate-vector-only-ui.mjs'], { cwd: dir, encoding: 'utf8' });
}
test('archived checker dictionaries do not count as active retired presentation', t => {
  const dir = fixture(t);
  for (const snapshot of ['__security_hold_7b6f9d22e1__', '__security_hold_one_day_enterprise__']) {
    const file = path.join(dir, snapshot, 'scripts/validate-vector-only-ui.mjs');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(path.join(dir, 'scripts/validate-vector-only-ui.mjs'), file);
  }
  const result = run(dir);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
test('retired tokens in archived presentation files are still rejected', t => {
  const dir = fixture(t);
  const file = path.join(dir, '__security_hold_one_day_enterprise__/ux-overlay/bad.js');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, ['ux11', 'queue'].join('-'));
  const result = run(dir);
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /forbidden-token/);
});
test('active retired presentation is still rejected', t => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'ux-overlay/bad.js'), ['ux11', 'queue'].join('-'));
  const result = run(dir);
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /forbidden-token/);
});
