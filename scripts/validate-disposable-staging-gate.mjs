import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFactory } = require('../resilience/autonomous-repair-factory.cjs');
const { createDisposableStagingGate } = require('../resilience/disposable-staging-gate.cjs');
const d = (v) => createHash('sha256').update(String(v)).digest('hex');
const expect = (fn, code) => { try { fn(); } catch (e) { assert.equal(e.code, code); return; } assert.fail('Expected ' + code); };

function executorCaps(overrides = {}) {
  return {
    isolationEnforced: true,
    disposable: true,
    networkMode: 'none',
    environmentMode: 'replace',
    secretsMounted: false,
    reusableCredentialsVisible: false,
    productionMounts: false,
    customerDataMounted: false,
    productionWriteAuthority: false,
    customerWriteAuthority: false,
    processEscapeDenied: true,
    incrementalCostZero: true,
    filesystemMode: 'ephemeral-staging',
    ...overrides,
  };
}

function attestorCaps(overrides = {}) {
  return {
    readOnly: true,
    networkMode: 'none',
    reusableCredentialsVisible: false,
    productionAuthority: false,
    stagingAuthority: false,
    ...overrides,
  };
}

function readyFactory(id = 'inc-stage', tenant = 'tenant-a') {
  const factory = createFactory({ maxAttempts: 3 });
  const artifactDigest = d(id + '-artifact');
  const provenanceDigest = d(id + '-provenance');
  const rollbackDigest = d(id + '-rollback');
  factory.openIncident({ incidentId: id, tenant, evidenceDigest: d(id + '-evidence') });
  factory.registerReproducer({ incidentId: id, tenant, failingTestDigest: d(id + '-failing'), observedFailureDigest: d(id + '-observed') });
  factory.proposeCandidate({ incidentId: id, tenant, proposerId: 'repair-worker', patchDigest: d(id + '-patch'), changedPaths: ['lib/fix.cjs'] });
  factory.verifyCandidate({
    incidentId: id,
    tenant,
    verifierId: 'independent-verifier',
    failingTestNowPasses: true,
    regressionPassed: true,
    securityPassed: true,
    tenantIsolationPassed: true,
    browserPassed: true,
    artifactDigest,
    provenanceDigest,
    rollbackDigest,
  });
  factory.issueStagingPermit({ incidentId: id, tenant, authorityId: 'release-authority', artifactDigest });
  return { factory, artifactDigest, provenanceDigest, rollbackDigest };
}

const baseExecutor = {
  capabilities: () => executorCaps(),
  run() { return null; },
  dispose() { return { status: 'disposed', disposalDigest: d('disposed'), productionAuthority: false, customerMutation: false }; },
};
const baseAttestor = { capabilities: () => attestorCaps(), verify: () => true };

expect(() => createDisposableStagingGate({ factory: readyFactory('inc-no-exec').factory, executor: { capabilities: () => executorCaps(), run() {} }, attestor: baseAttestor }), 'WFM_STAGING_EXECUTOR_UNAVAILABLE');
expect(() => createDisposableStagingGate({ factory: readyFactory('inc-net').factory, executor: { ...baseExecutor, capabilities: () => executorCaps({ networkMode: 'allowlist' }) }, attestor: baseAttestor }), 'WFM_STAGING_EXECUTOR_UNSAFE');
expect(() => createDisposableStagingGate({ factory: readyFactory('inc-cost').factory, executor: { ...baseExecutor, capabilities: () => executorCaps({ incrementalCostZero: false }) }, attestor: baseAttestor }), 'WFM_STAGING_EXECUTOR_UNSAFE');
expect(() => createDisposableStagingGate({ factory: readyFactory('inc-attestor').factory, executor: baseExecutor, attestor: { capabilities: () => attestorCaps({ productionAuthority: true }), verify: () => true } }), 'WFM_STAGING_ATTESTOR_UNSAFE');

process.env.WFM_TEST_REUSABLE_SECRET = 'must-not-cross-staging-boundary';
let capturedJob;
let disposed = 0;
const happy = readyFactory();
const signatureDigest = d('signature');
const executor = {
  capabilities: () => executorCaps(),
  run(job) {
    capturedJob = job;
    return {
      status: 'staged',
      acceptedArtifactDigest: job.artifactDigest,
      acceptedProvenanceDigest: job.provenanceDigest,
      acceptedSignatureDigest: job.signatureDigest,
      acceptedPermitDigest: job.permitDigest,
      exactRuntime: true,
      actualRuntime: '22.23.2',
      stagingInstanceDigest: d('staging-instance'),
      runtimeEvidenceDigest: d('runtime-evidence'),
      productionAuthority: false,
      productionMutation: false,
      customerMutation: false,
    };
  },
  dispose() { disposed++; return { status: 'disposed', disposalDigest: d('disposed'), productionAuthority: false, customerMutation: false }; },
};
const attestor = {
  capabilities: () => attestorCaps(),
  verify(payload) {
    return payload.artifactDigest === happy.artifactDigest && payload.provenanceDigest === happy.provenanceDigest && payload.signatureDigest === signatureDigest && payload.signerId === 'release-authority';
  },
};
const gate = createDisposableStagingGate({ factory: happy.factory, executor, attestor });
const staged = gate.run({
  incidentId: 'inc-stage',
  tenant: 'tenant-a',
  authorityId: 'release-authority',
  signerId: 'release-authority',
  artifactDigest: happy.artifactDigest,
  provenanceDigest: happy.provenanceDigest,
  signatureDigest,
  expectedRuntime: '22.23.2',
});
assert.equal(staged.status, 'staged');
assert.equal(staged.canaryEligible, true);
assert.equal(staged.disposable, true);
assert.equal(staged.productionAuthority, false);
assert.equal(disposed, 0);
assert.equal(capturedJob.networkMode, 'none');
assert.deepEqual(capturedJob.secrets, []);
assert.equal(capturedJob.customerDataMounted, false);
assert.equal(capturedJob.env.WFM_TEST_REUSABLE_SECRET, undefined);
assert.equal(JSON.stringify(capturedJob).includes('must-not-cross-staging-boundary'), false);
assert.equal(JSON.stringify(capturedJob).includes('tenant-a'), false);
assert.deepEqual(Object.keys(capturedJob.env).sort(), ['NODE_ENV', 'WFM_DISPOSABLE_STAGING'].sort());

let driftRuns = 0;
const drift = readyFactory('inc-provenance-drift');
const driftGate = createDisposableStagingGate({
  factory: drift.factory,
  executor: { ...baseExecutor, run() { driftRuns++; return null; } },
  attestor: baseAttestor,
});
expect(() => driftGate.run({
  incidentId: 'inc-provenance-drift', tenant: 'tenant-a', authorityId: 'release-authority', signerId: 'release-authority',
  artifactDigest: drift.artifactDigest, provenanceDigest: d('wrong-provenance'), signatureDigest: d('sig'), expectedRuntime: '22.23.2',
}), 'WFM_STAGING_PROVENANCE_DRIFT');
assert.equal(driftRuns, 0);

let attestationRuns = 0;
const badSig = readyFactory('inc-bad-signature');
const badSigGate = createDisposableStagingGate({
  factory: badSig.factory,
  executor: { ...baseExecutor, run() { attestationRuns++; return null; } },
  attestor: { capabilities: () => attestorCaps(), verify: () => false },
});
const badSigResult = badSigGate.run({
  incidentId: 'inc-bad-signature', tenant: 'tenant-a', authorityId: 'release-authority', signerId: 'release-authority',
  artifactDigest: badSig.artifactDigest, provenanceDigest: badSig.provenanceDigest, signatureDigest: d('bad-signature'), expectedRuntime: '22.23.2',
});
assert.equal(badSigResult.status, 'staging-rejected');
assert.equal(badSigResult.reason, 'artifact-attestation-rejected');
assert.equal(attestationRuns, 0);

let hostileDisposals = 0;
const hostile = readyFactory('inc-hostile-stage');
const hostileGate = createDisposableStagingGate({
  factory: hostile.factory,
  executor: {
    capabilities: () => executorCaps(),
    run(job) {
      return {
        status: 'staged', acceptedArtifactDigest: job.artifactDigest, acceptedProvenanceDigest: job.provenanceDigest,
        acceptedSignatureDigest: job.signatureDigest, acceptedPermitDigest: job.permitDigest,
        exactRuntime: true, actualRuntime: '22.23.2', stagingInstanceDigest: d('instance'), runtimeEvidenceDigest: d('runtime'),
        productionAuthority: true,
      };
    },
    dispose() { hostileDisposals++; return { status: 'disposed', disposalDigest: d('hostile-disposed'), productionAuthority: false, customerMutation: false }; },
  },
  attestor: baseAttestor,
});
const hostileResult = hostileGate.run({
  incidentId: 'inc-hostile-stage', tenant: 'tenant-a', authorityId: 'release-authority', signerId: 'release-authority',
  artifactDigest: hostile.artifactDigest, provenanceDigest: hostile.provenanceDigest, signatureDigest: d('sig-hostile'), expectedRuntime: '22.23.2',
});
assert.equal(hostileResult.status, 'staging-rejected');
assert.equal(hostileResult.reason, 'staging-authority-violation');
assert.equal(hostileResult.disposalVerified, true);
assert.equal(hostileDisposals, 1);

let runtimeDisposals = 0;
const runtimeDrift = readyFactory('inc-runtime-drift');
const runtimeGate = createDisposableStagingGate({
  factory: runtimeDrift.factory,
  executor: {
    capabilities: () => executorCaps(),
    run(job) {
      return {
        status: 'staged', acceptedArtifactDigest: job.artifactDigest, acceptedProvenanceDigest: job.provenanceDigest,
        acceptedSignatureDigest: job.signatureDigest, acceptedPermitDigest: job.permitDigest,
        exactRuntime: false, actualRuntime: '22.16.0', stagingInstanceDigest: d('instance'), runtimeEvidenceDigest: d('runtime'),
      };
    },
    dispose() { runtimeDisposals++; return { status: 'disposed', disposalDigest: d('runtime-disposed'), productionAuthority: false, customerMutation: false }; },
  },
  attestor: baseAttestor,
});
const runtimeResult = runtimeGate.run({
  incidentId: 'inc-runtime-drift', tenant: 'tenant-a', authorityId: 'release-authority', signerId: 'release-authority',
  artifactDigest: runtimeDrift.artifactDigest, provenanceDigest: runtimeDrift.provenanceDigest, signatureDigest: d('sig-runtime'), expectedRuntime: '22.23.2',
});
assert.equal(runtimeResult.status, 'staging-rejected');
assert.equal(runtimeResult.reason, 'staging-runtime-drift');
assert.equal(runtimeResult.disposalVerified, true);
assert.equal(runtimeDisposals, 1);

const scope = readyFactory('inc-scope', 'tenant-a');
const scopeGate = createDisposableStagingGate({ factory: scope.factory, executor: baseExecutor, attestor: baseAttestor });
expect(() => scopeGate.run({
  incidentId: 'inc-scope', tenant: 'tenant-b', authorityId: 'release-authority', signerId: 'release-authority',
  artifactDigest: scope.artifactDigest, provenanceDigest: scope.provenanceDigest, signatureDigest: d('sig-scope'), expectedRuntime: '22.23.2',
}), 'WFM_REPAIR_SCOPE');

console.log(JSON.stringify({
  schemaVersion: 1,
  proof: 'tier2-exact-artifact-disposable-staging-gate',
  status: 'PASS',
  exactArtifactBound: true,
  exactProvenanceBound: true,
  signatureAttestationRequired: true,
  independentReleaseAuthorityBound: true,
  exactRuntimeRequiredForCanaryEligibility: true,
  disposableIsolationRequired: true,
  networkDefaultDenyRequired: true,
  reusableSecretsDenied: true,
  customerDataDenied: true,
  tenantPlaintextDeniedFromExecutorJob: true,
  hostileAuthorityEscalationDisposed: true,
  runtimeDriftDisposed: true,
  incrementalCostZeroRequired: true,
  productionAuthority: false,
  productionMutation: false,
  customerMutation: false,
}, null, 2));
