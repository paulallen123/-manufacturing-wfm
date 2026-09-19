'use strict';

const http = require('node:http');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const {
  CONTRACT_VERSION,
  produceTimeReviewActionEvidence
} = require('./workflow-action-evidence-contract.cjs');

const PREFIX = '/api/workflow-actions';
const TIME_REVIEW_PATH = PREFIX + '/time-review';
const SOURCE_TIME_REVIEW_PATH = '/api/time-review';
const MAX_SOURCE_BYTES = 512 * 1024;
const SOURCE_TIMEOUT_MS = 3000;

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function compact(value, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

function cookieSessionToken(req) {
  const raw = String(req?.headers?.cookie || '');
  for (const part of raw.split(';')) {
    const item = part.trim();
    if (item.startsWith('wfm_session=')) return item.slice('wfm_session='.length);
  }
  return '';
}

function requestPath(req) {
  return String(req?.url || '/').split('?')[0] || '/';
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

function sourceError(message) {
  const error = new Error(message);
  error.statusCode = 502;
  return error;
}

function parseSourceJson(statusCode, chunks) {
  if (Number(statusCode) !== 200) return { status: Number(statusCode) || 502, body: null };
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('object required');
    return { status: 200, body };
  } catch {
    throw sourceError('Authoritative Time Review returned invalid JSON.');
  }
}

function fetchAuthoritativeTimeReview(req, options = {}) {
  const timeoutMs = Number(options.timeoutMs || SOURCE_TIMEOUT_MS);
  const maxBytes = Number(options.maxBytes || MAX_SOURCE_BYTES);
  const port = Number(options.port || req?.socket?.localPort || process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.reject(sourceError('Authoritative Time Review source port is unavailable.'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    const sourceReq = http.request({
      host: '127.0.0.1',
      port,
      path: SOURCE_TIME_REVIEW_PATH,
      method: 'GET',
      headers: {
        accept: 'application/json',
        cookie: String(req?.headers?.cookie || ''),
        host: compact(req?.headers?.host, 255) || 'localhost',
        'user-agent': 'wfm-workflow-action-evidence-bridge/1'
      }
    }, sourceRes => {
      let size = 0;
      const chunks = [];
      sourceRes.on('data', chunk => {
        if (settled) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > maxBytes) {
          sourceReq.destroy(sourceError('Authoritative Time Review response exceeded the safe read limit.'));
          return;
        }
        chunks.push(buffer);
      });
      sourceRes.on('end', () => {
        if (settled) return;
        try {
          finish(resolve, parseSourceJson(sourceRes.statusCode, chunks));
        } catch (error) {
          finish(reject, error);
        }
      });
    });
    sourceReq.setTimeout(timeoutMs, () => {
      sourceReq.destroy(sourceError('Authoritative Time Review source timed out.'));
    });
    sourceReq.on('error', error => {
      finish(reject, error?.statusCode ? error : sourceError('Authoritative Time Review source is unavailable.'));
    });
    sourceReq.end();
  });
}

function createWorkflowActionEvidenceBridge(options = {}) {
  const dbPath = options.dbPath || process.env.WFM_DB;
  if (!dbPath) throw new Error('Workflow action evidence bridge requires WFM_DB.');
  const db = new DatabaseSync(dbPath);
  const sourceProvider = typeof options.timeReviewSourceProvider === 'function'
    ? options.timeReviewSourceProvider
    : (req) => fetchAuthoritativeTimeReview(req, options.source || {});
  const auth = db.prepare(`SELECT u.email,u.tenant,u.role
    FROM sessions s JOIN users u ON u.email=s.email
    WHERE s.token_hash=? AND s.expires>?`);

  function context(req) {
    const token = cookieSessionToken(req);
    return token ? auth.get(sha256(token), Date.now()) || null : null;
  }

  function requireDecisionRole(req, res) {
    const ctx = context(req);
    if (!ctx) {
      writeJson(res, 401, { error: 'Sign in is required.' });
      return null;
    }
    if (String(ctx.role || '').toLowerCase() === 'employee') {
      writeJson(res, 403, { error: 'Workflow action evidence requires an authorised manager or administrator.' });
      return null;
    }
    return ctx;
  }

  async function timeReview(req, res) {
    const ctx = requireDecisionRole(req, res);
    if (!ctx) return true;

    let source;
    try {
      source = await sourceProvider(req, Object.freeze({
        tenant: String(ctx.tenant),
        role: String(ctx.role),
        email: String(ctx.email)
      }));
    } catch (error) {
      return writeJson(res, Number(error?.statusCode || 502), {
        error: 'Authoritative Time Review evidence is unavailable.'
      });
    }

    if (!source || Number(source.status) !== 200 || !source.body || typeof source.body !== 'object' || Array.isArray(source.body)) {
      return writeJson(res, 502, { error: 'Authoritative Time Review evidence is unavailable.' });
    }

    const report = source.body;
    const sourceTenant = compact(report.tenant ?? report.tenantId, 120);
    if (sourceTenant && sourceTenant !== String(ctx.tenant)) {
      return writeJson(res, 502, { error: 'Authoritative Time Review scope did not match the signed-in customer.' });
    }

    const allowedTeamIds = [...new Set((Array.isArray(report.teams) ? report.teams : [])
      .map(team => compact(team?.id ?? team?.teamId, 160))
      .filter(Boolean))];
    const items = produceTimeReviewActionEvidence(report, { allowedTeamIds });

    return writeJson(res, 200, {
      contractVersion: CONTRACT_VERSION,
      workflow: 'time-review',
      source: SOURCE_TIME_REVIEW_PATH,
      items
    });
  }

  async function handleRequest(req, res) {
    const path = requestPath(req);
    if (!path.startsWith(PREFIX)) return false;
    if (String(req.method || 'GET').toUpperCase() !== 'GET') {
      return writeJson(res, 405, { error: 'Workflow action evidence is read-only.' });
    }
    if (path === TIME_REVIEW_PATH) return await timeReview(req, res);
    return writeJson(res, 404, { error: 'Workflow action evidence endpoint not found.' });
  }

  return Object.freeze({
    handleRequest,
    close() { try { db.close(); } catch {} }
  });
}

module.exports = Object.freeze({
  PREFIX,
  TIME_REVIEW_PATH,
  SOURCE_TIME_REVIEW_PATH,
  cookieSessionToken,
  fetchAuthoritativeTimeReview,
  createWorkflowActionEvidenceBridge
});
