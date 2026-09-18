export const SAP_SUCCESSFACTORS = Object.freeze({
  schemaVersion: 1,
  providerKey: 'sap_successfactors',
  displayName: 'SAP SuccessFactors',
  connectionOptions: [
    { transport: 'rest_api', authMethods: ['signed_assertion'], directions: ['inbound'] }
  ],
  requiredConfigRefs: ['companyIdRef', 'clientIdRef', 'tokenEndpointRef', 'odataPlanRef', 'schemaEvidenceRef'],
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
  evidenceBoundary: 'Manifest describes supported setup/proof metadata only; it is not provider certification or a credential.'
});
