'use strict';

const { timingSafeEqual } = require('node:crypto');
const { createAgentsApiAdapter, ACTIVE_READONLY_PROFILE } = require('./agents-api-adapter.cjs');

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

function sanitizedStatus(status) {
  const requirements = Array.isArray(status?.requirements) ? status.requirements.map(item => ({
    key: text(item.key, 100),
    satisfied: item.satisfied === true,
    status: text(item.status, 40) || null,
    source: text(item.source, 100) || null
  })) : [];
  const jobs = Array.isArray(status?.workPlan?.jobs) ? status.workPlan.jobs.map(item => ({
    requirementKey: text(item.requirementKey, 100),
    status: text(item.status, 40) || null,
    blockedReason: text(item.blockedReason, 160) || null,
    attempts: Number(item.attempts || 0)
  })) : [];
  const decisions = Array.isArray(status?.blockingDecisions) ? status.blockingDecisions
    .filter(item => String(item.status || '').toUpperCase() === 'PENDING')
    .map(item => ({
      key: text(item.key, 120),
      status: 'PENDING',
      risk: text(item.risk, 40) || null
    })) : [];
  return {
    state: text(status?.state, 80) || null,
    operationalReady: status?.operationalReady === true,
    requirements,
    jobs,
    blockingDecisions: decisions
  };
}

function proofGaps(status) {
  const safe = sanitizedStatus(status);
  return {
    operationalReady: safe.operationalReady,
    unsatisfiedRequirements: safe.requirements.filter(item => !item.satisfied).map(item => item.key),
    runnable: Array.isArray(status?.workPlan?.runnable) ? status.workPlan.runnable.map(item => text(item, 100)).filter(Boolean) : [],
    blocked: Array.isArray(status?.workPlan?.blocked) ? status.workPlan.blocked.map(item => ({
      requirementKey: text(item.requirementKey, 100),
      reason: text(item.reason, 160) || null
    })) : [],
    failedClosed: Array.isArray(status?.workPlan?.failedClosed) ? status.workPlan.failedClosed.map(item => text(item, 100)).filter(Boolean) : [],
    pendingDecisions: safe.blockingDecisions.map(item => ({ key: item.key, risk: item.risk })),
    writeEnabled: false,
    customerProof: safe.operationalReady ? 'READINESS_REPORTED_NOT_INDEPENDENTLY_PROVEN' : 'NOT_READY'
  };
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
    fetchImpl: options.fetchImpl,
    pollIntervalMs: options.pollIntervalMs,
    maxPolls: options.maxPolls
  });

  async function bootstrap({ runId, tenant }) {
    runId = text(runId, 128);
    tenant = text(tenant, 128);
    if (!runId || !tenant) {
      const error = new Error('runId and tenant are required.');
      error.statusCode = 400;
      throw error;
    }

    function currentStatus() {
      const status = statusForTenant(tenant);
      if (!status || status.runId !== runId || status.tenant !== tenant) {
        const error = new Error('VECTOR_AGENTS_CURRENT_RUN_MISMATCH');
        error.code = 'VECTOR_AGENTS_CURRENT_RUN_MISMATCH';
        error.statusCode = 409;
        throw error;
      }
      return status;
    }
    currentStatus();

    const initialInput = [
      'ACTIVE READ-ONLY VECTOR CUSTOMER-PROOF CONTROL.',
      'Canonical binding: ' + JSON.stringify({ candidateSha, deploymentId, runId, tenant }) + '.',
      'Use all three read-only VECTOR functions before answering.',
      'Report current binding alignment, readiness blockers, proof gaps, drift and the next safe actions.',
      'Do not mutate VECTOR, invent policy or payroll authority, submit evidence, deploy, create alternate implementations or claim customer-ready.'
    ].join(' ');
    const session = await adapter.ensureSession({ runId, tenant, initialInput });
    currentStatus();

    const toolHandler = async name => {
      const status = currentStatus();
      if (name === 'get_vector_binding') {
        return {
          candidateSha, deploymentId, runId, tenant,
          profile: ACTIVE_READONLY_PROFILE,
          writeEnabled: false,
          environment: 'none'
        };
      }
      if (name === 'get_implementation_status') return sanitizedStatus(status);
      if (name === 'get_customer_proof_gaps') return proofGaps(status);
      const error = new Error('VECTOR_AGENTS_UNSUPPORTED_READONLY_TOOL');
      error.statusCode = 409;
      throw error;
    };

    const analysis = await adapter.analyzeSession({
      sessionId: session.sessionId,
      runId,
      tenant,
      startTurn: true,
      assertCurrentIdentity: currentStatus,
      toolHandler
    });
    const finalStatus = currentStatus();
    console.log('VECTOR_AGENTS_ANALYSIS=' + JSON.stringify({
      status: analysis.status,
      sessionId: session.sessionId,
      profile: ACTIVE_READONLY_PROFILE,
      toolCalls: analysis.toolCalls,
      writeEnabled: false,
      report: analysis.report ? analysis.report.slice(0, 4000) : null
    }));

    return {
      agentsApi: session,
      profile: ACTIVE_READONLY_PROFILE,
      analysis,
      binding: { candidateSha, deploymentId, runId, tenant },
      operationalReady: finalStatus.operationalReady === true,
      writeEnabled: false
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

module.exports = {
  createAgentsApiBootstrapRoute,
  BOOTSTRAP_PATH,
  sanitizedStatus,
  proofGaps
};
