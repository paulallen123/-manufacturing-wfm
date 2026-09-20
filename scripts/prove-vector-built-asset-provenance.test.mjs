import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { proveVectorBuiltAssetProvenance } from './prove-vector-built-asset-provenance.mjs';

const marker = 'VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1';

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-vector-provenance-'));
  const repoRoot = path.join(root, 'repo');
  const publicRoot = path.join(root, 'public');
  const baseCssPath = path.join(root, 'sealed-base.css');

  write(repoRoot, 'learning/ui/adaptive-coach.css', 'ADAPT-CSS\n');
  write(repoRoot, 'implementation/ui/implementation-journey.css', 'IMPL-CSS\n');
  write(repoRoot, 'ux-overlay/vector-shell.css', 'VECTOR-CSS\n');
  write(repoRoot, 'learning/ui/adaptive-coach.js', 'ADAPT-JS();\n');
  write(repoRoot, 'implementation/ui/implementation-journey.js', 'IMPL-JS();\n');
  write(repoRoot, 'ux-overlay/vector-shell.js', 'VECTOR-JS();\n');
  fs.mkdirSync(publicRoot, { recursive: true });
  fs.writeFileSync(baseCssPath, 'BASE-CSS\n');

  const expectedCss = `/* ${marker} */\nBASE-CSS\n\n/* WFM_ADAPTIVE_COACH_BEGIN */\nADAPT-CSS\n\n/* WFM_IMPLEMENTATION_JOURNEY_VERSION_D_BEGIN */\nIMPL-CSS\n\n/* ${marker} */\nVECTOR-CSS\n`;
  const expectedJs = `'use strict';\n/* ${marker} */\n\n;/* WFM_ADAPTIVE_COACH_BEGIN */\nADAPT-JS();\n\n;/* WFM_IMPLEMENTATION_JOURNEY_VERSION_D_BEGIN */\nIMPL-JS();\n\n;/* ${marker} */\nVECTOR-JS();\n`;

  fs.writeFileSync(path.join(publicRoot, 'vector-ui.css'), expectedCss);
  fs.writeFileSync(path.join(publicRoot, 'vector-ui.js'), expectedJs);
  return { root, repoRoot, publicRoot, baseCssPath };
}

test('accepts only the deterministic Vector assets composed from the admitted source inputs', () => {
  const f = fixture();
  try {
    const proof = proveVectorBuiltAssetProvenance(f);
    assert.match(proof.jsSha256, /^[a-f0-9]{64}$/);
    assert.match(proof.cssSha256, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('rejects marker-spoofed arbitrary JavaScript even when the approval marker is present', () => {
  const f = fixture();
  try {
    fs.writeFileSync(
      path.join(f.publicRoot, 'vector-ui.js'),
      `/* ${marker} */\nwindow.__ARBITRARY_UNAPPROVED_PRESENTATION__ = true;\n`
    );
    assert.throws(
      () => proveVectorBuiltAssetProvenance(f),
      /VECTOR_BUILT_ASSET_PROVENANCE_MISMATCH:vector-ui\.js/
    );
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
