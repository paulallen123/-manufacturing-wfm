'use strict';

const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { createIdentitySurvivalGuard } = require('./identity-survival-guard.cjs');
const { createProofRunnerAuth } = require('./proof-runner-auth.cjs');

const hosted = process.env.WFM_HOSTED_STAGING === 'true';
const enabled = process.env.WFM_IDENTITY_SURVIVAL_GUARD !== 'off';
const proofRunnerEnabled = process.env.WFM_PROOF_RUNNER_AUTH === 'enabled';
let guard = null;
let proofRunnerAuth = null;

// The sealed legacy runtime still expects a staging password at bootstrap. When the
// passwordless proof runner is enabled, generate an internal one-time value so no
// operator or proof runner has to create, store, retrieve or type a password.
if (hosted && proofRunnerEnabled && !process.env.WFM_STAGING_PASSWORD) {
  process.env.WFM_STAGING_PASSWORD = randomBytes(32).toString('base64url');
}

if (hosted && !process.env.WFM_DB) {
  throw new Error('Hosted staging refuses to start without WFM_DB for identity survival enforcement.');
}

const originalCreateServer = http.createServer;
http.createServer = function guardedCreateServer(listener) {
  if (typeof listener !== 'function') return originalCreateServer.call(http, listener);

  // The sealed server creates its SQLite schema before calling http.createServer().
  // Initialise synchronously here: the schema exists, but no socket can accept a
  // request until this function returns, so there is no unguarded request window.
  if (enabled && !guard && process.env.WFM_DB) {
    guard = createIdentitySurvivalGuard({ dbPath: process.env.WFM_DB });
  }
  if (hosted && !guard) {
    throw new Error('Hosted staging refuses to start without the identity survival guard.');
  }
  if (proofRunnerEnabled && !proofRunnerAuth) {
    proofRunnerAuth = createProofRunnerAuth({ dbPath: process.env.WFM_DB });
  }

  return originalCreateServer.call(http, async (req, res) => {
    if (guard) {
      try {
        if (guard.beforeRequest(req, res)) return;
      } catch {
        if (!res.headersSent && !res.writableEnded) {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.end(JSON.stringify({ error: 'Security control unavailable. Request refused.' }));
        }
        return;
      }
    }
    if (proofRunnerAuth) {
      try {
        if (await proofRunnerAuth.handleRequest(req, res)) return;
      } catch {
        if (!res.headersSent && !res.writableEnded) {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.end(JSON.stringify({ error: 'Proof authentication control unavailable. Request refused.' }));
        }
        return;
      }
    }
    return listener(req, res);
  });
};

require('/app/server.cjs');
