import crypto from 'node:crypto';
import { LANE_DEFINITIONS } from './policy.js';

const LANE_ENV = Object.freeze({
  'github-actions': {
    url: 'VECTOR_DISPATCH_GITHUB_URL',
    secret: 'VECTOR_DISPATCH_GITHUB_SECRET',
  },
  'railway-proof-workers': {
    url: 'VECTOR_DISPATCH_RAILWAY_URL',
    secret: 'VECTOR_DISPATCH_RAILWAY_SECRET',
  },
  'northstar-railway': {
    url: 'VECTOR_DISPATCH_NORTHSTAR_URL',
    secret: 'VECTOR_DISPATCH_NORTHSTAR_SECRET',
  },
  'non-railway-verifier': {
    url: 'VECTOR_DISPATCH_EXTERNAL_URL',
    secret: 'VECTOR_DISPATCH_EXTERNAL_SECRET',
  },
});

const ALLOWED_TASK_KINDS = new Set(['proof', 'repair_regression']);

function requireText(value, code) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(code);
  }
  return value.trim();
}

function validateTask(task) {
  if (!task || typeof task !== 'object') throw new Error('DISPATCH_TASK_MISSING');
  requireText(task.taskId, 'DISPATCH_TASK_ID_MISSING');
  requireText(task.idempotencyKey, 'DISPATCH_IDEMPOTENCY_KEY_MISSING');
  requireText(task.candidateToken, 'DISPATCH_CANDIDATE_TOKEN_MISSING');
  requireText(task.candidateSha, 'DISPATCH_CANDIDATE_SHA_MISSING');
  requireText(task.targetDeploymentId, 'DISPATCH_DEPLOYMENT_ID_MISSING');
  requireText(task.targetRuntimeSha, 'DISPATCH_RUNTIME_SHA_MISSING');
  requireText(task.gateId, 'DISPATCH_GATE_ID_MISSING');
  requireText(task.laneId, 'DISPATCH_LANE_ID_MISSING');
  requireText(task.provider, 'DISPATCH_PROVIDER_MISSING');
  requireText(task.failureDomainId, 'DISPATCH_FAILURE_DOMAIN_MISSING');

  if (!ALLOWED_TASK_KINDS.has(task.taskKind)) {
    throw new Error('DISPATCH_TASK_KIND_NOT_AUTHORISED');
  }

  const lane = LANE_DEFINITIONS[task.laneId];
  if (!lane?.enabled) throw new Error('DISPATCH_LANE_NOT_ADMITTED');
  if (lane.provider !== task.provider || lane.failureDomainId !== task.failureDomainId) {
    throw new Error('DISPATCH_LANE_BINDING_MISMATCH');
  }

  const candidate = task.exactCandidate;
  if (!candidate || typeof candidate !== 'object') throw new Error('DISPATCH_EXACT_CANDIDATE_MISSING');
  if (candidate.claimBoundary !== 'customer-proof-staging') {
    throw new Error('DISPATCH_CLAIM_BOUNDARY_NOT_AUTHORISED');
  }
  if (
    candidate.commitSha !== task.candidateSha
    || candidate.deploymentId !== task.targetDeploymentId
    || candidate.runtimeSha !== task.targetRuntimeSha
  ) {
    throw new Error('DISPATCH_EXACT_CANDIDATE_DRIFT');
  }

  return { lane, candidate };
}

export function resolveDispatchConfig(task, env = process.env) {
  validateTask(task);
  const config = LANE_ENV[task.laneId];
  if (!config) throw new Error('DISPATCH_LANE_CONFIG_MISSING');

  const mode = String(env.VECTOR_CONTROL_PLANE_DISPATCH_MODE || 'SHADOW').trim();
  if (mode !== 'LIVE_PROOF') {
    return { mode: 'SHADOW', laneId: task.laneId };
  }

  const endpointText = requireText(env[config.url], `DISPATCH_ENDPOINT_MISSING:${config.url}`);
  const secret = requireText(env[config.secret], `DISPATCH_SECRET_MISSING:${config.secret}`);

  let endpoint;
  try {
    endpoint = new URL(endpointText);
  } catch {
    throw new Error('DISPATCH_ENDPOINT_INVALID');
  }
  if (endpoint.protocol !== 'https:') throw new Error('DISPATCH_ENDPOINT_REQUIRES_HTTPS');
  if (endpoint.username || endpoint.password) throw new Error('DISPATCH_ENDPOINT_EMBEDDED_CREDENTIALS_FORBIDDEN');

  return {
    mode,
    endpoint: endpoint.toString(),
    secret,
    laneId: task.laneId,
  };
}

export function createDispatchEnvelope(task) {
  validateTask(task);
  return {
    schemaVersion: 1,
    eventType: 'VECTOR_PROOF_TASK',
    task: {
      taskId: task.taskId,
      idempotencyKey: task.idempotencyKey,
      candidateToken: task.candidateToken,
      candidateSha: task.candidateSha,
      gateId: task.gateId,
      taskKind: task.taskKind,
      attempt: task.attempt,
      laneId: task.laneId,
      provider: task.provider,
      failureDomainId: task.failureDomainId,
      targetDeploymentId: task.targetDeploymentId,
      targetRuntimeSha: task.targetRuntimeSha,
      retentionToken: task.retentionToken,
      exactCandidate: task.exactCandidate,
    },
  };
}

export async function dispatchProofTask(
  task,
  {
    env = process.env,
    fetchImpl = globalThis.fetch,
    now = () => new Date(),
  } = {},
) {
  const config = resolveDispatchConfig(task, env);
  if (config.mode !== 'LIVE_PROOF') {
    return {
      status: 'SHADOW_WOULD_DISPATCH',
      taskId: task.taskId,
      laneId: task.laneId,
      gateId: task.gateId,
    };
  }
  if (typeof fetchImpl !== 'function') throw new Error('DISPATCH_FETCH_UNAVAILABLE');

  const envelope = createDispatchEnvelope(task);
  const body = JSON.stringify(envelope);
  const timestamp = now().toISOString();
  const signature = crypto
    .createHmac('sha256', config.secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  const response = await fetchImpl(config.endpoint, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'vector-durable-control-plane/1',
      'x-vector-dispatch-timestamp': timestamp,
      'x-vector-dispatch-signature': signature,
      'x-vector-idempotency-key': task.idempotencyKey,
      'x-vector-candidate-token': task.candidateToken,
    },
    body,
    signal: AbortSignal.timeout(15000),
  });

  if (!response || !response.ok) {
    const status = response?.status ?? 'NO_RESPONSE';
    throw new Error(`DISPATCH_PROVIDER_REJECTED:${status}`);
  }

  return {
    status: 'DISPATCHED',
    taskId: task.taskId,
    laneId: task.laneId,
    gateId: task.gateId,
    providerStatus: response.status,
  };
}
