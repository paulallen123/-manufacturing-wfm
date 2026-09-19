'use strict';

const NON_FIXTURE_MODES = new Set(['sandbox', 'test-api', 'live']);
const PAYROLL_DATA_CLASSES = new Set(['synthetic-scale', 'sandbox', 'customer-authorised']);

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
