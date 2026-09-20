import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAutonomyControlLoop, digest } = require('../resilience/autonomy-control-loop.cjs');
const { createT4ContainmentController, createWriteOnceForensicStore } = require('../resilience/t4-containment-controller.cjs');
const { createT4ForensicFailoverStore, createT4RuntimeForensicStore } = require('../resilience/t4-forensic-failover-store.cjs');

const d = (value) => createHash('sha256').update(String(value)).digest('hex');
const contract = {
  tiers: {
    T0: { allowed_terminal_outcomes: ['answered', 'safe_abstention', 'contained'] },
    T1: { allowed_terminal_outcomes: ['recovered', 'contained', 'external_provider_authorisation_required'], allowlisted_action_prefixes: [] },
    T2: { allowed_terminal_outcomes: ['contained', 'verified_candidate_staged'] },
    T3: { allowed_terminal_outcomes: ['contained', 'customer_authorisation_required'] },
    T4: { allowed_terminal_outcomes: ['contained', 'rolled_back_to_known_good', 'security_or_legal_authority_required'] },
  },
  scenario_tier_overrides: { 'data-integrity-mismatch': 'T4' },
  category_defaults: {},
};
const failureScenarios = {
  scenarios: [{ id: 'data-integrity-mismatch', category: 'security' }],
};
const base = {
  tenant: 'tenant-a',
  scenarioId: 'data-integrity-mismatch',
  evidenceDigest: d('t4-terminal-evidence'),
};
let tick = 1000;

const verifiedController = {
  handle: async () => ({
    safeTerminal: true,
    outcome: 'contained',
    productionAuthorityGranted: false,
    modelAuthorityGranted: false,
    customerMutation: false,
    crossTenantMutation: false,
    requestedActionExecuted: false,
    receiptDigest: d('verified-inner-t4-receipt'),
  }),
  verifyReceipt: (receipt) => receipt?.receiptDigest === d('verified-inner-t4-receipt'),
};
const verifiedLoop = createAutonomyControlLoop({
  contract,
  failureScenarios,
  t4ContainmentController: verifiedController,
  now: () => ++tick,
});
const verified = await verifiedLoop.run({ ...base, incidentId: 'inc-t4-verified' });
assert.equal(verified.safeTerminal, true);
assert.equal(verifiedLoop.verifyReceipt(verified), true);

const failedForensicsController = {
  handle: async () => {
    const error = new Error('forensic read-back failed');
    error.code = 'WFM_T4_FORENSICS_VERIFY';
    throw error;
  },
  verifyReceipt: () => false,
};
const failedForensicsLoop = createAutonomyControlLoop({
  contract,
  failureScenarios,
  t4ContainmentController: failedForensicsController,
  now: () => ++tick,
});
const failedForensics = await failedForensicsLoop.run({ ...base, incidentId: 'inc-t4-forensics-failed' });
assert.equal(failedForensics.outcome, 'contained');
assert.equal(failedForensics.safeTerminal, false);
assert.equal(failedForensics.containedErrorCode, 'WFM_T4_FORENSICS_VERIFY');
assert.equal(failedForensicsLoop.verifyReceipt(failedForensics), true);
assert.ok(failedForensics.trace.some((event) => event.type === 't4-safe-terminal-not-established'));

const missingControllerLoop = createAutonomyControlLoop({
  contract,
  failureScenarios,
  now: () => ++tick,
});
const missingController = await missingControllerLoop.run({ ...base, incidentId: 'inc-t4-controller-missing' });
assert.equal(missingController.outcome, 'contained');
assert.equal(missingController.safeTerminal, false);
assert.equal(missingControllerLoop.verifyReceipt(missingController), true);

const authorityEscapeController = {
  handle: async () => ({
    safeTerminal: true,
    outcome: 'contained',
    productionAuthorityGranted: true,
    modelAuthorityGranted: false,
    customerMutation: false,
    crossTenantMutation: false,
    requestedActionExecuted: false,
    receiptDigest: d('hostile-inner-t4-receipt'),
  }),
  verifyReceipt: () => true,
};
const authorityEscapeLoop = createAutonomyControlLoop({
  contract,
  failureScenarios,
  t4ContainmentController: authorityEscapeController,
  now: () => ++tick,
});
const authorityEscape = await authorityEscapeLoop.run({ ...base, incidentId: 'inc-t4-authority-escape' });
assert.equal(authorityEscape.safeTerminal, false);
assert.equal(authorityEscape.containedErrorCode, 'WFM_AUTONOMY_T4_AUTHORITY');
assert.equal(authorityEscapeLoop.verifyReceipt(authorityEscape), true);

const forged = structuredClone(missingController);
forged.safeTerminal = true;
const forgedCore = { ...forged };
delete forgedCore.receiptDigest;
forged.receiptDigest = digest(forgedCore);
assert.equal(missingControllerLoop.verifyReceipt(forged), false, 'Semantic verification must reject a recomputed T4 safe-terminal claim without a verified inner T4 receipt.');

const SAFE_FAILOVER_CAPABILITY = Object.freeze({
  preExisting: true,
  sameTenantOnly: true,
  isolated: true,
  writeOnce: true,
  independentlyVerifiable: true,
  incrementalCostZero: true,
  productionWriteAuthority: false,
  modelVisibleReusableSecrets: false,
  createsResources: false,
  eligibilityEvidenceDigest: d('explicit-preexisting-zero-cost-isolated-forensic-lane-evidence'),
});
const runtimeCapability = (identity) => Object.freeze({
  ...SAFE_FAILOVER_CAPABILITY,
  storeIdentityDigest: d(`forensic-store-identity:${identity}`),
});

const root = mkdtempSync(join(tmpdir(), 'wfm-t4-forensic-failover-'));
try {
  const primaryStore = createWriteOnceForensicStore({ rootDir: join(root, 'primary') });
  const secondaryStore = createWriteOnceForensicStore({ rootDir: join(root, 'secondary') });
  let primaryAttempts = 0;
  const failingPrimary = {
    preserve: async () => {
      primaryAttempts += 1;
      const error = new Error('synthetic primary forensic store outage');
      error.code = 'WFM_T4_FORENSICS_SYNTHETIC_PRIMARY_OUTAGE';
      throw error;
    },
    verify: primaryStore.verify,
  };

  assert.throws(
    () => createT4RuntimeForensicStore({
      stores: [{ id: 'only-runtime-store', capability: runtimeCapability('only'), store: secondaryStore }],
    }),
    (error) => error?.code === 'WFM_T4_FORENSICS_RUNTIME_ATTESTATION',
    'T4 zero-engineer runtime must refuse a single forensic sink.',
  );
  assert.throws(
    () => createT4RuntimeForensicStore({
      stores: [
        { id: 'runtime-a', capability: runtimeCapability('duplicate'), store: primaryStore },
        { id: 'runtime-b', capability: runtimeCapability('duplicate'), store: secondaryStore },
      ],
    }),
    (error) => error?.code === 'WFM_T4_FORENSICS_RUNTIME_IDENTITY',
    'Two logical aliases of the same attested forensic sink must not satisfy redundancy.',
  );
  assert.throws(
    () => createT4RuntimeForensicStore({
      maxAttempts: 1,
      stores: [
        { id: 'runtime-primary', capability: runtimeCapability('primary-budget'), store: primaryStore },
        { id: 'runtime-secondary', capability: runtimeCapability('secondary-budget'), store: secondaryStore },
      ],
    }),
    (error) => error?.code === 'WFM_T4_FORENSICS_RUNTIME_ATTEMPTS',
    'Runtime attempt budget must be large enough to reach every required forensic failover sink.',
  );

  let unattestedLeadingCalls = 0;
  const unattestedLeadingStore = {
    preserve: async (...args) => {
      unattestedLeadingCalls += 1;
      return secondaryStore.preserve(...args);
    },
    verify: secondaryStore.verify,
  };
  const failoverStore = createT4RuntimeForensicStore({
    maxAttempts: 2,
    stores: [
      { id: 'leading-unattested', capability: SAFE_FAILOVER_CAPABILITY, store: unattestedLeadingStore },
      { id: 'primary-preexisting', capability: runtimeCapability('primary-preexisting'), store: failingPrimary },
      { id: 'secondary-preexisting', capability: runtimeCapability('secondary-preexisting'), store: secondaryStore },
    ],
  });
  assert.equal(failoverStore.zeroEngineerFailoverReady, true);
  assert.equal(failoverStore.requiredEligibleStores, 2);
  assert.equal(failoverStore.executableStoreCount, 2);
  assert.equal(failoverStore.runtimeAttestedStoreCount, 2);
  const actualT4Controller = createT4ContainmentController({ forensicStore: failoverStore, now: () => ++tick });
  const failoverLoop = createAutonomyControlLoop({
    contract,
    failureScenarios,
    t4ContainmentController: actualT4Controller,
    now: () => ++tick,
  });
  const failoverTerminal = await failoverLoop.run({ ...base, incidentId: 'inc-t4-primary-forensics-outage' });
  assert.equal(unattestedLeadingCalls, 0, 'An otherwise eligible store without attested identity must never enter the strict runtime execution set.');
  assert.equal(primaryAttempts, 1, 'Primary forensic store must be attempted once; no blind retry loop is permitted.');
  assert.equal(failoverTerminal.outcome, 'contained');
  assert.equal(failoverTerminal.safeTerminal, true, 'A verified pre-existing zero-cost secondary forensic store must restore a safe T4 terminal.');
  assert.equal(failoverTerminal.productionAuthorityGranted, false);
  assert.equal(failoverTerminal.customerMutation, false);
  assert.equal(failoverTerminal.t4?.productionAuthorityGranted, false);
  assert.equal(failoverTerminal.t4?.customerMutation, false);
  assert.equal(failoverTerminal.t4?.crossTenantMutation, false);
  assert.equal(failoverTerminal.t4?.modelAuthorityGranted, false);
  assert.equal(failoverTerminal.t4?.forensicReceipt?.verified, true);
  assert.equal(failoverTerminal.t4?.forensicReceipt?.immutable, true);
  assert.equal(failoverTerminal.t4?.forensicReceipt?.storageMode, 'write-once-failover:secondary-preexisting');
  assert.equal(failoverLoop.verifyReceipt(failoverTerminal), true);

  let unsafeSecondaryCalls = 0;
  const unsafeSecondary = {
    preserve: async () => {
      unsafeSecondaryCalls += 1;
      return secondaryStore.preserve({
        incidentId: 'must-not-run',
        tenant: 'tenant-a',
        scenarioId: 'data-integrity-mismatch',
        evidenceDigest: d('unsafe-secondary'),
        eventHeadDigest: d('unsafe-secondary-event'),
      });
    },
    verify: secondaryStore.verify,
  };
  const ineligibleStore = createT4ForensicFailoverStore({
    maxAttempts: 2,
    stores: [
      { id: 'primary-preexisting', capability: SAFE_FAILOVER_CAPABILITY, store: failingPrimary },
      { id: 'secondary-cost-unverified', capability: { ...SAFE_FAILOVER_CAPABILITY, incrementalCostZero: false }, store: unsafeSecondary },
    ],
  });
  const ineligibleController = createT4ContainmentController({ forensicStore: ineligibleStore, now: () => ++tick });
  const ineligibleLoop = createAutonomyControlLoop({
    contract,
    failureScenarios,
    t4ContainmentController: ineligibleController,
    now: () => ++tick,
  });
  const ineligibleTerminal = await ineligibleLoop.run({ ...base, incidentId: 'inc-t4-cost-unverified-secondary' });
  assert.equal(unsafeSecondaryCalls, 0, 'A secondary store without explicit zero-incremental-cost evidence must never be invoked.');
  assert.equal(ineligibleTerminal.safeTerminal, false);
  assert.equal(ineligibleTerminal.containedErrorCode, 'WFM_T4_FORENSICS_FAILOVER_EXHAUSTED');
  assert.equal(ineligibleLoop.verifyReceipt(ineligibleTerminal), true);

  let missingEvidenceCalls = 0;
  const missingEvidenceStore = {
    preserve: async (...args) => {
      missingEvidenceCalls += 1;
      return secondaryStore.preserve(...args);
    },
    verify: secondaryStore.verify,
  };
  const missingEvidenceFailover = createT4ForensicFailoverStore({
    stores: [{
      id: 'zero-cost-assertion-without-evidence',
      capability: { ...SAFE_FAILOVER_CAPABILITY, eligibilityEvidenceDigest: undefined },
      store: missingEvidenceStore,
    }],
  });
  await assert.rejects(
    () => missingEvidenceFailover.preserve({
      incidentId: 'inc-missing-eligibility-evidence',
      tenant: 'tenant-a',
      scenarioId: 'data-integrity-mismatch',
      evidenceDigest: d('missing-eligibility-evidence'),
      eventHeadDigest: d('missing-eligibility-event'),
    }),
    (error) => error?.code === 'WFM_T4_FORENSICS_NO_ELIGIBLE_STORE',
  );
  assert.equal(missingEvidenceCalls, 0, 'A bare zero-cost assertion without an eligibility evidence digest must never be executable.');

  const tenantDriftStore = {
    preserve: async () => ({
      verified: true,
      immutable: true,
      forensicDigest: d('tenant-drift-forensic'),
      tenantDigest: d('tenant:other-tenant'),
      storageKey: d('tenant-drift-storage'),
      storageMode: 'synthetic-write-once',
    }),
    verify: async () => true,
  };
  const tenantDriftFailover = createT4ForensicFailoverStore({
    stores: [{ id: 'hostile-tenant-drift', capability: SAFE_FAILOVER_CAPABILITY, store: tenantDriftStore }],
  });
  await assert.rejects(
    () => tenantDriftFailover.preserve({
      incidentId: 'inc-t4-tenant-drift',
      tenant: 'tenant-a',
      scenarioId: 'data-integrity-mismatch',
      evidenceDigest: d('tenant-drift-evidence'),
      eventHeadDigest: d('tenant-drift-event'),
    }),
    (error) => error?.code === 'WFM_T4_FORENSICS_FAILOVER_EXHAUSTED',
    'Cross-tenant forensic receipt drift must fail closed.',
  );

  const verifyFalsePrimary = {
    preserve: primaryStore.preserve,
    verify: async () => false,
  };
  const verificationFailover = createT4ForensicFailoverStore({
    maxAttempts: 2,
    stores: [
      { id: 'primary-verification-fails', capability: SAFE_FAILOVER_CAPABILITY, store: verifyFalsePrimary },
      { id: 'secondary-after-verification-failure', capability: SAFE_FAILOVER_CAPABILITY, store: secondaryStore },
    ],
  });
  const verificationReceipt = await verificationFailover.preserve({
    incidentId: 'inc-t4-primary-verification-failure',
    tenant: 'tenant-a',
    scenarioId: 'data-integrity-mismatch',
    evidenceDigest: d('verification-failure-evidence'),
    eventHeadDigest: d('verification-failure-event'),
  });
  assert.equal(verificationReceipt.selectedStoreId, 'secondary-after-verification-failure');
  assert.equal(verificationReceipt.failoverUsed, true);
  assert.equal(verificationReceipt.attemptCount, 2);
  assert.equal(await verificationFailover.verify(verificationReceipt), true);

  const mutableStore = {
    preserve: secondaryStore.preserve,
    verify: secondaryStore.verify,
  };
  const methodPinnedFailover = createT4ForensicFailoverStore({
    stores: [{ id: 'method-pinned-store', capability: SAFE_FAILOVER_CAPABILITY, store: mutableStore }],
  });
  mutableStore.preserve = async () => {
    throw Object.assign(new Error('substituted preserve method must not run'), { code: 'WFM_T4_HOSTILE_METHOD_SWAP' });
  };
  mutableStore.verify = async () => false;
  const methodPinnedReceipt = await methodPinnedFailover.preserve({
    incidentId: 'inc-t4-method-swap',
    tenant: 'tenant-a',
    scenarioId: 'data-integrity-mismatch',
    evidenceDigest: d('method-swap-evidence'),
    eventHeadDigest: d('method-swap-event'),
  });
  assert.equal(methodPinnedReceipt.selectedStoreId, 'method-pinned-store');
  assert.equal(await methodPinnedFailover.verify(methodPinnedReceipt), true, 'Post-construction store method substitution must not replace trusted forensic methods.');

  const noEligibleStore = createT4ForensicFailoverStore({
    stores: [{
      id: 'paid-or-unattested-only',
      capability: { ...SAFE_FAILOVER_CAPABILITY, incrementalCostZero: false },
      store: secondaryStore,
    }],
  });
  await assert.rejects(
    () => noEligibleStore.preserve({
      incidentId: 'inc-no-eligible-store',
      tenant: 'tenant-a',
      scenarioId: 'data-integrity-mismatch',
      evidenceDigest: d('no-eligible-evidence'),
      eventHeadDigest: d('no-eligible-event'),
    }),
    (error) => error?.code === 'WFM_T4_FORENSICS_NO_ELIGIBLE_STORE',
    'No explicitly eligible pre-existing zero-cost store must fail closed without attempting an unsafe lane.',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(JSON.stringify({
  schemaVersion: 3,
  proof: 't4-outer-terminal-integrity',
  status: 'PASS',
  verifiedT4MayClaimSafeTerminal: true,
  failedForensicsCannotClaimSafeTerminal: true,
  missingControllerCannotClaimSafeTerminal: true,
  authorityEscapeCannotClaimSafeTerminal: true,
  recomputedSemanticForgeryRejected: true,
  strictRuntimeForensicCompositionExercised: true,
  singleStoreRuntimeRejected: true,
  duplicateStoreIdentityRejected: true,
  insufficientAttemptBudgetRejected: true,
  unattestedLeadingStoreNeverExecutable: true,
  verifiedZeroCostForensicFailoverRestoresSafeTerminal: true,
  blindPrimaryRetriesDenied: true,
  unattestedCostLaneNeverInvoked: true,
  explicitEligibilityEvidenceRequired: true,
  crossTenantForensicReceiptRejected: true,
  independentReadbackFailureTriggersBoundedFailover: true,
  postConstructionStoreMethodSubstitutionDenied: true,
  productionMutation: false,
  customerMutation: false,
}, null, 2));
