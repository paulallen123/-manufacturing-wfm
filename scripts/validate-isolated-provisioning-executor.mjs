import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createIsolatedProvisioningExecutor,
  verifyExecutionReceipt,
  digest,
} = require('../resilience/isolated-provisioning-executor.cjs');

function action(tenantRef, dataRegion, type, target, inputs = {}) {
  const core = {
    type,
    target,
    inputs,
    productionWrite: false,
    customerDataMutation: false,
    payrollMutation: false,
    identityMutation: false,
    publicExposure: false,
    destructive: false,
  };
  return { ...core, idempotencyKey: digest({ tenant: tenantRef, region: dataRegion, ...core }) };
}

function makePlan(siteCount, employeeCount, regions) {
  const tenantRef = `tenant-${siteCount}-${employeeCount}`;
  const siteIds = Array.from({ length: siteCount }, (_, index) => `site-${String(index + 1).padStart(4, '0')}`);
  const grouped = new Map(regions.map((region) => [region, []]));
  siteIds.forEach((siteId, index) => grouped.get(regions[index % regions.length]).push(siteId));
  const regionPlans = [];
  for (const [dataRegion, sites] of grouped) {
    const actions = [
      action(tenantRef, dataRegion, 'reserve-existing-capacity', `pool-${dataRegion}`, { capacityEvidenceDigest: digest(`capacity:${dataRegion}`) }),
      action(tenantRef, dataRegion, 'create-isolated-tenant-namespace', `${tenantRef}:${dataRegion}`, { capacityId: `pool-${dataRegion}` }),
      action(tenantRef, dataRegion, 'attach-private-network', `${tenantRef}:${dataRegion}`, { publicIngress: false }),
      action(tenantRef, dataRegion, 'bind-secret-reference', 'tenant-encryption-key', { ref: 'secret://tenant/encryption', evidenceDigest: digest('secret:enc') }),
      action(tenantRef, dataRegion, 'bind-secret-reference', 'runtime-signing-key', { ref: 'secret://tenant/signing', evidenceDigest: digest('secret:sign') }),
      ...sites.map((siteId) => action(tenantRef, dataRegion, 'apply-site-template-reference', siteId, { templateDigest: digest(`template:${siteId}`), policyDigest: digest(`policy:${siteId}`) })),
      action(tenantRef, dataRegion, 'install-health-probe', `${tenantRef}:${dataRegion}`, { mode: 'private-only' }),
      action(tenantRef, dataRegion, 'create-rollback-checkpoint', `${tenantRef}:${dataRegion}`, { beforeAnyCustomerImport: true }),
      action(tenantRef, dataRegion, 'verify-tenant-isolation', `${tenantRef}:${dataRegion}`, { independentVerificationRequired: true }),
    ];
    regionPlans.push({
      dataRegion,
      provider: `provider-${dataRegion}`,
      capacityId: `pool-${dataRegion}`,
      capacityEvidenceDigest: digest(`capacity:${dataRegion}`),
      siteIds: sites,
      siteCount: sites.length,
      employeeCount: Math.floor(employeeCount * (sites.length / siteCount)),
      privateNetworkOnly: true,
      publicIngress: false,
      zeroIncrementalCost: true,
      rollbackRequired: true,
      independentIsolationVerificationRequired: true,
      actions,
    });
  }
  const actionBudget = regionPlans.reduce((sum, region) => sum + region.actions.length, 0);
  const core = {
    schemaVersion: 1,
    provisioningPlanVersion: '1.0.0',
    tenantRef,
    asOf: '2026-09-20T19:00:00.000Z',
    scopeReceiptDigest: digest('scope'),
    rolloutReceiptDigest: digest('rollout'),
    policyReceiptDigest: digest('policy'),
    status: 'PROVISIONING_PLAN_READY',
    regionPlans,
    blockers: [],
    blockedSiteIds: [],
    secretReferences: [],
    executionEnvelope: {
      readyForPreauthorisedDeterministicExecutor: true,
      permitIssued: false,
      executionAuthorityGranted: false,
      requiresExistingProviderPreauthorisation: true,
      requiresIndependentPostActionVerification: true,
      killSwitchRequired: true,
      rollbackRequired: true,
      actionBudget,
      llmMayExecute: false,
    },
    metrics: {
      sitesEvaluated: siteCount,
      sitesReadyForIsolatedProvisioning: siteCount,
      sitesBlocked: 0,
      regionsReady: regionPlans.length,
      deterministicActionsPlanned: actionBudget,
      implementationQuestionsAdded: 0,
      simulatedManualProvisioningPlanningStepsRemoved: siteCount + regionPlans.length * 4,
      manualProviderExecutionStepsRemoved: 0,
      remainingHumanOnlyDecisions: 0,
      realProvisioningExecuted: false,
      autonomousProvisioningProven: false,
    },
    guardrails: {
      newSpendAuthorised: false,
      publicExposureAuthorised: false,
      productionWriteAuthorised: false,
      customerDataMutationAuthorised: false,
      payrollMutationAuthorised: false,
      identityMutationAuthorised: false,
      rawSecretPersistenceAuthorised: false,
      destructiveActionAuthorised: false,
      modelCreatedAuthority: false,
    },
    authority: {
      environmentProvisioningAuthorityGranted: false,
      executionAuthorityGranted: false,
      productionMutation: false,
      customerMutation: false,
      payrollMutation: false,
      identityMutation: false,
      modelAuthorityGranted: false,
      releaseAuthorityGranted: false,
    },
  };
  return { ...core, receiptDigest: digest(core) };
}

function permit(plan, now = 1_795_200_000_000) {
  const core = {
    schemaVersion: 1,
    scope: 'disposable-provisioning-simulator-only',
    issuer: 'deterministic-test-harness',
    tenantRef: plan.tenantRef,
    planReceiptDigest: plan.receiptDigest,
    actionBudget: plan.executionEnvelope.actionBudget,
    oneShot: true,
    modelIssued: false,
    productionAuthorityGranted: false,
    customerAuthorityGranted: false,
    payrollAuthorityGranted: false,
    identityAuthorityGranted: false,
    networkAuthorityGranted: false,
    publicExposureAuthorityGranted: false,
    validUntil: now + 60_000,
  };
  return { ...core, permitDigest: digest(core) };
}

function makeAdapter({ failAt = null, rollbackFails = false, verificationFails = false, driftAfterAction = null } = {}) {
  const states = new Map();
  const initial = new Map();
  const seen = new Map();
  let attempts = 0;
  const key = (tenantRef, dataRegion) => `${tenantRef}:${dataRegion}`;
  const ensure = (tenantRef, dataRegion) => {
    const k = key(tenantRef, dataRegion);
    if (!states.has(k)) {
      const state = { tenantRef, dataRegion, actionKeys: [], privateNetworkOnly: true, publicIngress: false, checkpoint: false };
      states.set(k, state);
      initial.set(k, structuredClone(state));
      seen.set(k, new Set());
    }
    return states.get(k);
  };
  const stateDigest = (tenantRef, dataRegion) => digest(ensure(tenantRef, dataRegion));
  const adapter = {
    capability: {
      scope: 'disposable-provisioning-simulator-only',
      isolated: true,
      disposable: true,
      zeroIncrementalCost: true,
      networkAccess: false,
      publicExposure: false,
      customerDataVisible: false,
      productionDataVisible: false,
      payrollDataVisible: false,
      identityDataVisible: false,
      customerWriteAuthority: false,
      productionWriteAuthority: false,
      payrollWriteAuthority: false,
      identityWriteAuthority: false,
      secretMaterialVisible: false,
      rollbackSupported: true,
    },
    async readRegionStateDigest({ tenantRef, dataRegion }) {
      return stateDigest(tenantRef, dataRegion);
    },
    async executeAction({ tenantRef, dataRegion, action }) {
      attempts += 1;
      const beforeStateDigest = stateDigest(tenantRef, dataRegion);
      if (failAt === attempts) throw new Error('synthetic action failure');
      const state = ensure(tenantRef, dataRegion);
      const seenKeys = seen.get(key(tenantRef, dataRegion));
      const idempotentReplay = seenKeys.has(action.idempotencyKey);
      if (!idempotentReplay) {
        seenKeys.add(action.idempotencyKey);
        state.actionKeys.push(action.idempotencyKey);
        if (action.type === 'attach-private-network') {
          state.privateNetworkOnly = true;
          state.publicIngress = false;
        }
        if (action.type === 'create-rollback-checkpoint') state.checkpoint = true;
      }
      const afterStateDigest = stateDigest(tenantRef, dataRegion);
      if (driftAfterAction === attempts) adapter.executeAction = async () => ({ accepted: false });
      return {
        accepted: true,
        tenantRef,
        dataRegion,
        actionType: action.type,
        idempotencyKey: action.idempotencyKey,
        idempotentReplay,
        beforeStateDigest,
        afterStateDigest,
        disposableSimulationOnly: true,
        networkUsed: false,
        publicExposureCreated: false,
        customerDataTouched: false,
        productionDataTouched: false,
        payrollDataTouched: false,
        identityDataTouched: false,
        secretMaterialPersisted: false,
        newSpendIncurred: false,
        productionMutation: false,
        customerMutation: false,
        payrollMutation: false,
        identityMutation: false,
      };
    },
    async verifyRegion({ tenantRef, dataRegion, expectedActionKeys }) {
      const state = ensure(tenantRef, dataRegion);
      const set = new Set(state.actionKeys);
      const verified = !verificationFails && expectedActionKeys.every((entry) => set.has(entry));
      return {
        verified,
        tenantRef,
        dataRegion,
        privateNetworkOnly: true,
        publicIngress: false,
        tenantIsolationVerified: verified,
        zeroIncrementalCost: true,
        rollbackCheckpointPresent: state.checkpoint,
        secretMaterialPersisted: false,
        networkUsed: false,
        customerDataTouched: false,
        productionDataTouched: false,
        payrollDataTouched: false,
        identityDataTouched: false,
        productionMutation: false,
        customerMutation: false,
        payrollMutation: false,
        identityMutation: false,
        observedStateDigest: stateDigest(tenantRef, dataRegion),
      };
    },
    async rollbackRegion({ tenantRef, dataRegion, expectedRestoreStateDigest }) {
      const k = key(tenantRef, dataRegion);
      if (rollbackFails) {
        return {
          verified: false,
          tenantRef,
          dataRegion,
          restoredStateDigest: stateDigest(tenantRef, dataRegion),
          disposableSimulationOnly: true,
          networkUsed: false,
          customerDataTouched: false,
          productionDataTouched: false,
          payrollDataTouched: false,
          identityDataTouched: false,
          productionMutation: false,
          customerMutation: false,
          payrollMutation: false,
          identityMutation: false,
        };
      }
      states.set(k, structuredClone(initial.get(k)));
      seen.set(k, new Set());
      const restoredStateDigest = stateDigest(tenantRef, dataRegion);
      return {
        verified: restoredStateDigest === expectedRestoreStateDigest,
        tenantRef,
        dataRegion,
        restoredStateDigest,
        disposableSimulationOnly: true,
        networkUsed: false,
        customerDataTouched: false,
        productionDataTouched: false,
        payrollDataTouched: false,
        identityDataTouched: false,
        productionMutation: false,
        customerMutation: false,
        payrollMutation: false,
        identityMutation: false,
      };
    },
    _attempts: () => attempts,
  };
  return adapter;
}

const nowMs = 1_795_200_000_000;
const now = () => nowMs;
const scaleCases = [
  [1, 1, ['uk']],
  [1, 25, ['uk']],
  [2, 100, ['uk']],
  [5, 500, ['uk', 'eu']],
  [10, 2000, ['uk', 'eu']],
  [50, 10000, ['uk', 'eu', 'us']],
  [120, 25000, ['uk', 'eu', 'us', 'apac']],
];
const scaleResults = [];
for (const [siteCount, employeeCount, regions] of scaleCases) {
  const plan = makePlan(siteCount, employeeCount, regions);
  const adapter = makeAdapter();
  const executor = createIsolatedProvisioningExecutor({ adapter, now });
  const receipt = await executor.execute({ provisioningPlan: plan, simulationPermit: permit(plan, nowMs) });
  assert.equal(receipt.status, 'simulated-provisioning-verified');
  assert.equal(receipt.actionsVerified, plan.executionEnvelope.actionBudget);
  assert.equal(receipt.simulatedManualProviderExecutionStepsRemoved, plan.executionEnvelope.actionBudget);
  assert.equal(receipt.remainingHumanProviderExecutionSteps, plan.executionEnvelope.actionBudget);
  assert.equal(receipt.realProvisioningExecuted, false);
  assert.equal(receipt.autonomousProvisioningProven, false);
  assert.equal(receipt.environmentProvisioningAuthorityGranted, false);
  assert.equal(receipt.executionAuthorityGranted, false);
  assert.equal(verifyExecutionReceipt(receipt), true);

  const replay = await executor.execute({ provisioningPlan: plan, simulationPermit: permit(plan, nowMs) });
  assert.equal(replay.status, 'simulated-provisioning-verified');
  assert.equal(replay.idempotentReplays, plan.executionEnvelope.actionBudget);
  assert.equal(verifyExecutionReceipt(replay), true);

  scaleResults.push({ siteCount, employeeCount, regions: regions.length, actions: plan.executionEnvelope.actionBudget });
}

const plan = makePlan(4, 400, ['uk', 'eu']);

{
  const adapter = makeAdapter({ failAt: 4 });
  const executor = createIsolatedProvisioningExecutor({ adapter, now });
  const receipt = await executor.execute({ provisioningPlan: plan, simulationPermit: permit(plan, nowMs) });
  assert.equal(receipt.status, 'simulation-contained-rolled-back');
  assert.equal(receipt.automaticRollbacksVerified, 1);
  assert.equal(receipt.safeTerminal, true);
}

{
  const adapter = makeAdapter({ failAt: 3, rollbackFails: true });
  const executor = createIsolatedProvisioningExecutor({ adapter, now });
  const receipt = await executor.execute({ provisioningPlan: plan, simulationPermit: permit(plan, nowMs) });
  assert.equal(receipt.status, 'simulation-contained-reset-required');
  assert.equal(receipt.safeTerminal, false);
}

{
  let checks = 0;
  const adapter = makeAdapter();
  const executor = createIsolatedProvisioningExecutor({ adapter, now, isKilled: () => (++checks > 5) });
  const receipt = await executor.execute({ provisioningPlan: plan, simulationPermit: permit(plan, nowMs) });
  assert.equal(receipt.status, 'simulation-contained-rolled-back');
  assert.equal(receipt.reason, 'kill-switch-activated');
  assert.equal(receipt.automaticRollbacksVerified, 1);
}

{
  const adapter = makeAdapter({ verificationFails: true });
  const executor = createIsolatedProvisioningExecutor({ adapter, now });
  const receipt = await executor.execute({ provisioningPlan: plan, simulationPermit: permit(plan, nowMs) });
  assert.equal(receipt.status, 'simulation-contained-rolled-back');
  assert.equal(receipt.reason, 'independent-region-verification-failed');
}

{
  const adapter = makeAdapter();
  const original = adapter.executeAction;
  adapter.executeAction = async (args) => {
    const result = await original(args);
    return { ...result, tenantRef: 'other-tenant' };
  };
  const executor = createIsolatedProvisioningExecutor({ adapter, now });
  const receipt = await executor.execute({ provisioningPlan: plan, simulationPermit: permit(plan, nowMs) });
  assert.equal(receipt.status, 'simulation-contained-rolled-back');
  assert.equal(receipt.reason, 'unsafe-or-unbound-action-result');
}

{
  const adapter = makeAdapter({ driftAfterAction: 2 });
  const executor = createIsolatedProvisioningExecutor({ adapter, now });
  const receipt = await executor.execute({ provisioningPlan: plan, simulationPermit: permit(plan, nowMs) });
  assert.equal(receipt.status, 'simulation-contained-reset-required');
  assert.match(receipt.reason, /trusted-component-drift/);
}

{
  const adapter = makeAdapter();
  adapter.capability.networkAccess = true;
  assert.throws(() => createIsolatedProvisioningExecutor({ adapter, now }), (error) => error.code === 'WFM_PROVISIONING_EXECUTOR_ADAPTER');
}

{
  const adapter = makeAdapter();
  const executor = createIsolatedProvisioningExecutor({ adapter, now });
  const badPermit = permit(plan, nowMs);
  badPermit.modelIssued = true;
  const core = structuredClone(badPermit);
  delete core.permitDigest;
  badPermit.permitDigest = digest(core);
  const receipt = await executor.execute({ provisioningPlan: plan, simulationPermit: badPermit });
  assert.equal(receipt.reason, 'simulation-permit-invalid');
  assert.equal(receipt.actionsAttempted, 0);
}

{
  const adapter = makeAdapter();
  const executor = createIsolatedProvisioningExecutor({ adapter, now });
  const badPermit = permit(plan, nowMs);
  badPermit.planReceiptDigest = digest('other-plan');
  const core = structuredClone(badPermit);
  delete core.permitDigest;
  badPermit.permitDigest = digest(core);
  const receipt = await executor.execute({ provisioningPlan: plan, simulationPermit: badPermit });
  assert.equal(receipt.reason, 'simulation-permit-invalid');
  assert.equal(receipt.actionsAttempted, 0);
}

{
  const adapter = makeAdapter();
  const executor = createIsolatedProvisioningExecutor({ adapter, now });
  const expired = permit(plan, nowMs);
  expired.validUntil = nowMs - 1;
  const core = structuredClone(expired);
  delete core.permitDigest;
  expired.permitDigest = digest(core);
  const receipt = await executor.execute({ provisioningPlan: plan, simulationPermit: expired });
  assert.equal(receipt.reason, 'simulation-permit-invalid');
}

{
  const adapter = makeAdapter();
  const executor = createIsolatedProvisioningExecutor({ adapter, now });
  const lowBudget = permit(plan, nowMs);
  lowBudget.actionBudget -= 1;
  const core = structuredClone(lowBudget);
  delete core.permitDigest;
  lowBudget.permitDigest = digest(core);
  const receipt = await executor.execute({ provisioningPlan: plan, simulationPermit: lowBudget });
  assert.equal(receipt.reason, 'simulation-permit-invalid');
}

{
  const adapter = makeAdapter();
  const executor = createIsolatedProvisioningExecutor({ adapter, now });
  const forged = structuredClone(plan);
  forged.authority.environmentProvisioningAuthorityGranted = true;
  const core = structuredClone(forged);
  delete core.receiptDigest;
  forged.receiptDigest = digest(core);
  const receipt = await executor.execute({ provisioningPlan: forged, simulationPermit: permit(forged, nowMs) });
  assert.equal(receipt.reason, 'invalid-provisioning-plan');
  assert.equal(receipt.actionsAttempted, 0);
}

{
  const adapter = makeAdapter();
  const executor = createIsolatedProvisioningExecutor({ adapter, now });
  const forged = structuredClone(plan);
  forged.regionPlans[0].actions[0].publicExposure = true;
  const core = structuredClone(forged);
  delete core.receiptDigest;
  forged.receiptDigest = digest(core);
  const receipt = await executor.execute({ provisioningPlan: forged, simulationPermit: permit(forged, nowMs) });
  assert.equal(receipt.reason, 'invalid-provisioning-plan');
}

const enterprise = scaleResults.find((row) => row.employeeCount === 10000);
const stress = scaleResults.find((row) => row.employeeCount === 25000);
console.log(JSON.stringify({
  validator: 'isolated-provisioning-executor',
  result: 'PASS',
  scaleCases: scaleResults,
  edgeCases: 13,
  humanTouch: {
    implementationQuestionsAdded: 0,
    simulatedProviderExecutionStepsRemoved10000: enterprise.actions,
    simulatedProviderExecutionStepsRemoved25000: stress.actions,
    realProviderExecutionStepsRemoved: 0,
  },
  proofBoundary: {
    disposableSimulationOnly: true,
    realProvisioningExecuted: false,
    autonomousProvisioningProven: false,
    environmentProvisioningAuthorityGranted: false,
    llmProductionAuthorityGranted: false,
    newSpendIncurred: false,
    publicExposureCreated: false,
  },
}, null, 2));
