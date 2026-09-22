'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  routeForConnection,
  buildIntegrationPath
} = require('./launch-integration-pathfinder.cjs');

function connection(overrides = {}) {
  return {
    id: 'c-1',
    productKey: 'workday',
    name: 'Workday',
    state: 'ACTIVE',
    authMethod: 'oauth2',
    sourceInstanceId: 'tenant-a',
    mappingVersion: 3,
    lastSyncAt: '2026-09-22T10:00:00Z',
    lastReconciliation: { status: 'PASS', createdAt: '2026-09-22T10:00:00Z' },
    ...overrides
  };
}

test('active reconciled API connection is a proven route', () => {
  const plan = buildIntegrationPath({ integrationStatus: { connections: [connection()] } });
  assert.equal(plan.state, 'PROVEN_ROUTE');
  assert.equal(plan.ready, true);
  assert.equal(plan.selected.route, 'NATIVE_API');
  assert.match(plan.selected.evidenceRef, /reconciliation:PASS/);
});

test('active reconciled SFTP connection is a proven fallback rather than being mislabeled as API', () => {
  const plan = buildIntegrationPath({
    integrationStatus: { connections: [connection({ authMethod: 'sftp', productKey: 'mhr-itrent', name: 'MHR iTrent' })] }
  });
  assert.equal(routeForConnection({ authMethod: 'sftp' }), 'SFTP');
  assert.equal(plan.selected.route, 'SFTP');
});

test('a declared fallback without an executor never counts as connected', () => {
  const plan = buildIntegrationPath({
    fallbackCapabilities: [{
      route: 'DOCUMENT',
      source: 'customer-declared-document-export',
      executorAvailable: false,
      authorised: true,
      provenanceBound: true,
      reconcilable: true,
      authoritativeCoverage: true,
      proven: true,
      evidenceRef: 'declaration:1'
    }]
  });
  assert.equal(plan.ready, false);
  assert.equal(plan.state, 'EXECUTOR_UNAVAILABLE');
  assert.deepEqual(plan.declaredWithoutExecutor, ['DOCUMENT']);
});

test('an available executor still requires reconciliation and authoritative coverage proof', () => {
  const plan = buildIntegrationPath({
    fallbackCapabilities: [{
      route: 'FILE',
      source: 'file-batch-adapter',
      executorAvailable: true,
      authorised: true,
      provenanceBound: true,
      reconcilable: false,
      authoritativeCoverage: false,
      proven: false,
      evidenceRef: 'file-adapter:configured'
    }]
  });
  assert.equal(plan.ready, false);
  assert.equal(plan.state, 'PROOF_REQUIRED');
  assert.deepEqual(plan.needsProof, ['FILE']);
});

test('higher-preference degraded API does not block a lower proven SFTP route', () => {
  const plan = buildIntegrationPath({
    integrationStatus: {
      connections: [
        connection({ id: 'api', state: 'DEGRADED', lastReconciliation: { status: 'NEEDS_REVIEW' } }),
        connection({ id: 'sftp', authMethod: 'sftp', productKey: 'mhr-itrent', name: 'MHR iTrent' })
      ]
    }
  });
  assert.equal(plan.ready, true);
  assert.equal(plan.selected.route, 'SFTP');
});

test('no observed connection or fallback remains discovery required rather than invented support', () => {
  const plan = buildIntegrationPath({});
  assert.equal(plan.ready, false);
  assert.equal(plan.state, 'DISCOVERY_REQUIRED');
  assert.equal(plan.selected, null);
});
