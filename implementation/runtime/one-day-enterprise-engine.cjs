'use strict';

const { Readable } = require('node:stream');
const { timingSafeEqual } = require('node:crypto');
const core = require('./one-day-enterprise-engine-core.cjs');
const { validateStrictReadinessEvidence } = require('./readiness-evidence-contract.cjs');
const { createAgentsApiBootstrapRoute, BOOTSTRAP_PATH } = require('./agents-api-bootstrap-route.cjs');

const EVIDENCE_PATH = '/api/implementation/autonomous/evidence';
const INTERNAL_HEADER = 'x-wfm-implementation-internal';
const MAX_BODY_BYTES = 256 * 1024;

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function requestPath(req) {
  return String(req?.url || '/').split('?')[0] || '/';
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function replayRequest(req, body) {
  const replay = Readable.from(body.length ? [body] : []);
  replay.method = req.method;
  replay.url = req.url;
  replay.headers = { ...(req.headers || {}) };
  return replay;
}

function writeJson(res, status, body) {
  if (res.headersSent || res.writableEnded) return true;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
  return true;
}

function createOneDayEnterpriseEngine(options = {}) {
  const engine = core.createOneDayEnterpriseEngine(options);
  const strictEvidence = options.strictEvidence === true || process.env.WFM_HOSTED_STAGING === 'true';
  const agentsApiEnabled = options.agentsApiEnabled === true || (process.env.WFM_AGENTS_API_ENABLED === 'true' && process.env.NODE_ENV === 'staging');
  const internalToken = options.internalToken || process.env.WFM_IMPLEMENTATION_INTERNAL_TOKEN || '';
  let agentsRoute = null;
  let agentsInitError = null;

  if (agentsApiEnabled) {
    try {
      agentsRoute = createAgentsApiBootstrapRoute({
        dbPath: options.dbPath || process.env.WFM_DB,
        internalToken,
        candidateSha: options.candidateSha || process.env.RAILWAY_GIT_COMMIT_SHA || process.env.WFM_CANDIDATE_SHA,
        deploymentId: options.deploymentId || process.env.RAILWAY_DEPLOYMENT_ID,
        apiKey: options.openAIApiKey || process.env.OPENAI_API_KEY,
        model: options.agentsModel || process.env.WFM_AGENTS_MODEL || 'gpt-6-sol',
        fetchImpl: options.agentsFetchImpl,
        statusForTenant: tenant => engine.statusForTenant(tenant)
      });
    } catch (error) {
      agentsInitError = error;
      console.error('WFM_AGENTS_INIT=BLOCKED code=' + String(error?.code || error?.message || 'INITIALIZATION_FAILED').replace(/\s+/g, '_').slice(0, 160));
    }
  }

  const autoRunId = String(options.agentsAutoBootstrapRunId || process.env.WFM_AGENTS_BOOTSTRAP_RUN_ID || '').trim();
  const autoTenant = String(options.agentsAutoBootstrapTenant || process.env.WFM_AGENTS_BOOTSTRAP_TENANT || '').trim();
  if (agentsRoute && autoRunId && autoTenant) {
    queueMicrotask(() => {
      agentsRoute.bootstrap({ runId: autoRunId, tenant: autoTenant })
        .then(result => console.log('VECTOR_AGENTS_SESSION=' + JSON.stringify({
          status: 'PASS',
          sessionId: result.agentsApi.sessionId,
          reused: result.agentsApi.reused,
          binding: result.binding
        })))
        .catch(error => console.error('VECTOR_AGENTS_BOOTSTRAP=' + JSON.stringify({
          status: 'BLOCKED',
          code: String(error?.code || error?.message || 'BOOTSTRAP_FAILED').slice(0, 160)
        })));
    });
  }

  if (!strictEvidence && !agentsApiEnabled) return engine;

  return {
    ...engine,
    async handleRequest(req, res) {
      if (requestPath(req) === BOOTSTRAP_PATH) {
        if (agentsInitError || !agentsRoute) {
          return writeJson(res, 503, { error: 'Agents API control plane is unavailable.' });
        }
        return agentsRoute.handleRequest(req, res);
      }

      if (!strictEvidence || String(req?.method || '').toUpperCase() !== 'POST' || requestPath(req) !== EVIDENCE_PATH) {
        return engine.handleRequest(req, res);
      }

      let raw;
      try {
        raw = await readBody(req);
      } catch (error) {
        return writeJson(res, Number(error.statusCode || 400), { error: error.message || 'Invalid evidence payload.' });
      }
      const replay = replayRequest(req, raw);

      if (!internalToken || !secureEqual(req?.headers?.[INTERNAL_HEADER], internalToken)) {
        return engine.handleRequest(replay, res);
      }

      let body;
      try {
        body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
      } catch {
        return engine.handleRequest(replay, res);
      }

      const error = validateStrictReadinessEvidence(body.kind, body.status, body.detail);
      if (error) {
        return writeJson(res, 409, {
          error,
          readinessEvidenceAccepted: false,
          kind: String(body.kind || '')
        });
      }

      return engine.handleRequest(replay, res);
    },
    close() {
      try { agentsRoute?.close(); } catch {}
      return engine.close?.();
    }
  };
}

module.exports = {
  ...core,
  createOneDayEnterpriseEngine,
  validateStrictReadinessEvidence
};
