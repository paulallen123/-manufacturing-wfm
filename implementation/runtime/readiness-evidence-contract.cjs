'use strict';

const NON_FIXTURE_MODES = new Set(['sandbox', 'test-api', 'live']);
const PAYROLL_DATA_CLASSES = new Set(['synthetic-scale', 'sandbox', 'customer-authorised']);
const POLICY_EVIDENCE_CLASSES = new Set(['customer-authorised', 'provider-authorised', 'contract-authorised']);
const FRESH_OPERATIONAL_KINDS = new Set([
  'tenant-environment','scheduling','approvals','clocking','payroll-mapping',
  'security-controls','resilience','scenario-validation','live-data-import'
]);
const MANDATORY_GOLDEN_JOURNEY_STEPS = Object.freeze([
  'contract-signed',
  'secure-sign-in',
  'integrations-connected',
  'source-discovery',
  'workforce-import',
  'source-reconciliation',
  'customer-configuration',
  'customer-specific-training',
  'go-live-admission',
  'shift-workforce-management',
  'time-absence-approval',
  'downstream-state-update',
  'roi-value-evidence',
  'support-problem-injected',
  'support-problem-detected',
  'support-problem-repaired'
]);

function text(value) {
  return String(value || '').trim();
}

function finiteEqual(left, right) {
  return typeof left === 'number' && typeof right === 'number' &&
    Number.isFinite(left) && Number.isFinite(right) && left === right;
}

function validEffectiveDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return false;
  const calendarDate = value.slice(0, 10);
  const calendarTime = Date.parse(calendarDate + 'T00:00:00Z');
  return Number.isFinite(calendarTime) &&
    new Date(calendarTime).toISOString().slice(0, 10) === calendarDate &&
    Number.isFinite(Date.parse(value));
}

function zeroHuman(item, label) {
  if (item.zeroHuman !== true) return label + ' PASS requires explicit zero-human execution evidence.';
  if (Number(item.humanInterventions) !== 0) return label + ' PASS requires zero human interventions.';
  return null;
}

function authorityReceiptError(item, label) {
  const cls = text(item.evidenceClass).toLowerCase();
  if (cls === 'customer-authorised') {
    const receipt = item._customerAuthorityReceipt;
    if (!receipt || receipt.version !== 1 || !text(receipt.decisionId) || !text(receipt.acceptedAt) ||
        !/^[0-9a-f]{16}$/.test(text(receipt.actorDigest)) || !/^[0-9a-f]{16}$/.test(text(receipt.sourceRefDigest))) {
      return label + ' PASS requires a server-issued authenticated customer-authority receipt.';
    }
  } else if (['provider-authorised','contract-authorised'].includes(cls)) {
    const receipt = item._externalAuthorityReceipt;
    if (!receipt || receipt.signatureVerified !== true || !text(receipt.receiptId) || !text(receipt.issuer) || !text(receipt.acceptedAt)) {
      return label + ' PASS requires a verified external-authority receipt.';
    }
  }
  return null;
}

function validatePolicyEvidence(item, label) {
  const evidenceClass = text(item.evidenceClass).toLowerCase();
  if (!POLICY_EVIDENCE_CLASSES.has(evidenceClass)) {
    return label + ' PASS requires customer-authorised, provider-authorised or contract-authorised evidence.';
  }
  const authorityError = authorityReceiptError(item, label);
  if (authorityError) return authorityError;
  if (item.sourceAuthoritative !== true) return label + ' PASS requires an authoritative policy source.';
  if (!text(item.sourceRef)) return label + ' PASS requires a traceable policy source reference.';
  if (item.effectiveDated !== true) return label + ' PASS requires effective-dated policy evidence.';
  if (item.effectiveDate != null && !validEffectiveDate(item.effectiveDate)) return label + ' PASS contains an invalid policy effective date.';
  if (!Number.isInteger(Number(item.unresolvedRules)) || Number(item.unresolvedRules) !== 0) {
    return label + ' PASS requires zero unresolved policy rules.';
  }
  if (!Number.isInteger(Number(item.unknownPolicyFields)) || Number(item.unknownPolicyFields) !== 0) {
    return label + ' PASS requires zero unknown policy fields.';
  }
  return null;
}

function validateProvider(provider) {
  if (!provider || typeof provider !== 'object') return 'Each source-system provider requires structured evidence.';
  if (!text(provider.provider || provider.name)) return 'Each source-system provider requires a provider name.';
  if (provider.discovered !== true) return 'Each source-system provider must have a discovery receipt.';
  if (provider.authorized !== true) return 'Each source-system provider must have explicit authorised access evidence.';
  if (provider.connected !== true) return 'Each source-system provider must have a successful connection receipt.';
  const mode = text(provider.mode).toLowerCase();
  if (!NON_FIXTURE_MODES.has(mode)) return 'Fixture-only providers cannot satisfy source-system readiness.';
  if (mode === 'live' && provider.liveVerified !== true) return 'A provider cannot be claimed live without a live verification receipt.';
  return null;
}

function freshnessError(kind, context = {}) {
  if (!FRESH_OPERATIONAL_KINDS.has(kind)) return null;
  const maxAgeMs = Number(context.freshnessMaxAgeMs);
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return null;
  const acceptedAt = Date.parse(context.evidenceCreatedAt || '');
  const nowMs = Number(context.nowMs ?? Date.now());
  if (!Number.isFinite(acceptedAt)) return kind + ' PASS requires a durable evidence timestamp for freshness admission.';
  if (!Number.isFinite(nowMs) || nowMs < acceptedAt - 30000) return kind + ' PASS has an invalid freshness clock.';
  if (nowMs - acceptedAt > maxAgeMs) return kind + ' PASS is stale and must be revalidated before it can be presented as current.';
  return null;
}

function validateTenantEnvironmentEvidence(item, context = {}) {
  const runtimeIdentity = context.runtimeIdentity && typeof context.runtimeIdentity === 'object'
    ? context.runtimeIdentity : null;
  if (runtimeIdentity) {
    if (typeof runtimeIdentity.fixtureOnly === 'boolean' && item.fixtureOnly !== runtimeIdentity.fixtureOnly) {
      return 'Tenant-environment evidence contradicts the server-issued runtime fixture boundary.';
    }
    if (text(runtimeIdentity.candidateSha) && text(item.exactCandidateSha) !== text(runtimeIdentity.candidateSha)) {
      return 'Tenant-environment evidence SHA contradicts the server-issued runtime identity.';
    }
    if (runtimeIdentity.productionApproved === false && item.productionApproved === true) {
      return 'Tenant-environment evidence cannot claim production approval when runtime identity refuses it.';
    }
  }
  if (item.fixtureOnly !== false) return 'Tenant-environment PASS requires non-fixture cloud evidence.';
  const automationError = zeroHuman(item, 'Tenant-environment');
  if (automationError) return automationError;
  const verifierRunId = text(item.verifierRunId || item.verifierDeploymentId);
  const implementationRunId = text(item.implementationRunId || item.runId);
  if (item.provisioned !== true || !(item.tenantExists === true || text(item.environmentId))) {
    return 'Tenant-environment PASS requires a provisioned tenant receipt.';
  }
  if (!text(item.environmentId)) return 'Tenant-environment PASS requires an environment identifier.';
  if (text(item.provisioningMode).toLowerCase() !== 'cloud-runtime') return 'Tenant-environment PASS requires cloud-runtime provisioning.';
  if (!(item.runtimeHealthPassed === true || item.healthcheckPassed === true)) return 'Tenant-environment PASS requires a successful runtime health assertion.';
  if (item.tenantIsolationVerified !== true) return 'Tenant-environment PASS requires a passing tenant-isolation assertion.';
  if (item.crossTenantNegativeTests != null && (!Number.isInteger(Number(item.crossTenantNegativeTests)) || Number(item.crossTenantNegativeTests) < 1)) {
    return 'Tenant-environment PASS includes an invalid tenant-isolation negative-test count.';
  }
  if (item.durableStateVerified !== true) return 'Tenant-environment PASS requires durable-state verification.';
  if (!/^[0-9a-f]{40}$/.test(text(item.exactCandidateSha))) return 'Tenant-environment PASS requires an exact candidate SHA.';
  if (!text(item.exactTargetDeploymentId)) return 'Tenant-environment PASS requires an exact deployment identifier.';
  if (!text(item.tenant)) return 'Tenant-environment PASS requires an explicit tenant binding.';
  if (!implementationRunId) return 'Tenant-environment PASS requires an implementation-run binding.';
  if (!verifierRunId) return 'Tenant-environment PASS requires verifier-run provenance.';
  const verifiedAt = item.evidenceGeneratedAt == null ? null : Date.parse(item.evidenceGeneratedAt);
  const deploymentAt = item.targetDeploymentCreatedAt == null ? null : Date.parse(item.targetDeploymentCreatedAt);
  if ((verifiedAt != null || deploymentAt != null) &&
      (!Number.isFinite(verifiedAt) || !Number.isFinite(deploymentAt) || verifiedAt < deploymentAt)) {
    return 'Tenant-environment PASS requires evidence generated after the exact deployment.';
  }
  if (context.tenant != null && text(item.tenant) !== text(context.tenant)) return 'Tenant-environment evidence tenant binding does not match the implementation run.';
  if (context.implementationRunId != null && implementationRunId !== text(context.implementationRunId)) return 'Tenant-environment evidence run binding does not match the implementation run.';
  if (context.candidateSha != null && text(item.exactCandidateSha) !== text(context.candidateSha)) return 'Tenant-environment evidence SHA does not match the current candidate.';
  if (context.deploymentId != null && text(item.exactTargetDeploymentId) !== text(context.deploymentId)) return 'Tenant-environment evidence deployment does not match the current candidate.';
  if (context.source != null && !['hosted-proof', 'independent-hosted-tenant-environment-verifier'].includes(text(context.source))) {
    return 'Tenant-environment PASS requires independent hosted verifier provenance.';
  }
  if (context.evidenceCreatedAt != null) {
    const acceptedAt = Date.parse(context.evidenceCreatedAt);
    if (!Number.isFinite(acceptedAt) || (Number.isFinite(verifiedAt) && acceptedAt < verifiedAt)) {
      return 'Tenant-environment evidence was not durably recorded after verification.';
    }
    if (context.enforceFreshAdmission === true && Number.isFinite(verifiedAt) &&
        (acceptedAt - verifiedAt > 120000 || verifiedAt > acceptedAt + 30000)) {
      return 'Tenant-environment evidence is stale or timestamp-ambiguous.';
    }
  }
  if (context.requireCandidateIdentity === true &&
      (!/^[0-9a-f]{40}$/.test(text(context.candidateSha)) || !text(context.deploymentId) || !context.evidenceCreatedAt)) {
    return 'Current candidate identity or server evidence timestamp is unavailable for tenant-environment evidence.';
  }
  return null;
}

function validateScheduling(item) {
  if (item.cloudRuntime !== true) return 'Scheduling PASS requires current cloud-runtime execution.';
  if (item.sourceAuthoritative !== true) return 'Scheduling PASS requires authoritative workforce and rule sources.';
  if (item.rosterSourceVerified !== true) return 'Scheduling PASS requires a verified roster/source population.';
  if (item.skillCoverageVerified !== true) return 'Scheduling PASS requires required-skill coverage verification.';
  if (item.availabilityVerified !== true) return 'Scheduling PASS requires availability verification.';
  if (item.ruleEvaluationVerified !== true) return 'Scheduling PASS requires time/compliance rule evaluation.';
  if (item.publishedScheduleReadbackVerified !== true) return 'Scheduling PASS requires published-schedule readback.';
  if (Number(item.unresolvedExceptions) !== 0) return 'Scheduling PASS requires zero unresolved scheduling exceptions.';
  return null;
}

function validateApprovals(item) {
  if (item.cloudRuntime !== true) return 'Approvals PASS requires current cloud-runtime execution.';
  if (item.sourceAuthoritative !== true) return 'Approvals PASS requires authoritative approval/delegation configuration.';
  if (item.delegationRulesVerified !== true) return 'Approvals PASS requires verified delegation rules.';
  if (item.selfApprovalBlocked !== true) return 'Approvals PASS requires a proved self-approval negative boundary.';
  if (item.auditTrailVerified !== true) return 'Approvals PASS requires durable approval audit verification.';
  if (item.approvalReadbackVerified !== true) return 'Approvals PASS requires saved-decision readback.';
  return null;
}

function validateClocking(item) {
  if (item.cloudRuntime !== true) return 'Clocking PASS requires current cloud-runtime execution.';
  if (item.sourceAuthoritative !== true) return 'Clocking PASS requires an authoritative clocking/device source.';
  if (item.deviceOrSourceVerified !== true) return 'Clocking PASS requires verified device/source identity.';
  if (item.duplicateProtectionVerified !== true) return 'Clocking PASS requires duplicate/idempotency protection.';
  if (item.offlineHandlingVerified !== true) return 'Clocking PASS requires offline/failure handling verification.';
  if (item.timezoneDstVerified !== true) return 'Clocking PASS requires tenant/site timezone and DST verification.';
  if (item.attendanceReadbackVerified !== true) return 'Clocking PASS requires persisted attendance readback.';
  return null;
}

function validatePayrollMapping(item) {
  if (text(item.readinessClass).toLowerCase() !== 'customer-specific') {
    return 'Payroll-mapping PASS must be customer-specific; synthetic-scale evidence is diagnostic only.';
  }
  if (text(item.dataClass).toLowerCase() !== 'customer-authorised') {
    return 'Payroll-mapping PASS requires customer-authorised payroll readiness evidence.';
  }
  if (item.mappingAuthorityVerified !== true) return 'Payroll-mapping PASS requires explicit mapping authority.';
  if (item.providerTargetVerified !== true) return 'Payroll-mapping PASS requires verified provider/employer/run target.';
  if (item.employeeIdentityMappingVerified !== true) return 'Payroll-mapping PASS requires verified employee/provider identity mapping.';
  if (item.payCodesVerified !== true) return 'Payroll-mapping PASS requires verified pay-code mapping.';
  if (item.absenceMappingVerified !== true) return 'Payroll-mapping PASS requires verified absence mapping.';
  if (item.roundingPolicyVerified !== true) return 'Payroll-mapping PASS requires verified rounding policy.';
  if (!text(item.releasedBatchId) || !/^[0-9a-f]{64}$/.test(text(item.batchChecksum))) {
    return 'Payroll-mapping PASS requires an exact released batch and checksum.';
  }
  if (item.fullPayrollVerified !== true) {
    return 'Payroll-mapping PASS requires proof that the fully acknowledged provider scope covers the released batch.';
  }
  return null;
}

function validateResilience(item) {
  if (item.hostedRuntime !== true) return 'Resilience PASS requires hosted-runtime execution.';
  for (const [key,label] of [
    ['faultInjected','controlled fault injection'],
    ['detected','fault detection'],
    ['classified','fault classification'],
    ['repairOrContainmentApplied','bounded repair or containment'],
    ['independentVerificationPassed','independent verification'],
    ['durableAuditVerified','durable audit'],
    ['replaySafetyVerified','replay safety']
  ]) if (item[key] !== true) return 'Resilience PASS requires ' + label + '.';
  if (item.rollbackRequired === true && item.rollbackVerified !== true) return 'Resilience PASS requires verified rollback when rollback is required.';
  if (Number(item.criticalFailures) !== 0) return 'Resilience PASS requires zero critical failures.';
  return null;
}

function validateGoldenJourney(item) {
  if (item.cloudRuntime !== true) return 'Scenario-validation PASS requires execution in the cloud runtime.';
  if (!text(item.testDataClass)) return 'Scenario-validation PASS must label its test-data class rather than imply production evidence.';
  const correlationId=text(item.correlationId);
  if(!correlationId) return 'Scenario-validation PASS requires one Golden Journey correlation ID.';
  if (!Array.isArray(item.steps)) return 'Scenario-validation PASS requires enumerated Golden Journey step evidence.';
  const byId = new Map(item.steps.filter(step=>step&&typeof step==='object').map(step=>[text(step.id),step]));
  for (const id of MANDATORY_GOLDEN_JOURNEY_STEPS) {
    const step = byId.get(id);
    if (!step || text(step.status).toUpperCase() !== 'PASS' || !text(step.evidenceRef)) {
      return 'Scenario-validation PASS is missing proved Golden Journey step: ' + id + '.';
    }
    if(text(step.correlationId)!==correlationId) return 'Scenario-validation PASS must correlate every mandatory Golden Journey step to one journey.';
  }
  if (Number(item.criticalFailures) !== 0) return 'Scenario-validation PASS requires zero critical failures.';
  return null;
}

function validateStrictReadinessEvidence(kind, status, detail = {}, context = {}) {
  if (String(status || '').toUpperCase() !== 'PASS') return null;
  const item = detail && typeof detail === 'object' ? detail : {};
  const stale = freshnessError(kind, context);
  if (stale) return stale;

  if (kind === 'tenant-environment') {
    const tenantError = validateTenantEnvironmentEvidence(item, context);
    if (tenantError) return tenantError;
  }

  if (kind === 'time-policies') {
    const policyError = validatePolicyEvidence(item, 'Time-policies');
    if (policyError) return policyError;
    if (item.breakRulesVerified !== true) return 'Time-policies PASS requires verified break rules.';
    if (item.overtimeRulesVerified !== true) return 'Time-policies PASS requires verified overtime rules.';
    if (item.workingTimeRulesVerified !== true) return 'Time-policies PASS requires verified working-time rules.';
    if (item.timeZoneVerified !== true) return 'Time-policies PASS requires verified site timezone/DST handling.';
  }

  if (kind === 'absence-policies') {
    const policyError = validatePolicyEvidence(item, 'Absence-policies');
    if (policyError) return policyError;
    if (item.leaveYearVerified !== true) return 'Absence-policies PASS requires a verified leave year.';
    if (item.entitlementMethodVerified !== true) return 'Absence-policies PASS requires a verified entitlement method.';
    if (item.approvalRulesVerified !== true) return 'Absence-policies PASS requires verified approval/delegation rules.';
    if (item.absenceTypesVerified !== true) return 'Absence-policies PASS requires verified absence-type rules.';
    if (item.openingBalanceFictional === true) return 'Absence-policies PASS cannot use a fictional opening balance.';
    if (item.usesOpeningBalance === true && item.openingBalanceSourceVerified !== true) {
      return 'Absence-policies PASS requires a verified source for any opening leave balance.';
    }
  }

  if (kind === 'source-systems') {
    if (item.fixtureOnly !== false) return 'Source-systems PASS cannot be based on fixtures.';
    const automationError = zeroHuman(item, 'Source-systems');
    if (automationError) return automationError;
    if (item.discoveryCompleted !== true) return 'Source-systems PASS requires completed source-system discovery.';
    if (item.authorizationVerified !== true) return 'Source-systems PASS requires verified customer/provider authorisation.';
    if (!Array.isArray(item.providers) || item.providers.length === 0) return 'Source-systems PASS requires at least one provider receipt.';
    for (const provider of item.providers) {
      const error = validateProvider(provider);
      if (error) return error;
    }
  }

  if (kind === 'scheduling') { const error = validateScheduling(item); if (error) return error; }
  if (kind === 'approvals') { const error = validateApprovals(item); if (error) return error; }
  if (kind === 'clocking') { const error = validateClocking(item); if (error) return error; }
  if (kind === 'payroll-mapping') { const error = validatePayrollMapping(item); if (error) return error; }

  if (kind === 'historical-replay') {
    const dataClass = text(item.dataClass).toLowerCase();
    if (!PAYROLL_DATA_CLASSES.has(dataClass)) return 'Historical-replay PASS must declare whether evidence is synthetic-scale, sandbox or customer-authorised.';
    if (item.independentCalculation !== true) return 'Historical-replay PASS requires an independent payroll calculation.';
    if (!finiteEqual(item.expectedTotal, item.calculatedTotal)) return 'Historical-replay PASS requires expected and independently calculated totals to match exactly.';
    if (typeof item.unexplainedVariance !== 'number' || item.unexplainedVariance !== 0) return 'Historical-replay PASS requires zero numeric unexplained variance.';
    if (dataClass === 'synthetic-scale' && item.customerSpecificReadiness === true) {
      return 'Synthetic-scale historical replay cannot claim customer-specific payroll readiness.';
    }
  }

  if (kind === 'security-controls') {
    if (item.cloudRuntime !== true) return 'Security-controls PASS requires execution against the cloud runtime.';
    if (item.tenantIsolationVerified !== true) return 'Security-controls PASS requires verified tenant isolation.';
    if (!Number.isInteger(Number(item.crossTenantNegativeTests)) || Number(item.crossTenantNegativeTests) < 1) return 'Security-controls PASS requires at least one cross-tenant negative test.';
    if (Number(item.criticalFailures) !== 0) return 'Security-controls PASS requires zero critical failures.';
  }

  if (kind === 'resilience') { const error = validateResilience(item); if (error) return error; }
  if (kind === 'scenario-validation') { const error = validateGoldenJourney(item); if (error) return error; }

  if (kind === 'live-data-import') {
    if (item.fixtureOnly !== false) return 'Live-data-import PASS cannot be based on fixtures.';
    const automationError = zeroHuman(item, 'Live-data-import');
    if (automationError) return automationError;
    if (item.sourceAuthoritative !== true) return 'Live-data-import PASS requires an authoritative source receipt.';
  }

  return null;
}

module.exports = {
  validateStrictReadinessEvidence,
  validateTenantEnvironmentEvidence,
  validEffectiveDate,
  MANDATORY_GOLDEN_JOURNEY_STEPS
};
