'use strict';

const http = require('node:http');
const { createIdentitySurvivalGuard } = require('./identity-survival-guard.cjs');
const { createAutonomousIntegrationHub } = require('/app/integration-runtime/autonomous-integration-hub.cjs');

const hosted = process.env.WFM_HOSTED_STAGING === 'true';
const enabled = process.env.WFM_IDENTITY_SURVIVAL_GUARD !== 'off';
let guard = null;
let integrationHub = null;
let integrationHubInitError = null;

if (hosted && !process.env.WFM_DB) {
  throw new Error('Hosted staging refuses to start without WFM_DB for identity survival enforcement.');
}

function integrationPath(req) {
  return String(req?.url || '/').split('?')[0].startsWith('/api/integrations/autonomous');
}

function integrationUnavailable(res) {
  if (res.headersSent || res.writableEnded) return;
  res.statusCode = 503;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify({ error: 'Autonomous integration control plane is unavailable.' }));
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

  // Integration discovery/configuration is an additive control plane. A failure in
  // this overlay must fail its own routes closed without taking down the proven WFM core.
  if (!integrationHub && !integrationHubInitError && process.env.WFM_DB) {
    try {
      integrationHub = createAutonomousIntegrationHub({ dbPath: process.env.WFM_DB });
    } catch (error) {
      integrationHubInitError = error;
    }
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

    if (integrationPath(req)) {
      if (!integrationHub || integrationHubInitError) {
        integrationUnavailable(res);
        return;
      }
      try {
        if (await integrationHub.handleRequest(req, res)) return;
      } catch {
        integrationUnavailable(res);
        return;
      }
    }

    return listener(req, res);
  });
};

require('/app/server.cjs');
