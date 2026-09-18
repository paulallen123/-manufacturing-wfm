'use strict';

const http = require('node:http');
const { createIdentitySurvivalGuard } = require('./identity-survival-guard.cjs');
const { installHostedListenGuard } = require('./hosted-listen-guard.cjs');
const { createAutonomousIntegrationHub } = require('/app/integration-runtime/autonomous-integration-hub.cjs');
const { createAdaptiveLearningEngine } = require('/app/learning-runtime/adaptive-learning-engine.cjs');
const { createOneDayEnterpriseEngine } = require('/app/implementation-runtime/one-day-enterprise-engine.cjs');

const hosted = process.env.WFM_HOSTED_STAGING === 'true';
const enabled = process.env.WFM_IDENTITY_SURVIVAL_GUARD !== 'off';
installHostedListenGuard(http, { hosted });
let guard = null;
let integrationHub = null;
let integrationHubInitError = null;
let learningEngine = null;
let learningEngineInitError = null;
let implementationEngine = null;
let implementationEngineInitError = null;

if (hosted && !process.env.WFM_DB) {
  throw new Error('Hosted staging refuses to start without WFM_DB for identity survival enforcement.');
}

function requestPath(req) {
  return String(req?.url || '/').split('?')[0];
}

function integrationPath(req) {
  return requestPath(req).startsWith('/api/integrations/autonomous');
}

function learningPath(req) {
  return requestPath(req).startsWith('/api/learning/adaptive');
}

function implementationPath(req) {
  return requestPath(req).startsWith('/api/implementation/autonomous');
}

function overlayUnavailable(res, label) {
  if (res.headersSent || res.writableEnded) return;
  res.statusCode = 503;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify({ error: label + ' control plane is unavailable.' }));
}

async function routeOverlay(handler, initError, res, label, req) {
  if (!handler || initError) {
    overlayUnavailable(res, label);
    return true;
  }
  try {
    if (await handler.handleRequest(req, res)) return true;
  } catch {
    overlayUnavailable(res, label);
    return true;
  }
  return false;
}

const originalCreateServer = http.createServer;
http.createServer = function guardedCreateServer(listener) {
  if (typeof listener !== 'function') return originalCreateServer.call(http, listener);

  // The sealed server creates its SQLite schema before calling http.createServer().
  // Initialise synchronously here so no request can arrive before the additive
  // security/integration/implementation/learning overlays are ready or fail closed.
  if (enabled && !guard && process.env.WFM_DB) {
    guard = createIdentitySurvivalGuard({ dbPath: process.env.WFM_DB });
  }
  if (hosted && !guard) {
    throw new Error('Hosted staging refuses to start without the identity survival guard.');
  }

  if (!integrationHub && !integrationHubInitError && process.env.WFM_DB) {
    try {
      integrationHub = createAutonomousIntegrationHub({ dbPath: process.env.WFM_DB });
    } catch (error) {
      integrationHubInitError = error;
    }
  }

  if (!learningEngine && !learningEngineInitError && process.env.WFM_DB) {
    try {
      learningEngine = createAdaptiveLearningEngine({ dbPath: process.env.WFM_DB });
    } catch (error) {
      learningEngineInitError = error;
    }
  }

  if (!implementationEngine && !implementationEngineInitError && process.env.WFM_DB) {
    try {
      implementationEngine = createOneDayEnterpriseEngine({
        dbPath: process.env.WFM_DB,
        learningSummaryProvider: tenant => {
          if (!learningEngine || learningEngineInitError) {
            throw new Error('Adaptive learning evidence unavailable.');
          }
          return learningEngine.summaryForTenant(tenant);
        }
      });
    } catch (error) {
      implementationEngineInitError = error;
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
      if (await routeOverlay(integrationHub, integrationHubInitError, res, 'Autonomous integration', req)) return;
    }

    if (learningPath(req)) {
      if (await routeOverlay(learningEngine, learningEngineInitError, res, 'Adaptive learning', req)) return;
    }

    if (implementationPath(req)) {
      if (await routeOverlay(implementationEngine, implementationEngineInitError, res, 'Autonomous implementation', req)) return;
    }

    return listener(req, res);
  });
};

require('/app/server.cjs');
