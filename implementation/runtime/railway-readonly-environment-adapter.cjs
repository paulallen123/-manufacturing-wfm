'use strict';

const { deriveProvisioningEnvironmentBinding } = require('./provisioning-environment-binding.cjs');

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

const PROVIDER_PROOF_SOURCE = 'RAILWAY_PROVIDER_READ';
const MUTATION_METHOD_NAMES = ['createEnvironment', 'updateEnvironment', 'deleteEnvironment', 'create', 'update', 'delete', 'mutate', 'setVariable', 'upsertVariable'];

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

function assertReadOnlyCreationProofReader(reader) {
  if (!reader || typeof reader !== 'object' || typeof reader.readCreationProof !== 'function') {
    fail('WFM_RAILWAY_PROOF_READER_REQUIRED', 'Railway reconciliation requires a read-only provider creation-proof reader.', 500);
  }
  const caps = reader.capabilities || {};
  if (caps.readOnly !== true || caps.createsResources !== false || caps.updatesResources !== false || caps.deletesResources !== false) {
    fail('WFM_RAILWAY_PROOF_READER_NOT_READ_ONLY', 'Railway creation-proof reader must explicitly deny create, update and delete capability.', 403);
  }
  for (const method of MUTATION_METHOD_NAMES) {
    if (typeof reader[method] === 'function') {
      fail('WFM_RAILWAY_PROOF_READER_MUTATION_METHOD_PRESENT', 'Railway creation-proof reader exposes a mutation method.', 403);
    }
  }
  return reader;
}

function validateLookup(lookup) {
  if (!lookup || typeof lookup !== 'object') fail('WFM_RAILWAY_LOOKUP_REQUIRED', 'Railway reconciliation lookup is required.', 400);
  if (String(lookup.provider || '').toLowerCase() !== 'railway') {
    fail('WFM_RAILWAY_PROVIDER_MISMATCH', 'Railway adapter received a lookup for a different provider.', 400);
  }
  const normalized = {
    queueKey: requireString(lookup.queueKey, 'WFM_RAILWAY_QUEUE_KEY_REQUIRED', 'Provisioning queue identity is required.'),
    intentDigest: requireString(lookup.intentDigest, 'WFM_RAILWAY_INTENT_REQUIRED', 'Provisioning intent digest is required.').toLowerCase(),
    providerRequestId: requireString(lookup.providerRequestId, 'WFM_RAILWAY_REQUEST_REQUIRED', 'Provider request identity is required.'),
    provider: 'railway',
    region: requireString(lookup.region, 'WFM_RAILWAY_REGION_REQUIRED', 'Cloud region is required.'),
    tenantId: requireString(lookup.tenantId, 'WFM_RAILWAY_TENANT_REQUIRED', 'Tenant identity is required.')
  };
  const binding = deriveProvisioningEnvironmentBinding({
    queueKey: normalized.queueKey,
    intentDigest: normalized.intentDigest,
    providerRequestId: normalized.providerRequestId,
    payload: {
      plan: { provider: normalized.provider, region: normalized.region },
      contract: { tenantId: normalized.tenantId }
    }
  });
  return Object.freeze({ ...normalized, ...binding });
}

function normalizeProviderProofRead(proofRead, environment, expectedName) {
  if (!proofRead || typeof proofRead !== 'object') {
    fail('WFM_RAILWAY_CREATION_PROOF_REQUIRED', 'Matched Railway environment has no provider-resident autonomous creation proof.', 403);
  }
  if (proofRead.source !== PROVIDER_PROOF_SOURCE) {
    fail('WFM_RAILWAY_CREATION_PROOF_SOURCE_INVALID', 'Autonomous creation proof must be read back from Railway, not supplied from internal state.', 403);
  }
  if (String(proofRead.environmentId || '') !== String(environment.id || '') || String(proofRead.environmentName || '') !== expectedName) {
    fail('WFM_RAILWAY_CREATION_PROOF_ENVIRONMENT_MISMATCH', 'Provider-read creation proof does not belong to the exact matched Railway environment.', 409);
  }
  if (!proofRead.creationProof || typeof proofRead.creationProof !== 'object') {
    fail('WFM_RAILWAY_CREATION_PROOF_REQUIRED', 'Matched Railway environment has no provider-resident autonomous creation proof.', 403);
  }
  return Object.freeze({
    source: PROVIDER_PROOF_SOURCE,
    creationProof: structuredClone(proofRead.creationProof)
  });
}

function createRailwayReadOnlyEnvironmentAdapter({
  projectId,
  executeGraphQL,
  creationProofReader,
  now = Date.now
} = {}) {
  const railwayProjectId = requireString(projectId, 'WFM_RAILWAY_PROJECT_REQUIRED', 'Railway project id is required.');
  if (typeof executeGraphQL !== 'function') throw new Error('Railway read-only adapter requires an injected GraphQL query executor.');
  const proofReader = assertReadOnlyCreationProofReader(creationProofReader);

  const capabilities = Object.freeze({
    readOnly: true,
    createsResources: false,
    updatesResources: false,
    deletesResources: false
  });

  async function lookupEnvironment(rawLookup) {
    const lookup = validateLookup(rawLookup);
    const expectedName = lookup.environmentName;

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
    const proofRead = normalizeProviderProofRead(await proofReader.readCreationProof(Object.freeze({
      projectId: railwayProjectId,
      environmentId: providerResourceId,
      environmentName: expectedName
    })), environment, expectedName);

    return Object.freeze({
      status: 'FOUND',
      readOnly: true,
      observedAt,
      providerResourceId,
      providerRequestId: lookup.providerRequestId,
      provider: 'railway',
      region: lookup.region,
      tenantId: lookup.tenantId,
      environmentName: lookup.environmentName,
      bindingVersion: lookup.bindingVersion,
      bindingDigest: lookup.bindingDigest,
      createdAt: toMillis(environment.createdAt),
      creationProofSource: proofRead.source,
      creationProof: proofRead.creationProof
    });
  }

  return Object.freeze({ capabilities, lookupEnvironment });
}

module.exports = {
  RAILWAY_ENVIRONMENTS_QUERY,
  PROVIDER_PROOF_SOURCE,
  createRailwayReadOnlyEnvironmentAdapter,
  assertReadOnlyCreationProofReader,
  validateLookup,
  normalizeProviderProofRead,
  toMillis
};
