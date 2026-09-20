'use strict';

const { createHash } = require('node:crypto');
const { verifyScopeReceipt } = require('./adaptive-implementation-scope.cjs');

const ROLLOUT_VERSION = '1.0.0';
const TRUSTED_POLICY_SOURCES = new Set(['policy-catalog', 'contract', 'system-discovery']);
const ALLOWED_CONNECTIVITY = new Set(['standard', 'low']);
const ALLOWED_OPERATIONS = new Set(['standard', '24x7', 'highly-automated']);
const ALLOWED_TRAINING_PROFILES = new Set(['standard', 'guided', 'low-digital-confidence']);
const ALLOWED_DEVICES = new Set(['desktop', 'mobile', 'shared-terminal', 'mixed']);
const ALLOWED_OVERRIDE_KEYS = new Set([
  'time.captureMode',
  'training.profile',
  'training.device',
  'attendance.sourceClass',
  'shift.patternClass',
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

function isDigest(value) {
  return /^[a-f0-9]{64}$/.test(String(value || ''));
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function validId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(value);
}

function validCountry(value) {
  return typeof value === 'string' && /^[A-Z]{2}$/.test(value);
}

function validTimezone(value) {
  return value === 'UTC' || (typeof value === 'string' && /^[A-Za-z_+-]+\/[A-Za-z0-9_+\-/]+$/.test(value));
}

function validLanguage(value) {
  return typeof value === 'string' && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(value);
}

function assertEnvironmentModel(model) {
  if (!model || typeof model !== 'object') fail('WFM_GLOBAL_MODEL', 'environment model is required');
  if (!validId(model.tenantRef)) fail('WFM_GLOBAL_MODEL', 'valid tenantRef is required');
  if (!Array.isArray(model.allowedDataRegions) || model.allowedDataRegions.length === 0 || !model.allowedDataRegions.every(validId)) {
    fail('WFM_GLOBAL_DATA_REGION', 'at least one explicit allowed data region is required');
  }
  const allowedRegions = new Set(model.allowedDataRegions);
  if (!Array.isArray(model.entities) || model.entities.length === 0) fail('WFM_GLOBAL_MODEL', 'at least one entity is required');
  if (!Array.isArray(model.sites) || model.sites.length === 0) fail('WFM_GLOBAL_MODEL', 'at least one site is required');

  const entityIds = new Set();
  for (const entity of model.entities) {
    if (!entity || !validId(entity.entityId) || entityIds.has(entity.entityId)) fail('WFM_GLOBAL_ENTITY', 'entity IDs must be unique and valid');
    entityIds.add(entity.entityId);
    if (!validCountry(entity.country)) fail('WFM_GLOBAL_ENTITY', `entity ${entity.entityId} requires an ISO country code`);
    if (!validId(entity.dataRegion) || !allowedRegions.has(entity.dataRegion)) fail('WFM_GLOBAL_DATA_REGION', `entity ${entity.entityId} is outside allowed data regions`);
  }

  const siteIds = new Set();
  for (const site of model.sites) {
    if (!site || !validId(site.siteId) || siteIds.has(site.siteId)) fail('WFM_GLOBAL_SITE', 'site IDs must be unique and valid');
    siteIds.add(site.siteId);
    if (!entityIds.has(site.entityId)) fail('WFM_GLOBAL_SITE', `site ${site.siteId} references an unknown entity`);
    if (!validCountry(site.country)) fail('WFM_GLOBAL_SITE', `site ${site.siteId} requires an ISO country code`);
    if (!validTimezone(site.timezone)) fail('WFM_GLOBAL_SITE', `site ${site.siteId} requires an explicit IANA timezone`);
    if (!Number.isSafeInteger(site.employeeCount) || site.employeeCount < 1 || site.employeeCount > 1000000) fail('WFM_GLOBAL_SITE', `site ${site.siteId} has invalid employee count`);
    if (!validId(site.dataRegion) || !allowedRegions.has(site.dataRegion)) fail('WFM_GLOBAL_DATA_REGION', `site ${site.siteId} is outside allowed data regions`);
    if (!ALLOWED_CONNECTIVITY.has(site.connectivity || 'standard')) fail('WFM_GLOBAL_SITE', `site ${site.siteId} has invalid connectivity class`);
    if (!ALLOWED_OPERATIONS.has(site.operation || 'standard')) fail('WFM_GLOBAL_SITE', `site ${site.siteId} has invalid operation class`);
    if (!ALLOWED_TRAINING_PROFILES.has(site.trainingProfile || 'standard')) fail('WFM_GLOBAL_SITE', `site ${site.siteId} has invalid training profile`);
    if (!ALLOWED_DEVICES.has(site.device || 'desktop')) fail('WFM_GLOBAL_SITE', `site ${site.siteId} has invalid device class`);
    if (!Array.isArray(site.languages) || site.languages.length === 0 || !site.languages.every(validLanguage)) fail('WFM_GLOBAL_SITE', `site ${site.siteId} requires explicit training languages`);
    if (site.cloneOfSiteId && !validId(site.cloneOfSiteId)) fail('WFM_GLOBAL_CLONE', `site ${site.siteId} has invalid clone source`);
    if (site.overrides !== undefined) {
      if (!site.overrides || typeof site.overrides !== 'object' || Array.isArray(site.overrides)) fail('WFM_GLOBAL_OVERRIDE', `site ${site.siteId} overrides must be an object`);
      for (const key of Object.keys(site.overrides)) {
        if (!ALLOWED_OVERRIDE_KEYS.has(key)) fail('WFM_GLOBAL_OVERRIDE', `site ${site.siteId} attempts non-bounded override ${key}`);
      }
    }
  }
  for (const site of model.sites) {
    if (site.cloneOfSiteId && !siteIds.has(site.cloneOfSiteId)) fail('WFM_GLOBAL_CLONE', `site ${site.siteId} references an unknown clone source`);
    if (site.cloneOfSiteId === site.siteId) fail('WFM_GLOBAL_CLONE', `site ${site.siteId} cannot clone itself`);
  }
}

function normalizePolicyPacks(policyPacks) {
  const byCountry = new Map();
  for (const pack of Array.isArray(policyPacks) ? policyPacks : []) {
    if (!pack || pack.verified !== true || !TRUSTED_POLICY_SOURCES.has(pack.source) || !isDigest(pack.evidenceDigest)) continue;
    if (!validCountry(pack.country) || !validId(pack.packId) || typeof pack.version !== 'string' || pack.version.length < 1 || pack.version.length > 40) continue;
    if (typeof pack.effectiveFrom !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(pack.effectiveFrom)) continue;
    const list = byCountry.get(pack.country) || [];
    list.push({
      country: pack.country,
      packId: pack.packId,
      version: pack.version,
      effectiveFrom: pack.effectiveFrom,
      source: pack.source,
      evidenceDigest: pack.evidenceDigest,
      legalCoverageClaim: false,
    });
    byCountry.set(pack.country, list);
  }
  const selected = new Map();
  const conflicts = [];
  for (const [country, packs] of byCountry.entries()) {
    const identities = new Map();
    for (const pack of packs) {
      const key = digest({ packId: pack.packId, version: pack.version, effectiveFrom: pack.effectiveFrom });
      const list = identities.get(key) || [];
      list.push(pack);
      identities.set(key, list);
    }
    if (identities.size > 1) {
      conflicts.push({ country, reason: 'verified-policy-pack-conflict', evidenceDigests: packs.map((p) => p.evidenceDigest).sort() });
      continue;
    }
    const chosen = packs.slice().sort((a, b) => a.source.localeCompare(b.source) || a.evidenceDigest.localeCompare(b.evidenceDigest))[0];
    selected.set(country, chosen);
  }
  return { selected, conflicts };
}

function riskForSite(site) {
  let score = 0;
  const reasons = [];
  if ((site.connectivity || 'standard') === 'low') { score += 4; reasons.push('low-connectivity'); }
  if ((site.operation || 'standard') === '24x7') { score += 3; reasons.push('24x7'); }
  if ((site.operation || 'standard') === 'highly-automated') { score += 2; reasons.push('highly-automated'); }
  if (site.contractorHeavy === true) { score += 2; reasons.push('contractor-heavy'); }
  if (site.cloneOfSiteId) { score += 2; reasons.push('acquisition-or-site-clone'); }
  if ((site.languages || []).length > 1) { score += 1; reasons.push('multilingual'); }
  if ((site.trainingProfile || 'standard') !== 'standard') { score += 1; reasons.push('training-adaptation'); }
  return { score, reasons };
}

function testsForSite(site) {
  const tests = new Set(['tenant-isolation', 'role-access', 'import-validation', 'readiness-smoke']);
  if ((site.connectivity || 'standard') === 'low') tests.add('offline-sync-and-recovery');
  if ((site.operation || 'standard') === '24x7') tests.add('shift-midnight-and-timezone-boundary');
  if ((site.operation || 'standard') === 'highly-automated') tests.add('production-interface-isolation');
  if (site.contractorHeavy === true) tests.add('contingent-worker-authority-and-mapping');
  if (site.cloneOfSiteId) tests.add('clone-source-isolation-and-secret-noncopy');
  if ((site.languages || []).length > 1) tests.add('multilingual-training-render');
  if ((site.trainingProfile || 'standard') === 'low-digital-confidence') tests.add('guided-training-comprehension-path');
  return [...tests].sort();
}

function buildWaves(eligibleSites, smallCustomer) {
  const sorted = eligibleSites.slice().sort((a, b) => a.riskScore - b.riskScore || a.employeeCount - b.employeeCount || a.siteId.localeCompare(b.siteId));
  if (smallCustomer) {
    return [{
      wave: 1,
      siteIds: sorted.map((s) => s.siteId),
      employeeCount: sorted.reduce((n, s) => n + s.employeeCount, 0),
      riskCeiling: Math.max(...sorted.map((s) => s.riskScore), 0),
      purpose: 'single-wave-self-start',
    }];
  }

  const waves = [];
  let current = null;
  for (const site of sorted) {
    const newWaveNeeded = !current
      || current.siteIds.length >= 10
      || (current.employeeCount > 0 && current.employeeCount + site.employeeCount > 2000);
    if (newWaveNeeded) {
      current = {
        wave: waves.length + 1,
        siteIds: [],
        employeeCount: 0,
        riskCeiling: 0,
        purpose: waves.length === 0 ? 'lowest-risk-proof-wave' : 'phased-rollout',
      };
      waves.push(current);
    }
    current.siteIds.push(site.siteId);
    current.employeeCount += site.employeeCount;
    current.riskCeiling = Math.max(current.riskCeiling, site.riskScore);
  }
  return waves;
}

function compileGlobalImplementationRollout({ scopeReceipt, environmentModel, policyPacks = [] } = {}) {
  if (!verifyScopeReceipt(scopeReceipt) || scopeReceipt.status !== 'SCOPED') {
    fail('WFM_GLOBAL_SCOPE', 'a verified SCOPED adaptive implementation receipt is required');
  }
  assertEnvironmentModel(environmentModel);

  const expectedSites = scopeReceipt.facts?.['org.siteCount'];
  const expectedEmployees = scopeReceipt.facts?.['workforce.employeeCount'];
  const actualSites = environmentModel.sites.length;
  const actualEmployees = environmentModel.sites.reduce((sum, site) => sum + site.employeeCount, 0);
  if (expectedSites !== actualSites || expectedEmployees !== actualEmployees) {
    fail('WFM_GLOBAL_SCALE_DRIFT', 'environment topology does not match scoped site/employee totals');
  }

  const { selected: selectedPolicies, conflicts: policyConflicts } = normalizePolicyPacks(policyPacks);
  const conflictCountries = new Set(policyConflicts.map((x) => x.country));
  const blockedItems = policyConflicts.map(clone);
  const countrySet = new Set(environmentModel.sites.map((site) => site.country));
  for (const country of [...countrySet].sort()) {
    if (!selectedPolicies.has(country) && !conflictCountries.has(country)) {
      blockedItems.push({ country, reason: 'verified-policy-pack-evidence-required', legalCoverageClaim: false });
    }
  }

  const baseTemplate = {
    workforceSource: scopeReceipt.facts['workforce.sourceSystem'],
    payrollRequired: scopeReceipt.facts['payroll.enabled'],
    payrollProvider: scopeReceipt.facts['payroll.enabled'] ? scopeReceipt.facts['payroll.provider'] : null,
    timeCaptureMode: scopeReceipt.facts['time.captureMode'],
    agencyRequired: scopeReceipt.facts['agency.enabled'],
    agencyProvider: scopeReceipt.facts['agency.enabled'] ? scopeReceipt.facts['agency.system'] : null,
    roleGroups: clone(scopeReceipt.facts['training.roleGroups']),
  };
  const baseTemplateDigest = digest(baseTemplate);
  const baseFieldCount = Object.keys(baseTemplate).length;

  const sitePlans = [];
  const clonePlans = [];
  for (const site of environmentModel.sites.slice().sort((a, b) => a.siteId.localeCompare(b.siteId))) {
    const policy = selectedPolicies.get(site.country) || null;
    const policyBlocked = !policy || conflictCountries.has(site.country);
    const risk = riskForSite(site);
    const overlay = {
      country: site.country,
      timezone: site.timezone,
      dataRegion: site.dataRegion,
      languages: [...site.languages].sort(),
      trainingProfile: site.trainingProfile || 'standard',
      device: site.device || 'desktop',
      policyPackRef: policy ? { packId: policy.packId, version: policy.version, effectiveFrom: policy.effectiveFrom, evidenceDigest: policy.evidenceDigest } : null,
      regionalOwnerRef: validId(site.regionalOwnerRef) ? site.regionalOwnerRef : null,
      overrides: canonical(site.overrides || {}),
    };
    const templateDigest = digest({ baseTemplateDigest, overlay });
    const tests = testsForSite(site);
    sitePlans.push({
      siteId: site.siteId,
      entityId: site.entityId,
      country: site.country,
      employeeCount: site.employeeCount,
      riskScore: risk.score,
      riskReasons: risk.reasons,
      baseTemplateDigest,
      templateDigest,
      overlay,
      requiredTests: tests,
      blocked: policyBlocked,
      blockedReason: policyBlocked ? 'policy-evidence-not-ready' : null,
      legalCoverageClaim: false,
    });
    if (site.cloneOfSiteId) {
      clonePlans.push({
        siteId: site.siteId,
        cloneOfSiteId: site.cloneOfSiteId,
        copyTemplateReferenceOnly: true,
        identitiesCopied: false,
        secretsCopied: false,
        payrollStateCopied: false,
        testDataCopied: false,
        productionStateCopied: false,
      });
    }
  }

  const eligibleSites = sitePlans.filter((site) => !site.blocked);
  const smallCustomer = actualSites <= 2 && actualEmployees <= 100;
  const waves = eligibleSites.length > 0 ? buildWaves(eligibleSites, smallCustomer) : [];
  const scheduledIds = new Set(waves.flatMap((wave) => wave.siteIds));
  const blockedSiteIds = sitePlans.filter((site) => site.blocked).map((site) => site.siteId);

  const trainingAssignments = [];
  for (const site of sitePlans) {
    for (const role of baseTemplate.roleGroups) {
      for (const language of site.overlay.languages) {
        trainingAssignments.push({
          siteId: site.siteId,
          role,
          language,
          device: site.overlay.device,
          profile: site.overlay.trainingProfile,
          generatedFromTemplateDigest: site.templateDigest,
        });
      }
    }
  }

  const inheritedAssignments = actualSites * baseFieldCount;
  const simulatedRepeatedConfigEntriesAvoided = Math.max(0, actualSites - 1) * baseFieldCount;
  const core = {
    schemaVersion: 1,
    rolloutVersion: ROLLOUT_VERSION,
    scopeReceiptDigest: scopeReceipt.stateDigest,
    tenantRef: environmentModel.tenantRef,
    status: blockedSiteIds.length === 0 ? 'ROLLOUT_PLANNED' : 'PARTIAL_ROLLOUT_BLOCKED',
    topology: {
      entities: environmentModel.entities.length,
      sites: actualSites,
      employees: actualEmployees,
      countries: [...countrySet].sort(),
      allowedDataRegions: [...environmentModel.allowedDataRegions].sort(),
    },
    baseTemplate: { digest: baseTemplateDigest, fieldCount: baseFieldCount },
    sitePlans,
    waves,
    blockedItems,
    blockedSiteIds,
    clonePlans,
    trainingAssignments,
    driftBaseline: {
      scopeReceiptDigest: scopeReceipt.stateDigest,
      siteTemplateDigests: Object.fromEntries(sitePlans.map((site) => [site.siteId, site.templateDigest])),
      intentionalOverrides: Object.fromEntries(sitePlans.map((site) => [site.siteId, Object.keys(site.overlay.overrides)])),
    },
    metrics: {
      questionsAskedByRolloutPlanner: 0,
      manualRolloutPlanConstructionRequired: false,
      eligibleSites: eligibleSites.length,
      blockedSites: blockedSiteIds.length,
      scheduledSites: scheduledIds.size,
      waveCount: waves.length,
      inheritedConfigAssignments: inheritedAssignments,
      simulatedRepeatedConfigEntriesAvoided,
      clonePlans: clonePlans.length,
      trainingAssignments: trainingAssignments.length,
      remainingHumanOnlyDecisions: blockedItems.length,
    },
    guardrails: {
      legalCoverageClaim: false,
      policyValuesInvented: false,
      crossRegionDataMovementAuthorised: false,
      secretCopyAuthorised: false,
      identityCopyAuthorised: false,
      productionWriteAuthorised: false,
    },
    authority: {
      environmentProvisioningAuthorityGranted: false,
      integrationWriteAuthorityGranted: false,
      customerMutation: false,
      payrollMutation: false,
      identityMutation: false,
      productionMutation: false,
      modelAuthorityGranted: false,
      releaseAuthorityGranted: false,
    },
  };
  return { ...core, receiptDigest: digest(core) };
}

function verifyGlobalImplementationRollout(receipt) {
  if (!receipt || receipt.schemaVersion !== 1 || receipt.rolloutVersion !== ROLLOUT_VERSION || !isDigest(receipt.receiptDigest) || !isDigest(receipt.scopeReceiptDigest)) return false;
  if (!receipt.authority || Object.values(receipt.authority).some((value) => value !== false)) return false;
  if (!receipt.guardrails || receipt.guardrails.legalCoverageClaim !== false || receipt.guardrails.policyValuesInvented !== false) return false;
  if (receipt.guardrails.crossRegionDataMovementAuthorised !== false || receipt.guardrails.secretCopyAuthorised !== false || receipt.guardrails.identityCopyAuthorised !== false || receipt.guardrails.productionWriteAuthorised !== false) return false;
  if (!Array.isArray(receipt.sitePlans) || !Array.isArray(receipt.waves) || !Array.isArray(receipt.blockedSiteIds) || !Array.isArray(receipt.blockedItems)) return false;
  const siteIds = new Set(receipt.sitePlans.map((site) => site.siteId));
  if (siteIds.size !== receipt.sitePlans.length) return false;
  if (receipt.sitePlans.some((site) => !isDigest(site.baseTemplateDigest) || !isDigest(site.templateDigest) || site.legalCoverageClaim !== false || !Number.isSafeInteger(site.employeeCount) || site.employeeCount < 1)) return false;
  const blockedFromPlans = receipt.sitePlans.filter((site) => site.blocked === true).map((site) => site.siteId).sort();
  const declaredBlocked = [...receipt.blockedSiteIds].sort();
  if (JSON.stringify(blockedFromPlans) !== JSON.stringify(declaredBlocked)) return false;
  const scheduled = receipt.waves.flatMap((wave) => wave.siteIds);
  if (new Set(scheduled).size !== scheduled.length) return false;
  if (scheduled.some((id) => !siteIds.has(id) || declaredBlocked.includes(id))) return false;
  const eligible = receipt.sitePlans.filter((site) => site.blocked !== true).map((site) => site.siteId).sort();
  if (JSON.stringify([...scheduled].sort()) !== JSON.stringify(eligible)) return false;
  const siteById = new Map(receipt.sitePlans.map((site) => [site.siteId, site]));
  for (let index = 0; index < receipt.waves.length; index++) {
    const wave = receipt.waves[index];
    if (wave.wave !== index + 1 || !Array.isArray(wave.siteIds) || wave.siteIds.length === 0 || wave.siteIds.length > 10) return false;
    const employees = wave.siteIds.reduce((sum, id) => sum + siteById.get(id).employeeCount, 0);
    const riskCeiling = Math.max(...wave.siteIds.map((id) => siteById.get(id).riskScore), 0);
    if (wave.employeeCount !== employees || wave.riskCeiling !== riskCeiling) return false;
    if (wave.employeeCount > 2000 && wave.siteIds.length !== 1) return false;
  }
  if (receipt.clonePlans?.some((plan) => plan.copyTemplateReferenceOnly !== true || plan.identitiesCopied !== false || plan.secretsCopied !== false || plan.payrollStateCopied !== false || plan.testDataCopied !== false || plan.productionStateCopied !== false)) return false;
  if (receipt.trainingAssignments?.some((assignment) => !siteById.has(assignment.siteId) || assignment.generatedFromTemplateDigest !== siteById.get(assignment.siteId).templateDigest)) return false;
  if (receipt.metrics?.questionsAskedByRolloutPlanner !== 0 || receipt.metrics?.manualRolloutPlanConstructionRequired !== false) return false;
  if (receipt.metrics?.eligibleSites !== eligible.length || receipt.metrics?.blockedSites !== declaredBlocked.length || receipt.metrics?.scheduledSites !== scheduled.length || receipt.metrics?.waveCount !== receipt.waves.length) return false;
  if (receipt.topology?.sites !== receipt.sitePlans.length || receipt.topology?.employees !== receipt.sitePlans.reduce((sum, site) => sum + site.employeeCount, 0)) return false;
  if (receipt.status === 'ROLLOUT_PLANNED' && receipt.blockedSiteIds.length !== 0) return false;
  if (receipt.status === 'PARTIAL_ROLLOUT_BLOCKED' && receipt.blockedSiteIds.length === 0) return false;
  const core = clone(receipt);
  delete core.receiptDigest;
  return digest(core) === receipt.receiptDigest;
}

module.exports = {
  ROLLOUT_VERSION,
  compileGlobalImplementationRollout,
  verifyGlobalImplementationRollout,
  digest,
};
