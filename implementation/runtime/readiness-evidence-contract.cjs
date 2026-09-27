'use strict';

const NON_FIXTURE_MODES = new Set(['sandbox', 'test-api', 'live']);
const PAYROLL_DATA_CLASSES = new Set(['synthetic-scale', 'sandbox', 'customer-authorised']);
const POLICY_EVIDENCE_CLASSES = new Set(['customer-authorised', 'provider-authorised', 'contract-authorised']);

function text(value) {
  return String(value || '').trim();
}

function finiteEqual(left, right) {
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

function zeroHuman(item, label) {
  if (item.zeroHuman !== true) return label + ' PASS requires explicit zero-human execution evidence.';
  if (Number(item.humanInterventions) !== 0) return label + ' PASS requires zero human interventions.';
  return null;
}

function validatePolicyEvidence(item, label) {
  if (item.fixtureOnly !== false) return label + ' PASS requires non-fixture policy evidence.';
  const evidenceClass = text(item.evidenceClass).toLowerCase();
  if (!POLICY_EVIDENCE_CLASSES.has(evidenceClass)) {
    return label + ' PASS requires customer-authorised, provider-authorised or contract-authorised evidence.';
  }
  if (item.sourceAuthoritative !== true) return label + ' PASS requires an authoritative policy source.';
  if (!text(item.sourceRef)) return label + ' PASS requires a traceable policy source reference.';
  if (item.effectiveDated !== true) return label + ' PASS requires effective-dated policy evidence.';
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

function validateStrictReadinessEvidence(kind, status, detail = {}) {
  if (String(status || '').toUpperCase() !== 'PASS') return null;
  const item = detail && typeof detail === 'object' ? detail : {};

  if (kind === 'tenant-environment') {
    if (item.fixtureOnly !== false) return 'Tenant-environment PASS requires non-fixture cloud evidence.';
    const automationError = zeroHuman(item, 'Tenant-environment');
    if (automationError) return automationError;
    if (item.provisioned !== true) return 'Tenant-environment PASS requires a provisioning receipt.';
    if (!text(item.environmentId)) return 'Tenant-environment PASS requires an environment identifier.';
    if (text(item.provisioningMode).toLowerCase() !== 'cloud-runtime') return 'Tenant-environment PASS requires cloud-runtime provisioning, not a timing model or fixture.';
    if (item.healthcheckPassed !== true) return 'Tenant-environment PASS requires a successful runtime healthcheck.';
    if (item.tenantIsolationVerified !== true) return 'Tenant-environment PASS requires verified tenant isolation.';
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

  if (kind === 'historical-replay') {
    const dataClass = text(item.dataClass).toLowerCase();
    if (!PAYROLL_DATA_CLASSES.has(dataClass)) return 'Historical-replay PASS must declare whether evidence is synthetic-scale, sandbox or customer-authorised.';
    if (item.independentCalculation !== true) return 'Historical-replay PASS requires an independent payroll calculation.';
    if (!finiteEqual(item.expectedTotal, item.calculatedTotal)) return 'Historical-replay PASS requires expected and independently calculated totals to match exactly.';
    if (Number(item.unexplainedVariance) !== 0) return 'Historical-replay PASS requires zero unexplained variance.';
  }

  if (kind === 'security-controls') {
    if (item.cloudRuntime !== true) return 'Security-controls PASS requires execution against the cloud runtime.';
    if (item.tenantIsolationVerified !== true) return 'Security-controls PASS requires verified tenant isolation.';
    if (!Number.isInteger(Number(item.crossTenantNegativeTests)) || Number(item.crossTenantNegativeTests) < 1) return 'Security-controls PASS requires at least one cross-tenant negative test.';
    if (Number(item.criticalFailures) !== 0) return 'Security-controls PASS requires zero critical failures.';
  }

  if (kind === 'scenario-validation') {
    if (item.cloudRuntime !== true) return 'Scenario-validation PASS requires execution in the cloud runtime.';
    if (!text(item.testDataClass)) return 'Scenario-validation PASS must label its test-data class rather than imply production evidence.';
  }

  if (kind === 'live-data-import') {
    if (item.fixtureOnly !== false) return 'Live-data-import PASS cannot be based on fixtures.';
    const automationError = zeroHuman(item, 'Live-data-import');
    if (automationError) return automationError;
    if (item.sourceAuthoritative !== true) return 'Live-data-import PASS requires an authoritative source receipt.';
  }

  return null;
}

module.exports = { validateStrictReadinessEvidence };
