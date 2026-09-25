import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFactory } = require('../resilience/autonomous-repair-factory.cjs');
const { createIndependentRepairVerifier } = require('../resilience/independent-repair-verifier.cjs');
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
    sourceWriteAllowed: false,
    writableOutsideWorkspace: false,
    processEscapeDenied: true,
    incrementalCostZero: true,
    stagingPermitAuthority: false,
    productionAuthority: false,
    filesystemMode: 'read-only-source-plus-output',
    ...overrides,
  };
}

function readyFactory(id = 'inc-verifier', tenant = 'tenant-a', proposerId = 'repair-worker') {
  const f = createFactory({ maxAttempts: 3 });
  f.openIncident({ incidentId: id, tenant, evidenceDigest: d(id + '-evidence') });
  f.registerReproducer({ incidentId: id, tenant, failingTestDigest: d(id + '-failing'), observedFailureDigest: d(id + '-observed') });
  return {
    factory: f,
    proposed: f.proposeCandidate({ incidentId: id, tenant, proposerId, patchDigest: d(id + '-patch'), changedPaths: ['lib/fix.cjs', 'tests/fix.test.cjs'] }),
  };
}

expect(() => createIndependentRepairVerifier({ factory: readyFactory('inc-no-exec').factory }), 'WFM_REPAIR_VERIFIER_UNAVAILABLE');
expect(() => createIndependentRepairVerifier({ factory: readyFactory('inc-net').factory, executor: { capabilities: () => caps({ networkMode: 'allowlist' }), run() {} } }), 'WFM_REPAIR_VERIFIER_UNSAFE');
expect(() => createIndependentRepairVerifier({ factory: readyFactory('inc-write').factory, executor: { capabilities: () => caps({ sourceWriteAllowed: true }), run() {} } }), 'WFM_REPAIR_VERIFIER_UNSAFE');
expect(() => createIndependentRepairVerifier({ factory: readyFactory('inc-cost').factory, executor: { capabilities: () => caps({ incrementalCostZero: false }), run() {} } }), 'WFM_REPAIR_VERIFIER_UNSAFE');

let selfRuns = 0;
const selfReady = readyFactory('inc-self', 'tenant-a', 'same-agent');
const selfVerifier = createIndependentRepairVerifier({
  factory: selfReady.factory,
  executor: { capabilities: () => caps(), run() { selfRuns++; return null; } },
});
expect(() => selfVerifier.run({
  incidentId: 'inc-self', tenant: 'tenant-a', verifierId: 'same-agent',
  sourceSnapshotDigest: d('source'), expectedCandidateDigest: selfReady.proposed.candidate.candidateDigest, rollbackSourceDigest: d('rollback-source'),
}), 'WFM_REPAIR_SELF_VERIFY');
assert.equal(selfRuns, 0);

process.env.WFM_TEST_REUSABLE_SECRET = 'must-not-cross-verifier-boundary';
let capturedJob;
const goodReady = readyFactory();
const goodExecutor = {
  capabilities: () => caps(),
  run(job) {
    capturedJob = job;
    return {
      status: 'verified',
      acceptedCandidateDigest: job.candidateDigest,
      acceptedPatchDigest: job.patchDigest,
      acceptedSourceSnapshotDigest: job.sourceSnapshotDigest,
      acceptedRollbackSourceDigest: job.rollbackSourceDigest,
      failingTestNowPasses: true,
      regressionPassed: true,
      securityPassed: true,
      tenantIsolationPassed: true,
      browserPassed: true,
      artifactDigest: d('artifact'),
      provenanceDigest: d('provenance'),
      rollbackDigest: d('rollback'),
      productionAuthority: false,
      stagingPermitAuthority: false,
      sourceMutation: false,
      customerMutation: false,
    };
  },
};
const verifier = createIndependentRepairVerifier({ factory: goodReady.factory, executor: goodExecutor });
const verified = verifier.run({
  incidentId: 'inc-verifier', tenant: 'tenant-a', verifierId: 'independent-verifier',
  sourceSnapshotDigest: d('source'), expectedCandidateDigest: goodReady.proposed.candidate.candidateDigest, rollbackSourceDigest: d('rollback-source'),
});
assert.equal(verified.status, 'verified');
assert.equal(verified.productionAuthority, false);
assert.equal(verified.stagingPermitAuthority, false);
assert.equal(capturedJob.networkMode, 'none');
assert.equal(capturedJob.sourceWriteAllowed, false);
assert.deepEqual(capturedJob.secrets, []);
assert.equal(capturedJob.env.WFM_TEST_REUSABLE_SECRET, undefined);
assert.equal(JSON.stringify(capturedJob).includes('must-not-cross-verifier-boundary'), false);
assert.equal(JSON.stringify(capturedJob).includes('tenant-a'), false);
assert.deepEqual(Object.keys(capturedJob.env).sort(), ['NODE_ENV', 'WFM_INDEPENDENT_REPAIR_VERIFIER'].sort());
assert.equal(goodReady.factory.snapshot('inc-verifier').state, 'verified');

const driftReady = readyFactory('inc-drift');
const driftVerifier = createIndependentRepairVerifier({
  factory: driftReady.factory,
  executor: {
    capabilities: () => caps(),
    run(job) {
      return {
        status: 'verified', acceptedCandidateDigest: d('wrong-candidate'), acceptedPatchDigest: job.patchDigest,
        acceptedSourceSnapshotDigest: job.sourceSnapshotDigest, acceptedRollbackSourceDigest: job.rollbackSourceDigest,
        failingTestNowPasses: true, regressionPassed: true, securityPassed: true, tenantIsolationPassed: true, browserPassed: true,
        artifactDigest: d('a'), provenanceDigest: d('p'), rollbackDigest: d('r'),
      };
    },
  },
});
const drift = driftVerifier.run({
  incidentId: 'inc-drift', tenant: 'tenant-a', verifierId: 'independent-verifier',
  sourceSnapshotDigest: d('src'), expectedCandidateDigest: driftReady.proposed.candidate.candidateDigest, rollbackSourceDigest: d('rollback-src'),
});
assert.equal(drift.status, 'contained');
assert.equal(drift.reason, 'verifier-candidate-drift');
assert.equal(driftReady.factory.snapshot('inc-drift').state, 'contained');

const rejectedReady = readyFactory('inc-rejected');
const rejectedVerifier = createIndependentRepairVerifier({
  factory: rejectedReady.factory,
  executor: {
    capabilities: () => caps(),
    run(job) {
      return {
        status: 'rejected', acceptedCandidateDigest: job.candidateDigest, acceptedPatchDigest: job.patchDigest,
        acceptedSourceSnapshotDigest: job.sourceSnapshotDigest, failingTestNowPasses: true, regressionPassed: true,
        securityPassed: false, tenantIsolationPassed: true, browserPassed: true,
      };
    },
  },
});
const rejected = rejectedVerifier.run({
  incidentId: 'inc-rejected', tenant: 'tenant-a', verifierId: 'independent-verifier',
  sourceSnapshotDigest: d('src'), expectedCandidateDigest: rejectedReady.proposed.candidate.candidateDigest, rollbackSourceDigest: d('rollback-src'),
});
assert.equal(rejected.status, 'candidate-rejected');
assert.equal(rejectedReady.factory.snapshot('inc-rejected').state, 'candidate-rejected');

const hostileReady = readyFactory('inc-hostile');
const hostileVerifier = createIndependentRepairVerifier({
  factory: hostileReady.factory,
  executor: {
    capabilities: () => caps(),
    run(job) {
      return {
        status: 'verified', acceptedCandidateDigest: job.candidateDigest, acceptedPatchDigest: job.patchDigest,
        acceptedSourceSnapshotDigest: job.sourceSnapshotDigest, acceptedRollbackSourceDigest: job.rollbackSourceDigest,
        failingTestNowPasses: true, regressionPassed: true, securityPassed: true, tenantIsolationPassed: true, browserPassed: true,
        artifactDigest: d('a'), provenanceDigest: d('p'), rollbackDigest: d('r'), productionAuthority: true,
      };
    },
  },
});
const hostile = hostileVerifier.run({
  incidentId: 'inc-hostile', tenant: 'tenant-a', verifierId: 'independent-verifier',
  sourceSnapshotDigest: d('src'), expectedCandidateDigest: hostileReady.proposed.candidate.candidateDigest, rollbackSourceDigest: d('rollback-src'),
});
assert.equal(hostile.status, 'contained');
assert.equal(hostile.reason, 'verifier-authority-violation');
assert.equal(hostileReady.factory.snapshot('inc-hostile').state, 'contained');

console.log(JSON.stringify({
  schemaVersion: 1,
  proof: 'tier2-independent-repair-verifier-boundary',
  status: 'PASS',
  separateVerifierIdentityRequired: true,
  readOnlySourceRequired: true,
  networkDefaultDenyRequired: true,
  reusableSecretsDenied: true,
  ambientEnvironmentDenied: true,
  exactCandidateBindingRequired: true,
  rollbackSourceBindingRequired: true,
  securityFailureRejectsCandidate: true,
  authorityEscalationContained: true,
  incrementalCostZeroRequired: true,
  productionAuthority: false,
  stagingPermitAuthority: false,
  customerMutation: false,
}, null, 2));
