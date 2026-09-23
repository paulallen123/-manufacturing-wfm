'use strict';

function loadTrustSpine() {
  const candidates = [
    '../../trust/runtime/vector-trust-spine.cjs',
    './vector-trust-spine.cjs',
  ];
  let lastError = null;
  for (const candidate of candidates) {
    try { return require(candidate); } catch (error) { lastError = error; }
  }
  throw lastError || new Error('VECTOR T9 trust spine is unavailable.');
}

const {
  EvidenceLedger,
  CustomerGuardian,
  AuthorityKernel,
  TypedActionGateway,
  digest,
} = loadTrustSpine();

function clean(value, max = 180) {
  return String(value ?? '').trim().slice(0, max);
}

function validIso(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function actionTypeFor(kind) {
  const normalized = clean(kind, 60).toUpperCase();
  if (normalized === 'OVERTIME_OVERRIDE') return 'workforce.overtime_override';
  if (normalized === 'AGENCY_ASSIGNMENT') return 'workforce.agency_assignment';
  throw new Error('Unsupported T9 Autopilot action kind.');
}

async function executeT9AutopilotAction({
  tenant,
  permit,
  selected,
  plan,
  lifecycle,
  now = Date.now,
  telemetryBlind = false,
} = {}) {
  const nowFn = typeof now === 'function' ? now : () => Number(now);
  const tenantId = clean(tenant, 120);
  const permitId = clean(permit?.permit_id ?? permit?.permitId, 180);
  const actorRef = clean(permit?.actor_ref ?? permit?.actorRef, 180);
  const issuedAt = validIso(permit?.issued_at ?? permit?.issuedAt);
  const expiresAt = validIso(permit?.expires_at ?? permit?.expiresAt);
  const contextRevision = clean(selected?.contextRevision, 180);
  const optionId = clean(selected?.selection?.optionId, 120);
  const episodeId = clean(selected?.episodeId, 180);
  const actionKind = clean(plan?.action?.kind, 60).toUpperCase();
  const eventKey = clean(plan?.action?.eventKey, 180);
  const employeeId = clean(plan?.action?.employeeId, 160);

  if (!tenantId || !permitId || !actorRef || !issuedAt || !expiresAt || !episodeId || !contextRevision || !optionId) {
    throw new Error('T9 Autopilot requires a complete persisted permit and selected decision.');
  }
  if (!eventKey || !employeeId || !lifecycle?.applyTrustedEvent || !lifecycle?.getTrustedEvent) {
    throw new Error('T9 Autopilot requires an authoritative lifecycle adapter and bounded action plan.');
  }

  const actionType = actionTypeFor(actionKind);
  const resource = 'employee:' + employeeId;
  const actor = 'vector-autopilot-executor';

  const ledger = new EvidenceLedger({ now: nowFn });
  const permitEvidence = ledger.append({
    id: 'permit:' + permitId,
    tenant: tenantId,
    subjectId: resource,
    claimKey: 'autopilot.customer_authorisation',
    value: {
      permitId,
      actorRef,
      episodeId,
      optionId,
      contextRevision,
      actionKind,
      eventKey,
    },
    epistemicType: 'OBSERVED_FACT',
    sourceSystem: 'vector_autopilot_permits',
    sourceIdentity: 'sqlite:vector_autopilot_permits',
    observedAt: issuedAt,
    effectiveAt: issuedAt,
    expiresAt,
    sourceTrust: 1,
    confidence: 1,
    authorityRef: permitId,
  });

  const decisionEvidence = ledger.append({
    id: 'decision:' + permitId,
    tenant: tenantId,
    subjectId: resource,
    claimKey: 'autopilot.selected_decision',
    value: {
      episodeId,
      optionId,
      contextRevision,
      planDigest: digest(plan),
    },
    epistemicType: 'DERIVED_FACT',
    sourceSystem: 'vector_decision_episodes',
    sourceIdentity: 'sqlite:vector_decision_episodes',
    observedAt: validIso(selected?.selection?.selectedAt) || issuedAt,
    effectiveAt: issuedAt,
    expiresAt,
    sourceTrust: 1,
    confidence: 1,
    transformationRef: 'selectDecisionOption',
  });

  const authorityKernel = new AuthorityKernel({ now: nowFn });
  const grant = authorityKernel.issueGrant({
    grantId: 'grant:' + permitId,
    issuer: 'customer-policy-authority',
    actor,
    tenant: tenantId,
    resource,
    actionTypes: [actionType],
    riskCeiling: 'MEDIUM',
    maxBlastRadius: 1,
    expiresAt,
    issuerAuthorityVerified: true,
    evidencePrerequisites: [permitEvidence.id, decisionEvidence.id],
    customerApprovalRef: actorRef,
  });

  const guardian = new CustomerGuardian({
    invariants: [
      (_action, context) => context.customerPermitVerified === true
        ? { allowed: true }
        : { allowed: false, code: 'CUSTOMER_PERMIT_REQUIRED', message: 'A persisted customer permit is required.' },
      (_action, context) => context.contextRevision === contextRevision
        ? { allowed: true }
        : { allowed: false, code: 'CONTEXT_REVISION_CHANGED', message: 'Decision context changed before execution.' },
    ],
  });

  let applied = null;
  let rollbackEvent = null;
  const gateway = new TypedActionGateway({
    evidenceLedger: ledger,
    guardian,
    authorityKernel,
  });

  gateway.register({
    actionType,
    domain: 'workforce',
    riskClass: 'MEDIUM',
    maxBlastRadius: 1,
    reversible: true,
    executorId: 'workforce-lifecycle-executor',
    verifierId: 'workforce-lifecycle-independent-readback',
    maxEvidenceAgeMs: Math.max(1, Date.parse(expiresAt) - Date.parse(issuedAt)),
    executor: async () => {
      const event = {
        ...plan.action,
        payload: { ...(plan.action.payload || {}) },
      };
      if (event.kind === 'OVERTIME_OVERRIDE') {
        event.payload.approvalRef = permitId;
        event.payload.approvedBy = actorRef;
      }
      applied = lifecycle.applyTrustedEvent({ tenant: tenantId, eventKey, event });
      if (applied?.decision?.status !== 'ACCEPTED' || !applied?.event?.id) {
        const error = new Error('Authoritative lifecycle adapter rejected the T9 action.');
        error.code = 'VECTOR_T9_EXECUTOR_REJECTED';
        throw error;
      }
      return {
        executorId: 'workforce-lifecycle-executor',
        eventId: applied.event.id,
        executionDigest: digest({
          tenant: tenantId,
          eventId: applied.event.id,
          eventKey,
          decision: applied.decision.reasonCode || null,
          permitId,
        }),
      };
    },
    verifier: async ({ executionDigest }) => {
      const verified = lifecycle.getTrustedEvent({ tenant: tenantId, eventKey });
      const ok = Boolean(verified && verified.status === 'ACCEPTED');
      return {
        verifierId: 'workforce-lifecycle-independent-readback',
        verified: ok,
        eventId: verified?.id || null,
        executionDigest,
        verificationDigest: digest({
          tenant: tenantId,
          eventKey,
          eventId: verified?.id || null,
          status: verified?.status || 'MISSING',
        }),
      };
    },
    rollback: async () => {
      const rollbackKey = clean(plan?.rollback?.eventKey, 180);
      const rollbackReason = clean(plan?.rollback?.reason, 300);
      if (!rollbackKey || !rollbackReason || !applied?.event?.id) {
        return { verified: false, rollbackDigest: digest('rollback-unavailable') };
      }
      const result = lifecycle.applyTrustedEvent({
        tenant: tenantId,
        eventKey: rollbackKey,
        event: {
          kind: 'RETRO_CHANGE',
          employeeId,
          effectiveAt: new Date(nowFn()).toISOString(),
          payload: {
            targetEventId: applied.event.id,
            reason: rollbackReason,
            approvalRef: permitId,
            correction: { autopilotRollback: true, t9Governed: true },
          },
        },
      });
      if (result?.decision?.status !== 'ACCEPTED') {
        return { verified: false, rollbackDigest: digest({ permitId, rollbackKey, status: 'REJECTED' }) };
      }
      rollbackEvent = lifecycle.getTrustedEvent({ tenant: tenantId, eventKey: rollbackKey });
      const ok = Boolean(rollbackEvent && rollbackEvent.status === 'ACCEPTED');
      return {
        verified: ok,
        rollbackEventId: rollbackEvent?.id || null,
        rollbackDigest: digest({
          tenant: tenantId,
          permitId,
          rollbackKey,
          rollbackEventId: rollbackEvent?.id || null,
          status: rollbackEvent?.status || 'MISSING',
        }),
      };
    },
  });

  try {
    const receipt = await gateway.execute({
      actionId: 'autopilot:' + permitId,
      actionType,
      tenant: tenantId,
      targetTenant: tenantId,
      resource,
      blastRadius: 1,
      evidenceRefs: [permitEvidence.id, decisionEvidence.id],
      requestedChange: plan.action,
      idempotencyKey: 'autopilot:' + permitId,
      certifiedPlaybookMatch: true,
      telemetryBlind: telemetryBlind === true,
      actor,
      grantId: grant.grantId,
      context: {
        customerPermitVerified: true,
        contextRevision,
        telemetryBlind: telemetryBlind === true,
      },
    });
    const verified = lifecycle.getTrustedEvent({ tenant: tenantId, eventKey });
    return {
      state: 'VERIFIED',
      eventId: verified?.id || applied?.event?.id || null,
      trustReceiptDigest: receipt.receiptDigest,
      evidenceLedgerHeadDigest: ledger.headDigest,
      authorityGrantDigest: grant.grantDigest,
    };
  } catch (error) {
    if (error?.code === 'VECTOR_ACTION_POSTCONDITION' && error?.detail?.rollback?.verified === true) {
      return {
        state: 'ROLLED_BACK',
        rollbackEventId: error.detail.rollback.rollbackEventId || rollbackEvent?.id || null,
        evidenceLedgerHeadDigest: ledger.headDigest,
        authorityGrantDigest: grant.grantDigest,
        failureCode: error.code,
      };
    }
    if (applied?.event?.id) {
      return {
        state: 'CONTAINED',
        reason: 'ROLLBACK_UNCONFIRMED',
        appliedEventId: applied.event.id,
        evidenceLedgerHeadDigest: ledger.headDigest,
        authorityGrantDigest: grant.grantDigest,
        failureCode: clean(error?.code || 'VECTOR_T9_EXECUTION', 120),
      };
    }
    throw error;
  }
}

module.exports = Object.freeze({
  actionTypeFor,
  executeT9AutopilotAction,
});
