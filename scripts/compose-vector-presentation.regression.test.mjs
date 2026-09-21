import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const composer = path.join(here, 'compose-vector-presentation.mjs');
const retired = [
  'factory-control-ui.js',
  'factory-control-ui.css',
  'value-cockpit-ui.js',
  'value-cockpit-ui.css',
  'review-ui.js',
  'review-ui.css',
  'ui-evolution.css',
  'vector-shell.js'
];
const marker = 'VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1';

function fixture({ validMarkers = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-vector-compose-'));
  fs.writeFileSync(
    path.join(root, 'index.html'),
    '<html><head><link rel="stylesheet" href="/factory-control-ui.css"></head><body><script src="/factory-control-ui.js"></script><script src="/review-ui.js"></script></body></html>',
    'utf8'
  );
  fs.writeFileSync(path.join(root, 'vector-ui.js'), validMarkers ? `/* ${marker} */\n` : '/* invalid */\n', 'utf8');
  fs.writeFileSync(path.join(root, 'vector-ui.css'), `/* ${marker} */\n`, 'utf8');
  for (const name of retired) fs.writeFileSync(path.join(root, name), 'legacy\n', 'utf8');
  return root;
}

function run(root) {
  return spawnSync(process.execPath, [composer, root], { encoding: 'utf8' });
}

test('canonical Vector composition removes every retired presentation entrypoint including factory-control-ui.js', () => {
  const root = fixture();
  try {
    const result = run(root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /VECTOR_RETIRED_ENTRYPOINT_PURGE=PASS/);
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.match(html, /\/vector-ui\.js/);
    assert.match(html, /\/vector-ui\.css/);
    for (const name of retired) {
      assert.equal(html.includes(name), false, `${name} remains referenced`);
      assert.equal(fs.existsSync(path.join(root, name)), false, `${name} remains addressable`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('composition fails closed when a canonical Vector marker is absent', () => {
  const root = fixture({ validMarkers: false });
  try {
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /VECTOR_CANONICAL_MARKER_MISSING:vector-ui\.js/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

