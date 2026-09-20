import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  POLICY_PACK_RESOLVER_VERSION,
  resolveGlobalPolicyPacks,
  verifyGlobalPolicyPackResolution,
  digest,
} = require('../resilience/global-policy-pack-resolver.cjs');

const d = (label) => digest({ label });
function pack(country, { region = null, version = '2026.09', from = '2026-09-01', to = null, source = 'policy-catalog', allowedDataRegions = [], configRefs = {}, allowedSiteOverrideKeys = [] } = {}) {
  return {
    country, region, packId: `policy-${country.toLowerCase()}${region ? `-${region.toLowerCase()}` : ''}`,
    version, effectiveFrom: from, effectiveTo: to, source, verified: true,
    evidenceDigest: d(`policy:${country}:${region || '*'}:${version}:${from}:${source}`),
    configRefs: {
      calendarRef: `calendar/${country}/${version}`,
      workingTimeProfileRef: `working-time/${country}/${version}`,
      leaveModelRef: `leave/${country}/${version}`,
      retentionProfileRef: `retention/${country}/${version}`,
      residencyProfileRef: `residency/${country}/${version}`,
      ...configRefs,
    },
    allowedDataRegions,
    allowedSiteOverrideKeys,
  };
}

function site(i, country = 'GB', dataRegion = 'eu', extras = {}) {
  return { siteId: `site-${String(i).padStart(3, '0')}`, country, dataRegion, ...extras };
}

assert.equal(POLICY_PACK_RESOLVER_VERSION, '1.0.0');

const singleInputs = {
  tenantRef: 'small-manufacturer',
  asOfDate: '2026-09-20',
  sites: [site(1)],
  policyPacks: [pack('GB', { allowedDataRegions: ['eu'] })],
};
const single = resolveGlobalPolicyPacks(singleInputs);
assert.equal(single.status, 'POLICY_RESOLUTION_READY');
assert.equal(single.metrics.sitesResolved, 1);
assert.equal(single.metrics.manualPolicyPackSelectionsRemoved, 1);
assert.equal(single.metrics.questionsAdded, 0);
assert.equal(single.siteResolutions[0].legalCoverageClaim, false);
assert.equal(verifyGlobalPolicyPackResolution(single, singleInputs), true);

const countries = ['GB', 'DE', 'FR', 'PL', 'US'];
function scaleInputs(siteCount, employeeLabel) {
  const sites = Array.from({ length: siteCount }, (_, idx) => {
    const country = countries[idx % countries.length];
    return site(idx + 1, country, country === 'US' ? 'us' : 'eu');
  });
  return {
    tenantRef: `synthetic-${employeeLabel}`,
    asOfDate: '2026-09-20',
    sites,
    policyPacks: countries.map((country) => pack(country, { allowedDataRegions: [country === 'US' ? 'us' : 'eu'] })),
  };
}
const scaleProfiles = [
  { employees: 1, sites: 1 },
  { employees: 25, sites: 1 },
  { employees: 100, sites: 2 },
  { employees: 500, sites: 5 },
  { employees: 2000, sites: 10 },
  { employees: 10000, sites: 50 },
  { employees: 25000, sites: 120 },
];
const matrix = [];
for (const profile of scaleProfiles) {
  const inputs = scaleInputs(profile.sites, profile.employees);
  if (profile.sites < 5) inputs.policyPacks = [...new Set(inputs.sites.map((s) => s.country))].map((country) => pack(country, { allowedDataRegions: [country === 'US' ? 'us' : 'eu'] }));
  const receipt = resolveGlobalPolicyPacks(inputs);
  assert.equal(receipt.status, 'POLICY_RESOLUTION_READY');
  assert.equal(receipt.metrics.sitesResolved, profile.sites);
  assert.equal(receipt.metrics.sitesBlocked, 0);
  assert.equal(receipt.metrics.questionsAdded, 0);
  assert.equal(verifyGlobalPolicyPackResolution(receipt, inputs), true);
  matrix.push({ employees: profile.employees, sites: profile.sites, manualPolicyPackSelectionsRemoved: receipt.metrics.manualPolicyPackSelectionsRemoved, fieldCopiesAvoided: receipt.metrics.simulatedManualPolicyFieldCopiesAvoided });
}

const datedInputs = {
  tenantRef: 'effective-date-customer',
  asOfDate: '2026-09-20',
  sites: [site(1)],
  policyPacks: [
    pack('GB', { version: '2026.09', from: '2026-09-01', to: '2026-09-30', allowedDataRegions: ['eu'] }),
    pack('GB', { version: '2026.10', from: '2026-10-01', allowedDataRegions: ['eu'] }),
  ],
};
const dated = resolveGlobalPolicyPacks(datedInputs);
assert.equal(dated.siteResolutions[0].countryPack.version, '2026.09');
assert.equal(dated.upcomingChanges.length, 1);
assert.equal(dated.upcomingChanges[0].effectiveFrom, '2026-10-01');
assert.equal(dated.upcomingChanges[0].automaticProductionChangeAuthorised, false);

const regionalInputs = {
  tenantRef: 'regional-customer',
  asOfDate: '2026-09-20',
  sites: [site(1, 'US', 'us', { region: 'CA', regionalPolicyRequired: true })],
  policyPacks: [
    pack('US', { allowedDataRegions: ['us'], configRefs: { leaveModelRef: 'leave/us/base' } }),
    pack('US', { region: 'CA', allowedDataRegions: ['us'], configRefs: { leaveModelRef: 'leave/us/ca', calendarRef: 'calendar/us/ca' } }),
  ],
};
const regional = resolveGlobalPolicyPacks(regionalInputs);
assert.equal(regional.status, 'POLICY_RESOLUTION_READY');
assert.equal(regional.siteResolutions[0].regionPack.packId, 'policy-us-ca');
assert.equal(regional.siteResolutions[0].effectiveConfigRefs.leaveModelRef, 'leave/us/ca');

const missingRegionInputs = { ...regionalInputs, policyPacks: [pack('US', { allowedDataRegions: ['us'] })] };
const missingRegion = resolveGlobalPolicyPacks(missingRegionInputs);
assert.equal(missingRegion.status, 'POLICY_RESOLUTION_BLOCKED');
assert.ok(missingRegion.blockers.some((b) => b.reason === 'verified-regional-policy-pack-required'));

const overlapInputs = {
  tenantRef: 'compound-enterprise', asOfDate: '2026-09-20',
  sites: [site(1, 'GB', 'eu'), site(2, 'DE', 'eu')],
  policyPacks: [
    pack('GB', { version: 'a', from: '2026-09-01', allowedDataRegions: ['eu'] }),
    pack('GB', { version: 'b', from: '2026-09-15', allowedDataRegions: ['eu'] }),
    pack('DE', { allowedDataRegions: ['eu'] }),
  ],
};
const overlap = resolveGlobalPolicyPacks(overlapInputs);
assert.equal(overlap.status, 'PARTIAL_POLICY_RESOLUTION');
assert.equal(overlap.metrics.sitesResolved, 1);
assert.equal(overlap.metrics.sitesBlocked, 1);
assert.equal(overlap.rolloutCountryPacks.some((p) => p.country === 'GB'), false);
assert.equal(overlap.rolloutCountryPacks.some((p) => p.country === 'DE'), true);

const untrustedInputs = {
  tenantRef: 'untrusted-source', asOfDate: '2026-09-20', sites: [site(1)],
  policyPacks: [pack('GB', { source: 'llm', allowedDataRegions: ['eu'] })],
};
const untrusted = resolveGlobalPolicyPacks(untrustedInputs);
assert.equal(untrusted.status, 'POLICY_RESOLUTION_BLOCKED');
assert.equal(untrusted.metrics.policyPacksIgnored, 1);
assert.equal(untrusted.authority.modelAuthorityGranted, false);

const residencyInputs = {
  tenantRef: 'residency-mismatch', asOfDate: '2026-09-20', sites: [site(1, 'GB', 'us')],
  policyPacks: [pack('GB', { allowedDataRegions: ['eu'] })],
};
const residency = resolveGlobalPolicyPacks(residencyInputs);
assert.equal(residency.status, 'POLICY_RESOLUTION_BLOCKED');
assert.ok(residency.blockers.some((b) => b.reason === 'data-region-not-authorised-by-policy-evidence'));

const overridePack = pack('GB', { allowedDataRegions: ['eu'], allowedSiteOverrideKeys: ['calendarRef'] });
const overrideInputs = {
  tenantRef: 'trusted-override', asOfDate: '2026-09-20',
  sites: [site(1, 'GB', 'eu', { policyOverrides: { calendarRef: 'calendar/gb/site-local' }, overrideEvidence: { calendarRef: { verified: true, source: 'contract', evidenceDigest: d('override-calendar') } } })],
  policyPacks: [overridePack],
};
const override = resolveGlobalPolicyPacks(overrideInputs);
assert.equal(override.status, 'POLICY_RESOLUTION_READY');
assert.equal(override.siteResolutions[0].effectiveConfigRefs.calendarRef, 'calendar/gb/site-local');
assert.equal(override.metrics.trustedSiteOverridesApplied, 1);

const badOverrideInputs = structuredClone(overrideInputs);
badOverrideInputs.sites[0].overrideEvidence.calendarRef.source = 'llm';
const badOverride = resolveGlobalPolicyPacks(badOverrideInputs);
assert.equal(badOverride.status, 'POLICY_RESOLUTION_BLOCKED');
assert.ok(badOverride.blockers.some((b) => b.reason === 'trusted-site-override-evidence-required'));

const driftInputs = structuredClone(singleInputs);
const baseline = resolveGlobalPolicyPacks(driftInputs);
driftInputs.sites[0].currentPolicyDigest = '0'.repeat(64);
const drift = resolveGlobalPolicyPacks(driftInputs);
assert.equal(drift.metrics.configurationDriftSites, 1);
assert.deepEqual(drift.driftSiteIds, ['site-001']);
assert.notEqual(baseline.siteResolutions[0].policyDigest, null);

assert.throws(() => resolveGlobalPolicyPacks({ tenantRef: 'duplicate', asOfDate: '2026-09-20', sites: [site(1), site(1)], policyPacks: [pack('GB')] }), (error) => error?.code === 'WFM_POLICY_SITE');

const tampered = structuredClone(single);
tampered.authority.policyMutationAuthorityGranted = true;
assert.equal(verifyGlobalPolicyPackResolution(tampered, singleInputs), false);
const resealed = structuredClone(single);
resealed.siteResolutions[0].effectiveConfigRefs.calendarRef = 'calendar/forged';
const resealedCore = structuredClone(resealed); delete resealedCore.receiptDigest;
resealed.receiptDigest = digest(resealedCore);
assert.equal(verifyGlobalPolicyPackResolution(resealed, singleInputs), false, 're-sealed policy substitution must fail');
const forgedLegal = structuredClone(single);
forgedLegal.guardrails.legalCoverageClaim = true;
const forgedLegalCore = structuredClone(forgedLegal); delete forgedLegalCore.receiptDigest;
forgedLegal.receiptDigest = digest(forgedLegalCore);
assert.equal(verifyGlobalPolicyPackResolution(forgedLegal, singleInputs), false, 're-sealing cannot mint legal coverage claims');

console.log(JSON.stringify({
  schemaVersion: 1,
  proof: 'global-policy-pack-resolver',
  status: 'PASS',
  scaleMatrix: matrix,
  effectiveDating: true,
  futureChangeDetection: true,
  regionalInheritanceAndOverride: true,
  partialCountryFailureDoesNotBlockSafeCountry: true,
  trustedSiteOverrideEvidenceRequired: true,
  untrustedModelPolicyIgnored: true,
  dataRegionMismatchFailsClosed: true,
  driftDetection: true,
  resealedPolicySubstitutionDenied: true,
  resealedLegalClaimDenied: true,
  legalCoverageClaim: false,
  productionMutation: false,
  customerMutation: false,
  payrollMutation: false,
  identityMutation: false,
  modelAuthorityGranted: false,
  releaseAuthorityGranted: false,
}, null, 2));
