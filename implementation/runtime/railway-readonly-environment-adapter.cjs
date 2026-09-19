'use strict';

const RAILWAY_ENVIRONMENTS_QUERY = `query WfmReadOnlyEnvironments($projectId: String!, $isEphemeral: Boolean) {
  environments(projectId: $projectId, isEphemeral: $isEphemeral) {
    edges {
      node {
        id
        name
        createdAt
      }
    }
  }
}`;

function fail(code, message, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  throw error;
}

function requireString(value, code, message) {
  if (typeof value !== 'string' || value.trim() === '') fail(code, message, 400);
  return value.trim();
}

function toMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const millis = Date.parse(String(value || ''));
  if (!Number.isFinite(millis)) fail('WFM_RAILWAY_CREATED_AT_INVALID', 'Railway environment creation time is invalid.', 502);
  return millis;
}

function validateLookup(lookup) {
  if (!lookup || typeof lookup !== 'object') fail('WFM_RAILWAY_LOOKUP_REQUIRED', 'Railway reconciliation lookup is required.', 400);
  if (String(lookup.provider || '').toLowerCase() !== 'railway') {
    fail('WFM_RAILWAY_PROVIDER_MISMATCH', 'Railway adapter received a lookup for a different provider.', 400);
  }
  return Object.freeze({
    queueKey: requireString(lookup.queueKey, 'WFM_RAILWAY_QUEUE_KEY_REQUIRED', 'Provisioning queue identity is required.'),
    intentDigest: requireString(lookup.intentDigest, 'WFM_RAILWAY_INTENT_REQUIRED', 'Provisioning intent digest is required.').toLowerCase(),
    providerRequestId: requireString(lookup.providerRequestId, 'WFM_RAILWAY_REQUEST_REQUIRED', 'Provider request identity is required.'),
    provider: 'railway',
    region: requireString(lookup.region, 'WFM_RAILWAY_REGION_REQUIRED', 'Cloud region is required.'),
    tenantId: requireString(lookup.tenantId, 'WFM_RAILWAY_TENANT_REQUIRED', 'Tenant identity is required.')
  });
}

function createRailwayReadOnlyEnvironmentAdapter({
  projectId,
  executeGraphQL,
  environmentNameForLookup,
  creationProofForLookup,
  now = Date.now
} = {}) {
  const railwayProjectId = requireString(projectId, 'WFM_RAILWAY_PROJECT_REQUIRED', 'Railway project id is required.');
  if (typeof executeGraphQL !== 'function') throw new Error('Railway read-only adapter requires an injected GraphQL query executor.');
  if (typeof environmentNameForLookup !== 'function') throw new Error('Railway read-only adapter requires a deterministic environment-name resolver.');
  if (typeof creationProofForLookup !== 'function') throw new Error('Railway read-only adapter requires the durable fresh-create proof resolver.');

  const capabilities = Object.freeze({
    readOnly: true,
    createsResources: false,
    updatesResources: false,
    deletesResources: false
  });

  async function lookupEnvironment(rawLookup) {
    const lookup = validateLookup(rawLookup);
    const expectedName = requireString(
      await environmentNameForLookup(lookup),
      'WFM_RAILWAY_ENVIRONMENT_NAME_REQUIRED',
      'Railway reconciliation requires the exact expected environment name.'
    );

    const response = await executeGraphQL({
      query: RAILWAY_ENVIRONMENTS_QUERY,
      variables: Object.freeze({ projectId: railwayProjectId, isEphemeral: false })
    });
    const observedAt = Number(now());
    if (!Number.isFinite(observedAt) || observedAt <= 0) fail('WFM_RAILWAY_CLOCK_INVALID', 'Railway reconciliation clock is invalid.', 500);

    if (!response || typeof response !== 'object') {
      return Object.freeze({ status: 'AMBIGUOUS', readOnly: true, observedAt, provider: 'railway' });
    }
    if (Array.isArray(response.errors) && response.errors.length > 0) {
      return Object.freeze({ status: 'AMBIGUOUS', readOnly: true, observedAt, provider: 'railway' });
    }

    const edges = response.data && response.data.environments && response.data.environments.edges;
    if (!Array.isArray(edges)) {
      return Object.freeze({ status: 'AMBIGUOUS', readOnly: true, observedAt, provider: 'railway' });
    }

    const matches = edges
      .map(edge => edge && edge.node)
      .filter(node => node && node.name === expectedName);

    if (matches.length === 0) {
      return Object.freeze({ status: 'NOT_FOUND', readOnly: true, observedAt, provider: 'railway' });
    }
    if (matches.length !== 1) {
      return Object.freeze({ status: 'AMBIGUOUS', readOnly: true, observedAt, provider: 'railway' });
    }

    const environment = matches[0];
    const providerResourceId = requireString(
      environment.id,
      'WFM_RAILWAY_ENVIRONMENT_ID_REQUIRED',
      'Railway matched environment is missing its provider id.'
    );
    const creationProof = await creationProofForLookup(lookup);
    if (!creationProof || typeof creationProof !== 'object') {
      fail('WFM_RAILWAY_CREATION_PROOF_REQUIRED', 'Matched Railway environment has no durable autonomous fresh-create proof.', 403);
    }

    return Object.freeze({
      status: 'FOUND',
      readOnly: true,
      observedAt,
      providerResourceId,
      providerRequestId: lookup.providerRequestId,
      provider: 'railway',
      region: lookup.region,
      tenantId: lookup.tenantId,
      createdAt: toMillis(environment.createdAt),
      creationProof
    });
  }

  return Object.freeze({ capabilities, lookupEnvironment });
}

module.exports = {
  RAILWAY_ENVIRONMENTS_QUERY,
  createRailwayReadOnlyEnvironmentAdapter,
  validateLookup,
  toMillis
};
