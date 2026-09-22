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
    source: 'authoritative:' + key,
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
      state: 'ACTIVE',
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
