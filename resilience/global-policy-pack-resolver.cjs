'use strict';

const { createHash } = require('node:crypto');

const POLICY_PACK_RESOLVER_VERSION = '1.0.0';
const TRUSTED_SOURCES = new Set(['policy-catalog', 'contract', 'system-discovery']);
const CONFIG_KEYS = Object.freeze([
  'calendarRef',
  'workingTimeProfileRef',
  'payCycleInterfaceRef',
  'leaveModelRef',
  'retentionProfileRef',
  'residencyProfileRef',
  'attendanceRuleSetRef',
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

function validRef(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(value);
}

function validCountry(value) {
  return typeof value === 'string' && /^[A-Z]{2}$/.test(value);
}

function validRegion(value) {
  return value == null || (typeof value === 'string' && /^[A-Z0-9][A-Z0-9-]{0,15}$/.test(value));
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function activeOn(pack, asOfDate) {
  if (pack.effectiveFrom > asOfDate) return false;
  if (pack.effectiveTo && pack.effectiveTo < asOfDate) return false;
  return true;
}

function normalizeConfigRefs(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const output = {};
  for (const key of Object.keys(input).sort()) {
    if (!CONFIG_KEYS.includes(key) || !validRef(input[key])) return null;
    output[key] = input[key];
  }
  return output;
}

function normalizePack(pack) {
  if (!pack || typeof pack !== 'object') return null;
  if (pack.verified !== true || !TRUSTED_SOURCES.has(pack.source) || !isDigest(pack.evidenceDigest)) return null;
  if (!validCountry(pack.country) || !validRegion(pack.region) || !validRef(pack.packId)) return null;
  if (typeof pack.version !== 'string' || pack.version.length < 1 || pack.version.length > 40) return null;
  if (!validDate(pack.effectiveFrom) || (pack.effectiveTo != null && !validDate(pack.effectiveTo))) return null;
  if (pack.effectiveTo && pack.effectiveTo < pack.effectiveFrom) return null;
  const configRefs = normalizeConfigRefs(pack.configRefs);
  if (!configRefs || Object.keys(configRefs).length === 0) return null;
  const allowedDataRegions = pack.allowedDataRegions === undefined
    ? []
    : Array.isArray(pack.allowedDataRegions) && pack.allowedDataRegions.every(validRef)
      ? [...new Set(pack.allowedDataRegions)].sort()
      : null;
  if (allowedDataRegions === null) return null;
  const allowedSiteOverrideKeys = pack.allowedSiteOverrideKeys === undefined
    ? []
    : Array.isArray(pack.allowedSiteOverrideKeys) && pack.allowedSiteOverrideKeys.every((key) => CONFIG_KEYS.includes(key))
      ? [...new Set(pack.allowedSiteOverrideKeys)].sort()
      : null;
  if (allowedSiteOverrideKeys === null) return null;
  return {
    country: pack.country,
    region: pack.region || null,
    packId: pack.packId,
    version: pack.version,
    effectiveFrom: pack.effectiveFrom,
    effectiveTo: pack.effectiveTo || null,
    source: pack.source,
    evidenceDigest: pack.evidenceDigest,
    configRefs,
    allowedDataRegions,
    allowedSiteOverrideKeys,
    legalCoverageClaim: false,
  };
}

function scopeKey(pack) {
  return `${pack.country}:${pack.region || '*'}`;
}

function selectActivePack(packs, country, region, asOfDate) {
  const candidates = packs.filter((pack) => pack.country === country && (pack.region || null) === (region || null) && activeOn(pack, asOfDate));
  if (candidates.length === 0) return { selected: null, conflict: null };
  const identities = new Set(candidates.map((pack) => digest({
    packId: pack.packId,
    version: pack.version,
    effectiveFrom: pack.effectiveFrom,
    effectiveTo: pack.effectiveTo,
    configRefs: pack.configRefs,
    allowedDataRegions: pack.allowedDataRegions,
    allowedSiteOverrideKeys: pack.allowedSiteOverrideKeys,
  })));
  if (identities.size > 1) {
    return {
      selected: null,
      conflict: {
        country,
        region: region || null,
        reason: 'overlapping-verified-policy-packs',
        evidenceDigests: candidates.map((pack) => pack.evidenceDigest).sort(),
      },
    };
  }
  const selected = candidates.slice().sort((a, b) => a.source.localeCompare(b.source) || a.evidenceDigest.localeCompare(b.evidenceDigest))[0];
  return { selected, conflict: null };
}

function upcomingChanges(packs, asOfDate) {
  const seen = new Set();
  const changes = [];
  for (const pack of packs.slice().sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || scopeKey(a).localeCompare(scopeKey(b)) || a.packId.localeCompare(b.packId))) {
    if (pack.effectiveFrom <= asOfDate) continue;
    const key = `${scopeKey(pack)}:${pack.effectiveFrom}:${pack.packId}:${pack.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    changes.push({
      country: pack.country,
      region: pack.region,
      effectiveFrom: pack.effectiveFrom,
      packId: pack.packId,
      version: pack.version,
      evidenceDigest: pack.evidenceDigest,
      action: 're-resolve-before-effective-date',
      automaticProductionChangeAuthorised: false,
    });
  }
  return changes;
}

function normalizeSites(sites) {
  if (!Array.isArray(sites) || sites.length === 0) fail('WFM_POLICY_SITES', 'at least one site is required');
  const ids = new Set();
  return sites.map((site) => {
    if (!site || !validRef(site.siteId) || ids.has(site.siteId)) fail('WFM_POLICY_SITE', 'site IDs must be unique and valid');
    ids.add(site.siteId);
    if (!validCountry(site.country) || !validRegion(site.region) || !validRef(site.dataRegion)) fail('WFM_POLICY_SITE', `site ${site.siteId} requires country, optional region and dataRegion`);
    if (site.regionalPolicyRequired === true && !site.region) fail('WFM_POLICY_REGION', `site ${site.siteId} requires an explicit region`);
    const overrides = site.policyOverrides === undefined ? {} : normalizeConfigRefs(site.policyOverrides);
    if (overrides === null) fail('WFM_POLICY_OVERRIDE', `site ${site.siteId} has invalid policy override keys or values`);
    const overrideEvidence = site.overrideEvidence && typeof site.overrideEvidence === 'object' && !Array.isArray(site.overrideEvidence)
      ? site.overrideEvidence
      : {};
    return {
      siteId: site.siteId,
      country: site.country,
      region: site.region || null,
      dataRegion: site.dataRegion,
      regionalPolicyRequired: site.regionalPolicyRequired === true,
      policyOverrides: overrides,
      overrideEvidence: clone(overrideEvidence),
      currentPolicyDigest: site.currentPolicyDigest || null,
    };
  });
}

function trustedOverrideEvidence(item) {
  return item && item.verified === true && TRUSTED_SOURCES.has(item.source) && isDigest(item.evidenceDigest);
}

function resolveGlobalPolicyPacks({ tenantRef, asOfDate, sites, policyPacks = [] } = {}) {
  if (!validRef(tenantRef)) fail('WFM_POLICY_TENANT', 'valid tenantRef is required');
  if (!validDate(asOfDate)) fail('WFM_POLICY_DATE', 'valid asOfDate is required');
  const normalizedSites = normalizeSites(sites);
  const normalizedPacks = policyPacks.map(normalizePack).filter(Boolean);

  const siteResolutions = [];
  const blockers = [];
  const ignoredPolicyPacks = policyPacks.length - normalizedPacks.length;
  let trustedOverridesApplied = 0;

  for (const site of normalizedSites.slice().sort((a, b) => a.siteId.localeCompare(b.siteId))) {
    const baseSelection = selectActivePack(normalizedPacks, site.country, null, asOfDate);
    const regionalSelection = site.region ? selectActivePack(normalizedPacks, site.country, site.region, asOfDate) : { selected: null, conflict: null };
    const siteBlockers = [];
    if (baseSelection.conflict) siteBlockers.push(baseSelection.conflict);
    if (regionalSelection.conflict) siteBlockers.push(regionalSelection.conflict);
    if (!baseSelection.selected) siteBlockers.push({ country: site.country, region: null, reason: 'verified-country-policy-pack-required' });
    if (site.regionalPolicyRequired && !regionalSelection.selected) siteBlockers.push({ country: site.country, region: site.region, reason: 'verified-regional-policy-pack-required' });

    const effectiveRefs = baseSelection.selected ? clone(baseSelection.selected.configRefs) : {};
    let allowedDataRegions = new Set(baseSelection.selected?.allowedDataRegions || []);
    const allowedSiteOverrideKeys = new Set(baseSelection.selected?.allowedSiteOverrideKeys || []);

    if (regionalSelection.selected) {
      for (const [key, value] of Object.entries(regionalSelection.selected.configRefs)) effectiveRefs[key] = value;
      // A more-specific regional residency boundary may narrow the country boundary; never union it into a broader allowlist.
      if (regionalSelection.selected.allowedDataRegions.length > 0) allowedDataRegions = new Set(regionalSelection.selected.allowedDataRegions);
      for (const key of regionalSelection.selected.allowedSiteOverrideKeys) allowedSiteOverrideKeys.add(key);
    }

    if (allowedDataRegions.size > 0 && !allowedDataRegions.has(site.dataRegion)) {
      siteBlockers.push({
        country: site.country,
        region: site.region,
        siteId: site.siteId,
        reason: 'data-region-not-authorised-by-policy-evidence',
        dataRegion: site.dataRegion,
      });
    }

    for (const [key, value] of Object.entries(site.policyOverrides)) {
      const evidence = site.overrideEvidence[key];
      if (!allowedSiteOverrideKeys.has(key)) {
        siteBlockers.push({ siteId: site.siteId, reason: 'site-policy-override-not-allowed', key });
        continue;
      }
      if (!trustedOverrideEvidence(evidence)) {
        siteBlockers.push({ siteId: site.siteId, reason: 'trusted-site-override-evidence-required', key });
        continue;
      }
      effectiveRefs[key] = value;
      trustedOverridesApplied += 1;
    }

    const policyCore = {
      countryPack: baseSelection.selected ? {
        packId: baseSelection.selected.packId,
        version: baseSelection.selected.version,
        effectiveFrom: baseSelection.selected.effectiveFrom,
        effectiveTo: baseSelection.selected.effectiveTo,
        evidenceDigest: baseSelection.selected.evidenceDigest,
      } : null,
      regionPack: regionalSelection.selected ? {
        packId: regionalSelection.selected.packId,
        version: regionalSelection.selected.version,
        effectiveFrom: regionalSelection.selected.effectiveFrom,
        effectiveTo: regionalSelection.selected.effectiveTo,
        evidenceDigest: regionalSelection.selected.evidenceDigest,
      } : null,
      effectiveConfigRefs: canonical(effectiveRefs),
      dataRegion: site.dataRegion,
    };
    const policyDigest = Object.keys(effectiveRefs).length > 0 ? digest(policyCore) : null;
    const drift = site.currentPolicyDigest && policyDigest ? site.currentPolicyDigest !== policyDigest : false;
    const status = siteBlockers.length === 0 ? 'POLICY_RESOLVED' : 'POLICY_BLOCKED';
    for (const blocker of siteBlockers) blockers.push({ siteId: site.siteId, ...clone(blocker) });
    siteResolutions.push({
      siteId: site.siteId,
      country: site.country,
      region: site.region,
      dataRegion: site.dataRegion,
      status,
      blockers: siteBlockers,
      countryPack: policyCore.countryPack,
      regionPack: policyCore.regionPack,
      effectiveConfigRefs: canonical(effectiveRefs),
      policyDigest,
      configurationDriftDetected: drift,
      legalCoverageClaim: false,
      productionChangeAuthorised: false,
    });
  }

  const resolvedSites = siteResolutions.filter((site) => site.status === 'POLICY_RESOLVED');
  const blockedSites = siteResolutions.length - resolvedSites.length;
  const rolloutCountryPacks = [];
  for (const country of [...new Set(normalizedSites.map((site) => site.country))].sort()) {
    const countrySites = siteResolutions.filter((site) => site.country === country);
    if (countrySites.some((site) => site.status !== 'POLICY_RESOLVED')) continue;
    const first = countrySites[0]?.countryPack;
    if (!first) continue;
    const allSame = countrySites.every((site) => site.countryPack && digest(site.countryPack) === digest(first));
    if (!allSame) continue;
    rolloutCountryPacks.push({
      country,
      packId: first.packId,
      version: first.version,
      effectiveFrom: first.effectiveFrom,
      source: 'policy-catalog',
      verified: true,
      evidenceDigest: first.evidenceDigest,
      legalCoverageClaim: false,
    });
  }

  const upcoming = upcomingChanges(normalizedPacks, asOfDate);
  const driftSites = siteResolutions.filter((site) => site.configurationDriftDetected).map((site) => site.siteId);
  const manualFieldCopiesAvoided = resolvedSites.reduce((sum, site) => sum + Object.keys(site.effectiveConfigRefs).length, 0);
  const core = {
    schemaVersion: 1,
    resolverVersion: POLICY_PACK_RESOLVER_VERSION,
    tenantRef,
    asOfDate,
    status: blockedSites === 0 ? 'POLICY_RESOLUTION_READY' : resolvedSites.length > 0 ? 'PARTIAL_POLICY_RESOLUTION' : 'POLICY_RESOLUTION_BLOCKED',
    siteResolutions,
    blockers,
    upcomingChanges: upcoming,
    rolloutCountryPacks,
    metrics: {
      sitesEvaluated: siteResolutions.length,
      sitesResolved: resolvedSites.length,
      sitesBlocked: blockedSites,
      countriesEvaluated: new Set(normalizedSites.map((site) => site.country)).size,
      policyPacksReceived: policyPacks.length,
      trustedPolicyPacksAccepted: normalizedPacks.length,
      policyPacksIgnored: ignoredPolicyPacks,
      trustedSiteOverridesApplied: trustedOverridesApplied,
      configurationDriftSites: driftSites.length,
      manualPolicyPackSelectionsRemoved: resolvedSites.length,
      simulatedManualPolicyFieldCopiesAvoided: manualFieldCopiesAvoided,
      questionsAdded: 0,
      upcomingEffectiveDatedChanges: upcoming.length,
    },
    driftSiteIds: driftSites,
    guardrails: {
      legalCoverageClaim: false,
      policyValuesInvented: false,
      modelGeneratedAuthority: false,
      customerContactPerformed: false,
      automaticProductionChangePerformed: false,
      complianceCertificationClaim: false,
    },
    authority: {
      policyMutationAuthorityGranted: false,
      productionMutation: false,
      customerMutation: false,
      payrollMutation: false,
      identityMutation: false,
      modelAuthorityGranted: false,
      executionAuthorityGranted: false,
      releaseAuthorityGranted: false,
    },
  };
  return { ...core, receiptDigest: digest(core) };
}

function verifyGlobalPolicyPackResolution(receipt, inputs) {
  if (!receipt || !inputs || receipt.schemaVersion !== 1 || receipt.resolverVersion !== POLICY_PACK_RESOLVER_VERSION || !isDigest(receipt.receiptDigest)) return false;
  if (!receipt.authority || Object.values(receipt.authority).some((value) => value !== false)) return false;
  if (!receipt.guardrails || Object.values(receipt.guardrails).some((value) => value !== false)) return false;
  let rebuilt;
  try { rebuilt = resolveGlobalPolicyPacks(inputs); } catch { return false; }
  return JSON.stringify(receipt) === JSON.stringify(rebuilt);
}

module.exports = {
  POLICY_PACK_RESOLVER_VERSION,
  CONFIG_KEYS,
  resolveGlobalPolicyPacks,
  verifyGlobalPolicyPackResolution,
  digest,
};
