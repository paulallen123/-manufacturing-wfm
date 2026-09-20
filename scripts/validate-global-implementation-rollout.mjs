import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { compileAdaptiveScope, digest: scopeDigest } = require('../resilience/adaptive-implementation-scope.cjs');
const { ROLLOUT_VERSION, compileGlobalImplementationRollout, verifyGlobalImplementationRollout, digest: rolloutDigest } = require('../resilience/global-implementation-rollout.cjs');

const d = (label) => rolloutDigest({ label });
function scopeFor({ sites, employees, payroll = true, agency = true }) {
  const contractEvent = { authenticated: true, completed: true, eventDigest: scopeDigest({ label: `contract:${sites}:${employees}:${payroll}:${agency}` }) };
  const ev = (key, value, source = 'contract') => ({ key, value, source, verified: true, evidenceDigest: scopeDigest({ key, value, source, sites, employees }) });
  const evidence = [
    ev('country.primary', 'GB'),
    ev('org.siteCount', sites),
    ev('workforce.employeeCount', employees),
    ev('payroll.enabled', payroll),
    ...(payroll ? [ev('payroll.provider', 'Synthetic Payroll', 'integration-fabric')] : []),
    ev('workforce.sourceSystem', 'Synthetic HCM', 'integration-fabric'),
    ev('time.captureMode', 'mixed', 'system-discovery'),
    ev('agency.enabled', agency),
    ...(agency ? [ev('agency.system', 'Synthetic VMS', 'integration-fabric')] : []),
    ev('training.roleGroups', ['employee', 'manager', 'ops-manager', 'finance', 'admin']),
  ];
  const receipt = compileAdaptiveScope({ contractEvent, evidence });
  assert.equal(receipt.status, 'SCOPED');
  assert.equal(receipt.questions.length, 0);
  return receipt;
}

function pack(country, version = '2026.09', source = 'policy-catalog') {
  return { country, packId: `policy-${country.toLowerCase()}`, version, effectiveFrom: '2026-09-01', source, verified: true, evidenceDigest: d(`policy:${country}:${version}:${source}`) };
}

function makeEnvironment({ siteCount, employeeCount, countries = ['GB'], compound = false, acquisition = false }) {
  const entities = countries.map((country, index) => ({ entityId: `entity-${index + 1}`, country, dataRegion: country === 'US' ? 'us' : 'eu' }));
  const allowedDataRegions = [...new Set(entities.map((e) => e.dataRegion))];
  const base = Math.floor(employeeCount / siteCount);
  let remainder = employeeCount - base * siteCount;
  const sites = [];
  for (let i = 0; i < siteCount; i++) {
    const country = countries[i % countries.length];
    const entityIndex = i % entities.length;
    const employees = base + (remainder-- > 0 ? 1 : 0);
    const site = {
      siteId: `site-${String(i + 1).padStart(3, '0')}`,
      entityId: entities[entityIndex].entityId,
      country,
      timezone: country === 'US' ? 'America/New_York' : country === 'DE' ? 'Europe/Berlin' : country === 'PL' ? 'Europe/Warsaw' : country === 'FR' ? 'Europe/Paris' : 'Europe/London',
      employeeCount: employees,
      dataRegion: country === 'US' ? 'us' : 'eu',
      connectivity: compound && i === siteCount - 1 ? 'low' : 'standard',
      operation: compound && i === siteCount - 1 ? '24x7' : (compound && i === siteCount - 2 ? 'highly-automated' : 'standard'),
      contractorHeavy: compound && i === siteCount - 1,
      languages: compound && i === siteCount - 1 ? ['en-GB', 'pl-PL'] : [country === 'DE' ? 'de-DE' : country === 'FR' ? 'fr-FR' : country === 'PL' ? 'pl-PL' : 'en-GB'],
      trainingProfile: compound && i === siteCount - 1 ? 'low-digital-confidence' : 'standard',
      device: compound && i === siteCount - 1 ? 'shared-terminal' : 'desktop',
      regionalOwnerRef: `region-${entityIndex + 1}`,
      overrides: i % 11 === 0 ? { 'shift.patternClass': compound ? 'continuous' : 'standard' } : {},
    };
    if (acquisition && i === siteCount - 1 && siteCount > 1) site.cloneOfSiteId = sites[0].siteId;
    sites.push(site);
  }
  return { tenantRef: 'synthetic-manufacturer', allowedDataRegions, entities, sites };
}

const scaleMatrix = [
  { employees: 1, sites: 1, countries: ['GB'] },
  { employees: 25, sites: 1, countries: ['GB'] },
  { employees: 100, sites: 2, countries: ['GB'] },
  { employees: 500, sites: 5, countries: ['GB', 'DE'] },
  { employees: 2000, sites: 10, countries: ['GB', 'DE', 'FR'] },
  { employees: 10000, sites: 50, countries: ['GB', 'DE', 'FR', 'PL', 'US'] },
  { employees: 25000, sites: 120, countries: ['GB', 'DE', 'FR', 'PL', 'US'] },
];

assert.equal(ROLLOUT_VERSION, '1.0.0');
const matrixResults = [];
for (const profile of scaleMatrix) {
  const environmentModel = makeEnvironment({ siteCount: profile.sites, employeeCount: profile.employees, countries: profile.countries, compound: profile.sites >= 10, acquisition: profile.sites >= 5 });
  const receipt = compileGlobalImplementationRollout({
    scopeReceipt: scopeFor({ sites: profile.sites, employees: profile.employees }),
    environmentModel,
    policyPacks: profile.countries.map((country) => pack(country)),
  });
  assert.equal(receipt.status, 'ROLLOUT_PLANNED');
  assert.equal(receipt.metrics.questionsAskedByRolloutPlanner, 0);
  assert.equal(receipt.metrics.manualRolloutPlanConstructionRequired, false);
  assert.equal(receipt.metrics.scheduledSites, profile.sites);
  assert.equal(receipt.metrics.blockedSites, 0);
  assert.equal(verifyGlobalImplementationRollout(receipt), true);
  assert.equal(receipt.guardrails.legalCoverageClaim, false);
  assert.equal(receipt.authority.productionMutation, false);
  assert.equal(receipt.authority.modelAuthorityGranted, false);
  matrixResults.push({
    employees: profile.employees,
    sites: profile.sites,
    countries: profile.countries.length,
    waves: receipt.metrics.waveCount,
    repeatedConfigEntriesAvoided: receipt.metrics.simulatedRepeatedConfigEntriesAvoided,
    trainingAssignments: receipt.metrics.trainingAssignments,
    manualRolloutPlanningTouch: receipt.metrics.manualRolloutPlanConstructionRequired,
  });
}

const small = compileGlobalImplementationRollout({
  scopeReceipt: scopeFor({ sites: 1, employees: 1, payroll: false, agency: false }),
  environmentModel: makeEnvironment({ siteCount: 1, employeeCount: 1, countries: ['GB'] }),
  policyPacks: [pack('GB')],
});
assert.equal(small.waves.length, 1);
assert.equal(small.waves[0].purpose, 'single-wave-self-start');
assert.equal(small.metrics.questionsAskedByRolloutPlanner, 0);

const global = compileGlobalImplementationRollout({
  scopeReceipt: scopeFor({ sites: 50, employees: 10000 }),
  environmentModel: makeEnvironment({ siteCount: 50, employeeCount: 10000, countries: ['GB', 'DE', 'FR', 'PL', 'US'], compound: true, acquisition: true }),
  policyPacks: ['GB', 'DE', 'FR', 'PL', 'US'].map((country) => pack(country)),
});
assert.ok(global.metrics.waveCount >= 5);
assert.ok(global.metrics.simulatedRepeatedConfigEntriesAvoided >= 300);
assert.ok(global.clonePlans.length >= 1);
assert.equal(global.clonePlans[0].secretsCopied, false);
assert.equal(global.clonePlans[0].identitiesCopied, false);
assert.equal(global.clonePlans[0].payrollStateCopied, false);
assert.ok(global.sitePlans.some((site) => site.requiredTests.includes('offline-sync-and-recovery')));
assert.ok(global.sitePlans.some((site) => site.requiredTests.includes('shift-midnight-and-timezone-boundary')));
assert.ok(global.sitePlans.some((site) => site.requiredTests.includes('contingent-worker-authority-and-mapping')));
assert.ok(global.sitePlans.some((site) => site.requiredTests.includes('production-interface-isolation')));
assert.ok(global.sitePlans.some((site) => site.requiredTests.includes('guided-training-comprehension-path')));
assert.equal(verifyGlobalImplementationRollout(global), true);

const repeatGlobal = compileGlobalImplementationRollout({
  scopeReceipt: scopeFor({ sites: 50, employees: 10000 }),
  environmentModel: makeEnvironment({ siteCount: 50, employeeCount: 10000, countries: ['GB', 'DE', 'FR', 'PL', 'US'], compound: true, acquisition: true }),
  policyPacks: ['GB', 'DE', 'FR', 'PL', 'US'].map((country) => pack(country)),
});
assert.equal(repeatGlobal.receiptDigest, global.receiptDigest, 'same topology and evidence must produce the same plan');

const partial = compileGlobalImplementationRollout({
  scopeReceipt: scopeFor({ sites: 4, employees: 400 }),
  environmentModel: makeEnvironment({ siteCount: 4, employeeCount: 400, countries: ['GB', 'DE'] }),
  policyPacks: [pack('GB')],
});
assert.equal(partial.status, 'PARTIAL_ROLLOUT_BLOCKED');
assert.ok(partial.blockedItems.some((item) => item.country === 'DE' && item.reason === 'verified-policy-pack-evidence-required'));
assert.ok(partial.blockedSiteIds.length > 0);
assert.ok(partial.metrics.scheduledSites > 0, 'safe regions may still be planned while an unproven jurisdiction is blocked');
assert.equal(partial.guardrails.legalCoverageClaim, false);
assert.equal(verifyGlobalImplementationRollout(partial), true);

const untrustedPolicy = compileGlobalImplementationRollout({
  scopeReceipt: scopeFor({ sites: 1, employees: 10 }),
  environmentModel: makeEnvironment({ siteCount: 1, employeeCount: 10, countries: ['GB'] }),
  policyPacks: [pack('GB', '2026.09', 'llm')],
});
assert.equal(untrustedPolicy.status, 'PARTIAL_ROLLOUT_BLOCKED');
assert.equal(untrustedPolicy.blockedItems[0].reason, 'verified-policy-pack-evidence-required');

assert.throws(() => compileGlobalImplementationRollout({
  scopeReceipt: scopeFor({ sites: 1, employees: 10 }),
  environmentModel: { ...makeEnvironment({ siteCount: 1, employeeCount: 10, countries: ['GB'] }), allowedDataRegions: ['us'] },
  policyPacks: [pack('GB')],
}), (error) => error?.code === 'WFM_GLOBAL_DATA_REGION');

assert.throws(() => compileGlobalImplementationRollout({
  scopeReceipt: scopeFor({ sites: 2, employees: 20 }),
  environmentModel: makeEnvironment({ siteCount: 1, employeeCount: 20, countries: ['GB'] }),
  policyPacks: [pack('GB')],
}), (error) => error?.code === 'WFM_GLOBAL_SCALE_DRIFT');

const badOverrideEnv = makeEnvironment({ siteCount: 1, employeeCount: 10, countries: ['GB'] });
badOverrideEnv.sites[0].overrides = { 'payroll.rule': 'model-guessed' };
assert.throws(() => compileGlobalImplementationRollout({
  scopeReceipt: scopeFor({ sites: 1, employees: 10 }),
  environmentModel: badOverrideEnv,
  policyPacks: [pack('GB')],
}), (error) => error?.code === 'WFM_GLOBAL_OVERRIDE');

const tampered = structuredClone(global);
tampered.authority.environmentProvisioningAuthorityGranted = true;
assert.equal(verifyGlobalImplementationRollout(tampered), false);

const resealed = structuredClone(global);
resealed.authority.modelAuthorityGranted = true;
const core = structuredClone(resealed);
delete core.receiptDigest;
resealed.receiptDigest = rolloutDigest(core);
assert.equal(verifyGlobalImplementationRollout(resealed), false, 're-sealing must not mint model authority');

console.log(JSON.stringify({
  schemaVersion: 1,
  proof: 'global-implementation-rollout-planner',
  status: 'PASS',
  scaleMatrix: matrixResults,
  smallCustomerSelfStart: {
    employees: 1,
    sites: 1,
    waves: small.metrics.waveCount,
    rolloutQuestions: small.metrics.questionsAskedByRolloutPlanner,
    manualRolloutPlanConstructionRequired: small.metrics.manualRolloutPlanConstructionRequired,
  },
  globalEnterprise: {
    employees: global.topology.employees,
    sites: global.topology.sites,
    countries: global.topology.countries.length,
    waves: global.metrics.waveCount,
    simulatedRepeatedConfigEntriesAvoided: global.metrics.simulatedRepeatedConfigEntriesAvoided,
    trainingAssignments: global.metrics.trainingAssignments,
    clonePlans: global.metrics.clonePlans,
  },
  partialJurisdictionFailureFailsClosedWithoutBlockingSafeRegions: true,
  lowConnectivityCoverage: true,
  contractorHeavyCoverage: true,
  continuousOperationCoverage: true,
  highlyAutomatedPlantCoverage: true,
  acquisitionCloneSecretAndIdentityNoncopy: true,
  untrustedPolicyEvidenceCannotBecomeAuthority: true,
  crossRegionDataBoundaryDenied: true,
  nonBoundedOverrideDenied: true,
  authorityEscalationDenied: true,
  legalCoverageClaim: false,
  productionMutation: false,
  customerMutation: false,
  payrollMutation: false,
  identityMutation: false,
  modelAuthorityGranted: false,
  releaseAuthorityGranted: false,
}, null, 2));
