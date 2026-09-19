'use strict';

const PROFILES = Object.freeze({
  'sap-successfactors': Object.freeze({
    transport: 'api',
    preferredAuth: ['oauth2', 'service-account'],
    requiredTargetMetadata: ['apiServer', 'companyId'],
    proofRequest: Object.freeze({
      method: 'GET',
      path: '/odata/v2/User/$metadata',
      maxResponseBytes: 2 * 1024 * 1024,
      responseKind: 'odata-metadata',
      recordsAllowed: false
    }),
    identityBinding: 'companyId identifies the SuccessFactors system on the configured API server'
  }),
  netsuite: Object.freeze({
    transport: 'api',
    preferredAuth: ['oauth2'],
    requiredTargetMetadata: ['accountId', 'accountSpecificDomain'],
    proofRequest: Object.freeze({
      method: 'GET',
      path: '/services/rest/record/v1/metadata-catalog?select=customer',
      maxResponseBytes: 2 * 1024 * 1024,
      responseKind: 'openapi-metadata',
      recordsAllowed: false
    }),
    identityBinding: 'account-specific REST domain must match the reviewed NetSuite account ID and environment'
  })
});

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

  const missing = profile.requiredTargetMetadata.filter((key) => !String(target[key] || '').trim());
  if (missing.length) throw new Error('Provider target metadata is incomplete: ' + missing.join(', '));

  if (providerKey === 'netsuite') {
    const account = normalizeNetSuiteAccountId(target.accountId);
    const host = String(target.accountSpecificDomain || '').trim().toLowerCase();
    if (!account || host !== `${account}.suitetalk.api.netsuite.com`) {
      throw new Error('NetSuite account-specific REST domain does not match the supplied account ID.');
    }
  }

  return Object.freeze({
    providerKey,
    transport: profile.transport,
    authMethod: String(review.auth?.method || ''),
    credentialRef: String(review.auth?.credentialRef || ''),
    targetMetadata: Object.freeze({ ...target }),
    request: profile.proofRequest,
    identityBinding: profile.identityBinding,
    nonMutating: true,
    boundedMetadataOnly: true,
    containsSensitiveData: false,
    activationAllowedFromThisProofAlone: false
  });
}

module.exports = {
  PROFILES,
  normalizeNetSuiteAccountId,
  buildProviderProofPlan
};
