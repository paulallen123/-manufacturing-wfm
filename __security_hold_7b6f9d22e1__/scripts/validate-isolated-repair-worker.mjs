import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createFactory } = require('../resilience/autonomous-repair-factory.cjs');
const { createIsolatedRepairWorker } = require('../resilience/isolated-repair-worker.cjs');
const d = (v) => createHash('sha256').update(String(v)).digest('hex');
const expect = (fn, code) => { try { fn(); } catch (e) { assert.equal(e.code, code); return; } assert.fail('Expected ' + code); };

function caps(overrides = {}) {
  return {
    isolationEnforced: true,
    networkMode: 'none',
    environmentMode: 'replace',
    secretsMounted: false,
    reusableCredentialsVisible: false,
    productionMounts: false,
    customerDataMounted: false,
    writableOutsideWorktree: false,
    processEscapeDenied: true,
    incrementalCostZero: true,
    filesystemMode: 'isolated-worktree',
    ...overrides,
  };
}

function factoryFor(id = 'inc-worker', tenant = 'tenant-a') {
  const f = createFactory({ maxAttempts: 3 });
  f.openIncident({ incidentId: id, tenant, evidenceDigest: d(id + '-evidence') });
  f.registerReproducer({ incidentId: id, tenant, failingTestDigest: d(id + '-failing'), observedFailureDigest: d(id + '-observed') });
  return f;
}

expect(() => createIsolatedRepairWorker({ factory: factoryFor('inc-no-exec') }), 'WFM_REPAIR_ISOLATION_UNAVAILABLE');
expect(() => createIsolatedRepairWorker({ factory: factoryFor('inc-net'), executor: { capabilities: () => caps({ networkMode: 'allowlist' }), run() {} } }), 'WFM_REPAIR_ISOLATION_UNSAFE');
expect(() => createIsolatedRepairWorker({ factory: factoryFor('inc-secret'), executor: { capabilities: () => caps({ secretsMounted: true }), run() {} } }), 'WFM_REPAIR_ISOLATION_UNSAFE');
expect(() => createIsolatedRepairWorker({ factory: factoryFor('inc-cost'), executor: { capabilities: () => caps({ incrementalCostZero: false }), run() {} } }), 'WFM_REPAIR_ISOLATION_UNSAFE');

let executed = 0;
const crossFactory = factoryFor('inc-cross', 'tenant-a');
const crossWorker = createIsolatedRepairWorker({ factory: crossFactory, executor: { capabilities: () => caps(), run() { executed++; return { status: 'candidate', patchDigest: d('x'), changedPaths: ['lib/fix.cjs'] }; } } });
expect(() => crossWorker.run({ incidentId: 'inc-cross', tenant: 'tenant-b', workerId: 'repair-worker', sourceSnapshotDigest: d('src'), repairIntentDigest: d('intent'), allowedChangedPaths: ['lib/fix.cjs'] }), 'WFM_REPAIR_SCOPE');
assert.equal(executed, 0);

process.env.WFM_TEST_REUSABLE_SECRET = 'must-not-cross-boundary';
let capturedJob;
const goodFactory = factoryFor();
const goodExecutor = {
  capabilities: () => caps(),
  run(job) {
    capturedJob = job;
    return { status: 'candidate', patchDigest: d('patch'), changedPaths: ['lib/fix.cjs', 'tests/fix.test.cjs'], runtimeDependenciesAdded: [] };
  },
};
const worker = createIsolatedRepairWorker({ factory: goodFactory, executor: goodExecutor, maxWorkerAttempts: 2 });
const proposed = worker.run({ incidentId: 'inc-worker', tenant: 'tenant-a', workerId: 'isolated-repair-worker', sourceSnapshotDigest: d('source'), repairIntentDigest: d('intent'), allowedChangedPaths: ['tests/fix.test.cjs', 'lib/fix.cjs'] });
assert.equal(proposed.status, 'candidate-proposed');
assert.equal(proposed.productionAuthority, false);
assert.equal(capturedJob.networkMode, 'none');
assert.deepEqual(capturedJob.secrets, []);
assert.equal(capturedJob.env.WFM_TEST_REUSABLE_SECRET, undefined);
assert.equal(JSON.stringify(capturedJob).includes('must-not-cross-boundary'), false);
assert.equal(JSON.stringify(capturedJob).includes('tenant-a'), false);
assert.deepEqual(Object.keys(capturedJob.env).sort(), ['NODE_ENV', 'WFM_REPAIR_WORKER'].sort());
assert.equal(goodFactory.snapshot('inc-worker').state, 'candidate-proposed');

const escapeFactory = factoryFor('inc-escape');
const escapeWorker = createIsolatedRepairWorker({ factory: escapeFactory, executor: { capabilities: () => caps(), run() { return { status: 'candidate', patchDigest: d('escape'), changedPaths: ['lib/not-allowed.cjs'] }; } } });
const escaped = escapeWorker.run({ incidentId: 'inc-escape', tenant: 'tenant-a', workerId: 'repair-worker', sourceSnapshotDigest: d('src'), repairIntentDigest: d('intent'), allowedChangedPaths: ['lib/fix.cjs'] });
assert.equal(escaped.status, 'contained');
assert.equal(escapeFactory.snapshot('inc-escape').state, 'contained');

const depFactory = factoryFor('inc-dep');
const depWorker = createIsolatedRepairWorker({ factory: depFactory, executor: { capabilities: () => caps(), run() { return { status: 'candidate', patchDigest: d('dep'), changedPaths: ['lib/fix.cjs'], runtimeDependenciesAdded: ['left-pad'] }; } } });
const dep = depWorker.run({ incidentId: 'inc-dep', tenant: 'tenant-a', workerId: 'repair-worker', sourceSnapshotDigest: d('src'), repairIntentDigest: d('intent'), allowedChangedPaths: ['lib/fix.cjs'] });
assert.equal(dep.status, 'contained');
assert.equal(dep.reason, 'worker-runtime-dependency-policy-violation');

let timeoutAttempts = 0;
const timeoutFactory = factoryFor('inc-timeout');
const timeoutWorker = createIsolatedRepairWorker({ factory: timeoutFactory, maxWorkerAttempts: 2, executor: { capabilities: () => caps(), run() { timeoutAttempts++; return { status: 'timeout' }; } } });
const timed = timeoutWorker.run({ incidentId: 'inc-timeout', tenant: 'tenant-a', workerId: 'repair-worker', sourceSnapshotDigest: d('src'), repairIntentDigest: d('intent'), allowedChangedPaths: ['lib/fix.cjs'] });
assert.equal(timeoutAttempts, 2);
assert.equal(timed.status, 'contained');
assert.equal(timed.reason, 'worker-timeout-budget-exhausted');
assert.equal(timeoutFactory.snapshot('inc-timeout').state, 'contained');

const protectedFactory = factoryFor('inc-protected-input');
const protectedWorker = createIsolatedRepairWorker({ factory: protectedFactory, executor: { capabilities: () => caps(), run() { assert.fail('executor must not run for protected writable scope'); } } });
expect(() => protectedWorker.run({ incidentId: 'inc-protected-input', tenant: 'tenant-a', workerId: 'repair-worker', sourceSnapshotDigest: d('src'), repairIntentDigest: d('intent'), allowedChangedPaths: ['resilience/security-baseline.json'] }), 'WFM_REPAIR_PROTECTED_PATH');

console.log(JSON.stringify({
  schemaVersion: 1,
  proof: 'tier2-isolated-repair-worker-boundary',
  status: 'PASS',
  networkDefaultDenyRequired: true,
  reusableSecretsDenied: true,
  environmentPassthroughDenied: true,
  sameTenantRequired: true,
  boundedAttempts: true,
  pathEscapeContained: true,
  protectedAuthorityPathsDenied: true,
  newRuntimeDependencyContained: true,
  incrementalCostZeroRequired: true,
  productionAuthority: false,
  customerMutation: false,
}, null, 2));
