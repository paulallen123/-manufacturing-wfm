'use strict';

const { timingSafeEqual } = require('node:crypto');
const { createAgentsApiAdapter } = require('./agents-api-adapter.cjs');

const BOOTSTRAP_PATH = '/api/implementation/autonomous/agents/bootstrap';
const INTERNAL_HEADER = 'x-wfm-implementation-internal';
const MAX_BODY_BYTES = 32 * 1024;

function text(value, max = 512) {
  return String(value ?? '').trim().slice(0, max);
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function requestPath(req) {
  return String(req?.url || '/').split('?')[0] || '/';
}

async function readJson(req) {
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
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch {
    const error = new Error('Invalid JSON body.');
    error.statusCode = 400;
    throw error;
  }
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

function createAgentsApiBootstrapRoute(options = {}) {
  const internalToken = options.internalToken || process.env.WFM_IMPLEMENTATION_INTERNAL_TOKEN || '';
  const candidateSha = text(options.candidateSha || process.env.RAILWAY_GIT_COMMIT_SHA || process.env.WFM_CANDIDATE_SHA, 64).toLowerCase();
  const deploymentId = text(options.deploymentId || process.env.RAILWAY_DEPLOYMENT_ID, 128);
  const statusForTenant = typeof options.statusForTenant === 'function' ? options.statusForTenant : (() => null);
  const adapter = createAgentsApiAdapter({
    dbPath: options.dbPath || process.env.WFM_DB,
    apiKey: options.apiKey || process.env.OPENAI_API_KEY,
    candidateSha,
    deploymentId,
    model: options.model || process.env.WFM_AGENTS_MODEL || 'gpt-6-sol',
    fetchImpl: options.fetchImpl
  });

  async function bootstrap({ runId, tenant }) {
    runId = text(runId, 128);
    tenant = text(tenant, 128);
    if (!runId || !tenant) {
      const error = new Error('runId and tenant are required.');
      error.statusCode = 400;
      throw error;
    }

    const status = statusForTenant(tenant);
    const requirements = Array.isArray(status?.requirements)
      ? status.requirements.map(item => ({ key: text(item.key, 100), satisfied: item.satisfied === true }))
      : [];
    const initialInput = [
      'READ-ONLY VECTOR CUSTOMER-PROOF BOOTSTRAP.',
      'Canonical binding: ' + JSON.stringify({ candidateSha, deploymentId, runId, tenant }) + '.',
      'Current readiness: ' + JSON.stringify({
        state: status?.state || null,
        operationalReady: status?.operationalReady === true,
        requirements
      }) + '.',
      'Acknowledge the binding and current blockers only. Do not call tools, mutate VECTOR, invent policy authority, or claim customer-ready.'
    ].join(' ');
    const session = await adapter.ensureSession({ runId, tenant, initialInput });
    return {
      agentsApi: session,
      binding: { candidateSha, deploymentId, runId, tenant },
      operationalReady: status?.operationalReady === true
    };
  }

  async function handleRequest(req, res) {
    if (requestPath(req) !== BOOTSTRAP_PATH) return false;
    if (String(req?.method || '').toUpperCase() !== 'POST') {
      res.setHeader('Allow', 'POST');
      return writeJson(res, 405, { error: 'Method Not Allowed' });
    }
    if (!internalToken || !secureEqual(req?.headers?.[INTERNAL_HEADER], internalToken)) {
      return writeJson(res, 403, { error: 'Trusted implementation worker required.' });
    }

    let body;
    try { body = await readJson(req); }
    catch (error) { return writeJson(res, Number(error.statusCode || 400), { error: error.message || 'Invalid request.' }); }

    try {
      return writeJson(res, 200, await bootstrap(body));
    } catch (error) {
      const statusCode = Number(error?.statusCode || 503);
      return writeJson(res, statusCode >= 400 && statusCode <= 599 ? statusCode : 503, {
        error: error?.code || error?.message || 'Agents API bootstrap failed safely.'
      });
    }
  }

  return {
    bootstrap,
    handleRequest,
    close() { adapter.close(); }
  };
}

module.exports = { createAgentsApiBootstrapRoute, BOOTSTRAP_PATH };
