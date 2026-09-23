'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  GATE_DEFINITIONS,
  selectIntegrationRoute,
  createLaunchAutopilotController,
  gatesForImpact
} = require('./launch-autopilot-controller.cjs');

function withController(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-launch-autopilot-'));
  const dbPath = path.join(root, 'wfm.sqlite');
  const controller = createLaunchAutopilotController({ dbPath });
  try { return fn(controller, dbPath); }
  finally { controller.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

function pass(gate, n = 0) {
  return {
    gate,
    status: 'PASS',
    source: 'authoritative-test-source',
    evidenceRef: 'evidence:' + gate + ':' + n,
    observedAt: new Date(1789988400000 + n * 1000).toISOString(),
    verified: true,
    twinRevision: 'twin-r1',
    detail: { fixtureOnly: false }
  };
}

test('Launch Autopilot cannot claim ready until every authoritative gate passes', () => withController(c => {
  const run = c.ensureRun('alpha', 'run-1');
  assert.equal(run.state, 'DISCOVER');
  let state;
  for (let i = 0; i < GATE_DEFINITIONS.length - 1; i++) {
    state = c.recordReceipt({ tenant: 'alpha', runId: 'run-1', receipt: pass(GATE_DEFINITIONS[i].key, i) });
  }
  assert.equal(state.ready, false);
  assert.equal(state.activation.eligible, false);
  state = c.recordReceipt({ tenant: 'alpha', runId: 'run-1', receipt: pass(GATE_DEFINITIONS.at(-1).key, 99) });
  assert.equal(state.ready, true);
  assert.equal(state.state, 'READY');
  assert.equal(state.activation.authority, 'EXTERNAL_PERMIT_REQUIRED');
  assert.equal(state.activation.productionMutation, false);
}));

test('PASS proof must be explicitly verified', () => withController(c => {
  assert.throws(() => c.recordReceipt({
    tenant: 'alpha', runId: 'run-1',
    receipt: { ...pass('scope'), verified: false }
  }), /verified=true/);
}));

test('integration route falls back without weakening authority, provenance or reconciliation requirements', () => {
  const route = selectIntegrationRoute([
    { route: 'NATIVE_API', available: false },
    { route: 'MIDDLEWARE', available: true, authorised: true, provenanceBound: true, reconcilable: false, authoritativeCoverage: true },
    { route: 'SFTP', available: true, authorised: true, provenanceBound: true, reconcilable: true, authoritativeCoverage: true, source: 'customer-sftp', scope: ['people','time'] }
  ]);
  assert.equal(route.route, 'SFTP');
  assert.equal(route.fallback, true);
  assert.deepEqual(route.scope, ['people','time']);
  assert.equal(selectIntegrationRoute([{ route: 'FILE', available: true, authorised: true, provenanceBound: false, reconcilable: true, authoritativeCoverage: true }]), null);
});

test('a previously proven gate regression reverses readiness immediately', () => withController(c => {
  GATE_DEFINITIONS.forEach((g, i) => c.recordReceipt({ tenant: 'alpha', runId: 'run-1', receipt: pass(g.key, i) }));
  assert.equal(c.status('alpha','run-1').ready, true);
  const regressed = c.recordReceipt({ tenant: 'alpha', runId: 'run-1', receipt: {
    gate: 'source-systems', status: 'DEGRADED', source: 'autonomous-integration-hub',
    evidenceRef: 'integration:degraded:1', observedAt: '2026-09-22T11:00:00Z', verified: false,
    twinRevision: 'twin-r2', detail: { reason: 'SCHEMA_DRIFT' }
  }});
  assert.equal(regressed.ready, false);
  assert.ok(regressed.blocking.some(x => x.gate === 'source-systems'));
  assert.ok(c.events('alpha','run-1').some(e => e.event === 'READINESS_REGRESSED'));
}));

test('Digital Twin change opens only affected revalidation gates', () => withController(c => {
  GATE_DEFINITIONS.forEach((g, i) => c.recordReceipt({ tenant: 'alpha', runId: 'run-1', receipt: pass(g.key, i) }));
  const impact = {
    toRevision: 'twin-r2',
    changed: ['integration:hcm'],
    affected: { integrations: ['integration:hcm'], configuration: [], roles: ['role:manager'], training: ['training:integration-health'], tests: ['test:people-sync'], readiness: [] }
  };
  assert.deepEqual(gatesForImpact(impact), ['historical-replay','live-data-import','mapping','role-learning','scenario-validation','source-systems']);
  const next = c.invalidateForTwinImpact({ tenant: 'alpha', runId: 'run-1', impact });
  assert.equal(next.ready, false);
  const degraded = next.gates.filter(g => g.status === 'DEGRADED').map(g => g.key).sort();
  assert.deepEqual(degraded, gatesForImpact(impact));
  assert.equal(next.gates.find(g => g.key === 'tenant-environment').status, 'PASS');
  assert.ok(c.events('alpha','run-1').some(e => e.event === 'DELTA_REVALIDATION_OPENED'));
}));

test('receipts are persisted and append-only across controller restart', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-launch-persist-'));
  const dbPath = path.join(root, 'wfm.sqlite');
  let c = createLaunchAutopilotController({ dbPath });
  c.recordReceipt({ tenant: 'alpha', runId: 'run-1', receipt: pass('scope', 1) });
  c.close();
  c = createLaunchAutopilotController({ dbPath });
  try {
    assert.equal(c.status('alpha','run-1').receipts.length, 1);
    assert.equal(c.status('alpha','run-1').receipts[0].gate, 'scope');
  } finally {
    c.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
