const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('deployment record remains bound to the sealed runtime and its actual proof scope', () => {
  const root = path.resolve(__dirname, '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-deployment-record-'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'DEPLOYMENT_MANIFEST.json'), 'utf8'));
  const artifact = manifest.runtime_artifact;
  const copy = file => {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
  };
  const run = value => {
    fs.writeFileSync(path.join(dir, 'DEPLOYMENT_MANIFEST.json'), JSON.stringify(value, null, 2) + '\n');
    return spawnSync(process.execPath, ['scripts/validate-deployment.mjs'], { cwd: dir, encoding: 'utf8' });
  };
  try {
    for (const file of ['Dockerfile', 'resilience/security-baseline.json', 'scripts/validate-deployment.mjs', artifact]) copy(file);
    assert.equal(run(manifest).status, 0, 'The exact sealed candidate should pass release record validation.');
    for (const [key, expected] of [
      ['runtime_manifest_sha256', 'Runtime file manifest differs'],
      ['runtime_package_manifest_sha256', 'Runtime package manifest differs'],
      ['runtime_source_content_sha256', 'differs from deployment source identity']
    ]) {
      const altered = structuredClone(manifest);
      altered[key] = '0'.repeat(64);
      const result = run(altered);
      assert.notEqual(result.status, 0, `${key} must fail closed.`);
      assert.match(result.stderr, new RegExp(expected));
    }
    for (const [key, value] of [
      ['current_full_source_regression', '1878/1878'],
      ['current_hosted_acceptance', 'PASS']
    ]) {
      const altered = structuredClone(manifest);
      altered.tests[key] = value;
      const result = run(altered);
      assert.notEqual(result.status, 0, `${key} must not claim a pass while the sealed candidate reports pending proof.`);
      assert.match(result.stderr, /must remain pending/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
