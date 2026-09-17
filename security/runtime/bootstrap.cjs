'use strict';

const http = require('node:http');
const { createIdentitySurvivalGuard } = require('./identity-survival-guard.cjs');

const hosted = process.env.WFM_HOSTED_STAGING === 'true';
const enabled = process.env.WFM_IDENTITY_SURVIVAL_GUARD !== 'off';
let guard = null;

if (hosted && !process.env.WFM_DB) {
  throw new Error('Hosted staging refuses to start without WFM_DB for identity survival enforcement.');
}

const originalCreateServer = http.createServer;
http.createServer = function guardedCreateServer(listener) {
  if (typeof listener !== 'function') return originalCreateServer.call(http, listener);

  if (enabled && !guard && process.env.WFM_DB) {
    guard = createIdentitySurvivalGuard({ dbPath: process.env.WFM_DB });
  }
  if (hosted && !guard) {
    throw new Error('Hosted staging refuses to start without the identity survival guard.');
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
    return listener(req, res);
  });
};

require('/app/server.cjs');
