'use strict';

const fs = require('node:fs');

const COMMIT_SHA = /^[0-9a-f]{40}$/;
const DEFAULT_BUILD_SHA_FILE = '/app/.wfm-build-source-sha';

function requestPath(req) {
  return String(req?.url || '/').split('?')[0];
}

function createRuntimeIdentity({
  env = process.env,
  hosted = env.WFM_HOSTED_STAGING === 'true',
  buildShaFile = DEFAULT_BUILD_SHA_FILE,
  readFileSync = fs.readFileSync
} = {}) {
  const expectedSha = String(env.WFM_CANDIDATE_SHA || '').trim().toLowerCase();
  buildShaFile = String(buildShaFile || DEFAULT_BUILD_SHA_FILE).trim();
  let buildSha = '';

  if (hosted && !expectedSha) {
    throw new Error('WFM_RUNTIME_IDENTITY_SHA_REQUIRED');
  }
  if (expectedSha && !COMMIT_SHA.test(expectedSha)) {
    throw new Error('WFM_RUNTIME_IDENTITY_SHA_INVALID');
  }

  try {
    buildSha = String(readFileSync(buildShaFile, 'utf8')).trim().toLowerCase();
  } catch {
    if (hosted) throw new Error('WFM_RUNTIME_IDENTITY_BUILD_SHA_REQUIRED');
  }
  if (hosted && !buildSha) {
    throw new Error('WFM_RUNTIME_IDENTITY_BUILD_SHA_REQUIRED');
  }
  if (buildSha && !COMMIT_SHA.test(buildSha)) {
    throw new Error('WFM_RUNTIME_IDENTITY_BUILD_SHA_INVALID');
  }
  if (expectedSha && buildSha && expectedSha !== buildSha) {
    throw new Error('WFM_RUNTIME_IDENTITY_SHA_MISMATCH');
  }

  const candidateSha = buildSha || expectedSha;
  const sourceBinding = buildSha && expectedSha
    ? 'build-file-matched'
    : buildSha
      ? 'build-file-only'
      : expectedSha
        ? 'configured-only'
        : 'unbound';

  const payload = Object.freeze({
    schemaVersion: 1,
    candidateSha: candidateSha || null,
    sourceBinding,
    fixtureOnly: Boolean(hosted),
    productionApproved: false,
    pilotReady: false
  });

  function applyResponseHeaders(res) {
    if (!res || typeof res.setHeader !== 'function') {
      throw new TypeError('WFM_RUNTIME_IDENTITY_RESPONSE_REQUIRED');
    }
    if (payload.candidateSha) res.setHeader('X-WFM-Source-SHA', payload.candidateSha);
    res.setHeader('X-WFM-Source-Binding', payload.sourceBinding);
    res.setHeader('X-WFM-Fixture-Only', String(payload.fixtureOnly));
  }

  function handleRequest(req, res) {
    if (requestPath(req) !== '/api/runtime-identity') return false;

    const method = String(req?.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      res.setHeader('Cache-Control', 'no-store');
      res.end('Method Not Allowed');
      return true;
    }

    const body = JSON.stringify(payload);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (method === 'HEAD') res.end();
    else res.end(body);
    return true;
  }

  return Object.freeze({
    candidateSha: payload.candidateSha,
    applyResponseHeaders,
    handleRequest
  });
}

module.exports = { createRuntimeIdentity };
