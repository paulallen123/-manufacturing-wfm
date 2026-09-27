'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { createRuntimeIdentity } = require('./runtime-identity.cjs');

const CANDIDATE_SHA = 'f62f1e9f6d993d3f90ff19f8178275803e5b7d3f';
const OTHER_SHA = '517f58670009709ded4178f47e66bbe7059bfa0e';

function hostedIdentity(candidateSha = CANDIDATE_SHA, buildSha = candidateSha) {
  return createRuntimeIdentity({
    hosted: true,
    env: { WFM_CANDIDATE_SHA: candidateSha },
    readFileSync: () => buildSha + '\n'
  });
}

function responseRecorder() {
  return {
    statusCode: 0,
    headers: new Map(),
    body: '',
    setHeader(name, value) { this.headers.set(String(name).toLowerCase(), String(value)); },
    end(value = '') { this.body += String(value); }
  };
}

test('hosted runtime refuses to start without an exact commit SHA', () => {
  assert.throws(
    () => createRuntimeIdentity({ hosted: true, env: {} }),
    /WFM_RUNTIME_IDENTITY_SHA_REQUIRED/
  );
  assert.throws(
    () => createRuntimeIdentity({
      hosted: true,
      env: { WFM_CANDIDATE_SHA: 'not-a-commit' },
      readFileSync: () => CANDIDATE_SHA
    }),
    /WFM_RUNTIME_IDENTITY_SHA_INVALID/
  );
});

test('hosted runtime refuses missing, invalid, or mismatched build-derived identity', () => {
  assert.throws(
    () => createRuntimeIdentity({
      hosted: true,
      env: { WFM_CANDIDATE_SHA: CANDIDATE_SHA },
      readFileSync: () => { throw new Error('ENOENT'); }
    }),
    /WFM_RUNTIME_IDENTITY_BUILD_SHA_REQUIRED/
  );
  assert.throws(
    () => createRuntimeIdentity({
      hosted: true,
      env: { WFM_CANDIDATE_SHA: CANDIDATE_SHA },
      readFileSync: () => 'not-a-commit'
    }),
    /WFM_RUNTIME_IDENTITY_BUILD_SHA_INVALID/
  );
  assert.throws(
    () => hostedIdentity(CANDIDATE_SHA, OTHER_SHA),
    /WFM_RUNTIME_IDENTITY_SHA_MISMATCH/
  );
});

test('public identity endpoint reports exact deployed source and fixture boundary', () => {
  const identity = hostedIdentity();
  const res = responseRecorder();

  assert.equal(identity.handleRequest({ method: 'GET', url: '/api/runtime-identity?fresh=1' }, res), true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(JSON.parse(res.body), {
    schemaVersion: 1,
    candidateSha: CANDIDATE_SHA,
    sourceBinding: 'build-file-matched',
    fixtureOnly: true,
    productionApproved: false,
    pilotReady: false
  });
});

test('hosted runtime reads the sealed source identity from disk', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-runtime-identity-'));
  const buildShaFile = path.join(directory, 'source-sha');
  try {
    fs.writeFileSync(buildShaFile, CANDIDATE_SHA + '\n', { mode: 0o444 });
    const identity = createRuntimeIdentity({
      hosted: true,
      env: {
        WFM_CANDIDATE_SHA: CANDIDATE_SHA
      },
      buildShaFile
    });
    assert.equal(identity.candidateSha, CANDIDATE_SHA);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('hosted runtime ignores environment attempts to redirect sealed identity', () => {
  const attemptedPath = '/tmp/attacker-controlled-source-sha';
  const observedPaths = [];
  assert.throws(
    () => createRuntimeIdentity({
      hosted: true,
      env: {
        WFM_CANDIDATE_SHA: CANDIDATE_SHA,
        WFM_BUILD_SOURCE_SHA_FILE: attemptedPath
      },
      readFileSync: file => {
        observedPaths.push(file);
        if (file === attemptedPath) return CANDIDATE_SHA;
        throw new Error('ENOENT');
      }
    }),
    /WFM_RUNTIME_IDENTITY_BUILD_SHA_REQUIRED/
  );
  assert.deepEqual(observedPaths, ['/app/.wfm-build-source-sha']);
});

test('identity endpoint is read-only and leaves unrelated routes alone', () => {
  const identity = hostedIdentity();
  assert.equal(identity.handleRequest({ method: 'GET', url: '/api/health' }, responseRecorder()), false);

  const res = responseRecorder();
  assert.equal(identity.handleRequest({ method: 'POST', url: '/api/runtime-identity' }, res), true);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.get('allow'), 'GET, HEAD');
});

test('every hosted response can be bound to the exact serving source', () => {
  const identity = hostedIdentity();
  const res = responseRecorder();

  identity.applyResponseHeaders(res);

  assert.equal(res.headers.get('x-wfm-source-sha'), CANDIDATE_SHA);
  assert.equal(res.headers.get('x-wfm-source-binding'), 'build-file-matched');
  assert.equal(res.headers.get('x-wfm-fixture-only'), 'true');
});

test('downstream handlers cannot replace or remove source proof headers', async () => {
  const identity = hostedIdentity();
  const server = http.createServer((_req, res) => {
    identity.applyResponseHeaders(res);
    res.setHeader('X-WFM-Source-SHA', OTHER_SHA);
    res.removeHeader('X-WFM-Source-Binding');
    res.writeHead(200, { 'X-WFM-Fixture-Only': 'false' });
    res.end('ok');
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: server.address().port, path: '/' }, resolve)
        .on('error', reject);
    });
    response.resume();
    await new Promise(resolve => response.once('end', resolve));

    assert.equal(response.headers['x-wfm-source-sha'], CANDIDATE_SHA);
    assert.equal(response.headers['x-wfm-source-binding'], 'build-file-matched');
    assert.equal(response.headers['x-wfm-fixture-only'], 'true');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
