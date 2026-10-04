'use strict';

const { createHash } = require('node:crypto');

const MAX_CANARY_INSTANCES = 1;
const MAX_TRAFFIC_PERCENT = 5;

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

function safeId(value) {
  const v = String(value || '').trim();
  return v && v.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(v) ? v : null;
}

function verifyCaps(obj, method, required, code) {
  if (!obj || typeof obj.capabilities !== 'function' || typeof obj[method] !== 'function') {
    deny(code, 'trusted component unavailable');
  }
  const caps = obj.capabilities();
  for (const [key, expected] of Object.entries(required)) {
    if (caps?.[key] !== expected) deny(code, `unsafe capability: ${key}`);
  }
  return Object.freeze({ ...caps });
}

function createCanaryRollbackController({ canaryExecutor, rollbackExecutor, knownGoodAttestor, outcomeRecorder } = {}) {
  const canaryCaps = verifyCaps(canaryExecutor, 'run', {
    sameTenantEnforced: true,
    exactArtifactRequired: true,
    rollbackPreverifiedRequired: true,
    networkMode: 'none',
    reusableCredentialsVisible: false,
    modelCanGrantAuthority: false,
    customerDataVisible: false,
    incrementalCostZero: true,
    simulationOnly: true,
    productionWriteAuthority: false,
    customerWriteAuthority: false,
  }, 'WFM_CANARY_EXECUTOR_UNSAFE');
  const rollbackCaps = verifyCaps(rollbackExecutor, 'run', {
    sameTenantEnforced: true,
    knownGoodOnly: true,
    schemaCompatibilityRequired: true,
    networkMode: 'none',
    reusableCredentialsVisible: false,
    modelCanGrantAuthority: false,
    customerDataVisible: false,
    incrementalCostZero: true,
    simulationOnly: true,
    productionWriteAuthority: false,
    customerWriteAuthority: false,
  }, 'WFM_ROLLBACK_EXECUTOR_UNSAFE');
  const attestorCaps = verifyCaps(knownGoodAttestor, 'verify', {
    readOnly: true,
    networkMode: 'none',
    reusableCredentialsVisible: false,
    modelCanGrantAuthority: false,
    productionAuthority: false,
    customerWriteAuthority: false,
  }, 'WFM_KNOWN_GOOD_ATTESTOR_UNSAFE');
  const recorderCaps = verifyCaps(outcomeRecorder, 'record', {
    appendOnly: true,
    durable: true,
    tamperEvident: true,
    customerDataStored: false,
    productionAuthority: false,
    customerWriteAuthority: false,
    incrementalCostZero: true,
  }, 'WFM_CANARY_RECORDER_UNSAFE');

  async function record(payload) {
    const out = await outcomeRecorder.record(Object.freeze({ ...payload }));
    if (!out || !validDigest(out.receiptDigest)) deny('WFM_CANARY_RECORDER_RESULT', 'durable terminal receipt required');
    return out.receiptDigest;
  }

  async function terminal(base, status, reason, extra = {}) {
    const payload = {
      schemaVersion: 1,
      incidentId: base.incidentId,
      tenantDigest: base.tenantDigest,
      artifactDigest: base.artifactDigest,
      rollbackDigest: base.rollbackDigest,
      stagingReceiptDigest: base.stagingReceiptDigest,
      status,
      reason,
      canaryControllerId: base.canaryControllerId,
      rollbackControllerId: base.rollbackControllerId,
      productionAuthority: false,
      productionMutation: false,
      customerMutation: false,
      ...extra,
    };
    let outcomeReceiptDigest;
    try { outcomeReceiptDigest = await record(payload); }
    catch (cause) {
      // Preserve the observed diagnosis without manufacturing a durable receipt.
      const error = new Error(cause?.message || String(cause), {cause});
      error.code = cause?.code || 'WFM_CANARY_TERMINAL_AUDIT_FAILED';
      error.unrecordedTerminal = {...payload, durableReceiptRecorded:false};
      throw error;
    }
    return { ...payload, outcomeReceiptDigest };
  }

  async function rollback(base, canaryEvidenceDigest, reason) {
    let result;
    try {
      result = await rollbackExecutor.run(Object.freeze({
        schemaVersion: 1,
        incidentId: base.incidentId,
        tenantDigest: base.tenantDigest,
        artifactDigest: base.artifactDigest,
        rollbackDigest: base.rollbackDigest,
        stagingReceiptDigest: base.stagingReceiptDigest,
        canaryEvidenceDigest,
        reason,
        sameTenantOnly: true,
        simulationOnly: true,
        productionAuthority: false,
        productionMutation: false,
        customerMutation: false,
        rollbackExecutorCapabilityDigest: sha(rollbackCaps),
      }));
    } catch (_error) {
      return terminal(base, 'contained', 'known-good-rollback-executor-failure', { canaryEvidenceDigest, rollbackVerified: false });
    }
    if (!result || result.status !== 'rolled-back') {
      return terminal(base, 'contained', 'known-good-rollback-unverified', { canaryEvidenceDigest, rollbackVerified: false });
    }
    if (result.productionMutation === true || result.customerMutation === true || result.productionAuthority === true) {
      return terminal(base, 'contained', 'rollback-authority-violation', { canaryEvidenceDigest, rollbackVerified: false });
    }
    if (result.acceptedRollbackDigest !== base.rollbackDigest || result.acceptedArtifactDigest !== base.artifactDigest || result.acceptedTenantDigest !== base.tenantDigest) {
      return terminal(base, 'contained', 'rollback-evidence-drift', { canaryEvidenceDigest, rollbackVerified: false });
    }
    if (!validDigest(result.rollbackEvidenceDigest) || result.schemaCompatible !== true || result.knownGoodVerified !== true) {
      return terminal(base, 'contained', 'rollback-verification-failed', { canaryEvidenceDigest, rollbackVerified: false });
    }
    return terminal(base, 'rolled_back_to_known_good', reason, {
      canaryEvidenceDigest,
      rollbackEvidenceDigest: result.rollbackEvidenceDigest,
      rollbackVerified: true,
      schemaCompatible: true,
    });
  }

  async function run(input = {}) {
    const incidentId = safeId(input.incidentId);
    const canaryControllerId = safeId(input.canaryControllerId);
    const rollbackControllerId = safeId(input.rollbackControllerId);
    const tenant = String(input.tenant || '').trim();
    const targetTenant = String(input.targetTenant || '').trim();
    if (!incidentId || !canaryControllerId || !rollbackControllerId || !tenant || !targetTenant) deny('WFM_CANARY_INPUT', 'bounded canary scope required');
    if (canaryControllerId === rollbackControllerId) deny('WFM_CANARY_SEPARATION', 'canary and rollback controllers must be distinct');
    if (tenant !== targetTenant) deny('WFM_CANARY_CROSS_TENANT', 'cross-tenant canary denied');
    for (const value of [input.artifactDigest, input.rollbackDigest, input.stagingReceiptDigest]) {
      if (!validDigest(value)) deny('WFM_CANARY_INPUT', 'digest-only canary evidence required');
    }
    const maxInstances = Number(input.maxInstances);
    const trafficPercent = Number(input.trafficPercent);
    if (!Number.isInteger(maxInstances) || maxInstances < 1 || maxInstances > MAX_CANARY_INSTANCES) {
      deny('WFM_CANARY_BLAST_RADIUS', 'canary instance cap exceeded');
    }
    if (!Number.isFinite(trafficPercent) || trafficPercent <= 0 || trafficPercent > MAX_TRAFFIC_PERCENT) {
      deny('WFM_CANARY_BLAST_RADIUS', 'canary traffic cap exceeded');
    }

    const base = {
      incidentId,
      tenantDigest: sha(tenant),
      artifactDigest: input.artifactDigest,
      rollbackDigest: input.rollbackDigest,
      stagingReceiptDigest: input.stagingReceiptDigest,
      canaryControllerId,
      rollbackControllerId,
    };

    let attestation;
    try {
      attestation = await knownGoodAttestor.verify(Object.freeze({
        schemaVersion: 1,
        incidentId,
        tenantDigest: base.tenantDigest,
        artifactDigest: base.artifactDigest,
        rollbackDigest: base.rollbackDigest,
        stagingReceiptDigest: base.stagingReceiptDigest,
        readOnly: true,
        productionAuthority: false,
        customerMutation: false,
        attestorCapabilityDigest: sha(attestorCaps),
      }));
    } catch (_error) {
      return terminal(base, 'contained', 'known-good-attestation-failure', { canaryStarted: false });
    }
    if (!attestation || attestation.verified !== true || attestation.schemaCompatible !== true || attestation.signatureVerified !== true || attestation.provenanceVerified !== true || !validDigest(attestation.attestationDigest)) {
      return terminal(base, 'contained', 'known-good-attestation-rejected', { canaryStarted: false });
    }

    if (attestation.acceptedArtifactDigest !== base.artifactDigest || attestation.acceptedRollbackDigest !== base.rollbackDigest || attestation.acceptedTenantDigest !== base.tenantDigest || attestation.acceptedStagingReceiptDigest !== base.stagingReceiptDigest) {
      return terminal(base, 'contained', 'known-good-attestation-binding-mismatch', {canaryStarted:false});
    }

    const job = Object.freeze({
      schemaVersion: 1,
      incidentId,
      tenantDigest: base.tenantDigest,
      artifactDigest: base.artifactDigest,
      rollbackDigest: base.rollbackDigest,
      stagingReceiptDigest: base.stagingReceiptDigest,
      knownGoodAttestationDigest: attestation.attestationDigest,
      maxInstances,
      trafficPercent,
      sameTenantOnly: true,
      simulationOnly: true,
      productionAuthority: false,
      productionMutation: false,
      customerMutation: false,
      canaryExecutorCapabilityDigest: sha(canaryCaps),
    });

    let result;
    try {
      result = await canaryExecutor.run(structuredClone(job));
    } catch (_error) {
      return rollback(base, sha({ incidentId, reason: 'canary-executor-failure' }), 'canary-executor-failure');
    }
    if (!result || !['healthy', 'unhealthy', 'indeterminate'].includes(result.status)) {
      return rollback(base, sha({ incidentId, reason: 'canary-malformed-result' }), 'canary-malformed-result');
    }
    if (result.productionMutation === true || result.customerMutation === true || result.productionAuthority === true) {
      return rollback(base, validDigest(result.canaryEvidenceDigest) ? result.canaryEvidenceDigest : sha({ incidentId, reason: 'canary-authority-violation' }), 'canary-authority-violation');
    }
    const evidenceDrift = result.acceptedArtifactDigest !== base.artifactDigest || result.acceptedRollbackDigest !== base.rollbackDigest || result.acceptedTenantDigest !== base.tenantDigest;
    const blastRadiusExceeded = !Number.isInteger(result.touchedInstances) || result.touchedInstances < 0 || result.touchedInstances > maxInstances || !Number.isFinite(result.observedTrafficPercent) || result.observedTrafficPercent < 0 || result.observedTrafficPercent > trafficPercent;
    if (evidenceDrift || blastRadiusExceeded || !validDigest(result.canaryEvidenceDigest)) {
      return rollback(base, validDigest(result.canaryEvidenceDigest) ? result.canaryEvidenceDigest : sha({ incidentId, reason: evidenceDrift ? 'canary-evidence-drift' : 'canary-blast-radius-breach' }), evidenceDrift ? 'canary-evidence-drift' : 'canary-blast-radius-breach');
    }
    if (result.status !== 'healthy') return rollback(base, result.canaryEvidenceDigest, `canary-${result.status}`);
    if (result.businessInvariantPassed !== true || result.securityInvariantPassed !== true || result.tenantInvariantPassed !== true || result.duplicateOutcomeCount !== 0) {
      return rollback(base, result.canaryEvidenceDigest, 'canary-invariant-failed');
    }

    try { return await terminal(base, 'canary_proven', 'canary-healthy', {
      canaryEvidenceDigest: result.canaryEvidenceDigest,
      knownGoodAttestationDigest: attestation.attestationDigest,
      touchedInstances: result.touchedInstances,
      observedTrafficPercent: result.observedTrafficPercent,
      rollbackVerified: false,
      canaryStarted: true,
    });
    } catch (auditError) {
      // An unaudited success cannot leave the simulated candidate active. Restore known good,
      // then propagate the audit error; a missing durable receipt never becomes a proven result.
      try { auditError.rollbackOutcome = await rollback(base, result.canaryEvidenceDigest, 'canary-terminal-audit-failure'); }
      catch (recoveryError) {
        auditError.rollbackError = {code:recoveryError.code||null,message:recoveryError.message};
        if (recoveryError.unrecordedTerminal) auditError.rollbackOutcome = recoveryError.unrecordedTerminal;
      }
      throw auditError;
    }
  }

  return {
    run,
    limits: () => ({ maxInstances: MAX_CANARY_INSTANCES, maxTrafficPercent: MAX_TRAFFIC_PERCENT }),
    capabilities: () => ({ canary: { ...canaryCaps }, rollback: { ...rollbackCaps }, attestor: { ...attestorCaps }, recorder: { ...recorderCaps } }),
  };
}

module.exports = { createCanaryRollbackController, MAX_CANARY_INSTANCES, MAX_TRAFFIC_PERCENT };
