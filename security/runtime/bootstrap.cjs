'use strict';

const http = require('node:http');
const { createIdentitySurvivalGuard } = require('./identity-survival-guard.cjs');
const { createPasskeyAuth } = require('./passkey-auth.cjs');

const hosted = process.env.WFM_HOSTED_STAGING === 'true';
const enabled = process.env.WFM_IDENTITY_SURVIVAL_GUARD !== 'off';
const passkeysEnabled = process.env.WFM_PASSKEYS === 'true' || (hosted && process.env.WFM_PASSKEYS !== 'off');
let guard = null;
let passkeys = null;

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
  if (passkeysEnabled && !passkeys && process.env.WFM_DB) {
    passkeys = createPasskeyAuth({ dbPath: process.env.WFM_DB });
  }
  if (hosted && !guard) {
    throw new Error('Hosted staging refuses to start without the identity survival guard.');
  }
  if (hosted && passkeysEnabled && !passkeys) {
    throw new Error('Hosted staging refuses to start without passkey authentication controls.');
  }

  return originalCreateServer.call(http, async (req, res) => {
    const path = String(req.url || '/').split('?')[0] || '/';
    const publicPasskeyRoute =
      path === '/api/passkeys/config' ||
      path === '/api/passkeys/auth/options' ||
      path === '/api/passkeys/auth/verify';

    // A stale bearer cookie must not prevent a fresh phishing-resistant sign-in.
    // Only the three public ceremony endpoints bypass the existing-session guard;
    // the passkey module still enforces same-origin challenge/signature checks.
    if (passkeys && publicPasskeyRoute) {
      try {
        if (await passkeys.beforeRequest(req, res)) return;
      } catch {
        if (!res.headersSent && !res.writableEnded) {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.end(JSON.stringify({ error: 'Passkey security control unavailable. Request refused.' }));
        }
        return;
      }
    }

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

    // Enrolment, listing and revocation remain behind the same resource-side
    // session/tenant guard as every other authenticated WFM action.
    if (passkeys && !publicPasskeyRoute) {
      try {
        if (await passkeys.beforeRequest(req, res)) return;
      } catch {
        if (!res.headersSent && !res.writableEnded) {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.end(JSON.stringify({ error: 'Passkey security control unavailable. Request refused.' }));
        }
        return;
      }
    }

    return listener(req, res);
  });
};

require('/app/server.cjs');
