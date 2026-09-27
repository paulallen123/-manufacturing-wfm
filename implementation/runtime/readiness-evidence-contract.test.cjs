'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateStrictReadinessEvidence } = require('./readiness-evidence-contract.cjs');

test('tenant environment refuses weak, fixture or human-assisted evidence', () => {
  assert.match(validateStrictReadinessEvidence('tenant-environment', 'PASS', { checked: true }), /non-fixture/);
  assert.match(validateStrictReadinessEvidence('tenant-environment', 'PASS', {
    fixtureOnly: false,
    zeroHuman: false,
    humanInterventions: 1
  }), /zero-human/);
  assert.equal(validateStrictReadinessEvidence('tenant-environment', 'PASS', {
    fixtureOnly: false,
    zeroHuman: true,
    humanInterventions: 0,
    provisioned: true,
    environmentId: 'railway-runtime/tenant-alpha',
    provisioningMode: 'cloud-runtime',
    healthcheckPassed: true,
    tenantIsolationVerified: true
  }), null);
});

test('source systems require zero-human discovery, authorisation and a real provider receipt', () => {
  assert.match(validateStrictReadinessEvidence('source-systems', 'PASS', {
    fixtureOnly: true,
    authorizationVerified: true,
    providers: []
  }), /fixtures/);
  assert.match(validateStrictReadinessEvidence('source-systems', 'PASS', {
    fixtureOnly: false,
    zeroHuman: true,
    humanInterventions: 0,
    discoveryCompleted: true,
    authorizationVerified: true,
    providers: [{ provider: 'Example', discovered: true, authorized: true, connected: true, mode: 'live' }]
  }), /live verification/);
  assert.equal(validateStrictReadinessEvidence('source-systems', 'PASS', {
    fixtureOnly: false,
    zeroHuman: true,
    humanInterventions: 0,
    discoveryCompleted: true,
    authorizationVerified: true,
    providers: [{ provider: 'Example Sandbox', discovered: true, authorized: true, connected: true, mode: 'sandbox' }]
  }), null);
});


test('time policies reject fixture/default assumptions and require complete authoritative rules', () => {
  assert.match(validateStrictReadinessEvidence('time-policies', 'PASS', {
    fixtureOnly: true
  }), /non-fixture/);
  assert.match(validateStrictReadinessEvidence('time-policies', 'PASS', {
    fixtureOnly: false,
    evidenceClass: 'customer-authorised',
    sourceAuthoritative: true,
    sourceRef: 'contract://policy/2026-01',
    effectiveDated: true,
    unresolvedRules: 0,
    unknownPolicyFields: 0,
    breakRulesVerified: true,
    overtimeRulesVerified: false,
    workingTimeRulesVerified: true,
    timeZoneVerified: true
  }), /overtime/);
  assert.equal(validateStrictReadinessEvidence('time-policies', 'PASS', {
    fixtureOnly: false,
    evidenceClass: 'customer-authorised',
    sourceAuthoritative: true,
    sourceRef: 'contract://policy/2026-01',
    effectiveDated: true,
    unresolvedRules: 0,
    unknownPolicyFields: 0,
    breakRulesVerified: true,
    overtimeRulesVerified: true,
    workingTimeRulesVerified: true,
    timeZoneVerified: true
  }), null);
});

test('absence policies reject fictional balances and unverified entitlement rules', () => {
  assert.match(validateStrictReadinessEvidence('absence-policies', 'PASS', {
    fixtureOnly: false,
    evidenceClass: 'contract-authorised',
    sourceAuthoritative: true,
    sourceRef: 'contract://absence/2026',
    effectiveDated: true,
    unresolvedRules: 0,
    unknownPolicyFields: 0,
    leaveYearVerified: true,
    entitlementMethodVerified: true,
    approvalRulesVerified: true,
    absenceTypesVerified: true,
    usesOpeningBalance: true,
    openingBalanceSourceVerified: true,
    openingBalanceFictional: true
  }), /fictional/);
  assert.match(validateStrictReadinessEvidence('absence-policies', 'PASS', {
    fixtureOnly: false,
    evidenceClass: 'contract-authorised',
    sourceAuthoritative: true,
    sourceRef: 'contract://absence/2026',
    effectiveDated: true,
    unresolvedRules: 0,
    unknownPolicyFields: 0,
    leaveYearVerified: true,
    entitlementMethodVerified: false,
    approvalRulesVerified: true,
    absenceTypesVerified: true
  }), /entitlement/);
  assert.equal(validateStrictReadinessEvidence('absence-policies', 'PASS', {
    fixtureOnly: false,
    evidenceClass: 'provider-authorised',
    sourceAuthoritative: true,
    sourceRef: 'provider://hcm/policy/absence-v4',
    effectiveDated: true,
    unresolvedRules: 0,
    unknownPolicyFields: 0,
    leaveYearVerified: true,
    entitlementMethodVerified: true,
    approvalRulesVerified: true,
    absenceTypesVerified: true,
    usesOpeningBalance: true,
    openingBalanceSourceVerified: true,
    openingBalanceFictional: false
  }), null);
});

test('historical replay labels its data class and requires independent exact payroll reconciliation', () => {
  assert.match(validateStrictReadinessEvidence('historical-replay', 'PASS', {
    independentCalculation: true,
    expectedTotal: 15180000,
    calculatedTotal: 15180020,
    unexplainedVariance: 20
  }), /declare/);
  assert.match(validateStrictReadinessEvidence('historical-replay', 'PASS', {
    dataClass: 'synthetic-scale',
    independentCalculation: true,
    expectedTotal: 15180000,
    calculatedTotal: 15180020,
    unexplainedVariance: 20
  }), /match exactly/);
  assert.equal(validateStrictReadinessEvidence('historical-replay', 'PASS', {
    dataClass: 'synthetic-scale',
    independentCalculation: true,
    expectedTotal: 15180000,
    calculatedTotal: 15180000,
    unexplainedVariance: 0
  }), null);
});

test('security, scenario and live import evidence are fail-closed without overstating synthetic tests', () => {
  assert.match(validateStrictReadinessEvidence('security-controls', 'PASS', {
    cloudRuntime: true,
    tenantIsolationVerified: true,
    crossTenantNegativeTests: 0,
    criticalFailures: 0
  }), /cross-tenant/);
  assert.match(validateStrictReadinessEvidence('scenario-validation', 'PASS', {
    cloudRuntime: false,
    testDataClass: 'synthetic-edge-suite'
  }), /cloud runtime/);
  assert.equal(validateStrictReadinessEvidence('scenario-validation', 'PASS', {
    cloudRuntime: true,
    testDataClass: 'synthetic-edge-suite'
  }), null);
  assert.match(validateStrictReadinessEvidence('live-data-import', 'PASS', {
    fixtureOnly: false,
    zeroHuman: true,
    humanInterventions: 0,
    sourceAuthoritative: false
  }), /authoritative/);
});

test('non-PASS evidence remains recordable for diagnostics', () => {
  assert.equal(validateStrictReadinessEvidence('source-systems', 'FAIL', { fixtureOnly: true }), null);
  assert.equal(validateStrictReadinessEvidence('tenant-environment', 'WARN', {}), null);
});
