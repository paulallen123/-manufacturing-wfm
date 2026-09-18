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

function clean(value, max = 160) {
  return String(value ?? '').trim().replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').slice(0, max);
}

function validDigest(value) {
  return /^[a-f0-9]{64}$/.test(String(value ?? '').toLowerCase());
}

const ALLOWED_SCENARIOS = Object.freeze(new Set([
  'permission-or-identity-anomaly',
  'cross-tenant-access-attempt',
  'prompt-injection-or-untrusted-influence',
  'runaway-repair-loop',
  'external-advisory-poisoning',
  'known-exploited-vulnerability-match',
  'new-cve-component-match',
  'artifact-tampering-or-provenance-drift',
  'unsafe-production-mode-attempt',
  'data-integrity-mismatch',
  'audit-trail-degraded',
  'database-unavailable',
  'database-latency-spike',
  'support-system-failure',
  'bad-release',
  'unknown',
]));

const PROHIBITED_REQUEST_PREFIXES = Object.freeze([
  'payroll.release',
  'payroll.rule',
  'payroll.write',
  'identity.grant',
  'identity.disable',
  'security.policy',
  'security.secret',
  'tenant.boundary',
  'data.delete',
  'audit.delete',
  'backup.delete',
  'legal.override',
  'compliance.override',
  'production.force-promote',
]);

function createT4ContainmentController({ containmentExecutor, rollbackExecutor, forensicStore, now = Date.now, maxActions = 4 } = {}) {
  if (!Number.isSafeInteger(maxActions) || maxActions < 1 || maxActions > 12) {
    throw new Error('maxActions must be between 1 and 12.');
  }

  async function handle(input = {}) {
    const incidentId = clean(input.incidentId, 120);
    const tenant = clean(input.tenant, 100);
    const targetTenant = clean(input.targetTenant || tenant, 100);
    const scenarioId = clean(input.scenarioId || 'unknown', 120);
    const evidenceDigest = clean(input.evidenceDigest, 64).toLowerCase();
    const requestedAction = clean(input.requestedAction, 180);

    if (!incidentId || !tenant || !validDigest(evidenceDigest)) {
      throw Object.assign(new Error('incidentId, tenant and SHA-256 evidence digest are required.'), { code: 'WFM_T4_INPUT' });
    }

    const startedAt = Number(now());
    const events = [];
    let previousDigest = digest({ incidentId, tenant, scenarioId, evidenceDigest, startedAt });
    let actionCount = 0;

    const record = (type, detail = {}) => {
      const event = { seq: events.length + 1, at: Number(now()), type, detail, previousDigest };
      event.eventDigest = digest(event);
      previousDigest = event.eventDigest;
      events.push(event);
    };

    const consume = (kind) => {
      actionCount += 1;
      record('action-budget-consumed', { kind, actionCount, maxActions });
      if (actionCount > maxActions) {
        throw Object.assign(new Error('T4 containment action budget exhausted.'), { code: 'WFM_T4_BUDGET' });
      }
    };

    const threat = input.threat && typeof input.threat === 'object' ? input.threat : {};
    const provenance = input.provenance && typeof input.provenance === 'object' ? input.provenance : {};
    const supportSystem = input.supportSystem && typeof input.supportSystem === 'object' ? input.supportSystem : {};
    const knownGood = input.knownGood && typeof input.knownGood === 'object' ? input.knownGood : {};

    const crossTenant = targetTenant !== tenant;
    const promptPoisoned = threat.promptInjection === true || threat.untrustedToolInstruction === true;
    const memoryPoisoned = threat.memoryPoisoning === true;
    const egressAttempt = threat.credentialExfiltrationAttempt === true || threat.unapprovedEgressAttempt === true;
    const credentialDisclosureConfirmed = threat.credentialDisclosureConfirmed === true && validDigest(threat.credentialReferenceDigest);
    const provenanceMismatch = validDigest(provenance.expectedArtifactDigest)
      && validDigest(provenance.observedArtifactDigest)
      && provenance.expectedArtifactDigest !== provenance.observedArtifactDigest;
    const signatureInvalid = provenance.signatureVerified === false;
    const supportUnavailable = supportSystem.available === false || supportSystem.contextIntegrity === false;
    const runawayRepair = scenarioId === 'runaway-repair-loop' || threat.repairBudgetExceeded === true;
    const prohibitedRequestedAction = PROHIBITED_REQUEST_PREFIXES.some((prefix) => requestedAction === prefix || requestedAction.startsWith(prefix + '.'));
    const scenarioKnown = ALLOWED_SCENARIOS.has(scenarioId);

    record('classified', {
      scenarioId,
      scenarioKnown,
      crossTenant,
      promptPoisoned,
      memoryPoisoned,
      egressAttempt,
      credentialDisclosureConfirmed,
      provenanceMismatch,
      signatureInvalid,
      supportUnavailable,
      runawayRepair,
      prohibitedRequestedAction,
    });

    const planned = new Set(['preserve-forensics']);
    planned.add('freeze-promotion');

    if (crossTenant) planned.add('deny-cross-tenant-action');
    if (promptPoisoned || memoryPoisoned || egressAttempt || prohibitedRequestedAction) {
      planned.add('deny-model-tool-authority');
      planned.add('quarantine-support-context');
    }
    if (credentialDisclosureConfirmed) planned.add('quarantine-confirmed-credential-reference');
    if (provenanceMismatch || signatureInvalid) planned.add('quarantine-candidate-artifact');
    if (runawayRepair) planned.add('halt-repair-mutations');
    if (supportUnavailable) planned.add('use-static-safe-runbook');
    if (!scenarioKnown) planned.add('unknown-fault-isolation');

    const plan = [...planned];
    record('containment-plan', { actions: plan });

    let forensicReceipt = null;
    if (forensicStore?.preserve) {
      consume('forensics.preserve');
      const preserved = await forensicStore.preserve({
        incidentId,
        tenant,
        scenarioId,
        evidenceDigest,
        eventHeadDigest: previousDigest,
      });
      if (preserved?.verified !== true || !validDigest(preserved?.forensicDigest)) {
        throw Object.assign(new Error('Forensic preservation was not independently verified.'), { code: 'WFM_T4_FORENSICS_VERIFY' });
      }
      forensicReceipt = {
        verified: true,
        forensicDigest: preserved.forensicDigest,
        immutable: preserved.immutable === true,
      };
      record('forensics-preserved', { forensicDigest: preserved.forensicDigest, immutable: preserved.immutable === true });
    } else {
      record('forensics-preservation-required', { executorAvailable: false });
    }

    let containmentReceipt = null;
    if (containmentExecutor?.execute) {
      consume('containment.execute');
      const containment = await containmentExecutor.execute({
        incidentId,
        tenant,
        scenarioId,
        evidenceDigest,
        actions: plan,
        credentialReferenceDigest: credentialDisclosureConfirmed ? threat.credentialReferenceDigest : null,
      });
      if (containment?.verified !== true || containment?.productionAuthorityGranted === true || containment?.crossTenantMutation === true) {
        throw Object.assign(new Error('T4 containment executor exceeded or failed its bounded authority.'), { code: 'WFM_T4_CONTAINMENT_VERIFY' });
      }
      containmentReceipt = {
        verified: true,
        containmentDigest: validDigest(containment.containmentDigest) ? containment.containmentDigest : digest(containment),
      };
      record('containment-verified', { containmentDigest: containmentReceipt.containmentDigest });
    } else {
      record('containment-executor-unavailable', { deterministicPlanRetained: true });
    }

    const rollbackEligible = input.rollbackRequested === true
      && knownGood.available === true
      && knownGood.schemaCompatible === true
      && knownGood.independentlyVerified === true
      && knownGood.signatureVerified === true
      && validDigest(knownGood.artifactDigest)
      && validDigest(knownGood.verificationDigest)
      && !crossTenant;

    let rollbackReceipt = null;
    let outcome = 'contained';
    if (rollbackEligible && rollbackExecutor?.rollback) {
      consume('known-good.rollback');
      const rollback = await rollbackExecutor.rollback({
        incidentId,
        tenant,
        scenarioId,
        evidenceDigest,
        knownGoodArtifactDigest: knownGood.artifactDigest,
        knownGoodVerificationDigest: knownGood.verificationDigest,
      });
      if (rollback?.verified !== true || rollback?.productionAuthorityGranted === true || rollback?.crossTenantMutation === true || !validDigest(rollback?.rollbackDigest)) {
        throw Object.assign(new Error('Known-good rollback was not independently verified and bounded.'), { code: 'WFM_T4_ROLLBACK_VERIFY' });
      }
      rollbackReceipt = { verified: true, rollbackDigest: rollback.rollbackDigest };
      outcome = 'rolled_back_to_known_good';
      record('known-good-rollback-verified', { rollbackDigest: rollback.rollbackDigest });
    } else if (input.rollbackRequested === true) {
      record('rollback-denied', {
        rollbackExecutorAvailable: Boolean(rollbackExecutor?.rollback),
        knownGoodAvailable: knownGood.available === true,
        schemaCompatible: knownGood.schemaCompatible === true,
        independentlyVerified: knownGood.independentlyVerified === true,
        signatureVerified: knownGood.signatureVerified === true,
        sameTenant: !crossTenant,
      });
    }

    const requiresSecurityAuthority = credentialDisclosureConfirmed && threat.revocationPreauthorised !== true;
    if (outcome === 'contained' && requiresSecurityAuthority) outcome = 'security_or_legal_authority_required';

    record('terminal', { outcome, actionCount });
    const endedAt = Number(now());
    const result = {
      schemaVersion: 1,
      incidentId,
      tenant,
      scenarioId,
      evidenceDigest,
      outcome,
      safeTerminal: true,
      actionCount,
      maxActions,
      productionAuthorityGranted: false,
      modelAuthorityGranted: false,
      customerMutation: false,
      crossTenantMutation: false,
      requestedActionExecuted: false,
      plannedContainmentActions: plan,
      credentialMaterialExposedToModel: false,
      forensicReceipt,
      containmentReceipt,
      rollbackReceipt,
      startedAt,
      endedAt,
      events,
      traceHeadDigest: previousDigest,
    };
    result.receiptDigest = digest(result);
    return result;
  }

  function verifyReceipt(receipt) {
    if (!receipt || !Array.isArray(receipt.events) || !validDigest(receipt.receiptDigest)) return false;
    let previousDigest = digest({
      incidentId: receipt.incidentId,
      tenant: receipt.tenant,
      scenarioId: receipt.scenarioId,
      evidenceDigest: receipt.evidenceDigest,
      startedAt: receipt.startedAt,
    });
    for (const event of receipt.events) {
      if (event.previousDigest !== previousDigest) return false;
      const copy = { ...event };
      const eventDigest = copy.eventDigest;
      delete copy.eventDigest;
      if (eventDigest !== digest(copy)) return false;
      previousDigest = eventDigest;
    }
    if (receipt.traceHeadDigest !== previousDigest) return false;
    const copy = { ...receipt };
    const receiptDigest = copy.receiptDigest;
    delete copy.receiptDigest;
    return receiptDigest === digest(copy);
  }

  return { handle, verifyReceipt };
}

module.exports = { createT4ContainmentController, digest };
