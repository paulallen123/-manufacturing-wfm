import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  planIsolatedEnvironmentProvisioning,
  verifyIsolatedEnvironmentProvisioningPlan,
  digest,
} = require('../resilience/isolated-environment-provisioning-plan.cjs');

const d = (value) => createHash('sha256').update(String(value)).digest('hex');
const seal = (core, field = 'receiptDigest') => ({ ...core, [field]: digest(core) });

function scopeReceipt(siteCount, employeeCount) {
  const core = {
    schemaVersion: 1,
    graphVersion: '1.0.0',
    contractEventDigest: d(`contract:${siteCount}:${employeeCount}`),
    status: 'SCOPED',
    facts: {
      'org.siteCount': siteCount,
      'workforce.employeeCount': employeeCount,
      'workforce.sourceSystem': 'synthetic-hcm',
      'payroll.enabled': true,
      'payroll.provider': 'synthetic-payroll',
      'time.captureMode': 'mixed',
      'agency.enabled': false,
      'training.roleGroups': ['employee', 'manager', 'payroll', 'company-admin'],
    },
    provenance: {}, questions: [], conflicts: [], invalidatedAnswers: [], noOps: [], machineActions: [], metrics: {},
    authority: {
      productionMutation: false, customerMutation: false, payrollMutation: false, identityMutation: false,
      environmentProvisioningAuthorityGranted: false, integrationWriteAuthorityGranted: false,
      modelAuthorityGranted: false, releaseAuthorityGranted: false,
    },
  };
  return { ...core, stateDigest: digest(core), answers: structuredClone(core.facts) };
}

function topology(siteCount, employeeCount, regions = ['uk']) {
  const base = Math.floor(employeeCount / siteCount);
  let remainder = employeeCount - base * siteCount;
  const sites = [];
  for (let i = 0; i < siteCount; i += 1) {
    const employees = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    const dataRegion = regions[i % regions.length];
    sites.push({
      siteId: `site-${String(i + 1).padStart(3, '0')}`,
      dataRegion,
      employeeCount: employees,
      templateDigest: d(`template:${i}:${dataRegion}`),
      policyDigest: d(`policy:${i}:${dataRegion}`),
    });
  }
  return sites;
}

function rolloutReceipt(scope, tenantRef, sites, blocked = []) {
  const blockedSet = new Set(blocked);
  const core = {
    schemaVersion: 1,
    rolloutVersion: '1.0.0',
    scopeReceiptDigest: scope.stateDigest,
    tenantRef,
    status: blocked.length === 0 ? 'ROLLOUT_PLANNED' : 'PARTIAL_ROLLOUT_BLOCKED',
    sitePlans: sites.map((site) => ({
      siteId: site.siteId,
      employeeCount: site.employeeCount,
      templateDigest: site.templateDigest,
      blocked: blockedSet.has(site.siteId),
      overlay: { dataRegion: site.dataRegion },
    })),
    waves: [], blockedItems: [], blockedSiteIds: [...blocked].sort(), clonePlans: [], trainingAssignments: [], driftBaseline: {}, metrics: {},
    guardrails: { legalCoverageClaim: false, policyValuesInvented: false, crossRegionDataMovementAuthorised: false, secretCopyAuthorised: false, identityCopyAuthorised: false, productionWriteAuthorised: false },
    authority: { environmentProvisioningAuthorityGranted: false, integrationWriteAuthorityGranted: false, customerMutation: false, payrollMutation: false, identityMutation: false, productionMutation: false, modelAuthorityGranted: false, releaseAuthorityGranted: false },
  };
  return seal(core);
}

function policyReceipt(tenantRef, sites, options = {}) {
  const drift = new Set(options.drift || []);
  const blocked = new Set(options.blocked || []);
  const siteResolutions = sites.map((site) => ({
    siteId: site.siteId,
    country: 'GB', region: null, dataRegion: site.dataRegion,
    status: blocked.has(site.siteId) ? 'POLICY_BLOCKED' : 'POLICY_RESOLVED',
    blockers: blocked.has(site.siteId) ? [{ reason: 'synthetic-policy-block' }] : [],
    countryPack: {}, regionPack: null, effectiveConfigRefs: {},
    policyDigest: blocked.has(site.siteId) ? null : site.policyDigest,
    configurationDriftDetected: drift.has(site.siteId),
    legalCoverageClaim: false, productionChangeAuthorised: false,
  }));
  const core = {
    schemaVersion: 1, resolverVersion: '1.0.0', tenantRef, asOfDate: '2026-09-20',
    status: siteResolutions.every((s) => s.status === 'POLICY_RESOLVED') ? 'POLICY_RESOLUTION_READY' : 'PARTIAL_POLICY_RESOLUTION',
    siteResolutions, blockers: [], upcomingChanges: [], rolloutCountryPacks: [], metrics: {}, driftSiteIds: [...drift],
    guardrails: { legalCoverageClaim: false, policyValuesInvented: false, modelGeneratedAuthority: false, customerContactPerformed: false, automaticProductionChangePerformed: false, complianceCertificationClaim: false },
    authority: { policyMutationAuthorityGranted: false, productionMutation: false, customerMutation: false, payrollMutation: false, identityMutation: false, modelAuthorityGranted: false, executionAuthorityGranted: false, releaseAuthorityGranted: false },
  };
  return seal(core);
}

function capacity(regions, maxSites = 1000, maxEmployees = 1000000) {
  return regions.map((dataRegion) => ({
    dataRegion,
    capacityId: `pool-${dataRegion}`,
    provider: `provider-${dataRegion}`,
    source: 'preauthorised-capacity-registry',
    verified: true,
    evidenceDigest: d(`capacity:${dataRegion}`),
    observedAt: '2026-09-20T17:00:00Z',
    validUntil: '2026-09-21T17:00:00Z',
    maxSites,
    maxEmployees,
    preExistingCapacity: true,
    zeroIncrementalCost: true,
    billingImpact: 'none',
    privateNetworkOnly: true,
    publicIngress: false,
    tenantIsolationAttested: true,
    rollbackSupported: true,
  }));
}

const secrets = [
  { purpose: 'tenant-encryption-key', ref: 'secret://tenant/encryption', source: 'secret-manager', verified: true, evidenceDigest: d('secret:enc') },
  { purpose: 'runtime-signing-key', ref: 'secret://tenant/signing', source: 'secret-manager', verified: true, evidenceDigest: d('secret:sign') },
];
const asOf = '2026-09-20T18:00:00Z';

function expectMissingSecretFailure(secretReferences, missingPurpose) {
  assert.throws(
    () => planIsolatedEnvironmentProvisioning({
      scopeReceipt: scopeReceipt(1, 10),
      rolloutReceipt: rolloutReceipt(scopeReceipt(1, 10), 'tenant-secret-negative', topology(1, 10, ['uk'])),
      policyReceipt: policyReceipt('tenant-secret-negative', topology(1, 10, ['uk'])),
      capacityEvidence: capacity(['uk']),
      secretReferences,
      asOf,
    }),
    (error) => error.code === 'WFM_PROVISIONING_SECRET_REQUIRED' && String(error.message).includes(missingPurpose),
  );
}

expectMissingSecretFailure([], 'tenant-encryption-key');
expectMissingSecretFailure([secrets[0]], 'runtime-signing-key');
expectMissingSecretFailure([secrets[1]], 'tenant-encryption-key');

assert.throws(
  () => planIsolatedEnvironmentProvisioning({
    scopeReceipt: scopeReceipt(1, 10),
    rolloutReceipt: rolloutReceipt(scopeReceipt(1, 10), 'tenant-secret-duplicate', topology(1, 10, ['uk'])),
    policyReceipt: policyReceipt('tenant-secret-duplicate', topology(1, 10, ['uk'])),
    capacityEvidence: capacity(['uk']),
    secretReferences: [secrets[0], { ...secrets[0], ref: 'secret://tenant/encryption-duplicate', evidenceDigest: d('secret:enc:duplicate') }, secrets[1]],
    asOf,
  }),
  (error) => error.code === 'WFM_PROVISIONING_SECRET_REF',
);

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
  const scope = scopeReceipt(siteCount, employeeCount);
  const sites = topology(siteCount, employeeCount, regions);
  const rollout = rolloutReceipt(scope, `tenant-${siteCount}-${employeeCount}`, sites);
  const policy = policyReceipt(rollout.tenantRef, sites);
  const receipt = planIsolatedEnvironmentProvisioning({ scopeReceipt: scope, rolloutReceipt: rollout, policyReceipt: policy, capacityEvidence: capacity(regions), secretReferences: secrets, asOf });
  assert.equal(receipt.status, 'PROVISIONING_PLAN_READY');
  assert.equal(receipt.metrics.sitesReadyForIsolatedProvisioning, siteCount);
  assert.equal(receipt.metrics.sitesBlocked, 0);
  assert.equal(receipt.metrics.implementationQuestionsAdded, 0);
  assert.equal(receipt.metrics.manualProviderExecutionStepsRemoved, 0);
  assert.equal(receipt.metrics.realProvisioningExecuted, false);
  assert.equal(receipt.metrics.autonomousProvisioningProven, false);
  assert.equal(receipt.executionEnvelope.permitIssued, false);
  assert.equal(receipt.executionEnvelope.executionAuthorityGranted, false);
  assert.equal(receipt.executionEnvelope.llmMayExecute, false);
  assert.equal(verifyIsolatedEnvironmentProvisioningPlan(receipt), true);
  const replay = planIsolatedEnvironmentProvisioning({ scopeReceipt: scope, rolloutReceipt: rollout, policyReceipt: policy, capacityEvidence: capacity(regions), secretReferences: secrets, asOf });
  assert.deepEqual(replay, receipt);
  scaleResults.push({ siteCount, employeeCount, regions: receipt.metrics.regionsReady, planningStepsRemoved: receipt.metrics.simulatedManualProvisioningPlanningStepsRemoved, actions: receipt.metrics.deterministicActionsPlanned });
}

const scope = scopeReceipt(4, 400);
const sites = topology(4, 400, ['uk', 'eu']);
const rollout = rolloutReceipt(scope, 'tenant-compound', sites);
const policy = policyReceipt('tenant-compound', sites);

const partial = planIsolatedEnvironmentProvisioning({ scopeReceipt: scope, rolloutReceipt: rollout, policyReceipt: policy, capacityEvidence: capacity(['uk']), secretReferences: secrets, asOf });
assert.equal(partial.status, 'PARTIAL_PROVISIONING_BLOCKED');
assert.equal(partial.metrics.sitesReadyForIsolatedProvisioning, 2);
assert.equal(partial.metrics.sitesBlocked, 2);
assert.ok(partial.blockers.some((b) => b.reason === 'verified-zero-cost-private-capacity-required'));
assert.equal(verifyIsolatedEnvironmentProvisioningPlan(partial), true);

const costly = capacity(['uk', 'eu']);
costly[0].zeroIncrementalCost = false;
const costlyReceipt = planIsolatedEnvironmentProvisioning({ scopeReceipt: scope, rolloutReceipt: rollout, policyReceipt: policy, capacityEvidence: costly, secretReferences: secrets, asOf });
assert.ok(costlyReceipt.blockers.some((b) => b.reason === 'zero-incremental-cost-preexisting-capacity-required'));
assert.equal(costlyReceipt.guardrails.newSpendAuthorised, false);

const publicCapacity = capacity(['uk', 'eu']);
publicCapacity[1].publicIngress = true;
const publicBlocked = planIsolatedEnvironmentProvisioning({ scopeReceipt: scope, rolloutReceipt: rollout, policyReceipt: policy, capacityEvidence: publicCapacity, secretReferences: secrets, asOf });
assert.ok(publicBlocked.blockers.some((b) => b.reason === 'private-network-without-public-ingress-required'));
assert.equal(publicBlocked.guardrails.publicExposureAuthorised, false);

const staleCapacity = capacity(['uk', 'eu']);
staleCapacity[0].validUntil = '2026-09-20T17:30:00Z';
const stale = planIsolatedEnvironmentProvisioning({ scopeReceipt: scope, rolloutReceipt: rollout, policyReceipt: policy, capacityEvidence: staleCapacity, secretReferences: secrets, asOf });
assert.ok(stale.blockers.some((b) => b.reason === 'fresh-capacity-evidence-required'));

const insufficientCapacity = capacity(['uk', 'eu'], 1, 50);
const insufficient = planIsolatedEnvironmentProvisioning({ scopeReceipt: scope, rolloutReceipt: rollout, policyReceipt: policy, capacityEvidence: insufficientCapacity, secretReferences: secrets, asOf });
assert.equal(insufficient.status, 'PROVISIONING_BLOCKED');
assert.ok(insufficient.blockers.some((b) => b.reason === 'preexisting-capacity-insufficient'));

const driftPolicy = policyReceipt('tenant-compound', sites, { drift: [sites[0].siteId] });
const drift = planIsolatedEnvironmentProvisioning({ scopeReceipt: scope, rolloutReceipt: rollout, policyReceipt: driftPolicy, capacityEvidence: capacity(['uk', 'eu']), secretReferences: secrets, asOf });
assert.ok(drift.blockers.some((b) => b.reason === 'policy-drift-must-be-resolved'));
assert.equal(drift.metrics.sitesReadyForIsolatedProvisioning, 3);

const blockedRollout = rolloutReceipt(scope, 'tenant-compound', sites, [sites[1].siteId]);
const rolloutBlocked = planIsolatedEnvironmentProvisioning({ scopeReceipt: scope, rolloutReceipt: blockedRollout, policyReceipt: policy, capacityEvidence: capacity(['uk', 'eu']), secretReferences: secrets, asOf });
assert.ok(rolloutBlocked.blockers.some((b) => b.reason === 'rollout-site-blocked'));

const mismatchedPolicy = policyReceipt('tenant-compound', sites);
mismatchedPolicy.siteResolutions[0].dataRegion = 'wrong';
const mismatchedCore = structuredClone(mismatchedPolicy);
delete mismatchedCore.receiptDigest;
mismatchedPolicy.receiptDigest = digest(mismatchedCore);
assert.throws(
  () => planIsolatedEnvironmentProvisioning({ scopeReceipt: scope, rolloutReceipt: rollout, policyReceipt: mismatchedPolicy, capacityEvidence: capacity(['uk', 'eu']), secretReferences: secrets, asOf }),
  (error) => error.code === 'WFM_PROVISIONING_REGION_MISMATCH',
);

assert.throws(
  () => planIsolatedEnvironmentProvisioning({
    scopeReceipt: scope, rolloutReceipt: rollout, policyReceipt: policy, capacityEvidence: capacity(['uk', 'eu']), asOf,
    secretReferences: [{ purpose: 'tenant-encryption-key', ref: 'secret://tenant/encryption', source: 'secret-manager', verified: true, evidenceDigest: d('secret'), value: 'raw-secret' }],
  }),
  (error) => error.code === 'WFM_PROVISIONING_RAW_SECRET',
);

const forgedPermit = structuredClone(partial);
forgedPermit.executionEnvelope.permitIssued = true;
forgedPermit.executionEnvelope.executionAuthorityGranted = true;
const forgedPermitCore = structuredClone(forgedPermit);
delete forgedPermitCore.receiptDigest;
forgedPermit.receiptDigest = digest(forgedPermitCore);
assert.equal(verifyIsolatedEnvironmentProvisioningPlan(forgedPermit), false);

const forgedAction = structuredClone(partial);
forgedAction.regionPlans[0].actions.push({
  type: 'create-public-endpoint', target: 'internet', inputs: {}, idempotencyKey: d('fake'),
  productionWrite: false, customerDataMutation: false, payrollMutation: false, identityMutation: false, publicExposure: true, destructive: false,
});
forgedAction.executionEnvelope.actionBudget += 1;
forgedAction.metrics.deterministicActionsPlanned += 1;
const forgedActionCore = structuredClone(forgedAction);
delete forgedActionCore.receiptDigest;
forgedAction.receiptDigest = digest(forgedActionCore);
assert.equal(verifyIsolatedEnvironmentProvisioningPlan(forgedAction), false);

const missingMetadataSecret = structuredClone(partial);
missingMetadataSecret.secretReferences = missingMetadataSecret.secretReferences.filter((s) => s.purpose !== 'runtime-signing-key');
const missingMetadataSecretCore = structuredClone(missingMetadataSecret);
delete missingMetadataSecretCore.receiptDigest;
missingMetadataSecret.receiptDigest = digest(missingMetadataSecretCore);
assert.equal(verifyIsolatedEnvironmentProvisioningPlan(missingMetadataSecret), false);

const missingBindAction = structuredClone(partial);
missingBindAction.regionPlans[0].actions = missingBindAction.regionPlans[0].actions.filter(
  (action) => !(action.type === 'bind-secret-reference' && action.target === 'runtime-signing-key'),
);
missingBindAction.executionEnvelope.actionBudget -= 1;
missingBindAction.metrics.deterministicActionsPlanned -= 1;
const missingBindActionCore = structuredClone(missingBindAction);
delete missingBindActionCore.receiptDigest;
missingBindAction.receiptDigest = digest(missingBindActionCore);
assert.equal(verifyIsolatedEnvironmentProvisioningPlan(missingBindAction), false);

const duplicateBindAction = structuredClone(partial);
const duplicate = structuredClone(
  duplicateBindAction.regionPlans[0].actions.find(
    (action) => action.type === 'bind-secret-reference' && action.target === 'tenant-encryption-key',
  ),
);
duplicateBindAction.regionPlans[0].actions.push(duplicate);
duplicateBindAction.executionEnvelope.actionBudget += 1;
duplicateBindAction.metrics.deterministicActionsPlanned += 1;
const duplicateBindActionCore = structuredClone(duplicateBindAction);
delete duplicateBindActionCore.receiptDigest;
duplicateBindAction.receiptDigest = digest(duplicateBindActionCore);
assert.equal(verifyIsolatedEnvironmentProvisioningPlan(duplicateBindAction), false);

const wrongTenantPolicy = policyReceipt('other-tenant', sites);
assert.throws(
  () => planIsolatedEnvironmentProvisioning({ scopeReceipt: scope, rolloutReceipt: rollout, policyReceipt: wrongTenantPolicy, capacityEvidence: capacity(['uk', 'eu']), secretReferences: secrets, asOf }),
  (error) => error.code === 'WFM_PROVISIONING_POLICY',
);

const tamperedRollout = structuredClone(rollout);
tamperedRollout.sitePlans[0].employeeCount += 1;
assert.throws(
  () => planIsolatedEnvironmentProvisioning({ scopeReceipt: scope, rolloutReceipt: tamperedRollout, policyReceipt: policy, capacityEvidence: capacity(['uk', 'eu']), secretReferences: secrets, asOf }),
  (error) => error.code === 'WFM_PROVISIONING_ROLLOUT',
);

console.log(JSON.stringify({
  validator: 'isolated-environment-provisioning-plan',
  result: 'PASS',
  scaleCases: scaleResults,
  edgeCases: 19,
  humanTouch: {
    planningQuestionsAdded: 0,
    smallCustomerPlanningStepsRemoved: scaleResults[0].planningStepsRemoved,
    enterprise10000PlanningStepsRemoved: scaleResults.find((x) => x.employeeCount === 10000).planningStepsRemoved,
    stress25000PlanningStepsRemoved: scaleResults.find((x) => x.employeeCount === 25000).planningStepsRemoved,
    providerExecutionStepsRemoved: 0,
  },
  proofBoundary: {
    realProvisioningExecuted: false,
    autonomousProvisioningProven: false,
    permitIssued: false,
    llmExecutionAuthority: false,
  },
}));