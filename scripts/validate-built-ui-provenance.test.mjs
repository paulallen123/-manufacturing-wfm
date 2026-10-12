import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const validator = path.join(root, 'scripts/validate-built-ui-provenance.mjs');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('accepts exact composed assets and rejects a marker-spoofed script', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-ui-provenance-'));
  try {
    const actual = path.join(temp, 'public');
    run('tar', ['-xzf', 'artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz', '-C', temp, 'public']);
    run(process.execPath, ['scripts/retire-legacy-presentation.mjs', actual]);
    fs.appendFileSync(path.join(actual, 'factory-control-ui.css'), '\n/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */\n' + fs.readFileSync(path.join(root, 'ux-overlay/vector-shell.css')));
    fs.appendFileSync(path.join(actual, 'value-cockpit-ui.js'), '\n;/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */\n' + fs.readFileSync(path.join(root, 'ux-overlay/vector-shell.js')));

    const args = [validator, '--public', actual, '--receipt', path.join(temp, 'receipt.json'), '--source-sha', 'test-sha', '--image-id', 'sha256:test-image'];
    const valid = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);
    const receipt = JSON.parse(fs.readFileSync(path.join(temp, 'receipt.json'), 'utf8'));
    assert.equal(receipt.sourceSha, 'test-sha');
    assert.equal(receipt.imageId, 'sha256:test-image');
    assert.ok(receipt.publicSha256);

    fs.appendFileSync(path.join(actual, 'value-cockpit-ui.js'), '\nwindow.__ARBITRARY_UNAPPROVED_PRESENTATION__ = true;\n');
    const spoofed = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
    assert.notEqual(spoofed.status, 0, spoofed.stdout);
    assert.match(spoofed.stderr, /value-cockpit-ui\.js/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
