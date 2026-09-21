'use strict';

const { createHash } = require('node:crypto');

const SAFE_ENV = Object.freeze({
  NODE_ENV: 'test',
  WFM_INDEPENDENT_REPAIR_VERIFIER: '1',
});

function sha(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function validDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function deny(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

function verifyIsolation(executor) {
  if (!executor || typeof executor.capabilities !== 'function' || typeof executor.run !== 'function') {
    deny('WFM_REPAIR_VERIFIER_UNAVAILABLE', 'trusted independent verifier executor unavailable');
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
    sourceWriteAllowed: false,
    writableOutsideWorkspace: false,
    processEscapeDenied: true,
    incrementalCostZero: true,
    stagingPermitAuthority: false,
    productionAuthority: false,
  };
  for (const [key, expected] of Object.entries(required)) {
    if (c?.[key] !== expected) deny('WFM_REPAIR_VERIFIER_UNSAFE', `independent verifier capability rejected: ${key}`);
  }
  if (c.filesystemMode !== 'read-only-source-plus-output') {
    deny('WFM_REPAIR_VERIFIER_UNSAFE', 'read-only source plus isolated output is required');
  }
  return Object.freeze({ ...c });
}

function createIndependentRepairVerifier({ factory, executor, timeoutMs = 180000 } = {}) {
  if (!factory || typeof factory.snapshot !== 'function' || typeof factory.verifyCandidate !== 'function' || typeof factory.containIncident !== 'function') {
    deny('WFM_REPAIR_VERIFIER_INPUT', 'repair factory with verification and containment is required');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) {
    deny('WFM_REPAIR_VERIFIER_INPUT', 'invalid verifier timeout');
  }

  const caps = verifyIsolation(executor);

  function contain(incidentId, tenant, reason, verifierId) {
    const record = factory.containIncident({ incidentId, tenant, reason, actorId: verifierId });
    return {
      status: 'contained',
      reason: record.containment.reason,
      containmentDigest: record.containment.containmentDigest,
      productionAuthority: false,
    };
  }

  function run({ incidentId, tenant, verifierId, sourceSnapshotDigest, expectedCandidateDigest, rollbackSourceDigest }) {
    if (!incidentId || !tenant || !verifierId || verifierId.length > 128) deny('WFM_REPAIR_VERIFIER_INPUT', 'invalid verifier scope');
    for (const value of [sourceSnapshotDigest, expectedCandidateDigest, rollbackSourceDigest]) {
      if (!validDigest(value)) deny('WFM_REPAIR_VERIFIER_INPUT', 'digest-only verifier inputs required');
    }

    const incident = factory.snapshot(incidentId);
    if (!incident || incident.tenant !== tenant) deny('WFM_REPAIR_SCOPE', 'incident scope');
    if (incident.state !== 'candidate-proposed' || !incident.candidate || !incident.reproducer) {
      deny('WFM_REPAIR_VERIFIER_STATE', 'candidate is not ready for independent verification');
    }
    if (incident.candidate.proposerId === verifierId) deny('WFM_REPAIR_SELF_VERIFY', 'candidate proposer cannot act as verifier');
    if (incident.candidate.candidateDigest !== expectedCandidateDigest) {
      return contain(incidentId, tenant, 'verifier-input-candidate-drift', verifierId);
    }

    const job = Object.freeze({
      schemaVersion: 1,
      incidentId,
      tenantDigest: sha(tenant),
      verifierId,
      sourceSnapshotDigest,
      candidateDigest: incident.candidate.candidateDigest,
      patchDigest: incident.candidate.patchDigest,
      changedPaths: [...incident.candidate.changedPaths],
      evidenceDigest: incident.evidenceDigest,
      failingTestDigest: incident.reproducer.failingTestDigest,
      observedFailureDigest: incident.reproducer.observedFailureDigest,
      rollbackSourceDigest,
      env: { ...SAFE_ENV },
      timeoutMs,
      networkMode: 'none',
      secrets: [],
      sourceWriteAllowed: false,
      stagingPermitAuthority: false,
      productionAuthority: false,
      customerMutation: false,
      executorCapabilityDigest: sha(caps),
    });

    let result;
    try {
      result = executor.run(structuredClone(job));
    } catch (_error) {
      return contain(incidentId, tenant, 'verifier-executor-failure', verifierId);
    }

    if (!result || !['verified', 'rejected'].includes(result.status)) {
      return contain(incidentId, tenant, 'verifier-malformed-result', verifierId);
    }
    if (result.productionAuthority === true || result.stagingPermitAuthority === true || result.sourceMutation === true || result.customerMutation === true) {
      return contain(incidentId, tenant, 'verifier-authority-violation', verifierId);
    }
    if (result.acceptedCandidateDigest !== expectedCandidateDigest || result.acceptedPatchDigest !== incident.candidate.patchDigest || result.acceptedSourceSnapshotDigest !== sourceSnapshotDigest) {
      return contain(incidentId, tenant, 'verifier-candidate-drift', verifierId);
    }

    const checks = {
      failingTestNowPasses: result.failingTestNowPasses === true,
      regressionPassed: result.regressionPassed === true,
      securityPassed: result.securityPassed === true,
      tenantIsolationPassed: result.tenantIsolationPassed === true,
      browserPassed: result.browserPassed === true,
    };

    if (result.status === 'rejected') {
      if (Object.values(checks).every(Boolean)) return contain(incidentId, tenant, 'verifier-rejected-without-failed-check', verifierId);
      const rejected = factory.verifyCandidate({ incidentId, tenant, verifierId, ...checks });
      return {
        status: 'candidate-rejected',
        verificationDigest: rejected.verification ? sha(rejected.verification) : null,
        productionAuthority: false,
      };
    }

    if (Object.values(checks).some((value) => value !== true)) {
      return contain(incidentId, tenant, 'verifier-verified-with-failed-check', verifierId);
    }
    for (const value of [result.artifactDigest, result.provenanceDigest, result.rollbackDigest]) {
      if (!validDigest(value)) return contain(incidentId, tenant, 'verifier-invalid-evidence-digest', verifierId);
    }
    if (result.acceptedRollbackSourceDigest !== rollbackSourceDigest) {
      return contain(incidentId, tenant, 'verifier-rollback-source-drift', verifierId);
    }

    const verified = factory.verifyCandidate({
      incidentId,
      tenant,
      verifierId,
      ...checks,
      artifactDigest: result.artifactDigest,
      provenanceDigest: result.provenanceDigest,
      rollbackDigest: result.rollbackDigest,
    });
    return {
      status: 'verified',
      artifactDigest: verified.verification.artifactDigest,
      provenanceDigest: verified.verification.provenanceDigest,
      rollbackDigest: verified.verification.rollbackDigest,
      verificationDigest: verified.verification.verificationDigest,
      candidateDigest: incident.candidate.candidateDigest,
      productionAuthority: false,
      stagingPermitAuthority: false,
    };
  }

  return { run, capabilities: () => ({ ...caps }), safeEnvironment: () => ({ ...SAFE_ENV }) };
}

module.exports = { createIndependentRepairVerifier, SAFE_ENV };
