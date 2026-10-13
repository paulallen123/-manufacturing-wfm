'use strict';

// Advisory projection of the existing integration hub's public connection.
// Provider authentication and outage recovery need external receipts; a
// connection state or a prior import cannot establish either on its own.
function providerReadinessPreflight(connection, { requiredScopes = ['people.read'] } = {}) {
  const record = connection && typeof connection === 'object' ? connection : {};
  const configMissing = [];
  if (typeof record.id !== 'string' || !record.id) configMissing.push('CONNECTION_ID_MISSING');
  if (typeof record.productKey !== 'string' || !record.productKey) configMissing.push('PROVIDER_TYPE_MISSING');
  if (typeof record.sourceInstanceId !== 'string' || !record.sourceInstanceId) configMissing.push('SOURCE_INSTANCE_MISSING');
  if (typeof record.authMethod !== 'string' || !record.authMethod) configMissing.push('AUTH_METHOD_MISSING');
  if (!Number.isInteger(record.mappingVersion) || record.mappingVersion <= 0) configMissing.push('MAPPING_VERSION_MISSING');

  const grants = Array.isArray(record.grantedScopes) ? record.grantedScopes : [];
  const needed = Array.isArray(requiredScopes) && requiredScopes.every(x => typeof x === 'string' && x)
    ? requiredScopes : null;
  const authMissing = [];
  if (!needed) authMissing.push('REQUIRED_SCOPE_CONTRACT_INVALID');
  else if (needed.some(scope => !grants.includes(scope))) authMissing.push('REQUIRED_SCOPE_NOT_GRANTED');
  if (['AUTHORIZATION_REQUIRED', 'REAUTH_REQUIRED'].includes(record.state)) authMissing.push('PROVIDER_AUTHORIZATION_REQUIRED');
  else if (record.state !== 'ACTIVE') authMissing.push('ACTIVE_AUTHENTICATED_CONNECTION_UNPROVEN');
  if (record.failureClass) authMissing.push('CURRENT_PROVIDER_FAILURE');
  // A previous health timestamp is diagnostic, never proof of current auth.
  authMissing.push('CURRENT_PROVIDER_AUTH_RECEIPT_REQUIRED');

  const recoveryMissing = [];
  if (record.lastReconciliation?.status !== 'PASS') recoveryMissing.push('COMPLETE_RECONCILIATION_UNPROVEN');
  if (record.canonicalImport?.status !== 'PASS'
      || record.canonicalImport?.mappingVersion !== record.mappingVersion) {
    recoveryMissing.push('CURRENT_MAPPING_IMPORT_UNPROVEN');
  }
  recoveryMissing.push('OUTAGE_REPLAY_AND_READBACK_RECEIPT_REQUIRED');

  return {
    configuration: { state: configMissing.length ? 'BLOCKED' : 'PRESENT', blockers: configMissing },
    authentication: { state: 'UNPROVEN', blockers: authMissing },
    recovery: { state: 'UNPROVEN', blockers: recoveryMissing },
    providerReady: false,
    claimBoundary: 'Connection metadata cannot prove current provider authentication, recovery or customer acceptance.'
  };
}

module.exports = { providerReadinessPreflight };
