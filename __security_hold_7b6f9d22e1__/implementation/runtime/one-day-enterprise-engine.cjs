'use strict';

const { Readable } = require('node:stream');
const { timingSafeEqual } = require('node:crypto');
const core = require('./one-day-enterprise-engine-core.cjs');
const { validateStrictReadinessEvidence } = require('./readiness-evidence-contract.cjs');

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
  if (!strictEvidence) return engine;

  const internalToken = options.internalToken || process.env.WFM_IMPLEMENTATION_INTERNAL_TOKEN || '';

  return {
    ...engine,
    async handleRequest(req, res) {
      if (String(req?.method || '').toUpperCase() !== 'POST' || requestPath(req) !== EVIDENCE_PATH) {
        return engine.handleRequest(req, res);
      }

      let raw;
      try {
        raw = await readBody(req);
      } catch (error) {
        return writeJson(res, Number(error.statusCode || 400), { error: error.message || 'Invalid evidence payload.' });
      }
      const replay = replayRequest(req, raw);

      // Preserve the core engine's authentication response and avoid exposing
      // readiness-contract details to an unauthorised caller.
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
    }
  };
}

module.exports = {
  ...core,
  createOneDayEnterpriseEngine,
  validateStrictReadinessEvidence
};
