'use strict';

const { createHash } = require('node:crypto');

const SAFE_ENV = Object.freeze({
  NODE_ENV: 'test',
  WFM_DISPOSABLE_STAGING: '1',
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

function verifyExecutor(executor) {
  if (!executor || typeof executor.capabilities !== 'function' || typeof executor.run !== 'function' || typeof executor.dispose !== 'function') {
    deny('WFM_STAGING_EXECUTOR_UNAVAILABLE', 'trusted disposable staging executor unavailable');
  }
  const c = executor.capabilities();
  const required = {
    isolationEnforced: true,
    disposable: true,
    networkMode: 'none',
    environmentMode: 'replace',
    secretsMounted: false,
    reusableCredentialsVisible: false,
    productionMounts: false,
    customerDataMounted: false,
    productionWriteAuthority: false,
    customerWriteAuthority: false,
    processEscapeDenied: true,
    incrementalCostZero: true,
  };
  for (const [key, expected] of Object.entries(required)) {
    if (c?.[key] !== expected) deny('WFM_STAGING_EXECUTOR_UNSAFE', `staging executor capability rejected: ${key}`);
  }
  if (c.filesystemMode !== 'ephemeral-staging') deny('WFM_STAGING_EXECUTOR_UNSAFE', 'ephemeral staging filesystem required');
  return Object.freeze({ ...c });
}

function verifyAttestor(attestor) {
  if (!attestor || typeof attestor.capabilities !== 'function' || typeof attestor.verify !== 'function') {
    deny('WFM_STAGING_ATTESTOR_UNAVAILABLE', 'trusted attestation verifier unavailable');
  }
  const c = attestor.capabilities();
  const required = {
    readOnly: true,
    networkMode: 'none',
    reusableCredentialsVisible: false,
    productionAuthority: false,
    stagingAuthority: false,
  };
  for (const [key, expected] of Object.entries(required)) {
    if (c?.[key] !== expected) deny('WFM_STAGING_ATTESTOR_UNSAFE', `attestor capability rejected: ${key}`);
  }
  return Object.freeze({ ...c });
}

function createDisposableStagingGate({ factory, executor, attestor, approvedRuntime, timeoutMs = 180000 } = {}) {
  if (!factory || typeof factory.snapshot !== 'function') {
    deny('WFM_STAGING_INPUT', 'repair factory snapshot access is required');
  }
  if (typeof approvedRuntime !== 'string' || !/^\d+\.\d+\.\d+$/.test(approvedRuntime)) {
    deny('WFM_STAGING_INPUT', 'deterministic approved runtime is required');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) {
    deny('WFM_STAGING_INPUT', 'invalid staging timeout');
  }

  const executorCaps = verifyExecutor(executor);
  const attestorCaps = verifyAttestor(attestor);

  function dispose(job, reason) {
    let result;
    try {
      result = executor.dispose(Object.freeze({
        schemaVersion: 1,
        incidentId: job.incidentId,
        tenantDigest: job.tenantDigest,
        stagingReceiptSeed: job.stagingReceiptSeed,
        artifactDigest: job.artifactDigest,
        reason,
        productionAuthority: false,
        customerMutation: false,
      }));
    } catch (_error) {
      return {
        status: 'fail-closed',
        reason: 'staging-disposal-unverified',
        disposalVerified: false,
        productionAuthority: false,
        customerMutation: false,
      };
    }
    if (!result || result.status !== 'disposed' || result.productionAuthority === true || result.customerMutation === true) {
      return {
        status: 'fail-closed',
        reason: 'staging-disposal-unverified',
        disposalVerified: false,
        productionAuthority: false,
        customerMutation: false,
      };
    }
    return {
      status: 'staging-rejected',
      reason,
      disposalVerified: true,
      disposalDigest: validDigest(result.disposalDigest) ? result.disposalDigest : sha({ reason, receipt: job.stagingReceiptSeed }),
      productionAuthority: false,
      customerMutation: false,
    };
  }

  function run({ incidentId, tenant, authorityId, signerId, artifactDigest, provenanceDigest, signatureDigest }) {
    if (!incidentId || !tenant || !authorityId || !signerId) deny('WFM_STAGING_INPUT', 'invalid staging scope');
    if (authorityId !== signerId) deny('WFM_STAGING_AUTHORITY', 'staging authority must be the artifact signer');
    for (const value of [artifactDigest, provenanceDigest, signatureDigest]) {
      if (!validDigest(value)) deny('WFM_STAGING_INPUT', 'digest-only staging inputs required');
    }

    const incident = factory.snapshot(incidentId);
    if (!incident || incident.tenant !== tenant) deny('WFM_REPAIR_SCOPE', 'incident scope');
    if (incident.state !== 'staging-authorised' || !incident.stagingPermit || !incident.verification) {
      deny('WFM_STAGING_STATE', 'incident is not authorised for isolated staging');
    }
    if (incident.stagingPermit.authorityId !== authorityId) deny('WFM_STAGING_AUTHORITY', 'staging authority drift');
    if (incident.stagingPermit.artifactDigest !== artifactDigest || incident.verification.artifactDigest !== artifactDigest) {
      deny('WFM_STAGING_ARTIFACT_DRIFT', 'artifact differs from verified staging permit');
    }
    if (incident.verification.provenanceDigest !== provenanceDigest) {
      deny('WFM_STAGING_PROVENANCE_DRIFT', 'provenance differs from independent verification');
    }

    const attestationPayload = Object.freeze({
      schemaVersion: 1,
      artifactDigest,
      provenanceDigest,
      verificationDigest: incident.verification.verificationDigest,
      permitDigest: incident.stagingPermit.permitDigest,
      signatureDigest,
      signerId,
      authorityId,
      approvedRuntime,
    });
    let attested = false;
    try {
      attested = attestor.verify(structuredClone(attestationPayload)) === true;
    } catch (_error) {
      attested = false;
    }
    if (!attested) {
      return {
        status: 'staging-rejected',
        reason: 'artifact-attestation-rejected',
        stagingStarted: false,
        disposalVerified: true,
        productionAuthority: false,
        customerMutation: false,
      };
    }

    const tenantDigest = sha(tenant);
    const stagingReceiptSeed = sha({
      incidentId,
      tenantDigest,
      artifactDigest,
      provenanceDigest,
      signatureDigest,
      verificationDigest: incident.verification.verificationDigest,
      permitDigest: incident.stagingPermit.permitDigest,
      approvedRuntime,
    });
    const job = Object.freeze({
      schemaVersion: 1,
      incidentId,
      tenantDigest,
      artifactDigest,
      provenanceDigest,
      signatureDigest,
      rollbackDigest: incident.verification.rollbackDigest,
      verificationDigest: incident.verification.verificationDigest,
      permitDigest: incident.stagingPermit.permitDigest,
      expectedRuntime: approvedRuntime,
      stagingReceiptSeed,
      env: { ...SAFE_ENV },
      secrets: [],
      networkMode: 'none',
      customerDataMounted: false,
      timeoutMs,
      productionAuthority: false,
      customerMutation: false,
      executorCapabilityDigest: sha(executorCaps),
      attestorCapabilityDigest: sha(attestorCaps),
    });

    let result;
    try {
      result = executor.run(structuredClone(job));
    } catch (_error) {
      return dispose(job, 'staging-executor-failure');
    }

    if (!result || !['staged', 'rejected'].includes(result.status)) {
      return dispose(job, 'staging-malformed-result');
    }
    if (result.productionAuthority === true || result.customerMutation === true || result.productionMutation === true) {
      return dispose(job, 'staging-authority-violation');
    }
    if (
      result.acceptedArtifactDigest !== artifactDigest ||
      result.acceptedProvenanceDigest !== provenanceDigest ||
      result.acceptedSignatureDigest !== signatureDigest ||
      result.acceptedPermitDigest !== incident.stagingPermit.permitDigest
    ) {
      return dispose(job, 'staging-evidence-drift');
    }
    if (result.status === 'rejected') return dispose(job, result.reason || 'staging-runtime-rejected');
    if (result.exactRuntime !== true || result.actualRuntime !== approvedRuntime) {
      return dispose(job, 'staging-runtime-drift');
    }
    if (!validDigest(result.stagingInstanceDigest) || !validDigest(result.runtimeEvidenceDigest)) {
      return dispose(job, 'staging-evidence-invalid');
    }

    const receipt = {
      schemaVersion: 1,
      incidentId,
      tenantDigest,
      artifactDigest,
      provenanceDigest,
      signatureDigest,
      permitDigest: incident.stagingPermit.permitDigest,
      verificationDigest: incident.verification.verificationDigest,
      stagingInstanceDigest: result.stagingInstanceDigest,
      runtimeEvidenceDigest: result.runtimeEvidenceDigest,
      expectedRuntime: approvedRuntime,
      actualRuntime: result.actualRuntime,
      disposable: true,
      canaryEligible: true,
      productionAuthority: false,
      customerMutation: false,
    };
    return {
      status: 'staged',
      ...receipt,
      stagingReceiptDigest: sha(receipt),
    };
  }

  return {
    run,
    capabilities: () => ({ executor: { ...executorCaps }, attestor: { ...attestorCaps }, approvedRuntime }),
    safeEnvironment: () => ({ ...SAFE_ENV }),
  };
}

module.exports = { createDisposableStagingGate, SAFE_ENV };
