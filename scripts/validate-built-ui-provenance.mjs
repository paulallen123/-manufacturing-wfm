#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const options = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, args) => {
  if (index % 2 === 0) pairs.push([value, args[index + 1]]);
  return pairs;
}, []));
const actualDir = options['--public'];
const receiptPath = options['--receipt'];
const sourceSha = options['--source-sha'];
const imageId = options['--image-id'];
assert(actualDir && receiptPath && sourceSha && imageId, 'Required: --public, --receipt, --source-sha, --image-id');

const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const archive = path.join(root, 'artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'DEPLOYMENT_MANIFEST.json'), 'utf8'));
assert.equal(sha(fs.readFileSync(archive)), manifest.runtime_sha256, 'Sealed runtime archive hash mismatch');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw Error(`${command} failed: ${result.stderr || result.stdout}`);
}

function files(dir, prefix = '') {
  const result = new Map();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [key, value] of files(full, rel)) result.set(key, value);
    } else {
      assert(entry.isFile(), `Unexpected non-file in public assets: ${rel}`);
      result.set(rel, sha(fs.readFileSync(full)));
    }
  }
  return result;
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-expected-public-'));
try {
  run('tar', ['-xzf', archive, '-C', temp, 'public']);
  const expectedDir = path.join(temp, 'public');
  run(process.execPath, ['scripts/retire-legacy-presentation.mjs', expectedDir]);
  const overlayDir = path.join(root, 'ux-overlay');
  assert.deepEqual(fs.readdirSync(overlayDir).sort(), ['vector-shell.css', 'vector-shell.js']);
  fs.appendFileSync(path.join(expectedDir, 'factory-control-ui.css'), '\n/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */\n' + fs.readFileSync(path.join(overlayDir, 'vector-shell.css')));
  fs.appendFileSync(path.join(expectedDir, 'value-cockpit-ui.js'), '\n;/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */\n' + fs.readFileSync(path.join(overlayDir, 'vector-shell.js')));

  const expected = files(expectedDir);
  const actual = files(actualDir);
  const names = [...new Set([...expected.keys(), ...actual.keys()])].sort();
  const mismatches = names.filter(name => expected.get(name) !== actual.get(name));
  assert.equal(mismatches.length, 0, `Built public assets differ from validated source composition: ${mismatches.join(', ')}`);

  const publicSha256 = sha(names.map(name => `${name}\0${actual.get(name)}\n`).join(''));
  const receipt = {
    schemaVersion: 1,
    sourceSha,
    imageId,
    runtimeArchiveSha256: manifest.runtime_sha256,
    overlayJsSha256: sha(fs.readFileSync(path.join(overlayDir, 'vector-shell.js'))),
    overlayCssSha256: sha(fs.readFileSync(path.join(overlayDir, 'vector-shell.css'))),
    publicSha256,
    publicFileCount: names.length,
    result: 'PASS'
  };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  console.log(`VECTOR_BUILT_UI_PROVENANCE=PASS|files=${names.length}|sha256=${publicSha256}`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
