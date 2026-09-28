'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const root = path.resolve(__dirname, '..');
const bootstrap = fs.readFileSync(path.join(root, 'security/runtime/bootstrap.cjs'), 'utf8');
const relativeRequires = Array.from(bootstrap.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g), m => m[1]);
test('the final Docker stage includes every relative bootstrap dependency', () => {
  const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const finalStage = docker.slice(docker.lastIndexOf('\nFROM '));
  for (const file of relativeRequires) {
    assert.ok(finalStage.includes(`COPY security/runtime/${file} /app/security-runtime/${file}`), `required runtime module omitted from image: ${file}`);
  }
});
test('local proof assembly includes the same required bootstrap dependencies', () => {
  const composer = fs.readFileSync(path.join(root, 'scripts/compose-vector-local-runtime.mjs'), 'utf8');
  const group = composer.match(/security:\s*\[([^\]]+)\]/)?.[1] || '';
  for (const file of relativeRequires) assert.ok(group.includes(`'${file}'`), `local proof omitted required module: ${file}`);
});

test('local proof assembly includes absolute bootstrap runtime dependencies and training closure', () => {
  const composer = fs.readFileSync(path.join(root, 'scripts/compose-vector-local-runtime.mjs'), 'utf8');
  const absoluteRequires = Array.from(bootstrap.matchAll(/require\(['"]\/app\/([^'"]+)['"]\)/g), m => m[1]);
  const runtimeGroups = {
    'integration-runtime': 'integration',
    'implementation-runtime': 'implementation',
    'learning-runtime': 'learning',
    'operations-runtime': 'operations',
    'reporting-runtime': 'reporting',
    'trust-runtime': 'trust'
  };
  for (const required of absoluteRequires) {
    if (required === 'server.cjs') {
      assert.match(composer, /artifact\/wfm-0\.6\.76-hosted-staging-rc1\.tar\.gz/, 'base server must remain sourced from the pinned sealed runtime artifact');
      continue;
    }
    const [runtimeGroup, ...rest] = required.split('/');
    const sourceGroup = runtimeGroups[runtimeGroup];
    assert.ok(sourceGroup, `unmapped bootstrap runtime group: ${runtimeGroup}`);
    const file = rest.join('/');
    if (runtimeGroup === 'operations-runtime' && file === 'workforce-lifecycle-guard.cjs') {
      assert.match(composer, /workforce-lifecycle-router\.cjs'\s*,\s*'operations-runtime\/workforce-lifecycle-guard\.cjs'/);
      continue;
    }
    const group = composer.match(new RegExp(sourceGroup + ':\\s*\\[([\\s\\S]*?)\\n\\s*\\]'))?.[1]
      || composer.match(new RegExp(sourceGroup + ':\\s*\\[([^\\]]+)\\]'))?.[1]
      || '';
    assert.ok(group.includes(`'${file}'`), `local proof omitted absolute bootstrap dependency: ${required}`);
  }

  const training = fs.readFileSync(path.join(root, 'learning/runtime/training-delivery-service.cjs'), 'utf8');
  const trainingRelatives = Array.from(training.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g), m => m[1]);
  const learningGroup = composer.match(/learning:\s*\[([\s\S]*?)\n\s*\]/)?.[1] || '';
  for (const file of trainingRelatives) {
    assert.ok(learningGroup.includes(`'${file}'`), `local proof omitted training dependency: ${file}`);
  }
});
test('local proof assembly includes scheduling runtime dependency closure', () => {
  const composer = fs.readFileSync(path.join(root, 'scripts/compose-vector-local-runtime.mjs'), 'utf8');
  const scheduling = fs.readFileSync(path.join(root, 'operations/runtime/scheduling-intelligence-service.cjs'), 'utf8');
  const relatives = Array.from(scheduling.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g), m => m[1]);
  const operationsGroup = composer.match(/operations:\s*\[([\s\S]*?)\n\s*\]/)?.[1] || '';
  assert.ok(operationsGroup.includes("'scheduling-intelligence-service.cjs'"), 'local proof omitted scheduling service');
  for (const file of relatives) {
    assert.ok(operationsGroup.includes(`'${file}'`), `local proof omitted scheduling dependency: ${file}`);
  }
});

test('retired presentation serves 410 for direct and encoded paths, and never intercepts the real API', async t => {
  const { serveRetiredPresentation } = require('../security/runtime/retired-presentation.cjs');
  const server = http.createServer((req, res) => {
    if (serveRetiredPresentation(req, res)) return;
    res.writeHead(204); res.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const asset of ['/factory-control-ui.js', '/factory%2dcontrol-ui.js', '/nested/review-ui.js?cache=old', '/vector-shell.js']) {
    for (const method of ['GET', 'HEAD']) {
      const res = await fetch(base + asset, { method });
      assert.equal(res.status, 410); assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      const body = await res.text(); if (method === 'HEAD') assert.equal(body, '');
    }
  }
  for (const route of ['/api/health', '/api/login', '/vector-ui.js', '/vector-workflows.js']) {
    assert.equal((await fetch(base + route)).status, 204);
  }
});


test('legacy local-data writes are redirected outside immutable app root', () => {
  const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(docker, /mkdir -p \/tmp\/vector-local-data/);
  assert.match(docker, /ln -s \/tmp\/vector-local-data \/app\/local-data/);
  assert.match(docker, /chmod 0700 \/tmp\/vector-local-data/);
  assert.match(docker, /USER node/);
  assert.match(docker, /find \/app -type d -exec chmod 0555/);
});


test('integration fabric runtime retains its source-relative loader layout', () => {
  const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(docker, /COPY integration-fabric\/runtime\/ \/app\/integration-fabric\/runtime\//);
  assert.match(docker, /COPY integration-fabric\/scripts\/load-catalog\.mjs \/app\/integration-fabric\/scripts\/load-catalog\.mjs/);
  assert.match(docker, /COPY integration-fabric\/systems\.json \/app\/integration-fabric\/systems\.json/);
  assert.match(docker, /COPY integration-fabric\/systems-research\.json \/app\/integration-fabric\/systems-research\.json/);
  assert.match(docker, /COPY integration-fabric\/research-overlays\/ \/app\/integration-fabric\/research-overlays\//);
  assert.match(docker, /COPY integration-fabric\/protocol-profiles\.json \/app\/integration-fabric\/protocol-profiles\.json/);
  assert.match(docker, /COPY integration-fabric\/opportunity-profiles\.json \/app\/integration-fabric\/opportunity-profiles\.json/);
  const registry = fs.readFileSync(path.join(root, 'integration-fabric/runtime/connector-registry.mjs'), 'utf8');
  assert.match(registry, /\.\.\/scripts\/load-catalog\.mjs/);
});
