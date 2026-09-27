'use strict';

const COMMIT_SHA = /^[0-9a-f]{40}$/;

function requestPath(req) {
  return String(req?.url || '/').split('?')[0];
}

function createRuntimeIdentity({ env = process.env, hosted = env.WFM_HOSTED_STAGING === 'true' } = {}) {
  const candidateSha = String(env.WFM_CANDIDATE_SHA || '').trim().toLowerCase();

  if (hosted && !candidateSha) {
    throw new Error('WFM_RUNTIME_IDENTITY_SHA_REQUIRED');
  }
  if (candidateSha && !COMMIT_SHA.test(candidateSha)) {
    throw new Error('WFM_RUNTIME_IDENTITY_SHA_INVALID');
  }

  const payload = Object.freeze({
    schemaVersion: 1,
    candidateSha: candidateSha || null,
    fixtureOnly: Boolean(hosted),
    productionApproved: false,
    pilotReady: false
  });

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

  return Object.freeze({ candidateSha: payload.candidateSha, handleRequest });
}

module.exports = { createRuntimeIdentity };
