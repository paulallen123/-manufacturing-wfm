'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RAILWAY_ENVIRONMENTS_QUERY,
  PROVIDER_PROOF_SOURCE,
  createRailwayReadOnlyEnvironmentAdapter,
  validateLookup
} = require('./railway-readonly-environment-adapter.cjs');

function lookup(overrides = {}) {
  return {
    queueKey: 'wfm-provision:v1:abc',
    intentDigest: 'a'.repeat(64),
    providerRequestId: 'wfm-create-123',
    provider: 'railway',
    region: 'eu-west',
    tenantId: 'tenant-42',
    ...overrides
  };
}

function expectedName(overrides = {}) {
  return validateLookup(lookup(overrides)).environmentName;
}

function readOnlyProofReader(hooks = {}, result = null) {
  return {
    capabilities: {
      readOnly: true,
      createsResources: false,
      updatesResources: false,
      deletesResources: false
    },
    async readCreationProof(request) {
      hooks.proofRead = request;
      if (result !== null) return result;
      return {
        source: PROVIDER_PROOF_SOURCE,
        environmentId: request.environmentId,
        environmentName: request.environmentName,
        creationProof: { schemaVersion: 2, mac: 'proof' }
      };
    }
  };
}

function adapter(response, hooks = {}, proofResult = null) {
  return createRailwayReadOnlyEnvironmentAdapter({
    projectId: 'project-1',
    now: () => 1_000_000,
    creationProofReader: readOnlyProofReader(hooks, proofResult),
    executeGraphQL: async request => {
      hooks.request = request;
      return response;
    }
  });
}

test('adapter and provider proof reader are explicitly read-only', () => {
  const value = adapter({ data: { environments: { edges: [] } } });
  assert.deepEqual(value.capabilities, {
    readOnly: true,
    createsResources: false,
    updatesResources: false,
    deletesResources: false
  });
  assert.match(RAILWAY_ENVIRONMENTS_QUERY, /^query\s+/);
  assert.doesNotMatch(RAILWAY_ENVIRONMENTS_QUERY, /\bmutation\b/i);
});

test('maps one exact Railway match only after reading its autonomous proof from that provider environment', async () => {
  const hooks = {};
  const name = expectedName();
  const value = adapter({
    data: {
      environments: {
        edges: [
          { node: { id: 'env-other', name: 'other', createdAt: '1970-01-01T00:16:39.000Z' } },
          { node: { id: 'env-1', name, createdAt: '1970-01-01T00:16:39.900Z' } }
        ]
      }
    }
  }, hooks);
  const result = await value.lookupEnvironment(lookup());

  assert.equal(hooks.request.query, RAILWAY_ENVIRONMENTS_QUERY);
  assert.deepEqual(hooks.request.variables, { projectId: 'project-1', isEphemeral: false });
  assert.equal(Object.isFrozen(hooks.request.variables), true);
  assert.equal(result.status, 'FOUND');
  assert.equal(result.providerResourceId, 'env-1');
  assert.equal(result.environmentName, name);
  assert.match(result.bindingDigest, /^[a-f0-9]{64}$/);
  assert.equal(result.creationProof.mac, 'proof');
  assert.equal(result.creationProofSource, PROVIDER_PROOF_SOURCE);
  assert.deepEqual(hooks.proofRead, { projectId: 'project-1', environmentId: 'env-1', environmentName: name });
});

test('returns NOT_FOUND without reading proof when the exact bound environment does not exist', async () => {
  let proofCalls = 0;
  const value = createRailwayReadOnlyEnvironmentAdapter({
    projectId: 'project-1',
    now: () => 1_000_000,
    creationProofReader: {
      capabilities: { readOnly: true, createsResources: false, updatesResources: false, deletesResources: false },
      async readCreationProof() {
        proofCalls += 1;
        return null;
      }
    },
    executeGraphQL: async () => ({ data: { environments: { edges: [] } } })
  });
  assert.deepEqual(await value.lookupEnvironment(lookup()), {
    status: 'NOT_FOUND', readOnly: true, observedAt: 1_000_000, provider: 'railway'
  });
  assert.equal(proofCalls, 0);
});

test('fails closed as AMBIGUOUS when Railway returns GraphQL errors even with a response body', async () => {
  const value = adapter({
    errors: [{ message: 'Not Authorized', extensions: { code: 'INTERNAL_SERVER_ERROR' } }],
    data: { environments: { edges: [] } }
  });
  assert.deepEqual(await value.lookupEnvironment(lookup()), {
    status: 'AMBIGUOUS', readOnly: true, observedAt: 1_000_000, provider: 'railway'
  });
});

test('fails closed as AMBIGUOUS when duplicate exact-name environments are returned', async () => {
  const name = expectedName();
  const value = adapter({
    data: {
      environments: {
        edges: [
          { node: { id: 'env-1', name, createdAt: '1970-01-01T00:16:39.900Z' } },
          { node: { id: 'env-2', name, createdAt: '1970-01-01T00:16:39.950Z' } }
        ]
      }
    }
  });
  assert.deepEqual(await value.lookupEnvironment(lookup()), {
    status: 'AMBIGUOUS', readOnly: true, observedAt: 1_000_000, provider: 'railway'
  });
});

test('a manually named environment cannot qualify using an internal proof copy', async () => {
  const name = expectedName();
  const value = adapter({
    data: { environments: { edges: [{ node: { id: 'env-1', name, createdAt: '1970-01-01T00:16:39.900Z' } }] } }
  }, {}, {
    source: 'INTERNAL_DURABLE_STATE',
    environmentId: 'env-1',
    environmentName: name,
    creationProof: { schemaVersion: 2, mac: 'looks-valid-internally' }
  });
  await assert.rejects(
    () => value.lookupEnvironment(lookup()),
    error => error.code === 'WFM_RAILWAY_CREATION_PROOF_SOURCE_INVALID'
  );
});

test('rejects a matched environment when its provider-resident autonomous proof is unavailable', async () => {
  const name = expectedName();
  const value = adapter({
    data: { environments: { edges: [{ node: { id: 'env-1', name, createdAt: '1970-01-01T00:16:39.900Z' } }] } }
  }, {}, undefined);
  const missingReader = {
    capabilities: { readOnly: true, createsResources: false, updatesResources: false, deletesResources: false },
    async readCreationProof() { return null; }
  };
  const direct = createRailwayReadOnlyEnvironmentAdapter({
    projectId: 'project-1',
    now: () => 1_000_000,
    creationProofReader: missingReader,
    executeGraphQL: async () => ({
      data: { environments: { edges: [{ node: { id: 'env-1', name, createdAt: '1970-01-01T00:16:39.900Z' } }] } }
    })
  });
  await assert.rejects(
    () => direct.lookupEnvironment(lookup()),
    error => error.code === 'WFM_RAILWAY_CREATION_PROOF_REQUIRED'
  );
  assert.ok(value);
});

test('rejects a provider proof reader that exposes mutation capability', () => {
  assert.throws(() => createRailwayReadOnlyEnvironmentAdapter({
    projectId: 'project-1',
    creationProofReader: {
      capabilities: { readOnly: true, createsResources: false, updatesResources: false, deletesResources: false },
      readCreationProof() {},
      setVariable() {}
    },
    executeGraphQL: async () => ({ data: { environments: { edges: [] } } })
  }), error => error.code === 'WFM_RAILWAY_PROOF_READER_MUTATION_METHOD_PRESENT');
});

test('rejects lookups for another provider before any Railway query occurs', async () => {
  let calls = 0;
  const value = createRailwayReadOnlyEnvironmentAdapter({
    projectId: 'project-1',
    creationProofReader: readOnlyProofReader(),
    executeGraphQL: async () => {
      calls += 1;
      return { data: { environments: { edges: [] } } };
    }
  });
  await assert.rejects(
    () => value.lookupEnvironment(lookup({ provider: 'aws' })),
    error => error.code === 'WFM_RAILWAY_PROVIDER_MISMATCH'
  );
  assert.equal(calls, 0);
});

test('a different sealed request derives a different lookup name, blocking stale or manually redirected recovery', () => {
  const original = validateLookup(lookup());
  const changed = validateLookup(lookup({ providerRequestId: 'wfm-create-456' }));
  assert.notEqual(changed.environmentName, original.environmentName);
  assert.notEqual(changed.bindingDigest, original.bindingDigest);
});
