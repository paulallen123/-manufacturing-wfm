const REQUIRED_SAFE_TEST_EVIDENCE = Object.freeze([
  'provider_identity', 'authentication', 'schema', 'bounded_sample', 'reconciliation'
]);

export const SAP_SUCCESSFACTORS = Object.freeze({
  schemaVersion: 1,
  providerKey: 'sap_successfactors',
  displayName: 'SAP SuccessFactors',
  connectionOptions: [
    { transport: 'rest_api', authMethods: ['signed_assertion'], directions: ['inbound'] }
  ],
  requiredConfigRefs: ['companyIdRef', 'clientIdRef', 'tokenEndpointRef', 'odataPlanRef', 'schemaEvidenceRef'],
  safeTest: {
    policyVersion: 1,
    maxRecords: 5,
    maxBytes: 65536,
    timeoutMs: 10000,
    requiredEvidence: REQUIRED_SAFE_TEST_EVIDENCE,
    providerPlan: 'Use a registered OAuth client with a signed assertion, verify OData metadata, then execute only the customer-reviewed bounded read plan. Do not use deprecated assertion-generation endpoints.'
  },
  evidenceBoundary: 'Manifest describes supported setup/proof metadata only; it is not provider certification or a credential.'
});

export const ORACLE_NETSUITE = Object.freeze({
  schemaVersion: 1,
  providerKey: 'oracle_netsuite',
  displayName: 'Oracle NetSuite',
  connectionOptions: [
    { transport: 'rest_api', authMethods: ['signed_assertion'], directions: ['inbound'] }
  ],
  requiredConfigRefs: ['accountIdRef', 'clientIdRef', 'certificateIdRef', 'suiteqlPlanRef', 'schemaEvidenceRef'],
  safeTest: {
    policyVersion: 1,
    maxRecords: 5,
    maxBytes: 65536,
    timeoutMs: 10000,
    requiredEvidence: REQUIRED_SAFE_TEST_EVIDENCE,
    providerPlan: 'Use OAuth 2.0 client credentials with the mapped certificate, verify the supported REST metadata surface, then execute only the customer-reviewed bounded SuiteQL read plan. Treat SuiteQL POST as read semantics and forbid business mutation.'
  },
  evidenceBoundary: 'Manifest describes supported setup/proof metadata only; it is not provider certification or a credential.'
});
