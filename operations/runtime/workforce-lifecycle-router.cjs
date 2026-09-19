'use strict';

const https = require('node:https');
const core = require('./workforce-lifecycle-core.cjs');
const {
  PREFIX: ACTION_EVIDENCE_PREFIX,
  createWorkflowActionEvidenceBridge
} = require('./workflow-action-evidence-bridge.cjs');

const SOURCE_TIME_REVIEW_PATH = '/api/time-review';
const SOURCE_TIMEOUT_MS = 3000;
const MAX_SOURCE_BYTES = 512 * 1024;

function requestPath(req) {
  return String(req?.url || '/').split('?')[0] || '/';
}

function sourceError(message) {
  const error = new Error(message);
  error.statusCode = 502;
  return error;
}

function createTrustedHostedTimeReviewSourceProvider(publicOrigin = process.env.WFM_PUBLIC_ORIGIN) {
  const raw = String(publicOrigin || '').trim();
  if (!raw) return null;

  let origin;
  try {
    origin = new URL(raw);
  } catch {
    return async () => { throw sourceError('Configured public origin is invalid.'); };
  }

  const valid = origin.protocol === 'https:' &&
    !origin.username && !origin.password &&
    (origin.pathname === '/' || origin.pathname === '') &&
    !origin.search && !origin.hash &&
    Boolean(origin.hostname);
  if (!valid) {
    return async () => { throw sourceError('Configured public origin is not a trusted HTTPS origin.'); };
  }

  return async function trustedHostedTimeReview(req) {
    const requestHost = String(req?.headers?.host || '').trim().toLowerCase();
    if (!requestHost || requestHost !== origin.host.toLowerCase()) {
      throw sourceError('Authoritative Time Review host binding failed.');
    }

    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        fn(value);
      };
      const sourceReq = https.request({
        protocol: 'https:',
        hostname: origin.hostname,
        port: origin.port || 443,
        path: SOURCE_TIME_REVIEW_PATH,
        method: 'GET',
        headers: {
          accept: 'application/json',
          cookie: String(req?.headers?.cookie || ''),
          host: origin.host,
          'user-agent': 'wfm-workflow-action-evidence-authoritative-source/1'
        }
      }, sourceRes => {
        let size = 0;
        const chunks = [];
        sourceRes.on('data', chunk => {
          if (settled) return;
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.length;
          if (size > MAX_SOURCE_BYTES) {
            sourceReq.destroy(sourceError('Authoritative Time Review response exceeded the safe read limit.'));
            return;
          }
          chunks.push(buffer);
        });
        sourceRes.on('end', () => {
          if (settled) return;
          const status = Number(sourceRes.statusCode || 502);
          if (status !== 200) {
            finish(resolve, { status, body: null });
            return;
          }
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!body || typeof body !== 'object' || Array.isArray(body)) {
              throw new Error('object required');
            }
            finish(resolve, { status: 200, body });
          } catch {
            finish(reject, sourceError('Authoritative Time Review returned invalid JSON.'));
          }
        });
      });
      sourceReq.setTimeout(SOURCE_TIMEOUT_MS, () => {
        sourceReq.destroy(sourceError('Authoritative Time Review source timed out.'));
      });
      sourceReq.on('error', error => {
        finish(reject, error?.statusCode ? error : sourceError('Authoritative Time Review source is unavailable.'));
      });
      sourceReq.end();
    });
  };
}

function createWorkforceLifecycleGuard(options = {}) {
  const dbPath = options.dbPath || process.env.WFM_DB;
  const lifecycle = core.createWorkforceLifecycleGuard(options);
  const configuredSourceProvider = typeof options.timeReviewSourceProvider === 'function'
    ? options.timeReviewSourceProvider
    : createTrustedHostedTimeReviewSourceProvider(options.publicOrigin);
  const actionEvidence = createWorkflowActionEvidenceBridge({
    dbPath,
    ...(configuredSourceProvider ? { timeReviewSourceProvider: configuredSourceProvider } : {})
  });

  return Object.freeze({
    async handleRequest(req, res) {
      if (requestPath(req).startsWith(ACTION_EVIDENCE_PREFIX)) {
        return await actionEvidence.handleRequest(req, res);
      }
      return await lifecycle.handleRequest(req, res);
    },
    close() {
      try { actionEvidence.close(); } catch {}
      try { lifecycle.close(); } catch {}
    }
  });
}

module.exports = Object.freeze({
  ...core,
  createTrustedHostedTimeReviewSourceProvider,
  createWorkforceLifecycleGuard
});
