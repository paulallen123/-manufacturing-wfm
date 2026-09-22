import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const marker = 'VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1';

function read(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath));
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function composeExpectedVectorAssets({ repoRoot, baseCssPath }) {
  const css = Buffer.concat([
    Buffer.from(`/* ${marker} */\n`),
    fs.readFileSync(baseCssPath),
    Buffer.from('\n/* WFM_ADAPTIVE_COACH_BEGIN */\n'),
    read(repoRoot, 'learning/ui/adaptive-coach.css'),
    Buffer.from('\n/* WFM_IMPLEMENTATION_JOURNEY_VERSION_D_BEGIN */\n'),
    read(repoRoot, 'implementation/ui/implementation-journey.css'),
    Buffer.from(`\n/* ${marker} */\n`),
    read(repoRoot, 'ux-overlay/vector-shell.css'),
    read(repoRoot, 'ux-overlay/vector-workflows.css'),
    Buffer.from('\n/* VECTOR_DEMAND_DECISION_INTELLIGENCE_BEGIN */\n'),
    read(repoRoot, 'ux-overlay/vector-demand-intelligence.css')
  ]);

  const js = Buffer.concat([
    Buffer.from(`'use strict';\n/* ${marker} */\n`),
    Buffer.from('\n;/* WFM_ADAPTIVE_COACH_BEGIN */\n'),
    read(repoRoot, 'learning/ui/adaptive-coach.js'),
    Buffer.from('\n;/* WFM_IMPLEMENTATION_JOURNEY_VERSION_D_BEGIN */\n'),
    read(repoRoot, 'implementation/ui/implementation-journey.js'),
    Buffer.from(`\n;/* ${marker} */\n`),
    read(repoRoot, 'ux-overlay/vector-shell.js'),
    Buffer.from('\n;/* VECTOR_DEMAND_DECISION_INTELLIGENCE_BEGIN */\n'),
    read(repoRoot, 'ux-overlay/vector-demand-intelligence.js')
  ]);

  return { js, css, workflows: read(repoRoot, 'ux-overlay/vector-workflows.js') };
}

export function proveVectorBuiltAssetProvenance({ repoRoot, publicRoot, baseCssPath }) {
  const expected = composeExpectedVectorAssets({ repoRoot, baseCssPath });
  const actual = {
    js: fs.readFileSync(path.join(publicRoot, 'vector-ui.js')),
    css: fs.readFileSync(path.join(publicRoot, 'vector-ui.css')),
    workflows: fs.readFileSync(path.join(publicRoot, 'vector-workflows.js'))
  };

  for (const [kind, filename] of Object.entries({js: 'vector-ui.js', css: 'vector-ui.css', workflows: 'vector-workflows.js'})) {
    if (!actual[kind].equals(expected[kind])) {
      throw new Error(
        `VECTOR_BUILT_ASSET_PROVENANCE_MISMATCH:${filename}:expected=${sha256(expected[kind])}:actual=${sha256(actual[kind])}`
      );
    }
  }

  return {
    jsSha256: sha256(actual.js),
    cssSha256: sha256(actual.css),
    workflowsSha256: sha256(actual.workflows)
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [repoRoot, publicRoot, baseCssPath] = process.argv.slice(2);
  if (!repoRoot || !publicRoot || !baseCssPath) {
    throw new Error('USAGE: prove-vector-built-asset-provenance.mjs <repo-root> <public-root> <sealed-base-css>');
  }
  const proof = proveVectorBuiltAssetProvenance({ repoRoot, publicRoot, baseCssPath });
  console.log(`VECTOR_CANONICAL_JS_SHA256=${proof.jsSha256}`);
  console.log(`VECTOR_CANONICAL_CSS_SHA256=${proof.cssSha256}`);
  console.log(`VECTOR_WORKFLOWS_JS_SHA256=${proof.workflowsSha256}`);
  console.log('VECTOR_BUILT_ASSET_PROVENANCE=PASS');
}
