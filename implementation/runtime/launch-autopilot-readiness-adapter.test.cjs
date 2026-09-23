'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLaunchAutopilotController } = require('./launch-autopilot-controller.cjs');
const { syncLaunchAutopilot, buildImplementationTwin } = require('./launch-autopilot-readiness-adapter.cjs');

const KEYS = [
  'configuration-scope','tenant-environment','identity-access','source-systems','people-data',
  'organisation-model','time-policies','absence-policies','scheduling','approvals','clocking',
  'payroll-mapping','historical-replay','security-controls','resilience','scenario-validation',
  'test-data-cleanup','live-data-import','role-learning','privileged-competency','frontline-readiness'
];

function readiness(overrides = {}) {
  const requirements = KEYS.map((key, index) => ({
    key,
    status: 'PASS',
    confidence: 1,
    satisfied: true,
    source: key === 'configuration-scope'
      ? 'customer-scope'
      : ['role-learning','privileged-competency','frontline-readiness'].includes(key)
        ? 'adaptive-learning-engine'
        : 'authoritative:' + key,
    observedAt: new Date(Date.parse('2026-09-22T09:00:00Z') + index * 1000).toISOString()
  }));
  if (overrides.failKey) {
    const item = requirements.find(x => x.key === overrides.failKey);
    item.status = 'FAIL';
    item.satisfied = false;
  }
  return {
    runId: 'run-1',
    tenant: 'alpha',
    startedAt: '2026-09-22T08:00:00Z',
    operationalReady: overrides.operationalReady !== false && !overrides.failKey,
    requirements,
    blockingDecisions: overrides.blockingDecisions || [],
    customerScope: {
      companyName: 'Alpha Manufacturing',
      employeeCount: 10000,
      countries: ['United Kingdom'],
      sites: ['Plant A','Plant B'],
      sourceSystems: ['HCM','Payroll']
    }
  };
}

function integrations() {
  return {
    connections: [{
      id: 'hcm-1',
      productKey: 'workday',
      name: 'Workday',
      state: 'ACTIVE',
      authMethod: 'oauth2',
      sourceInstanceId: 'tenant-a',
      mappingVersion: 2,
      lastSyncAt: '2026-09-22T09:30:00Z',
      lastReconciliation: { status: 'PASS' }
    }]
  };
}

function withController(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-launch-adapter-'));
  const dbPath = path.join(root, 'wfm.sqlite');
  const controller = createLaunchAutopilotController({ dbPath });
  try { return fn(controller); }
  finally { controller.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

test('current one-day implementation proof can satisfy Launch Autopilot without removing any old requirement', () => withController(controller => {
  const launch = syncLaunchAutopilot({ controller, readiness: readiness(), integrations: integrations() });
  assert.equal(launch.ready, true);
  assert.equal(launch.state, 'READY');
  assert.equal(launch.compatibility.existingImplementationReady, true);
  assert.equal(launch.compatibility.noRequirementRemoved, true);
  assert.equal(launch.activation.authority, 'EXTERNAL_PERMIT_REQUIRED');
  assert.equal(launch.activation.productionMutation, false);
  assert.ok(launch.twinRevision);
  assert.equal(launch.integrationPath.state, 'PROVEN_ROUTE');
  assert.equal(launch.integrationPath.selected.route, 'NATIVE_API');
  assert.equal(launch.gates.find(x => x.key === 'existing-readiness').status, 'PASS');
}));

test('a detailed legacy requirement failure prevents Launch readiness even if other domains remain proven', () => withController(controller => {
  const launch = syncLaunchAutopilot({ controller, readiness: readiness({ failKey: 'absence-policies' }), integrations: integrations() });
  assert.equal(launch.ready, false);
  assert.equal(launch.gates.find(x => x.key === 'configuration').status, 'FAIL');
  assert.equal(launch.gates.find(x => x.key === 'existing-readiness').status, 'DEGRADED');
}));

test('a blocking customer decision prevents superset readiness', () => withController(controller => {
  const r = readiness({ blockingDecisions: [{ key: 'overtime-rule' }] });
  r.operationalReady = false;
  const launch = syncLaunchAutopilot({ controller, readiness: r, integrations: integrations() });
  assert.equal(launch.ready, false);
  assert.equal(launch.gates.find(x => x.key === 'existing-readiness').status, 'DEGRADED');
}));

test('Implementation Digital Twin revision is deterministic for unchanged authoritative input', () => {
  const a = buildImplementationTwin(readiness(), integrations());
  const b = buildImplementationTwin(readiness(), integrations());
  assert.equal(a.revision, b.revision);
  assert.equal(a.nodes.filter(x => x.type === 'site').length, 2);
  assert.equal(a.nodes.filter(x => x.type === 'integration').length, 1);
});


test('unchanged implementation polling is idempotent and does not append duplicate proof events', () => withController(controller => {
  const r = readiness();
  syncLaunchAutopilot({ controller, readiness: r, integrations: integrations() });
  const first = controller.events('alpha','run-1').length;
  const polled = {
    ...r,
    requirements: r.requirements.map(item =>
      ['customer-scope','adaptive-learning-engine'].includes(item.source)
        ? { ...item, observedAt: '2026-09-22T11:59:59Z' }
        : item
    )
  };
  syncLaunchAutopilot({ controller, readiness: polled, integrations: integrations() });
  assert.equal(controller.events('alpha','run-1').length, first);
});


test('Digital Twin integration change cannot be cleared by stale proof and restores only after fresh revision-bound evidence', () => withController(controller => {
  const base = readiness();
  const first = syncLaunchAutopilot({ controller, readiness: base, integrations: integrations() });
  assert.equal(first.ready, true);

  const degradedIntegrations = integrations();
  degradedIntegrations.connections[0] = {
    ...degradedIntegrations.connections[0],
    state: 'DEGRADED',
    failureClass: 'SCHEMA_DRIFT',
    lastSyncAt: '2026-09-22T09:45:00Z'
  };
  const degraded = syncLaunchAutopilot({ controller, readiness: base, integrations: degradedIntegrations });
  assert.equal(degraded.ready, false);
  for (const key of ['source-systems','mapping','historical-replay','live-data-import']) {
    assert.equal(degraded.gates.find(x => x.key === key).status, 'DEGRADED');
  }

  const fresh = readiness();
  fresh.requirements = fresh.requirements.map(item =>
    ['source-systems','payroll-mapping','historical-replay','test-data-cleanup','live-data-import'].includes(item.key)
      ? { ...item, observedAt: '2026-09-22T12:00:00Z' }
      : item
  );
  const repairedIntegrations = integrations();
  repairedIntegrations.connections[0] = {
    ...repairedIntegrations.connections[0],
    state: 'ACTIVE',
    lastSyncAt: '2026-09-22T12:00:00Z',
    lastHealthAt: '2026-09-22T12:00:00Z'
  };
  const restored = syncLaunchAutopilot({ controller, readiness: fresh, integrations: repairedIntegrations });
  assert.equal(restored.ready, true);
  assert.equal(restored.gates.find(x => x.key === 'source-systems').status, 'PASS');
  assert.ok(controller.events('alpha','run-1').some(e => e.event === 'TWIN_REVISION_OBSERVED'));
  assert.ok(controller.events('alpha','run-1').some(e => e.event === 'DELTA_REVALIDATION_OPENED'));
});
