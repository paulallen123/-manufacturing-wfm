'use strict';

const { createHash } = require('node:crypto');

const INCIDENT_CLASSES = Object.freeze([
  'PAYROLL_CRITICAL',
  'MULTI_INTEGRATION_OUTAGE',
  'PROVIDER_SCHEMA_OR_API_DRIFT',
  'CLOCKING_INTEGRITY',
  'OFFLINE_SITE_RECOVERY',
  'GLOBAL_POLICY_CONFLICT',
  'SECURITY_OR_TENANT_INCIDENT',
  'DATASTORE_OR_SERVICE_FAILURE',
  'BAD_RELEASE',
  'EXTREME_LOAD',
  'CONTRADICTORY_SOURCE_DATA',
  'NOVEL_OR_COMPOUND'
]);

const TERMINALS = Object.freeze({
  CONTAINED: 'CONTAINED',
  VERIFIED_RECOVERY: 'VERIFIED_RECOVERY',
  CERTIFIED_REFLEX: 'CERTIFIED_REFLEX'
});

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function clean(value, max = 240) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function stableList(value, max = 64, maxLen = 180) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => clean(item, maxLen)).filter(Boolean))]
    .sort()
    .slice(0, max);
}

function positiveTiming(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(name + ' must be a non-negative finite number.');
  return n;
}

function assertSafeEvidence(input = {}) {
  if (
    input.rawCustomerData === true ||
    input.rawSecret === true ||
    input.executionToken === true ||
    input.crossTenantEvidence === true
  ) {
    throw new Error('Incident learning accepts only sanitised, tenant-safe evidence and never execution credentials.');
  }
}

function fingerprintIncident(incident = {}) {
  const incidentClass = clean(incident.incidentClass, 80).toUpperCase();
  if (!INCIDENT_CLASSES.includes(incidentClass)) throw new Error('Unsupported incident class.');

  const material = {
    incidentClass,
    subsystem: clean(incident.subsystem, 120).toLowerCase(),
    signals: stableList(incident.signals),
    errorCodes: stableList(incident.errorCodes, 32, 100),
    invariantFailures: stableList(incident.invariantFailures),
    affectedInterfaces: stableList(incident.affectedInterfaces),
    dependencyClasses: stableList(incident.dependencyClasses),
    compoundClasses: stableList(incident.compoundClasses, 16, 80)
  };
  if (
    !material.subsystem &&
    material.signals.length === 0 &&
    material.errorCodes.length === 0 &&
    material.invariantFailures.length === 0
  ) {
    throw new Error('Incident fingerprint requires stable diagnostic material.');
  }
  return digest(material);
}

function createRegressionCase(input = {}) {
  assertSafeEvidence(input);
  const incident = input.incident || {};
  const fingerprint = fingerprintIncident(incident);
  const expectedInvariants = stableList(input.expectedInvariants, 64, 220);
  if (!expectedInvariants.length) throw new Error('Regression case requires expected invariants.');

  const core = {
    contractVersion: 'VECTOR_INCIDENT_REGRESSION_V1',
    fingerprint,
    incidentClass: clean(incident.incidentClass, 80).toUpperCase(),
    evidenceRefs: stableList(input.evidenceRefs, 64, 220),
    replaySeed: digest({
      fingerprint,
      signals: stableList(incident.signals),
      errorCodes: stableList(incident.errorCodes),
      invariantFailures: stableList(incident.invariantFailures)
    }),
    expectedInvariants,
    failureInjectionRequired: input.failureInjectionRequired !== false,
    exactReplayRequired: true,
    independentReplayRequired: true,
    permanentRegression: true,
    productionMutation: false,
    mayGrantAuthority: false
  };
  if (!core.evidenceRefs.length) throw new Error('Regression case requires evidence references.');
  return Object.freeze({ ...core, regressionDigest: digest(core) });
}

function createResolutionReceipt(input = {}) {
  assertSafeEvidence(input);
  const incident = input.incident || {};
  const fingerprint = fingerprintIncident(incident);
  const actionType = clean(input.repair?.actionType, 180);
  const containmentAction = clean(input.containment?.actionType, 180);
  const evidenceRefs = stableList(input.evidenceRefs, 100, 220);
  if (!evidenceRefs.length) throw new Error('Resolution receipt requires evidence references.');

  const detectionMs = positiveTiming(input.timings?.detectionMs ?? 0, 'detectionMs');
  const containmentMs = positiveTiming(input.timings?.containmentMs ?? detectionMs, 'containmentMs');
  const recoveryMs = positiveTiming(input.timings?.recoveryMs ?? containmentMs, 'recoveryMs');

  const checks = {
    containmentApplied: input.containment?.applied === true,
    repairExecuted: input.repair?.executed === true,
    actionAllowlisted: input.repair?.actionAllowlisted === true,
    machineQuorumPassed: input.repair?.machineQuorumPassed === true,
    sameAuthorityEnvelope: input.repair?.sameAuthorityEnvelope === true,
    noAuthorityExpansion: input.repair?.noAuthorityExpansion === true,
    independentVerifierPassed: input.verification?.independentVerifierPassed === true,
    tenantInvariantPassed: input.verification?.tenantInvariantPassed === true,
    securityInvariantPassed: input.verification?.securityInvariantPassed === true,
    reconciliationPassed: input.verification?.reconciliationPassed === true,
    noSilentDataLoss: input.verification?.noSilentDataLoss === true,
    recoveryStable: input.verification?.recoveryStable === true,
    rollbackOrCompensationProved: input.verification?.rollbackOrCompensationProved === true,
    exactReplayPassed: input.verification?.exactReplayPassed === true,
    independentReplayPassed: input.verification?.independentReplayPassed === true,
    regressionAdded: input.prevention?.regressionAdded === true,
    detectionRuleAdded: input.prevention?.detectionRuleAdded === true,
    guardOrInvariantAdded: input.prevention?.guardOrInvariantAdded === true,
    failureInjectionAdded: input.prevention?.failureInjectionAdded === true
  };

  const recoveryVerified = [
    'containmentApplied',
    'repairExecuted',
    'independentVerifierPassed',
    'tenantInvariantPassed',
    'securityInvariantPassed',
    'reconciliationPassed',
    'noSilentDataLoss',
    'recoveryStable',
    'rollbackOrCompensationProved'
  ].every(key => checks[key]);

  const reflexCertified = recoveryVerified && [
    'actionAllowlisted',
    'machineQuorumPassed',
    'sameAuthorityEnvelope',
    'noAuthorityExpansion',
    'exactReplayPassed',
    'independentReplayPassed',
    'regressionAdded',
    'detectionRuleAdded',
    'guardOrInvariantAdded',
    'failureInjectionAdded'
  ].every(key => checks[key]) && Boolean(actionType);

  const previous = input.previousVerifiedResolution || null;
  const previousDetection = previous ? positiveTiming(previous.bestDetectionMs, 'previous.bestDetectionMs') : null;
  const previousRecovery = previous ? positiveTiming(previous.bestRecoveryMs, 'previous.bestRecoveryMs') : null;
  const bestDetectionMs = previousDetection == null ? detectionMs : Math.min(previousDetection, detectionMs);
  const bestRecoveryMs = previousRecovery == null ? recoveryMs : Math.min(previousRecovery, recoveryMs);
  const fasterDetectionTargetMs = Math.max(1, Math.floor(bestDetectionMs * 0.8));
  const fasterRecoveryTargetMs = Math.max(1, Math.floor(bestRecoveryMs * 0.8));

  const terminal = reflexCertified
    ? TERMINALS.CERTIFIED_REFLEX
    : recoveryVerified
      ? TERMINALS.VERIFIED_RECOVERY
      : TERMINALS.CONTAINED;

  const core = {
    contractVersion: 'VECTOR_EXTREME_INCIDENT_RESOLUTION_V1',
    fingerprint,
    incidentClass: clean(incident.incidentClass, 80).toUpperCase(),
    terminal,
    containmentAction: containmentAction || null,
    repairAction: actionType || null,
    checks,
    timings: { detectionMs, containmentMs, recoveryMs },
    bestDetectionMs,
    bestRecoveryMs,
    recurrenceTargets: {
      detectionMs: fasterDetectionTargetMs,
      recoveryMs: fasterRecoveryTargetMs,
      targetIsNonBindingUntilProved: true
    },
    evidenceRefs,
    playbookCertified: reflexCertified,
    permanentRegressionRequired: true,
    preventionRequired: true,
    humanOperationalTouchBudget: 0,
    mayExpandAuthority: false,
    maySelfGrantAuthority: false,
    rawCustomerDataStored: false
  };
  return Object.freeze({ ...core, resolutionDigest: digest(core) });
}

function planRecurrence(input = {}) {
  const incident = input.incident || {};
  const fingerprint = fingerprintIncident(incident);
  const resolution = input.resolution || null;

  if (
    resolution &&
    resolution.contractVersion === 'VECTOR_EXTREME_INCIDENT_RESOLUTION_V1' &&
    resolution.fingerprint === fingerprint &&
    resolution.playbookCertified === true &&
    resolution.terminal === TERMINALS.CERTIFIED_REFLEX
  ) {
    return Object.freeze({
      contractVersion: 'VECTOR_INCIDENT_RECURRENCE_PLAN_V1',
      fingerprint,
      mode: 'CERTIFIED_FAST_PATH',
      containment: 'APPLY_PROVEN_CONTAINMENT_IMMEDIATELY',
      diagnosis: 'MATCH_EXACT_FINGERPRINT_AND_RECHECK_CURRENT_INVARIANTS',
      repairAction: resolution.repairAction,
      executeOnlyIfCurrentMachineQuorumPasses: true,
      executeOnlyInsideExistingAuthorityEnvelope: true,
      independentVerificationStillRequired: true,
      targetDetectionMs: resolution.recurrenceTargets.detectionMs,
      targetRecoveryMs: resolution.recurrenceTargets.recoveryMs,
      onMismatch: 'CONTAIN_AND_REPROVE',
      productionExperimentationAllowed: false,
      sourceResolutionDigest: resolution.resolutionDigest
    });
  }

  return Object.freeze({
    contractVersion: 'VECTOR_INCIDENT_RECURRENCE_PLAN_V1',
    fingerprint,
    mode: 'CONTAIN_AND_PROVE',
    containment: 'PROTECT_PRESERVE_ISOLATE',
    diagnosis: 'RECONSTRUCT_CAUSE_IN_DISPOSABLE_OR_READ_ONLY_ENVIRONMENT',
    repairAction: null,
    executeOnlyIfCurrentMachineQuorumPasses: true,
    executeOnlyInsideExistingAuthorityEnvelope: true,
    independentVerificationStillRequired: true,
    onMismatch: 'KEEP_CONTAINED',
    productionExperimentationAllowed: false,
    sourceResolutionDigest: null
  });
}

function certifyCompoundResponse(input = {}) {
  assertSafeEvidence(input);
  const components = Array.isArray(input.componentResolutions) ? input.componentResolutions : [];
  if (components.length < 2) throw new Error('Compound response requires at least two component resolutions.');
  const allCertified = components.every(item =>
    item?.contractVersion === 'VECTOR_EXTREME_INCIDENT_RESOLUTION_V1' &&
    item.playbookCertified === true &&
    item.terminal === TERMINALS.CERTIFIED_REFLEX
  );
  const unique = new Set(components.map(item => item.fingerprint));
  if (unique.size !== components.length) throw new Error('Compound response requires distinct incident fingerprints.');

  const combinedChecks = {
    allComponentPlaybooksCertified: allCertified,
    compoundSimulationPassed: input.verification?.compoundSimulationPassed === true,
    compoundIndependentReplayPassed: input.verification?.compoundIndependentReplayPassed === true,
    orderingAndDependencyChecksPassed: input.verification?.orderingAndDependencyChecksPassed === true,
    tenantInvariantPassed: input.verification?.tenantInvariantPassed === true,
    securityInvariantPassed: input.verification?.securityInvariantPassed === true,
    noSplitBrain: input.verification?.noSplitBrain === true,
    noSilentDataLoss: input.verification?.noSilentDataLoss === true,
    rollbackOrCompensationProved: input.verification?.rollbackOrCompensationProved === true,
    noAuthorityExpansion: input.verification?.noAuthorityExpansion === true
  };
  const certified = Object.values(combinedChecks).every(Boolean);

  const core = {
    contractVersion: 'VECTOR_COMPOUND_INCIDENT_RESPONSE_V1',
    componentFingerprints: [...unique].sort(),
    componentResolutionDigests: components.map(item => item.resolutionDigest).sort(),
    checks: combinedChecks,
    certified,
    mode: certified ? 'CERTIFIED_COMPOUND_FAST_PATH' : 'COMPOUND_CONTAIN_AND_PROVE',
    humanOperationalTouchBudget: 0,
    productionExperimentationAllowed: false,
    mayExpandAuthority: false,
    maySelfGrantAuthority: false
  };
  return Object.freeze({ ...core, compoundDigest: digest(core) });
}

module.exports = Object.freeze({
  INCIDENT_CLASSES,
  TERMINALS,
  canonical,
  digest,
  fingerprintIncident,
  createRegressionCase,
  createResolutionReceipt,
  planRecurrence,
  certifyCompoundResponse
});
