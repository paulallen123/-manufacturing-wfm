'use strict';

const { buildSetupDescriptor } = require('./transport-runtime-policy.cjs');

const RAW_SECRET_FIELD_PATTERN = /(^|[-_.])(password|passwd|secret|clientsecret|client_secret|token|accesstoken|access_token|apikey|api_key|privatekey|private_key)($|[-_.])/i;

function hasValue(value) {
  if (typeof value === 'string') return value.trim().length > 0;
  return value !== undefined && value !== null;
}

function assessCustomerSetup(review, supplied = {}) {
  const descriptor = buildSetupDescriptor(review);
  const requiredFields = descriptor.customerInputs.map((item) => item.key);
  const suppliedKeys = Object.keys(supplied || {}).sort();
  const rejectedRawSecretFields = suppliedKeys.filter((key) =>
    key !== 'credentialRef' && RAW_SECRET_FIELD_PATTERN.test(key) && hasValue(supplied[key])
  );
  const missingFields = requiredFields.filter((key) => !hasValue(supplied[key]));
  const unrecognizedFieldNames = suppliedKeys.filter((key) =>
    !requiredFields.includes(key) && !rejectedRawSecretFields.includes(key)
  );
  const acceptedFieldNames = requiredFields.filter((key) => hasValue(supplied[key]));

  const blockers = [];
  if (missingFields.length > 0) {
    blockers.push(`Missing required setup metadata: ${missingFields.join(', ')}.`);
  }
  if (rejectedRawSecretFields.length > 0) {
    blockers.push('Raw secret fields are not accepted; use a protected credential reference instead.');
  }

  return Object.freeze({
    transport: descriptor.transport,
    providerKey: descriptor.providerKey,
    targetIdentity: descriptor.targetIdentity,
    environment: descriptor.environment,
    readyForSafeConnectionTest: blockers.length === 0,
    acceptedFieldNames,
    missingFields,
    rejectedRawSecretFields,
    unrecognizedFieldNames,
    blockers,
    mappingConfiguredSeparately: true,
    businessRulesConfiguredSeparately: true,
    explicitActivationApprovalRequired: true,
    connectionTest: descriptor.connectionTest,
    nextAction: blockers.length === 0
      ? 'Run bounded non-mutating connection test, then review mapping before activation.'
      : 'Complete only the missing metadata and protected credential reference before testing.'
  });
}

module.exports = { assessCustomerSetup };
