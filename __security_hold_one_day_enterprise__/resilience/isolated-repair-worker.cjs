'use strict';

const { createHash } = require('node:crypto');
const path = require('node:path');

const SAFE_ENV = Object.freeze({
  NODE_ENV: 'test',
  WFM_REPAIR_WORKER: '1',
});

function sha(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function deny(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

function validDigest(value) {
  return /^[a-f0-9]{64}$/.test(value || '');
}

function relativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 240) deny('WFM_REPAIR_WORKER_PATH', 'invalid path');
  const slash = value.replace(/\\/g, '/');
  if (slash.startsWith('/') || /^[a-zA-Z]:\//.test(slash)) deny('WFM_REPAIR_WORKER_PATH', 'absolute paths denied');
  const clean = path.posix.normalize(slash);
  if (clean === '.' || clean === '..' || clean.startsWith('../')) deny('WFM_REPAIR_WORKER_PATH', 'path escape denied');
  return clean;
}

function verifyIsolation(executor) {
  if (!executor || typeof executor.capabilities !== 'function' || typeof executor.run !== 'function') {
    deny('WFM_REPAIR_ISOLATION_UNAVAILABLE', 'trusted isolated executor unavailable');
  }
  const c = executor.capabilities();
  const required = {
    isolationEnforced: true,
    networkMode: 'none',
    environmentMode: 'replace',
    secretsMounted: false,
    reusableCredentialsVisible: false,
    productionMounts: false,
    customerDataMounted: false,
    writableOutsideWorktree: false,
    processEscapeDenied: true,
    incrementalCostZero: true,
  };
  for (const [key, expected] of Object.entries(required)) {
    if (c?.[key] !== expected) deny('WFM_REPAIR_ISOLATION_UNSAFE', `isolated executor capability rejected: ${key}`);
  }
  if (c.filesystemMode !== 'isolated-worktree') deny('WFM_REPAIR_ISOLATION_UNSAFE', 'isolated worktree required');
  return Object.freeze({ ...c });
}

function createIsolatedRepairWorker({ factory, executor, maxWorkerAttempts = 2, timeoutMs = 120000 } = {}) {
  if (!factory || typeof factory.snapshot !== 'function' || typeof factory.proposeCandidate !== 'function' || typeof factory.containIncident !== 'function') {
    deny('WFM_REPAIR_WORKER_INPUT', 'repair factory with containment is required');
  }
  if (!Number.isInteger(maxWorkerAttempts) || maxWorkerAttempts < 1 || maxWorkerAttempts > 5) deny('WFM_REPAIR_WORKER_INPUT', 'invalid worker attempt budget');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) deny('WFM_REPAIR_WORKER_INPUT', 'invalid worker timeout');

  const caps = verifyIsolation(executor);

  function contain(incidentId, tenant, reason, workerId) {
    return factory.containIncident({ incidentId, tenant, reason, actorId: workerId });
  }

  function run({ incidentId, tenant, workerId, sourceSnapshotDigest, repairIntentDigest, allowedChangedPaths = [] }) {
    if (!incidentId || !tenant || !workerId || workerId.length > 128) deny('WFM_REPAIR_WORKER_INPUT', 'invalid worker scope');
    if (!validDigest(sourceSnapshotDigest) || !validDigest(repairIntentDigest)) deny('WFM_REPAIR_WORKER_INPUT', 'digest-only repair inputs required');

    const incident = factory.snapshot(incidentId);
    if (!incident || incident.tenant !== tenant) deny('WFM_REPAIR_SCOPE', 'incident scope');
    if (!incident.reproducer || !['reproduced', 'candidate-rejected'].includes(incident.state)) deny('WFM_REPAIR_WORKER_STATE', 'incident is not ready for isolated repair');
    if (!Array.isArray(allowedChangedPaths) || allowedChangedPaths.length === 0) deny('WFM_REPAIR_WORKER_INPUT', 'bounded writable paths required');

    const allowed = [...new Set(allowedChangedPaths.map(relativePath))].sort();
    if (allowed.some((p) => factory.protectedPaths.includes(p))) deny('WFM_REPAIR_PROTECTED_PATH', 'repair worker cannot receive protected authority paths');

    const baseJob = {
      schemaVersion: 1,
      incidentId,
      tenantDigest: sha(tenant),
      workerId,
      sourceSnapshotDigest,
      repairIntentDigest,
      evidenceDigest: incident.evidenceDigest,
      failingTestDigest: incident.reproducer.failingTestDigest,
      observedFailureDigest: incident.reproducer.observedFailureDigest,
      allowedChangedPaths: allowed,
      env: { ...SAFE_ENV },
      timeoutMs,
      networkMode: 'none',
      secrets: [],
      productionAuthority: false,
      customerMutation: false,
      runtimeDependencyInstallAllowed: false,
      executorCapabilityDigest: sha(caps),
    };

    for (let attempt = 1; attempt <= maxWorkerAttempts; attempt++) {
      const job = Object.freeze({ ...baseJob, attempt });
      let result;
      try {
        result = executor.run(structuredClone(job));
      } catch (_error) {
        if (attempt === maxWorkerAttempts) {
          const rec = contain(incidentId, tenant, 'worker-executor-failure', workerId);
          return { status: 'contained', reason: rec.containment.reason, attempts: attempt, containmentDigest: rec.containment.containmentDigest };
        }
        continue;
      }

      if (!result || result.status !== 'candidate') {
        if (attempt === maxWorkerAttempts) {
          const reason = result?.status === 'timeout' ? 'worker-timeout-budget-exhausted' : 'worker-no-candidate-budget-exhausted';
          const rec = contain(incidentId, tenant, reason, workerId);
          return { status: 'contained', reason, attempts: attempt, containmentDigest: rec.containment.containmentDigest };
        }
        continue;
      }

      const changedPaths = Array.isArray(result.changedPaths) ? result.changedPaths.map(relativePath) : [];
      if (changedPaths.length === 0 || changedPaths.some((p) => !allowed.includes(p))) {
        const rec = contain(incidentId, tenant, 'worker-path-policy-violation', workerId);
        return { status: 'contained', reason: rec.containment.reason, attempts: attempt, containmentDigest: rec.containment.containmentDigest };
      }
      if (!validDigest(result.patchDigest)) {
        const rec = contain(incidentId, tenant, 'worker-invalid-patch-digest', workerId);
        return { status: 'contained', reason: rec.containment.reason, attempts: attempt, containmentDigest: rec.containment.containmentDigest };
      }

      try {
        const proposed = factory.proposeCandidate({
          incidentId,
          tenant,
          proposerId: workerId,
          patchDigest: result.patchDigest,
          changedPaths,
          runtimeDependenciesAdded: Array.isArray(result.runtimeDependenciesAdded) ? result.runtimeDependenciesAdded : [],
        });
        return {
          status: 'candidate-proposed',
          attempts: attempt,
          candidateDigest: proposed.candidate.candidateDigest,
          patchDigest: proposed.candidate.patchDigest,
          changedPaths: proposed.candidate.changedPaths,
          productionAuthority: false,
        };
      } catch (error) {
        if (['WFM_REPAIR_PROTECTED_PATH', 'WFM_REPAIR_RUNTIME_DEPENDENCY', 'WFM_REPAIR_BUDGET'].includes(error?.code)) {
          const reason = error.code === 'WFM_REPAIR_RUNTIME_DEPENDENCY' ? 'worker-runtime-dependency-policy-violation' : error.code === 'WFM_REPAIR_PROTECTED_PATH' ? 'worker-protected-path-policy-violation' : 'worker-repair-budget-exhausted';
          const existing = factory.snapshot(incidentId);
          if (existing?.state === 'contained') return { status: 'contained', reason: existing.containment?.reason || reason, attempts: attempt, containmentDigest: existing.containment?.containmentDigest || null };
          const rec = contain(incidentId, tenant, reason, workerId);
          return { status: 'contained', reason: rec.containment.reason, attempts: attempt, containmentDigest: rec.containment.containmentDigest };
        }
        throw error;
      }
    }

    deny('WFM_REPAIR_WORKER_STATE', 'unreachable worker state');
  }

  return { run, capabilities: () => ({ ...caps }), safeEnvironment: () => ({ ...SAFE_ENV }) };
}

module.exports = { createIsolatedRepairWorker, SAFE_ENV };
