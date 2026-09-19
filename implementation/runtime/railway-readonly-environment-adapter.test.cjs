'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RAILWAY_ENVIRONMENTS_QUERY,
  createRailwayReadOnlyEnvironmentAdapter
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

function adapter(response, hooks = {}) {
  return createRailwayReadOnlyEnvironmentAdapter({
    projectId: 'project-1',
    now: () => 1_000_000,
    environmentNameForLookup: async value => {
      hooks.seenLookup = value;
      return 'wfm-tenant-42-proof';
    },
    creationProofForLookup: async value => {
      hooks.proofLookup = value;
      return { schemaVersion: 1, mac: 'proof' };
    },
    executeGraphQL: async request => {
      hooks.request = request;
      return response;
    }
  });
}

test('adapter is explicitly read-only and its fixed Railway operation is a query, not a mutation', () => {
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

test('queries only non-ephemeral environments and maps one exact match to fresh-create evidence', async () => {
  const hooks = {};
  const value = adapter({
    data: {
      environments: {
        edges: [
          { node: { id: 'env-other', name: 'other', createdAt: '1970-01-01T00:16:39.000Z' } },
          { node: { id: 'env-1', name: 'wfm-tenant-42-proof', createdAt: '1970-01-01T00:16:39.900Z' } }
        ]
      }
    }
  }, hooks);
  const result = await value.lookupEnvironment(lookup());

  assert.equal(hooks.request.query, RAILWAY_ENVIRONMENTS_QUERY);
  assert.deepEqual(hooks.request.variables, { projectId: 'project-1', isEphemeral: false });
  assert.equal(Object.isFrozen(hooks.request.variables), true);
  assert.deepEqual(result, {
    status: 'FOUND',
    readOnly: true,
    observedAt: 1_000_000,
    providerResourceId: 'env-1',
    providerRequestId: 'wfm-create-123',
    provider: 'railway',
    region: 'eu-west',
    tenantId: 'tenant-42',
    createdAt: 999_900,
    creationProof: { schemaVersion: 1, mac: 'proof' }
  });
  assert.equal(Object.isFrozen(hooks.seenLookup), true);
  assert.equal(hooks.proofLookup.queueKey, 'wfm-provision:v1:abc');
});

test('returns NOT_FOUND without asking for proof when the expected environment does not exist', async () => {
  let proofCalls = 0;
  const value = createRailwayReadOnlyEnvironmentAdapter({
    projectId: 'project-1',
    now: () => 1_000_000,
    environmentNameForLookup: async () => 'expected',
    creationProofForLookup: async () => {
      proofCalls += 1;
      return { mac: 'unused' };
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
  const value = adapter({
    data: {
      environments: {
        edges: [
          { node: { id: 'env-1', name: 'wfm-tenant-42-proof', createdAt: '1970-01-01T00:16:39.900Z' } },
          { node: { id: 'env-2', name: 'wfm-tenant-42-proof', createdAt: '1970-01-01T00:16:39.950Z' } }
        ]
      }
    }
  });
  assert.deepEqual(await value.lookupEnvironment(lookup()), {
    status: 'AMBIGUOUS', readOnly: true, observedAt: 1_000_000, provider: 'railway'
  });
});

test('rejects a matched environment when its durable autonomous proof is unavailable', async () => {
  const value = createRailwayReadOnlyEnvironmentAdapter({
    projectId: 'project-1',
    now: () => 1_000_000,
    environmentNameForLookup: async () => 'expected',
    creationProofForLookup: async () => null,
    executeGraphQL: async () => ({
      data: { environments: { edges: [{ node: { id: 'env-1', name: 'expected', createdAt: '1970-01-01T00:16:39.900Z' } }] } }
    })
  });
  await assert.rejects(
    () => value.lookupEnvironment(lookup()),
    error => error.code === 'WFM_RAILWAY_CREATION_PROOF_REQUIRED'
  );
});

test('rejects lookups for another provider before any Railway query occurs', async () => {
  let calls = 0;
  const value = createRailwayReadOnlyEnvironmentAdapter({
    projectId: 'project-1',
    environmentNameForLookup: async () => 'expected',
    creationProofForLookup: async () => ({ mac: 'proof' }),
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
