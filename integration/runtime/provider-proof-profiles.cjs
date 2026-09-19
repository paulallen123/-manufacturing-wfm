'use strict';

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

const PROFILES = Object.freeze({
  'sap-successfactors': Object.freeze({
    transport: 'api',
    preferredAuth: ['oauth2', 'service-account'],
    requiredTargetMetadata: ['apiServer', 'companyId'],
    proofRequest: Object.freeze({
      method: 'GET',
      path: '/odata/v2/User/$metadata',
      headers: Object.freeze({ Accept: 'application/atom+xml' }),
      maxResponseBytes: 2 * 1024 * 1024,
      responseKind: 'odata-metadata',
      recordsAllowed: false,
      redirectPolicy: 'error'
    }),
    identityBinding: 'companyId identifies the SuccessFactors system on the configured API server'
  }),
  netsuite: Object.freeze({
    transport: 'api',
    preferredAuth: ['oauth2'],
    requiredTargetMetadata: ['accountId', 'accountSpecificDomain'],
    proofRequest: Object.freeze({
      method: 'GET',
      path: '/services/rest/record/v1/metadata-catalog/?select=customer',
      headers: Object.freeze({ Accept: 'application/swagger+json' }),
      maxResponseBytes: 2 * 1024 * 1024,
      responseKind: 'openapi-metadata',
      recordsAllowed: false,
      redirectPolicy: 'error'
    }),
    identityBinding: 'account-specific REST domain must match the reviewed NetSuite account ID and environment'
  })
});

function normalizeHostname(value) {
  const host = String(value || '').trim().toLowerCase().replace(/\.$/, '');
  if (!host || host.includes('://') || /[\\/?#@\s:]/.test(host) || !HOSTNAME.test(host)) {
    throw new Error('Provider target must be a plain HTTPS hostname without a scheme, port, path or user information.');
  }
  return host;
}

function normalizeNetSuiteAccountId(value) {
  return String(value || '').trim().toLowerCase().replace(/_/g, '-');
}

function buildProviderProofPlan(review, target = {}) {
  const providerKey = String(review?.providerKey || '').trim().toLowerCase();
  const profile = PROFILES[providerKey];
  if (!profile) throw new Error('No bounded provider proof profile is available.');
  if (String(review?.transport || '').trim().toLowerCase() !== profile.transport) {
    throw new Error('Provider proof profile does not match the reviewed transport.');
  }

  const authMethod = String(review?.auth?.method || '').trim().toLowerCase();
  if (!profile.preferredAuth.includes(authMethod)) {
    throw new Error('Authentication method is not approved for this provider proof profile.');
  }

  const missing = profile.requiredTargetMetadata.filter((key) => !String(target[key] || '').trim());
  if (missing.length) throw new Error('Provider target metadata is incomplete: ' + missing.join(', '));

  let targetHost;
  if (providerKey === 'sap-successfactors') {
    targetHost = normalizeHostname(target.apiServer);
  } else if (providerKey === 'netsuite') {
    const account = normalizeNetSuiteAccountId(target.accountId);
    targetHost = normalizeHostname(target.accountSpecificDomain);
    if (!account || targetHost !== `${account}.suitetalk.api.netsuite.com`) {
      throw new Error('NetSuite account-specific REST domain does not match the supplied account ID.');
    }
  }

  return Object.freeze({
    providerKey,
    transport: profile.transport,
    authMethod,
    credentialRef: String(review.auth?.credentialRef || ''),
    targetMetadata: Object.freeze({ ...target, ...(providerKey === 'sap-successfactors' ? { apiServer: targetHost } : { accountSpecificDomain: targetHost }) }),
    targetOrigin: `https://${targetHost}`,
    pinnedHost: targetHost,
    request: profile.proofRequest,
    identityBinding: profile.identityBinding,
    nonMutating: true,
    boundedMetadataOnly: true,
    containsSensitiveData: false,
    followRedirects: false,
    activationAllowedFromThisProofAlone: false
  });
}

module.exports = {
  PROFILES,
  normalizeHostname,
  normalizeNetSuiteAccountId,
  buildProviderProofPlan
};
