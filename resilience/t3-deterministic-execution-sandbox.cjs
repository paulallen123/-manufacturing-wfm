'use strict';

const { createHash } = require('node:crypto');

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
}

function isDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function clean(value, max = 160) {
  return String(value ?? '').trim().replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').slice(0, max);
}

function verifyBoundReceipt(receipt, digestField) {
  if (!receipt || !isDigest(receipt[digestField])) return false;
  const core = { ...receipt };
  const expected = core[digestField];
  delete core[digestField];
  return expected === digest(core);
}

function assertSandboxAdapter(adapter) {
  const capability = adapter?.capability || {};
  const safe = capability.scope === 'isolated-t3-sandbox-only'
    && capability.isolated === true
    && capability.zeroIncrementalCost === true
    && capability.networkAccess === false
    && capability.customerDataVisible === false
    && capability.productionDataVisible === false
    && capability.customerWriteAuthority === false
    && capability.productionWriteAuthority === false
    && typeof adapter.readStateDigest === 'function'
    && typeof adapter.applyExactPlan === 'function'
    && typeof adapter.rollbackKnownGood === 'function';
  if (!safe) throw new Error('T3 deterministic execution sandbox requires a zero-cost isolated non-customer/non-production adapter.');
}

function createT3DeterministicExecutionSandbox({ readinessGate, authorityGate, sandboxAdapter, now = Date.now } = {}) {
  if (!readinessGate || typeof readinessGate.verifyReceipt !== 'function') {
    throw new Error('T3 deterministic execution sandbox requires the execution-readiness verifier.');
  }
  if (!authorityGate || typeof authorityGate.consume !== 'function') {
    throw new Error('T3 deterministic execution sandbox requires a separate one-shot execution-authority gate.');
  }
  assertSandboxAdapter(sandboxAdapter);

  function terminal(base, detail = {}) {
    const core = {
      schemaVersion: 1,
      ...base,
      ...detail,
      executorScope: 'isolated-t3-sandbox-only',
      sandboxMutation: detail.sandboxMutation === true,
      executionAuthority: false,
      promotionAuthorityGranted: false,
      productionAuthorityGranted: false,
      modelAuthorityGranted: false,
      customerMutation: false,
      productionMutation: false,
      productionDataTouched: false,
      customerDataTouched: false,
    };
    return { ...core, executionReceiptDigest: digest(core) };
  }

  function verifyReceipt(receipt) {
    if (!receipt || !isDigest(receipt.executionReceiptDigest)) return false;
    if (
      receipt.executionAuthority !== false
      || receipt.promotionAuthorityGranted !== false
      || receipt.productionAuthorityGranted !== false
      || receipt.modelAuthorityGranted !== false
      || receipt.customerMutation !== false
      || receipt.productionMutation !== false
      || receipt.productionDataTouched !== false
      || receipt.customerDataTouched !== false
      || receipt.executorScope !== 'isolated-t3-sandbox-only'
    ) return false;
    const core = { ...receipt };
    const expected = core.executionReceiptDigest;
    delete core.executionReceiptDigest;
    return expected === digest(core);
  }

  async function execute({ readinessReceipt, authorityToken, executorId } = {}) {
    const actor = clean(executorId, 120);
    const at = Number(now());
    const base = {
      status: 'contained',
      reason: 'invalid-readiness-receipt',
      tenant: readinessReceipt?.tenant || null,
      scenarioId: readinessReceipt?.scenarioId || null,
      incidentId: readinessReceipt?.incidentId || null,
      proposalDigest: readinessReceipt?.proposalDigest || null,
      readinessReceiptDigest: readinessReceipt?.readinessReceiptDigest || null,
      executorId: actor || null,
      executedAt: at,
      sandboxMutation: false,
    };

    if (!actor) return terminal(base, { reason: 'deterministic-executor-identity-required' });
    if (!readinessGate.verifyReceipt(readinessReceipt)) return terminal(base);
    if (
      readinessReceipt.status !== 'execution-ready-awaiting-external-authority'
      || readinessReceipt.executionReady !== true
      || readinessReceipt.externalExecutionAuthorityRequired !== true
      || readinessReceipt.deterministicExecutorRequired !== true
      || readinessReceipt.executionAuthority !== false
      || readinessReceipt.productionAuthorityGranted !== false
      || readinessReceipt.modelAuthorityGranted !== false
      || readinessReceipt.customerMutation !== false
      || readinessReceipt.productionMutation !== false
    ) return terminal(base, { reason: 'readiness-authority-boundary-invalid' });
    if (!Number.isSafeInteger(readinessReceipt.validUntil) || at > readinessReceipt.validUntil) {
      return terminal(base, { reason: 'readiness-receipt-expired' });
    }
    for (const key of [
      'proposalDigest', 'readinessReceiptDigest', 'executionPlanDigest', 'idempotencyKeyDigest',
      'currentStateDigest', 'expectedAfterStateDigest', 'rollbackDigest', 'compensationPlanDigest',
    ]) {
      if (!isDigest(readinessReceipt[key])) return terminal(base, { reason: `readiness-${key}-invalid` });
    }

    const observedBefore = await sandboxAdapter.readStateDigest({
      tenant: readinessReceipt.tenant,
      scenarioId: readinessReceipt.scenarioId,
      incidentId: readinessReceipt.incidentId,
    });
    if (!isDigest(observedBefore) || observedBefore !== readinessReceipt.currentStateDigest) {
      return terminal(base, {
        reason: 'sandbox-state-drift-before-execution',
        observedBeforeStateDigest: isDigest(observedBefore) ? observedBefore : null,
      });
    }

    let authority;
    try {
      authority = await authorityGate.consume({
        token: authorityToken,
        executorId: actor,
        tenant: readinessReceipt.tenant,
        scenarioId: readinessReceipt.scenarioId,
        proposalDigest: readinessReceipt.proposalDigest,
        readinessReceiptDigest: readinessReceipt.readinessReceiptDigest,
        executionPlanDigest: readinessReceipt.executionPlanDigest,
        idempotencyKeyDigest: readinessReceipt.idempotencyKeyDigest,
      });
    } catch {
      return terminal(base, { reason: 'external-execution-authority-unavailable-or-replayed' });
    }

    const authorityValid = authority
      && authority.authorised === true
      && authority.scope === 'isolated-t3-sandbox-only'
      && authority.executorType === 'deterministic-sandbox-executor'
      && authority.executorId === actor
      && authority.tenant === readinessReceipt.tenant
      && authority.scenarioId === readinessReceipt.scenarioId
      && authority.proposalDigest === readinessReceipt.proposalDigest
      && authority.readinessReceiptDigest === readinessReceipt.readinessReceiptDigest
      && authority.executionPlanDigest === readinessReceipt.executionPlanDigest
      && authority.idempotencyKeyDigest === readinessReceipt.idempotencyKeyDigest
      && authority.oneShot === true
      && authority.durableReplayProtection === true
      && authority.sandboxMutationAllowed === true
      && authority.executionAuthority === false
      && authority.productionAuthorityGranted === false
      && authority.modelAuthorityGranted === false
      && authority.customerMutation === false
      && authority.productionMutation === false
      && isDigest(authority.authorityReceiptDigest);
    if (!authorityValid) return terminal(base, { reason: 'external-execution-authority-invalid' });

    let applied;
    try {
      applied = await sandboxAdapter.applyExactPlan({
        tenant: readinessReceipt.tenant,
        scenarioId: readinessReceipt.scenarioId,
        incidentId: readinessReceipt.incidentId,
        proposalDigest: readinessReceipt.proposalDigest,
        executionPlanDigest: readinessReceipt.executionPlanDigest,
        idempotencyKeyDigest: readinessReceipt.idempotencyKeyDigest,
        expectedBeforeStateDigest: readinessReceipt.currentStateDigest,
        expectedAfterStateDigest: readinessReceipt.expectedAfterStateDigest,
        affectedRecords: readinessReceipt.affectedRecords,
        executorId: actor,
      });
    } catch {
      applied = null;
    }

    const appliedSafe = applied
      && applied.accepted === true
      && applied.tenant === readinessReceipt.tenant
      && applied.scenarioId === readinessReceipt.scenarioId
      && applied.proposalDigest === readinessReceipt.proposalDigest
      && applied.executionPlanDigest === readinessReceipt.executionPlanDigest
      && applied.idempotencyKeyDigest === readinessReceipt.idempotencyKeyDigest
      && applied.beforeStateDigest === readinessReceipt.currentStateDigest
      && applied.affectedRecords === readinessReceipt.affectedRecords
      && applied.sandboxMutation === true
      && applied.customerMutation === false
      && applied.productionMutation === false
      && applied.productionDataTouched === false
      && applied.customerDataTouched === false
      && applied.networkUsed === false
      && isDigest(applied.afterStateDigest);

    const postconditionsGreen = appliedSafe
      && applied.afterStateDigest === readinessReceipt.expectedAfterStateDigest
      && applied.businessInvariantPassed === true
      && applied.securityPassed === true
      && applied.tenantIsolationPassed === true;

    if (postconditionsGreen) {
      return terminal(base, {
        status: 'sandbox-execution-verified',
        reason: null,
        sandboxMutation: true,
        observedBeforeStateDigest: observedBefore,
        observedAfterStateDigest: applied.afterStateDigest,
        authorityReceiptDigest: authority.authorityReceiptDigest,
        applyResultDigest: digest(applied),
        postconditionReconciled: true,
        automaticKnownGoodRollbackUsed: false,
        productionExecutionReady: false,
      });
    }

    let currentAfterFailure = null;
    try {
      currentAfterFailure = await sandboxAdapter.readStateDigest({
        tenant: readinessReceipt.tenant,
        scenarioId: readinessReceipt.scenarioId,
        incidentId: readinessReceipt.incidentId,
      });
    } catch {
      currentAfterFailure = null;
    }

    let rollback;
    try {
      rollback = await sandboxAdapter.rollbackKnownGood({
        tenant: readinessReceipt.tenant,
        scenarioId: readinessReceipt.scenarioId,
        incidentId: readinessReceipt.incidentId,
        rollbackDigest: readinessReceipt.rollbackDigest,
        compensationPlanDigest: readinessReceipt.compensationPlanDigest,
        expectedRestoreStateDigest: readinessReceipt.currentStateDigest,
        failedAfterStateDigest: isDigest(currentAfterFailure) ? currentAfterFailure : null,
        executorId: actor,
      });
    } catch {
      rollback = null;
    }

    const rollbackGreen = rollback
      && rollback.verified === true
      && rollback.tenant === readinessReceipt.tenant
      && rollback.restoredStateDigest === readinessReceipt.currentStateDigest
      && rollback.rollbackDigest === readinessReceipt.rollbackDigest
      && rollback.compensationPlanDigest === readinessReceipt.compensationPlanDigest
      && rollback.sandboxMutation === true
      && rollback.customerMutation === false
      && rollback.productionMutation === false
      && rollback.productionDataTouched === false
      && rollback.customerDataTouched === false
      && rollback.networkUsed === false;

    if (rollbackGreen) {
      return terminal(base, {
        status: 'sandbox-rolled-back-known-good',
        reason: appliedSafe ? 'sandbox-postcondition-mismatch' : 'sandbox-apply-result-invalid',
        sandboxMutation: true,
        observedBeforeStateDigest: observedBefore,
        observedAfterStateDigest: isDigest(currentAfterFailure) ? currentAfterFailure : null,
        restoredStateDigest: rollback.restoredStateDigest,
        authorityReceiptDigest: authority.authorityReceiptDigest,
        applyResultDigest: applied ? digest(applied) : null,
        rollbackResultDigest: digest(rollback),
        postconditionReconciled: false,
        automaticKnownGoodRollbackUsed: true,
        productionExecutionReady: false,
      });
    }

    return terminal(base, {
      status: 'sandbox-contained-reset-required',
      reason: appliedSafe ? 'sandbox-postcondition-and-rollback-verification-failed' : 'sandbox-apply-and-rollback-verification-failed',
      sandboxMutation: Boolean(appliedSafe || rollback),
      observedBeforeStateDigest: observedBefore,
      observedAfterStateDigest: isDigest(currentAfterFailure) ? currentAfterFailure : null,
      authorityReceiptDigest: authority.authorityReceiptDigest,
      applyResultDigest: applied ? digest(applied) : null,
      rollbackResultDigest: rollback ? digest(rollback) : null,
      postconditionReconciled: false,
      automaticKnownGoodRollbackUsed: true,
      isolatedResetRequired: true,
      productionExecutionReady: false,
    });
  }

  return { execute, verifyReceipt };
}

function assertProvenanceVerifier(verifier, expectedScope, methodName) {
  const capability = verifier?.capability || {};
  const verifierId = clean(capability.verifierId, 120);
  const safe = Boolean(verifierId)
    && capability.scope === expectedScope
    && capability.readOnly === true
    && capability.writeAuthority === false
    && capability.modelAuthority === false
    && capability.customerMutation === false
    && capability.productionMutation === false
    && typeof verifier?.[methodName] === 'function';
  if (!safe) throw new Error(`T3 external execution reconciliation requires a safe ${expectedScope} verifier.`);
  return verifierId;
}

function attestationDigestValid(attestation) {
  return verifyBoundReceipt(attestation, 'attestationDigest');
}

function createT3ExternalExecutionReconciler({
  readinessGate,
  executionProvenanceVerifier,
  observationProvenanceVerifier,
  now = Date.now,
  maxObservationAgeMs = 2 * 60_000,
} = {}) {
  if (!readinessGate || typeof readinessGate.verifyReceipt !== 'function') {
    throw new Error('T3 external execution reconciliation requires the execution-readiness verifier.');
  }
  if (!Number.isSafeInteger(maxObservationAgeMs) || maxObservationAgeMs < 1000 || maxObservationAgeMs > 10 * 60_000) {
    throw new Error('T3 external execution reconciliation maxObservationAgeMs must be between 1 second and 10 minutes.');
  }

  const executionVerifierId = assertProvenanceVerifier(
    executionProvenanceVerifier,
    'external-execution-receipt-provenance-only',
    'verifyExecutionReceipt',
  );
  const observationVerifierId = assertProvenanceVerifier(
    observationProvenanceVerifier,
    'external-observation-provenance-only',
    'verifyObservation',
  );
  if (executionVerifierId === observationVerifierId) {
    throw new Error('T3 external execution reconciliation requires independent execution and observation provenance verifiers.');
  }

  function terminal(base, detail = {}) {
    const core = {
      schemaVersion: 2,
      ...base,
      ...detail,
      executionAuthority: false,
      rollbackAuthority: false,
      promotionAuthorityGranted: false,
      productionAuthorityGranted: false,
      modelAuthorityGranted: false,
      customerMutation: false,
      productionMutation: false,
    };
    return { ...core, reconciliationReceiptDigest: digest(core) };
  }

  function rollbackRequired(base, reason, executionReceipt, observation = null, extra = {}) {
    return terminal(base, {
      status: 'rollback-required-awaiting-external-authority',
      reason,
      executionObserved: true,
      externalMutationObserved: true,
      rollbackRequired: true,
      rollbackDigest: base.rollbackDigest,
      compensationPlanDigest: base.compensationPlanDigest,
      executionReceiptDigest: executionReceipt.executionReceiptDigest,
      observationDigest: observation?.observationDigest || null,
      observedAfterStateDigest: isDigest(observation?.observedStateDigest) ? observation.observedStateDigest : null,
      postconditionReconciled: false,
      ...extra,
    });
  }

  function reconcile({ readinessReceipt, executionReceipt, observation } = {}) {
    const at = Number(now());
    const base = {
      status: 'contained',
      reason: 'invalid-readiness-receipt',
      tenant: readinessReceipt?.tenant || null,
      scenarioId: readinessReceipt?.scenarioId || null,
      incidentId: readinessReceipt?.incidentId || null,
      proposalDigest: readinessReceipt?.proposalDigest || null,
      readinessReceiptDigest: readinessReceipt?.readinessReceiptDigest || null,
      executionPlanDigest: readinessReceipt?.executionPlanDigest || null,
      idempotencyKeyDigest: readinessReceipt?.idempotencyKeyDigest || null,
      expectedBeforeStateDigest: readinessReceipt?.currentStateDigest || null,
      expectedAfterStateDigest: readinessReceipt?.expectedAfterStateDigest || null,
      rollbackDigest: readinessReceipt?.rollbackDigest || null,
      compensationPlanDigest: readinessReceipt?.compensationPlanDigest || null,
      reconciledAt: at,
      executionObserved: false,
      externalMutationObserved: false,
      rollbackRequired: false,
      postconditionReconciled: false,
      executionProvenanceVerified: false,
      observationProvenanceVerified: false,
    };

    if (!readinessGate.verifyReceipt(readinessReceipt)) return terminal(base);
    if (
      readinessReceipt.status !== 'execution-ready-awaiting-external-authority'
      || readinessReceipt.executionReady !== true
      || readinessReceipt.externalExecutionAuthorityRequired !== true
      || readinessReceipt.deterministicExecutorRequired !== true
      || readinessReceipt.executionAuthority !== false
      || readinessReceipt.productionAuthorityGranted !== false
      || readinessReceipt.modelAuthorityGranted !== false
      || readinessReceipt.customerMutation !== false
      || readinessReceipt.productionMutation !== false
    ) return terminal(base, { reason: 'readiness-authority-boundary-invalid' });

    for (const key of [
      'proposalDigest', 'readinessReceiptDigest', 'executionPlanDigest', 'idempotencyKeyDigest',
      'currentStateDigest', 'expectedAfterStateDigest', 'rollbackDigest', 'compensationPlanDigest',
    ]) {
      if (!isDigest(readinessReceipt[key])) return terminal(base, { reason: `readiness-${key}-invalid` });
    }

    if (!verifyBoundReceipt(executionReceipt, 'executionReceiptDigest')) {
      return terminal(base, { reason: 'external-execution-receipt-invalid' });
    }

    let executionAttestation;
    try {
      executionAttestation = executionProvenanceVerifier.verifyExecutionReceipt({
        readinessReceipt,
        executionReceipt,
      });
    } catch {
      executionAttestation = null;
    }

    const executionProvenanceValid = attestationDigestValid(executionAttestation)
      && executionAttestation.verified === true
      && executionAttestation.verifierId === executionVerifierId
      && executionAttestation.scope === 'external-execution-receipt-provenance-only'
      && executionAttestation.readOnly === true
      && executionAttestation.writeAuthority === false
      && executionAttestation.modelAuthorityUsed === false
      && executionAttestation.customerMutation === false
      && executionAttestation.productionMutation === false
      && executionAttestation.tenant === readinessReceipt.tenant
      && executionAttestation.scenarioId === readinessReceipt.scenarioId
      && executionAttestation.incidentId === readinessReceipt.incidentId
      && executionAttestation.proposalDigest === readinessReceipt.proposalDigest
      && executionAttestation.readinessReceiptDigest === readinessReceipt.readinessReceiptDigest
      && executionAttestation.executionReceiptDigest === executionReceipt.executionReceiptDigest
      && executionAttestation.externalAuthorityReceiptDigest === executionReceipt.externalAuthorityReceiptDigest
      && isDigest(executionAttestation.trustRootDigest)
      && Number.isSafeInteger(executionAttestation.attestedAt)
      && executionAttestation.attestedAt >= executionReceipt.executedAt
      && executionAttestation.attestedAt <= at;

    if (!executionProvenanceValid) {
      return terminal(base, { reason: 'external-execution-provenance-unverified' });
    }

    const executorId = clean(executionReceipt.executorId, 120);
    const executionBindingValid = executionReceipt.status === 'executed'
      && executionReceipt.executorType === 'deterministic-external-executor'
      && executionReceipt.authoritySource === 'customer-controlled-external-authority'
      && Boolean(executorId)
      && executionReceipt.tenant === readinessReceipt.tenant
      && executionReceipt.scenarioId === readinessReceipt.scenarioId
      && executionReceipt.incidentId === readinessReceipt.incidentId
      && executionReceipt.proposalDigest === readinessReceipt.proposalDigest
      && executionReceipt.readinessReceiptDigest === readinessReceipt.readinessReceiptDigest
      && executionReceipt.executionPlanDigest === readinessReceipt.executionPlanDigest
      && executionReceipt.idempotencyKeyDigest === readinessReceipt.idempotencyKeyDigest
      && executionReceipt.beforeStateDigest === readinessReceipt.currentStateDigest
      && isDigest(executionReceipt.afterStateDigest)
      && executionReceipt.affectedRecords === readinessReceipt.affectedRecords
      && executionReceipt.oneShotAuthorityConsumed === true
      && executionReceipt.durableReplayProtection === true
      && isDigest(executionReceipt.externalAuthorityReceiptDigest)
      && Number.isSafeInteger(executionReceipt.executedAt);

    if (!executionBindingValid) {
      return terminal(base, {
        reason: 'external-execution-binding-invalid',
        executionProvenanceVerified: true,
        executionProvenanceAttestationDigest: executionAttestation.attestationDigest,
      });
    }

    const executionBase = {
      ...base,
      executionObserved: true,
      externalMutationObserved: true,
      executorId,
      executionReceiptDigest: executionReceipt.executionReceiptDigest,
      observedExecutionAfterStateDigest: executionReceipt.afterStateDigest,
      executionProvenanceVerified: true,
      executionProvenanceVerifierId: executionVerifierId,
      executionProvenanceAttestationDigest: executionAttestation.attestationDigest,
      executionTrustRootDigest: executionAttestation.trustRootDigest,
    };

    if (executionReceipt.modelAuthorityUsed !== false || executionReceipt.llmDecisionAuthorityUsed !== false) {
      return rollbackRequired(executionBase, 'model-authority-used-for-external-execution', executionReceipt, observation);
    }
    if (!Number.isSafeInteger(readinessReceipt.evaluatedAt) || !Number.isSafeInteger(readinessReceipt.validUntil)
      || executionReceipt.executedAt > readinessReceipt.validUntil || executionReceipt.executedAt < readinessReceipt.evaluatedAt) {
      return rollbackRequired(executionBase, 'external-execution-outside-readiness-window', executionReceipt, observation);
    }

    if (!verifyBoundReceipt(observation, 'observationDigest')) {
      return rollbackRequired(executionBase, 'independent-post-execution-observation-invalid', executionReceipt, observation);
    }

    let observationAttestation;
    try {
      observationAttestation = observationProvenanceVerifier.verifyObservation({
        readinessReceipt,
        executionReceipt,
        observation,
      });
    } catch {
      observationAttestation = null;
    }

    const observerId = clean(observation.observerId, 120);
    const observationProvenanceValid = attestationDigestValid(observationAttestation)
      && observationAttestation.verified === true
      && observationAttestation.verifierId === observationVerifierId
      && observationAttestation.scope === 'external-observation-provenance-only'
      && observationAttestation.readOnly === true
      && observationAttestation.writeAuthority === false
      && observationAttestation.modelAuthorityUsed === false
      && observationAttestation.customerMutation === false
      && observationAttestation.productionMutation === false
      && observationAttestation.tenant === readinessReceipt.tenant
      && observationAttestation.scenarioId === readinessReceipt.scenarioId
      && observationAttestation.incidentId === readinessReceipt.incidentId
      && observationAttestation.proposalDigest === readinessReceipt.proposalDigest
      && observationAttestation.readinessReceiptDigest === readinessReceipt.readinessReceiptDigest
      && observationAttestation.executionReceiptDigest === executionReceipt.executionReceiptDigest
      && observationAttestation.observationDigest === observation.observationDigest
      && isDigest(observationAttestation.trustRootDigest)
      && Number.isSafeInteger(observationAttestation.attestedAt)
      && observationAttestation.attestedAt >= observation.observedAt
      && observationAttestation.attestedAt <= at;

    if (!observationProvenanceValid) {
      return rollbackRequired(
        executionBase,
        'independent-post-execution-observation-provenance-unverified',
        executionReceipt,
        observation,
      );
    }

    const observationBindingValid = observation.observerType === 'independent-read-only-reconciler'
      && Boolean(observerId)
      && observerId !== executorId
      && observerId !== executionVerifierId
      && observerId !== observationVerifierId
      && observationVerifierId !== executorId
      && observationVerifierId !== executionVerifierId
      && observation.readOnly === true
      && observation.writeAuthority === false
      && observation.modelAuthorityUsed === false
      && observation.tenant === readinessReceipt.tenant
      && observation.scenarioId === readinessReceipt.scenarioId
      && observation.incidentId === readinessReceipt.incidentId
      && observation.proposalDigest === readinessReceipt.proposalDigest
      && observation.readinessReceiptDigest === readinessReceipt.readinessReceiptDigest
      && observation.executionReceiptDigest === executionReceipt.executionReceiptDigest
      && isDigest(observation.observedStateDigest)
      && Number.isSafeInteger(observation.observedAt)
      && observation.observedAt >= executionReceipt.executedAt;

    if (!observationBindingValid) {
      return rollbackRequired(
        executionBase,
        'independent-post-execution-observation-boundary-invalid',
        executionReceipt,
        observation,
        {
          observationProvenanceVerified: true,
          observationProvenanceVerifierId: observationVerifierId,
          observationProvenanceAttestationDigest: observationAttestation.attestationDigest,
        },
      );
    }

    if (at < observation.observedAt || at - observation.observedAt > maxObservationAgeMs) {
      return rollbackRequired(
        executionBase,
        'independent-post-execution-observation-stale',
        executionReceipt,
        observation,
        {
          observationProvenanceVerified: true,
          observationProvenanceVerifierId: observationVerifierId,
          observationProvenanceAttestationDigest: observationAttestation.attestationDigest,
        },
      );
    }

    const exactPostState = executionReceipt.afterStateDigest === readinessReceipt.expectedAfterStateDigest
      && observation.observedStateDigest === readinessReceipt.expectedAfterStateDigest
      && observation.observedStateDigest === executionReceipt.afterStateDigest;
    const invariantsGreen = observation.businessInvariantPassed === true
      && observation.securityPassed === true
      && observation.tenantIsolationPassed === true;

    if (!exactPostState) {
      return rollbackRequired(
        executionBase,
        'post-execution-state-mismatch',
        executionReceipt,
        observation,
        {
          observationProvenanceVerified: true,
          observationProvenanceVerifierId: observationVerifierId,
          observationProvenanceAttestationDigest: observationAttestation.attestationDigest,
        },
      );
    }
    if (!invariantsGreen) {
      return rollbackRequired(
        executionBase,
        'post-execution-invariant-failure',
        executionReceipt,
        observation,
        {
          observationProvenanceVerified: true,
          observationProvenanceVerifierId: observationVerifierId,
          observationProvenanceAttestationDigest: observationAttestation.attestationDigest,
        },
      );
    }

    return terminal(executionBase, {
      status: 'externally-executed-reconciled',
      reason: null,
      observerId,
      observationDigest: observation.observationDigest,
      observationProvenanceVerified: true,
      observationProvenanceVerifierId: observationVerifierId,
      observationProvenanceAttestationDigest: observationAttestation.attestationDigest,
      observationTrustRootDigest: observationAttestation.trustRootDigest,
      observedAfterStateDigest: observation.observedStateDigest,
      rollbackRequired: false,
      postconditionReconciled: true,
      externalAuthorityConsumed: true,
      independentObservationVerified: true,
      exactExpectedPostStateVerified: true,
      businessInvariantPassed: true,
      securityPassed: true,
      tenantIsolationPassed: true,
    });
  }

  function verifyReceipt(receipt) {
    if (!receipt || !isDigest(receipt.reconciliationReceiptDigest)) return false;
    if (
      receipt.executionAuthority !== false
      || receipt.rollbackAuthority !== false
      || receipt.promotionAuthorityGranted !== false
      || receipt.productionAuthorityGranted !== false
      || receipt.modelAuthorityGranted !== false
      || receipt.customerMutation !== false
      || receipt.productionMutation !== false
    ) return false;
    const core = { ...receipt };
    const expected = core.reconciliationReceiptDigest;
    delete core.reconciliationReceiptDigest;
    return expected === digest(core);
  }

  return { reconcile, verifyReceipt };
}

module.exports = {
  createT3DeterministicExecutionSandbox,
  createT3ExternalExecutionReconciler,
  canonical,
  digest,
};
