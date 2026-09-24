'use strict';

const http = require('node:http');
const fs = require('node:fs');
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createIdentitySurvivalGuard } = require('./identity-survival-guard.cjs');
const { installHostedListenGuard } = require('./hosted-listen-guard.cjs');
const { createOwnerAccessRecovery } = require('./owner-access-recovery.cjs');
const { serveRetiredPresentation } = require('./retired-presentation.cjs');
const { createAutonomousIntegrationHub } = require('/app/integration-runtime/autonomous-integration-hub.cjs');
const { createAdaptiveLearningEngine } = require('/app/learning-runtime/adaptive-learning-engine.cjs');
const { createTrainingDeliveryService } = require('/app/learning-runtime/training-delivery-service.cjs');
const { createOneDayEnterpriseEngine } = require('/app/implementation-runtime/one-day-enterprise-engine.cjs');
const { createWorkforceLifecycleGuard } = require('/app/operations-runtime/workforce-lifecycle-guard.cjs');
const { createDemandDecisionService } = require('/app/operations-runtime/demand-decision-service.cjs');
const { createAutopilotExecutionEngine } = require('/app/operations-runtime/autopilot-execution-engine.cjs');
const { createRealtimeEventService } = require('/app/operations-runtime/realtime-event-service.cjs');
const { createT9CustomerGuardian } = require('/app/operations-runtime/t9-customer-guardian.cjs');
const { createVectorReportingService } = require('/app/reporting-runtime/vector-reporting-service.cjs');

const hosted = process.env.WFM_HOSTED_STAGING === 'true';
const STAGING_ACCESS_GRANTS = Object.freeze([
  { key: 'vector-ui-access-direct-20260919', tokenHash: '206b067c57a91d14c0dedee7a717e907ada9b04b5d964a4b3aa2d94da7aa58b8', restore: true },
  { key: 'vector-ui-probe-restore-20260919', tokenHash: 'a1a70f9319430281482a623d3453756ef8c0f279a243d9fe8d67fafcb5fc1c16', restore: false }
]);
const STAGING_ACCESS_EXPIRES_AT = Date.parse('2026-09-19T23:00:00.000Z');
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
const ownerAccessRecovery = createOwnerAccessRecovery();
let guard = null;
let integrationHub = null;
let integrationHubInitError = null;
let learningEngine = null;
let learningEngineInitError = null;
let trainingDeliveryService = null;
let trainingDeliveryServiceInitError = null;
let implementationEngine = null;
let implementationEngineInitError = null;
let lifecycleGuard = null;
let lifecycleGuardInitError = null;
let realtimeEventService = null;
let realtimeEventServiceInitError = null;
let autopilotExecutionEngine = null;
let autopilotExecutionEngineInitError = null;
let demandDecisionService = null;
let demandDecisionServiceInitError = null;
let t9CustomerGuardian = null;
let t9CustomerGuardianInitError = null;
let reportingService = null;
let reportingServiceInitError = null;

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

function trainingPath(req) {
  return requestPath(req).startsWith('/api/learning/training');
}

function implementationPath(req) {
  return requestPath(req).startsWith('/api/implementation/autonomous');
}

function lifecyclePath(req) {
  return requestPath(req).startsWith('/api/workforce/lifecycle');
}

function autopilotPath(req) { return requestPath(req).startsWith('/api/operations/autopilot'); }

function realtimePath(req) {
  return requestPath(req).startsWith('/api/realtime');
}

function demandDecisionPath(req) {
  return requestPath(req).startsWith('/api/operations/intelligence');
}

function reportingPath(req) {
  return requestPath(req).startsWith('/api/reporting');
}

function stagingAccessPath(req) {
  return requestPath(req) === '/api/staging-access';
}

function uiPresentationPath(req) {
  const path = requestPath(req);
  return path === '/' ||
    path === '/index.html' ||
    path === '/vector-ui.css' ||
    path === '/vector-ui.js' ||
    path === '/vector-workflows.js';
}

function forceVectorUiFreshness(req, res) {
  if (!uiPresentationPath(req) || res.headersSent || res.writableEnded) return;
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-WFM-UI', 'VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1');
}

function serveCanonicalVectorAsset(req, res) {
  if (serveRetiredPresentation(req, res)) return true;
  const path = requestPath(req);
  const asset = path === '/vector-ui.js'
    ? { file: '/app/public/vector-ui.js', type: 'text/javascript; charset=utf-8' }
    : path === '/vector-ui.css'
      ? { file: '/app/public/vector-ui.css', type: 'text/css; charset=utf-8' }
      : path === '/vector-workflows.js'
        ? { file: '/app/public/vector-workflows.js', type: 'text/javascript; charset=utf-8' }
        : null;
  if (!asset) return false;

  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end('Method Not Allowed');
    return true;
  }

  try {
    const body = fs.readFileSync(asset.file);
    res.statusCode = 200;
    res.setHeader('Content-Type', asset.type);
    res.setHeader('Content-Length', String(body.length));
    res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-WFM-UI', 'VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1');
    if (method === 'HEAD') res.end();
    else res.end(body);
  } catch {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end('Canonical Vector presentation asset unavailable.');
  }
  return true;
}

function cookieValue(req, name) {
  const raw = String(req?.headers?.cookie || '');
  const prefix = name + '=';
  for (const part of raw.split(';')) {
    const item = part.trim();
    if (item.startsWith(prefix)) return item.slice(prefix.length);
  }
  return '';
}

function issueStagingSession(db, res) {
  const account = db.prepare('SELECT email FROM users WHERE email=?').get(STAGING_ACCESS_EMAIL);
  if (!account) return '';
  const sessionToken = randomBytes(32).toString('base64url');
  const sessionExpires = Math.min(Date.now() + 4 * 60 * 60 * 1000, STAGING_ACCESS_EXPIRES_AT + 4 * 60 * 60 * 1000);
  db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)')
    .run(sha256(sessionToken), STAGING_ACCESS_EMAIL, sessionExpires);
  if (res) res.setHeader('Set-Cookie', 'wfm_session=' + sessionToken + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=14400');
  return sessionToken;
}

function restoreStagingSession(req, res) {
  if (!hosted || process.env.NODE_ENV !== 'staging') return false;
  if (cookieValue(req, 'wfm_session')) return false;
  const rawRestore = cookieValue(req, 'wfm_staging_restore');
  if (!rawRestore || Date.now() > STAGING_ACCESS_EXPIRES_AT) return false;
  const restoreHash = sha256(rawRestore);
  const grant = STAGING_ACCESS_GRANTS.find(item => item.restore === true && secureEqualHex(restoreHash, item.tokenHash));
  if (!grant) return false;
  const path = requestPath(req);
  if (!path.startsWith('/api/') || path === '/api/login' || path === '/api/logout' || path === '/api/staging-access') return false;

  const db = new DatabaseSync(process.env.WFM_DB);
  try {
    const sessionToken = issueStagingSession(db, res);
    if (!sessionToken) return false;
    const existing = String(req.headers.cookie || '');
    req.headers.cookie = (existing ? existing + '; ' : '') + 'wfm_session=' + sessionToken;
    return true;
  } finally {
    try { db.close(); } catch {}
  }
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
    if (used && grant.restore !== true) {
      res.statusCode = 410;
      res.setHeader('Cache-Control', 'no-store');
      res.end('This staging access link has already been used.');
      return true;
    }

    try {
      db.exec('BEGIN IMMEDIATE;');
      const sessionToken = issueStagingSession(db, null);
      if (!sessionToken) {
        db.exec('ROLLBACK;');
        res.statusCode = 503;
        res.setHeader('Cache-Control', 'no-store');
        res.end('Staging account is unavailable.');
        return true;
      }
      if (!used) {
        db.prepare('INSERT INTO staging_access_grants(grant_key,used_at) VALUES(?,?)')
          .run(grant.key, new Date().toISOString());
      }
      db.exec('COMMIT;');

      res.statusCode = 302;
      res.setHeader('Cache-Control', 'no-store');
      const cookies = [
        'wfm_session=' + sessionToken + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=14400'
      ];
      if (grant.restore === true) {
        cookies.push('wfm_staging_restore=' + rawToken + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=14400');
      }
      res.setHeader('Set-Cookie', cookies);
      res.setHeader('Location', '/?vector_home=1');
      res.end();
      return true;
    } catch (error) {
      try { db.exec('ROLLBACK;'); } catch {}
      throw error;
    }
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

  if (!trainingDeliveryService && !trainingDeliveryServiceInitError && process.env.WFM_DB) {
    try { trainingDeliveryService = createTrainingDeliveryService({ dbPath: process.env.WFM_DB }); }
    catch (error) { trainingDeliveryServiceInitError = error; }
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

  if (!realtimeEventService && !realtimeEventServiceInitError && process.env.WFM_DB) {
    try {
      realtimeEventService = createRealtimeEventService({ dbPath: process.env.WFM_DB });
    } catch (error) {
      realtimeEventServiceInitError = error;
    }
  }

  if (!autopilotExecutionEngine && !autopilotExecutionEngineInitError && process.env.WFM_DB) {
    try { autopilotExecutionEngine=createAutopilotExecutionEngine({dbPath:process.env.WFM_DB,lifecycleAdapter:lifecycleGuard,publishEvent:realtimeEventService&&!realtimeEventServiceInitError?event=>realtimeEventService.publish(event):null}); } catch(error){ autopilotExecutionEngineInitError=error; }
  }

  if (!demandDecisionService && !demandDecisionServiceInitError && process.env.WFM_DB) {
    try {
      demandDecisionService = createDemandDecisionService({
        dbPath: process.env.WFM_DB,
        publishEvent: realtimeEventService && !realtimeEventServiceInitError ? event => realtimeEventService.publish(event) : null
      });
    } catch (error) {
      demandDecisionServiceInitError = error;
    }
  }

  if (!t9CustomerGuardian && !t9CustomerGuardianInitError && process.env.WFM_DB) {
    try { t9CustomerGuardian = createT9CustomerGuardian({ dbPath: process.env.WFM_DB }); }
    catch (error) { t9CustomerGuardianInitError = error; }
  }

  if (!reportingService && !reportingServiceInitError && process.env.WFM_DB) {
    try { reportingService = createVectorReportingService({ dbPath: process.env.WFM_DB }); }
    catch (error) { reportingServiceInitError = error; }
  }

  return originalCreateServer.call(http, async (req, res) => {
    const guardianStarted = process.hrtime.bigint();
    if (t9CustomerGuardian && !t9CustomerGuardianInitError && typeof res.once === 'function') {
      res.once('finish', () => {
        const elapsedMs = Number(process.hrtime.bigint() - guardianStarted) / 1e6;
        queueMicrotask(() => {
          try { t9CustomerGuardian.observeHttpCompletion({ req, statusCode: res.statusCode, durationMs: elapsedMs }); } catch {}
        });
      });
    }
    forceVectorUiFreshness(req, res);
    if (serveCanonicalVectorAsset(req, res)) return;
    if (await ownerAccessRecovery.handleRequest(req, res)) return;
    if (handleStagingAccess(req, res)) return;
    restoreStagingSession(req, res);

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

    if (trainingPath(req)) {
      if (await routeOverlay(trainingDeliveryService, trainingDeliveryServiceInitError, res, 'Training delivery', req)) return;
    }

    if (implementationPath(req)) {
      if (await routeOverlay(implementationEngine, implementationEngineInitError, res, 'Autonomous implementation', req)) return;
    }

    if (lifecyclePath(req)) {
      if (await routeOverlay(lifecycleGuard, lifecycleGuardInitError, res, 'Workforce lifecycle', req)) return;
    }

    if (autopilotPath(req)) { if (await routeOverlay(autopilotExecutionEngine, autopilotExecutionEngineInitError, res, 'Autopilot execution', req)) return; }

    if (realtimePath(req)) {
      if (await routeOverlay(realtimeEventService, realtimeEventServiceInitError, res, 'Realtime events', req)) return;
    }

    if (demandDecisionPath(req)) {
      if (await routeOverlay(demandDecisionService, demandDecisionServiceInitError, res, 'Decision intelligence', req)) return;
    }

    if (reportingPath(req)) {
      if (await routeOverlay(reportingService, reportingServiceInitError, res, 'Reporting', req)) return;
    }

    return listener(req, res);
  });
};

require('/app/server.cjs');

