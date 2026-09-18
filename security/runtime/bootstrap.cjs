'use strict';

const http = require('node:http');
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createIdentitySurvivalGuard } = require('./identity-survival-guard.cjs');
const { createUxPreferenceStore } = require('./ux-preference.cjs');
const { installHostedListenGuard } = require('./hosted-listen-guard.cjs');
const { createAutonomousIntegrationHub } = require('/app/integration-runtime/autonomous-integration-hub.cjs');
const { createAdaptiveLearningEngine } = require('/app/learning-runtime/adaptive-learning-engine.cjs');
const { createOneDayEnterpriseEngine } = require('/app/implementation-runtime/one-day-enterprise-engine.cjs');
const { createWorkforceLifecycleGuard } = require('/app/operations-runtime/workforce-lifecycle-guard.cjs');

const hosted = process.env.WFM_HOSTED_STAGING === 'true';
const STAGING_ACCESS_GRANTS = Object.freeze([
  { key: 'version-d-access', tokenHash: '56ee02ec22d0ffb576da2aca01fdb9ef283a3cad1ee01edcf6bdbefde626eafe' },
  { key: 'version-d-probe', tokenHash: '4c63718f69bf65b3340dad010e5b2c055ab2a88fdd7f275cf9c1faf7c76e5d91' }
]);
const STAGING_ACCESS_EXPIRES_AT = Date.parse('2026-09-19T02:30:00.000Z');
const STAGING_ACCESS_EMAIL = 'superuser@northstar.example';

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function secureEqualHex(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}
const enabled = process.env.WFM_IDENTITY_SURVIVAL_GUARD !== 'off';
installHostedListenGuard(http, { hosted });
let guard = null;
let uxPreferences = null;
let uxPreferencesInitError = null;
let integrationHub = null;
let integrationHubInitError = null;
let learningEngine = null;
let learningEngineInitError = null;
let implementationEngine = null;
let implementationEngineInitError = null;
let lifecycleGuard = null;
let lifecycleGuardInitError = null;

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

function lifecyclePath(req) {
  return requestPath(req).startsWith('/api/workforce/lifecycle');
}

function stagingAccessPath(req) {
  return requestPath(req) === '/api/staging-access';
}

function handleStagingAccess(req, res) {
  if (!hosted || process.env.NODE_ENV !== 'staging') return false;
  if (!stagingAccessPath(req)) return false;
  if (String(req.method || 'GET').toUpperCase() !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.end('Method Not Allowed');
    return true;
  }

  let rawToken = '';
  try {
    rawToken = new URL(String(req.url || '/'), 'https://staging.invalid').searchParams.get('token') || '';
  } catch {}

  const presentedHash = rawToken ? sha256(rawToken) : '';
  const grant = STAGING_ACCESS_GRANTS.find(item => secureEqualHex(presentedHash, item.tokenHash));
  if (
    Date.now() > STAGING_ACCESS_EXPIRES_AT ||
    !rawToken ||
    !grant
  ) {
    res.statusCode = 404;
    res.setHeader('Cache-Control', 'no-store');
    res.end('Not Found');
    return true;
  }

  const db = new DatabaseSync(process.env.WFM_DB);
  try {
    db.exec(
      'CREATE TABLE IF NOT EXISTS staging_access_grants(' +
      'grant_key TEXT PRIMARY KEY, used_at TEXT NOT NULL);'
    );
    const used = db.prepare('SELECT used_at FROM staging_access_grants WHERE grant_key=?').get(grant.key);
    if (used) {
      res.statusCode = 410;
      res.setHeader('Cache-Control', 'no-store');
      res.end('This staging access link has already been used.');
      return true;
    }

    const account = db.prepare('SELECT email FROM users WHERE email=?').get(STAGING_ACCESS_EMAIL);
    if (!account) {
      res.statusCode = 503;
      res.setHeader('Cache-Control', 'no-store');
      res.end('Staging account is unavailable.');
      return true;
    }

    const sessionToken = randomBytes(32).toString('base64url');
    const sessionExpires = Math.min(Date.now() + 4 * 60 * 60 * 1000, STAGING_ACCESS_EXPIRES_AT + 4 * 60 * 60 * 1000);
    try {
      db.exec('BEGIN IMMEDIATE;');
      db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)')
        .run(sha256(sessionToken), STAGING_ACCESS_EMAIL, sessionExpires);
      db.prepare('INSERT INTO staging_access_grants(grant_key,used_at) VALUES(?,?)')
        .run(grant.key, new Date().toISOString());
      db.exec('COMMIT;');
    } catch (error) {
      try { db.exec('ROLLBACK;'); } catch {}
      throw error;
    }

    res.statusCode = 302;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Set-Cookie', 'wfm_session=' + sessionToken + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=14400');
    res.setHeader('Location', '/');
    res.end();
    return true;
  } finally {
    try { db.close(); } catch {}
  }
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

  if (!uxPreferences && !uxPreferencesInitError && process.env.WFM_DB) {
    try {
      uxPreferences = createUxPreferenceStore({ dbPath: process.env.WFM_DB });
    } catch (error) {
      uxPreferencesInitError = error;
    }
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

  if (!lifecycleGuard && !lifecycleGuardInitError && process.env.WFM_DB) {
    try {
      lifecycleGuard = createWorkforceLifecycleGuard({ dbPath: process.env.WFM_DB });
    } catch (error) {
      lifecycleGuardInitError = error;
    }
  }

  return originalCreateServer.call(http, async (req, res) => {
    if (handleStagingAccess(req, res)) return;

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

    if (requestPath(req) === '/api/ux-preference') {
      if (!uxPreferences || uxPreferencesInitError) {
        overlayUnavailable(res, 'UX preference');
        return;
      }
      try {
        if (await uxPreferences.beforeRequest(req, res)) return;
      } catch {
        overlayUnavailable(res, 'UX preference');
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

    if (lifecyclePath(req)) {
      if (await routeOverlay(lifecycleGuard, lifecycleGuardInitError, res, 'Workforce lifecycle', req)) return;
    }

    return listener(req, res);
  });
};

require('/app/server.cjs');
