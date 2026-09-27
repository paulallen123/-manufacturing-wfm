'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRuntimeIdentity } = require('./runtime-identity.cjs');

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
    () => createRuntimeIdentity({ hosted: true, env: { WFM_CANDIDATE_SHA: 'not-a-commit' } }),
    /WFM_RUNTIME_IDENTITY_SHA_INVALID/
  );
});

test('public identity endpoint reports exact deployed source and fixture boundary', () => {
  const candidateSha = 'f62f1e9f6d993d3f90ff19f8178275803e5b7d3f';
  const identity = createRuntimeIdentity({ hosted: true, env: { WFM_CANDIDATE_SHA: candidateSha } });
  const res = responseRecorder();

  assert.equal(identity.handleRequest({ method: 'GET', url: '/api/runtime-identity?fresh=1' }, res), true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(JSON.parse(res.body), {
    schemaVersion: 1,
    candidateSha,
    fixtureOnly: true,
    productionApproved: false,
    pilotReady: false
  });
});

test('identity endpoint is read-only and leaves unrelated routes alone', () => {
  const identity = createRuntimeIdentity({
    hosted: true,
    env: { WFM_CANDIDATE_SHA: 'f62f1e9f6d993d3f90ff19f8178275803e5b7d3f' }
  });
  assert.equal(identity.handleRequest({ method: 'GET', url: '/api/health' }, responseRecorder()), false);

  const res = responseRecorder();
  assert.equal(identity.handleRequest({ method: 'POST', url: '/api/runtime-identity' }, res), true);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.get('allow'), 'GET, HEAD');
});
