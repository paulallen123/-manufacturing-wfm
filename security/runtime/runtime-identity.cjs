'use strict';

const fs = require('node:fs');

const COMMIT_SHA = /^[0-9a-f]{40}$/;
const DEFAULT_BUILD_SHA_FILE = '/app/.wfm-build-source-sha';
const RESPONSE_PROOF_BOUND = Symbol('wfm-runtime-source-proof-bound');

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
    if (res[RESPONSE_PROOF_BOUND]) return;

    const proofHeaders = new Map([
      ['x-wfm-source-binding', { name: 'X-WFM-Source-Binding', value: payload.sourceBinding }],
      ['x-wfm-fixture-only', { name: 'X-WFM-Fixture-Only', value: String(payload.fixtureOnly) }]
    ]);
    if (payload.candidateSha) {
      proofHeaders.set('x-wfm-source-sha', { name: 'X-WFM-Source-SHA', value: payload.candidateSha });
    }

    const originalSetHeader = res.setHeader.bind(res);
    const originalRemoveHeader = typeof res.removeHeader === 'function'
      ? res.removeHeader.bind(res)
      : null;
    const originalWriteHead = typeof res.writeHead === 'function'
      ? res.writeHead.bind(res)
      : null;

    function enforceProofHeaders() {
      for (const header of proofHeaders.values()) originalSetHeader(header.name, header.value);
    }

    function clearProofHeaders() {
      if (!originalRemoveHeader) return false;
      for (const header of proofHeaders.values()) originalRemoveHeader(header.name);
      return true;
    }

    function mergeProofHeaders(headers) {
      if (Array.isArray(headers)) {
        const merged = [];
        for (let index = 0; index < headers.length; index += 2) {
          if (!proofHeaders.has(String(headers[index] || '').toLowerCase())) {
            merged.push(headers[index], headers[index + 1]);
          }
        }
        for (const header of proofHeaders.values()) merged.push(header.name, header.value);
        return merged;
      }

      const merged = {};
      for (const [name, value] of Object.entries(headers || {})) {
        if (!proofHeaders.has(String(name).toLowerCase())) merged[name] = value;
      }
      for (const header of proofHeaders.values()) merged[header.name] = header.value;
      return merged;
    }

    Object.defineProperty(res, RESPONSE_PROOF_BOUND, { value: true });
    res.setHeader = function sourceProofSetHeader(name, value) {
      const protectedHeader = proofHeaders.get(String(name || '').toLowerCase());
      if (protectedHeader) return originalSetHeader(protectedHeader.name, protectedHeader.value);
      return originalSetHeader(name, value);
    };
    if (originalRemoveHeader) {
      res.removeHeader = function sourceProofRemoveHeader(name) {
        if (proofHeaders.has(String(name || '').toLowerCase())) return;
        return originalRemoveHeader(name);
      };
    }
    if (originalWriteHead) {
      res.writeHead = function sourceProofWriteHead(statusCode, statusMessage, headers) {
        // Node appends raw header-array values to headers already set on the
        // response. Clear the protected set first so each proof value is emitted
        // exactly once by the canonical merged writeHead arguments.
        if (!clearProofHeaders()) enforceProofHeaders();
        if (typeof statusMessage === 'string') {
          return originalWriteHead(statusCode, statusMessage, mergeProofHeaders(headers));
        }
        return originalWriteHead(statusCode, mergeProofHeaders(statusMessage));
      };
    }
    enforceProofHeaders();
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
