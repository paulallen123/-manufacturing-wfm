'use strict';

const { createHash } = require('node:crypto');

const VERSION = '1.0.0';
const PLAN_VERSION = '1.0.0';
const ADAPTER_SCOPE = 'disposable-provisioning-simulator-only';
const ALLOWED_ACTIONS = new Set([
  'reserve-existing-capacity',
  'create-isolated-tenant-namespace',
  'attach-private-network',
  'bind-secret-reference',
  'apply-site-template-reference',
  'install-health-probe',
  'create-rollback-checkpoint',
  'verify-tenant-isolation',
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isDigest(value) {
  return /^[a-f0-9]{64}$/.test(String(value || ''));
}

function allFalse(value) {
  return value && typeof value === 'object' && Object.values(value).every((entry) => entry === false);
}

function verifyBoundReceipt(receipt, field) {
  if (!receipt || !isDigest(receipt[field])) return false;
  const core = clone(receipt);
  const expected = core[field];
  delete core[field];
  return digest(core) === expected;
}

function safeIdentifier(value, max = 160) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= max
    && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value);
}

function verifyPlan(plan) {
  if (!plan || plan.schemaVersion !== 1 || plan.provisioningPlanVersion !== PLAN_VERSION) return false;
  if (!verifyBoundReceipt(plan, 'receiptDigest') || !allFalse(plan.authority) || !allFalse(plan.guardrails)) return false;
  if (!safeIdentifier(plan.tenantRef, 180)) return false;
  if (!['PROVISIONING_PLAN_READY', 'PARTIAL_PROVISIONING_BLOCKED'].includes(plan.status)) return false;
  if (!Array.isArray(plan.regionPlans) || plan.regionPlans.length < 1 || !Array.isArray(plan.blockedSiteIds)) return false;
  const envelope = plan.executionEnvelope;
  if (!envelope
    || envelope.readyForPreauthorisedDeterministicExecutor !== true
    || envelope.permitIssued !== false
    || envelope.executionAuthorityGranted !== false
    || envelope.requiresExistingProviderPreauthorisation !== true
    || envelope.requiresIndependentPostActionVerification !== true
    || envelope.killSwitchRequired !== true
    || envelope.rollbackRequired !== true
    || envelope.llmMayExecute !== false
    || !Number.isSafeInteger(envelope.actionBudget)
    || envelope.actionBudget < 1) return false;
  let actions = 0;
  const siteIds = new Set();
  for (const region of plan.regionPlans) {
    if (!region
      || !safeIdentifier(region.dataRegion, 80)
      || !safeIdentifier(region.provider, 120)
      || !safeIdentifier(region.capacityId, 160)
      || !isDigest(region.capacityEvidenceDigest)
      || region.privateNetworkOnly !== true
      || region.publicIngress !== false
      || region.zeroIncrementalCost !== true
      || region.rollbackRequired !== true
      || region.independentIsolationVerificationRequired !== true
      || !Array.isArray(region.siteIds)
      || !Array.isArray(region.actions)) return false;
    if (region.siteIds.length !== region.siteCount || new Set(region.siteIds).size !== region.siteIds.length) return false;
    for (const siteId of region.siteIds) {
      if (!safeIdentifier(siteId, 160) || siteIds.has(siteId) || plan.blockedSiteIds.includes(siteId)) return false;
      siteIds.add(siteId);
    }
    for (const action of region.actions) {
      actions += 1;
      if (!action
        || !ALLOWED_ACTIONS.has(action.type)
        || !safeIdentifier(action.target, 240)
        || !isDigest(action.idempotencyKey)
        || action.productionWrite !== false
        || action.customerDataMutation !== false
        || action.payrollMutation !== false
        || action.identityMutation !== false
        || action.publicExposure !== false
        || action.destructive !== false) return false;
    }
  }
  return actions === envelope.actionBudget
    && plan.metrics?.deterministicActionsPlanned === actions
    && plan.metrics?.manualProviderExecutionStepsRemoved === 0
    && plan.metrics?.realProvisioningExecuted === false
    && plan.metrics?.autonomousProvisioningProven === false;
}

function assertAdapter(adapter) {
  const c = adapter?.capability || {};
  const safe = c.scope === ADAPTER_SCOPE
    && c.isolated === true
    && c.disposable === true
    && c.zeroIncrementalCost === true
    && c.networkAccess === false
    && c.publicExposure === false
    && c.customerDataVisible === false
    && c.productionDataVisible === false
    && c.payrollDataVisible === false
    && c.identityDataVisible === false
    && c.customerWriteAuthority === false
    && c.productionWriteAuthority === false
    && c.payrollWriteAuthority === false
    && c.identityWriteAuthority === false
    && c.secretMaterialVisible === false
    && c.rollbackSupported === true
    && typeof adapter.readRegionStateDigest === 'function'
    && typeof adapter.executeAction === 'function'
    && typeof adapter.verifyRegion === 'function'
    && typeof adapter.rollbackRegion === 'function';
  if (!safe) {
    const error = new Error('Provisioning executor requires a zero-cost disposable simulator with no network/customer/production/payroll/identity authority.');
    error.code = 'WFM_PROVISIONING_EXECUTOR_ADAPTER';
    throw error;
  }
}

function verifySimulationPermit(permit, plan, nowMs) {
  if (!permit || permit.schemaVersion !== 1 || !verifyBoundReceipt(permit, 'permitDigest')) return false;
  return permit.scope === ADAPTER_SCOPE
    && permit.issuer === 'deterministic-test-harness'
    && permit.planReceiptDigest === plan.receiptDigest
    && permit.tenantRef === plan.tenantRef
    && permit.oneShot === true
    && permit.modelIssued === false
    && permit.productionAuthorityGranted === false
    && permit.customerAuthorityGranted === false
    && permit.payrollAuthorityGranted === false
    && permit.identityAuthorityGranted === false
    && permit.networkAuthorityGranted === false
    && permit.publicExposureAuthorityGranted === false
    && Number.isSafeInteger(permit.actionBudget)
    && permit.actionBudget === plan.executionEnvelope.actionBudget
    && Number.isSafeInteger(permit.validUntil)
    && nowMs <= permit.validUntil;
}

function terminal(base, detail = {}) {
  const core = {
    schemaVersion: 1,
    executorVersion: VERSION,
    ...base,
    ...detail,
    executorScope: ADAPTER_SCOPE,
    disposableSimulationOnly: true,
    realProvisioningExecuted: false,
    autonomousProvisioningProven: false,
    productionExecutionReady: false,
    environmentProvisioningAuthorityGranted: false,
    executionAuthorityGranted: false,
    productionMutation: false,
    customerMutation: false,
    payrollMutation: false,
    identityMutation: false,
    modelAuthorityGranted: false,
    releaseAuthorityGranted: false,
    publicExposureCreated: false,
    newSpendIncurred: false,
  };
  return { ...core, executionReceiptDigest: digest(core) };
}

function verifyExecutionReceipt(receipt) {
  if (!receipt || receipt.schemaVersion !== 1 || receipt.executorVersion !== VERSION) return false;
  if (!verifyBoundReceipt(receipt, 'executionReceiptDigest')) return false;
  return receipt.executorScope === ADAPTER_SCOPE
    && receipt.disposableSimulationOnly === true
    && receipt.realProvisioningExecuted === false
    && receipt.autonomousProvisioningProven === false
    && receipt.productionExecutionReady === false
    && receipt.environmentProvisioningAuthorityGranted === false
    && receipt.executionAuthorityGranted === false
    && receipt.productionMutation === false
    && receipt.customerMutation === false
    && receipt.payrollMutation === false
    && receipt.identityMutation === false
    && receipt.modelAuthorityGranted === false
    && receipt.releaseAuthorityGranted === false
    && receipt.publicExposureCreated === false
    && receipt.newSpendIncurred === false;
}

function createIsolatedProvisioningExecutor({ adapter, now = Date.now, isKilled = () => false } = {}) {
  assertAdapter(adapter);
  if (typeof now !== 'function' || typeof isKilled !== 'function') throw new Error('Executor requires deterministic time and kill-switch callbacks.');
  const capabilityDigest = digest(adapter.capability);
  const trusted = Object.freeze({
    readRegionStateDigest: adapter.readRegionStateDigest,
    executeAction: adapter.executeAction,
    verifyRegion: adapter.verifyRegion,
    rollbackRegion: adapter.rollbackRegion,
    capabilityDigest,
  });

  function componentsIntact() {
    return adapter.readRegionStateDigest === trusted.readRegionStateDigest
      && adapter.executeAction === trusted.executeAction
      && adapter.verifyRegion === trusted.verifyRegion
      && adapter.rollbackRegion === trusted.rollbackRegion
      && digest(adapter.capability) === trusted.capabilityDigest;
  }

  async function execute({ provisioningPlan, simulationPermit, executorId = 'deterministic-provisioning-simulator' } = {}) {
    const executedAt = Number(now());
    const base = {
      status: 'contained',
      reason: 'invalid-provisioning-plan',
      tenantRef: provisioningPlan?.tenantRef || null,
      planReceiptDigest: provisioningPlan?.receiptDigest || null,
      simulationPermitDigest: simulationPermit?.permitDigest || null,
      executorId: safeIdentifier(executorId, 160) ? executorId : null,
      executedAt,
      attemptedRegions: 0,
      verifiedRegions: 0,
      containedRegions: 0,
      actionsAttempted: 0,
      actionsVerified: 0,
      idempotentReplays: 0,
      automaticRollbacksVerified: 0,
      simulatedManualProviderExecutionStepsRemoved: 0,
      remainingHumanProviderExecutionSteps: provisioningPlan?.executionEnvelope?.actionBudget || 0,
      regionReceipts: [],
    };

    if (!base.executorId) return terminal(base, { reason: 'deterministic-executor-identity-required' });
    if (!verifyPlan(provisioningPlan)) return terminal(base);
    if (!componentsIntact()) return terminal(base, { reason: 'trusted-component-drift-before-execution' });
    if (!verifySimulationPermit(simulationPermit, provisioningPlan, executedAt)) return terminal(base, { reason: 'simulation-permit-invalid' });
    if (isKilled() === true) return terminal(base, { reason: 'kill-switch-active-before-execution' });

    const regionReceipts = [];
    let actionsAttempted = 0;
    let actionsVerified = 0;
    let idempotentReplays = 0;
    let verifiedRegions = 0;
    let containedRegions = 0;
    let automaticRollbacksVerified = 0;

    for (const region of provisioningPlan.regionPlans) {
      const regionBase = {
        dataRegion: region.dataRegion,
        provider: region.provider,
        capacityId: region.capacityId,
        siteIds: clone(region.siteIds),
        expectedActionCount: region.actions.length,
      };
      let before = null;
      try {
        before = await trusted.readRegionStateDigest.call(adapter, { tenantRef: provisioningPlan.tenantRef, dataRegion: region.dataRegion });
      } catch {
        before = null;
      }
      if (!componentsIntact() || !isDigest(before)) {
        regionReceipts.push({ ...regionBase, status: 'contained', reason: 'region-state-unavailable-before-execution', beforeStateDigest: isDigest(before) ? before : null });
        containedRegions += 1;
        break;
      }

      let failureReason = null;
      let lastAfter = before;
      let regionAttempts = 0;
      let regionVerified = 0;
      let regionReplays = 0;

      for (const action of region.actions) {
        if (isKilled() === true) {
          failureReason = 'kill-switch-activated';
          break;
        }
        if (!componentsIntact()) {
          failureReason = 'trusted-component-drift-before-action';
          break;
        }
        if (actionsAttempted >= simulationPermit.actionBudget) {
          failureReason = 'action-budget-exhausted';
          break;
        }
        let result = null;
        try {
          result = await trusted.executeAction.call(adapter, {
            tenantRef: provisioningPlan.tenantRef,
            dataRegion: region.dataRegion,
            action: clone(action),
            executorId: base.executorId,
          });
        } catch {
          result = null;
        }
        actionsAttempted += 1;
        regionAttempts += 1;
        const resultSafe = result
          && result.accepted === true
          && result.tenantRef === provisioningPlan.tenantRef
          && result.dataRegion === region.dataRegion
          && result.idempotencyKey === action.idempotencyKey
          && result.actionType === action.type
          && result.disposableSimulationOnly === true
          && result.networkUsed === false
          && result.publicExposureCreated === false
          && result.customerDataTouched === false
          && result.productionDataTouched === false
          && result.payrollDataTouched === false
          && result.identityDataTouched === false
          && result.secretMaterialPersisted === false
          && result.newSpendIncurred === false
          && result.productionMutation === false
          && result.customerMutation === false
          && result.payrollMutation === false
          && result.identityMutation === false
          && isDigest(result.beforeStateDigest)
          && isDigest(result.afterStateDigest)
          && result.beforeStateDigest === lastAfter;
        if (!resultSafe || !componentsIntact()) {
          failureReason = componentsIntact() ? 'unsafe-or-unbound-action-result' : 'trusted-component-drift-after-action';
          break;
        }
        lastAfter = result.afterStateDigest;
        actionsVerified += 1;
        regionVerified += 1;
        if (result.idempotentReplay === true) {
          idempotentReplays += 1;
          regionReplays += 1;
        }
      }

      let verification = null;
      if (!failureReason && regionVerified === region.actions.length) {
        try {
          verification = await trusted.verifyRegion.call(adapter, {
            tenantRef: provisioningPlan.tenantRef,
            dataRegion: region.dataRegion,
            expectedActionKeys: region.actions.map((action) => action.idempotencyKey),
            expectedSiteIds: clone(region.siteIds),
            expectedProvider: region.provider,
            expectedCapacityId: region.capacityId,
          });
        } catch {
          verification = null;
        }
        const verificationSafe = componentsIntact()
          && verification
          && verification.verified === true
          && verification.tenantRef === provisioningPlan.tenantRef
          && verification.dataRegion === region.dataRegion
          && verification.privateNetworkOnly === true
          && verification.publicIngress === false
          && verification.tenantIsolationVerified === true
          && verification.zeroIncrementalCost === true
          && verification.rollbackCheckpointPresent === true
          && verification.secretMaterialPersisted === false
          && verification.networkUsed === false
          && verification.customerDataTouched === false
          && verification.productionDataTouched === false
          && verification.payrollDataTouched === false
          && verification.identityDataTouched === false
          && verification.productionMutation === false
          && verification.customerMutation === false
          && verification.payrollMutation === false
          && verification.identityMutation === false
          && isDigest(verification.observedStateDigest)
          && verification.observedStateDigest === lastAfter;
        if (verificationSafe) {
          verifiedRegions += 1;
          regionReceipts.push({
            ...regionBase,
            status: 'simulation-verified',
            reason: null,
            beforeStateDigest: before,
            afterStateDigest: lastAfter,
            actionsAttempted: regionAttempts,
            actionsVerified: regionVerified,
            idempotentReplays: regionReplays,
            verificationDigest: digest(verification),
          });
          continue;
        }
        failureReason = 'independent-region-verification-failed';
      }

      containedRegions += 1;
      let rollback = null;
      try {
        rollback = await trusted.rollbackRegion.call(adapter, {
          tenantRef: provisioningPlan.tenantRef,
          dataRegion: region.dataRegion,
          expectedRestoreStateDigest: before,
          executorId: base.executorId,
        });
      } catch {
        rollback = null;
      }
      let readback = null;
      try {
        readback = await trusted.readRegionStateDigest.call(adapter, { tenantRef: provisioningPlan.tenantRef, dataRegion: region.dataRegion });
      } catch {
        readback = null;
      }
      const rollbackGreen = componentsIntact()
        && rollback
        && rollback.verified === true
        && rollback.tenantRef === provisioningPlan.tenantRef
        && rollback.dataRegion === region.dataRegion
        && rollback.disposableSimulationOnly === true
        && rollback.networkUsed === false
        && rollback.customerDataTouched === false
        && rollback.productionDataTouched === false
        && rollback.payrollDataTouched === false
        && rollback.identityDataTouched === false
        && rollback.productionMutation === false
        && rollback.customerMutation === false
        && rollback.payrollMutation === false
        && rollback.identityMutation === false
        && rollback.restoredStateDigest === before
        && readback === before;
      if (rollbackGreen) automaticRollbacksVerified += 1;
      regionReceipts.push({
        ...regionBase,
        status: rollbackGreen ? 'simulation-contained-rolled-back' : 'simulation-contained-reset-required',
        reason: failureReason || 'region-execution-failed',
        beforeStateDigest: before,
        observedAfterFailureStateDigest: isDigest(lastAfter) ? lastAfter : null,
        restoredStateDigest: rollbackGreen ? before : null,
        actionsAttempted: regionAttempts,
        actionsVerified: regionVerified,
        idempotentReplays: regionReplays,
        rollbackDigest: rollback ? digest(rollback) : null,
        rollbackVerified: rollbackGreen,
      });
      break;
    }

    const allRegionsVerified = verifiedRegions === provisioningPlan.regionPlans.length;
    const resetRequired = regionReceipts.some((receipt) => receipt.status === 'simulation-contained-reset-required');
    const status = allRegionsVerified
      ? 'simulated-provisioning-verified'
      : resetRequired ? 'simulation-contained-reset-required' : 'simulation-contained-rolled-back';
    const reason = allRegionsVerified ? null : regionReceipts.find((receipt) => receipt.status !== 'simulation-verified')?.reason || 'simulation-contained';
    const removed = allRegionsVerified ? actionsVerified : 0;
    return terminal(base, {
      status,
      reason,
      attemptedRegions: regionReceipts.length,
      verifiedRegions,
      containedRegions,
      actionsAttempted,
      actionsVerified,
      idempotentReplays,
      automaticRollbacksVerified,
      simulatedManualProviderExecutionStepsRemoved: removed,
      remainingHumanProviderExecutionSteps: provisioningPlan.executionEnvelope.actionBudget,
      regionReceipts,
      safeTerminal: allRegionsVerified || automaticRollbacksVerified === containedRegions,
      independentPostActionVerificationPassed: allRegionsVerified,
      rollbackVerifiedForFailedRegion: containedRegions === 0 ? null : automaticRollbacksVerified === containedRegions,
    });
  }

  return { execute, verifyReceipt: verifyExecutionReceipt, verifyPlan };
}

module.exports = {
  ISOLATED_PROVISIONING_EXECUTOR_VERSION: VERSION,
  DISPOSABLE_PROVISIONING_SCOPE: ADAPTER_SCOPE,
  createIsolatedProvisioningExecutor,
  verifyExecutionReceipt,
  verifyPlan,
  digest,
};
