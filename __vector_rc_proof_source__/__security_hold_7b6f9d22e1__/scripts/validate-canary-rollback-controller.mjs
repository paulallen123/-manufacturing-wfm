import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createCanaryRollbackController, MAX_CANARY_INSTANCES, MAX_TRAFFIC_PERCENT } = require(path.join(process.cwd(), 'resilience/canary-rollback-controller.cjs'));
const sha = v => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const D = label => sha(label);

function recorder() {
  const records = [];
  return {
    records,
    capabilities: () => ({ appendOnly: true, durable: true, tamperEvident: true, customerDataStored: false, productionAuthority: false, customerWriteAuthority: false, incrementalCostZero: true }),
    async record(payload) { records.push(structuredClone(payload)); return { receiptDigest: sha(payload) }; },
  };
}

function attestor(overrides = {}) {
  return {
    capabilities: () => ({ readOnly: true, networkMode: 'none', reusableCredentialsVisible: false, modelCanGrantAuthority: false, productionAuthority: false, customerWriteAuthority: false }),
    async verify(input) { return { verified: true, schemaCompatible: true, signatureVerified: true, provenanceVerified: true, attestationDigest: sha({ input, tag: 'known-good' }), ...overrides }; },
  };
}

function canary(runImpl) {
  return {
    capabilities: () => ({ sameTenantEnforced: true, exactArtifactRequired: true, rollbackPreverifiedRequired: true, networkMode: 'none', reusableCredentialsVisible: false, modelCanGrantAuthority: false, customerDataVisible: false, incrementalCostZero: true, simulationOnly: true, productionWriteAuthority: false, customerWriteAuthority: false }),
    run: runImpl,
  };
}

function rollback(runImpl) {
  return {
    capabilities: () => ({ sameTenantEnforced: true, knownGoodOnly: true, schemaCompatibilityRequired: true, networkMode: 'none', reusableCredentialsVisible: false, modelCanGrantAuthority: false, customerDataVisible: false, incrementalCostZero: true, simulationOnly: true, productionWriteAuthority: false, customerWriteAuthority: false }),
    run: runImpl,
  };
}

const base = Object.freeze({
  incidentId: 'inc-1', tenant: 'tenant-a', targetTenant: 'tenant-a', canaryControllerId: 'canary-controller', rollbackControllerId: 'rollback-controller',
  artifactDigest: D('artifact'), rollbackDigest: D('rollback'), stagingReceiptDigest: D('staging'), maxInstances: 1, trafficPercent: 5,
});

function healthyResult(job, extra = {}) {
  return {
    status: 'healthy', acceptedArtifactDigest: job.artifactDigest, acceptedRollbackDigest: job.rollbackDigest, acceptedTenantDigest: job.tenantDigest,
    touchedInstances: 1, observedTrafficPercent: 5, canaryEvidenceDigest: D('canary-evidence'), businessInvariantPassed: true, securityInvariantPassed: true,
    tenantInvariantPassed: true, duplicateOutcomeCount: 0, productionMutation: false, customerMutation: false, productionAuthority: false, ...extra,
  };
}
function rollbackResult(job, extra = {}) {
  return {
    status: 'rolled-back', acceptedRollbackDigest: job.rollbackDigest, acceptedArtifactDigest: job.artifactDigest, acceptedTenantDigest: job.tenantDigest,
    rollbackEvidenceDigest: D('rollback-evidence'), schemaCompatible: true, knownGoodVerified: true, productionMutation: false, customerMutation: false,
    productionAuthority: false, ...extra,
  };
}

let rollbackCalls = 0;
let rec = recorder();
let ctl = createCanaryRollbackController({
  canaryExecutor: canary(async job => healthyResult(job)),
  rollbackExecutor: rollback(async job => { rollbackCalls++; return rollbackResult(job); }),
  knownGoodAttestor: attestor(), outcomeRecorder: rec,
});
assert.deepEqual(ctl.limits(), { maxInstances: MAX_CANARY_INSTANCES, maxTrafficPercent: MAX_TRAFFIC_PERCENT });
let out = await ctl.run(base);
assert.equal(out.status, 'canary_proven');
assert.equal(rollbackCalls, 0);
assert.equal(rec.records.length, 1);
assert.equal(out.productionMutation, false);
assert.match(out.outcomeReceiptDigest, /^[a-f0-9]{64}$/);

rollbackCalls = 0; rec = recorder();
ctl = createCanaryRollbackController({
  canaryExecutor: canary(async job => healthyResult(job, { status: 'unhealthy' })),
  rollbackExecutor: rollback(async job => { rollbackCalls++; return rollbackResult(job); }),
  knownGoodAttestor: attestor(), outcomeRecorder: rec,
});
out = await ctl.run(base);
assert.equal(out.status, 'rolled_back_to_known_good');
assert.equal(out.rollbackVerified, true);
assert.equal(rollbackCalls, 1);

rollbackCalls = 0; rec = recorder();
ctl = createCanaryRollbackController({
  canaryExecutor: canary(async job => healthyResult(job, { status: 'indeterminate' })),
  rollbackExecutor: rollback(async job => { rollbackCalls++; return rollbackResult(job); }),
  knownGoodAttestor: attestor(), outcomeRecorder: rec,
});
out = await ctl.run(base);
assert.equal(out.status, 'rolled_back_to_known_good');
assert.equal(rollbackCalls, 1);

rec = recorder();
ctl = createCanaryRollbackController({
  canaryExecutor: canary(async job => healthyResult(job)), rollbackExecutor: rollback(async job => rollbackResult(job)), knownGoodAttestor: attestor(), outcomeRecorder: rec,
});
await assert.rejects(() => ctl.run({ ...base, targetTenant: 'tenant-b' }), err => err.code === 'WFM_CANARY_CROSS_TENANT');
await assert.rejects(() => ctl.run({ ...base, maxInstances: 2 }), err => err.code === 'WFM_CANARY_BLAST_RADIUS');
await assert.rejects(() => ctl.run({ ...base, trafficPercent: 6 }), err => err.code === 'WFM_CANARY_BLAST_RADIUS');

let canaryCalls = 0; rec = recorder();
ctl = createCanaryRollbackController({
  canaryExecutor: canary(async job => { canaryCalls++; return healthyResult(job); }), rollbackExecutor: rollback(async job => rollbackResult(job)),
  knownGoodAttestor: attestor({ verified: false }), outcomeRecorder: rec,
});
out = await ctl.run(base);
assert.equal(out.status, 'contained');
assert.equal(out.reason, 'known-good-attestation-rejected');
assert.equal(canaryCalls, 0);

rollbackCalls = 0; rec = recorder();
ctl = createCanaryRollbackController({
  canaryExecutor: canary(async job => healthyResult(job, { touchedInstances: 2 })),
  rollbackExecutor: rollback(async job => { rollbackCalls++; return rollbackResult(job); }), knownGoodAttestor: attestor(), outcomeRecorder: rec,
});
out = await ctl.run(base);
assert.equal(out.status, 'rolled_back_to_known_good');
assert.equal(out.reason, 'canary-blast-radius-breach');
assert.equal(rollbackCalls, 1);

rollbackCalls = 0; rec = recorder();
ctl = createCanaryRollbackController({
  canaryExecutor: canary(async job => healthyResult(job, { businessInvariantPassed: false })),
  rollbackExecutor: rollback(async job => { rollbackCalls++; return rollbackResult(job); }), knownGoodAttestor: attestor(), outcomeRecorder: rec,
});
out = await ctl.run(base);
assert.equal(out.status, 'rolled_back_to_known_good');
assert.equal(out.reason, 'canary-invariant-failed');
assert.equal(rollbackCalls, 1);

rec = recorder();
ctl = createCanaryRollbackController({
  canaryExecutor: canary(async job => healthyResult(job, { status: 'unhealthy' })),
  rollbackExecutor: rollback(async job => rollbackResult(job, { knownGoodVerified: false })), knownGoodAttestor: attestor(), outcomeRecorder: rec,
});
out = await ctl.run(base);
assert.equal(out.status, 'contained');
assert.equal(out.reason, 'rollback-verification-failed');
assert.equal(out.rollbackVerified, false);

assert.throws(() => createCanaryRollbackController({
  canaryExecutor: { ...canary(async job => healthyResult(job)), capabilities: () => ({ ...canary(async()=>{}).capabilities(), modelCanGrantAuthority: true }) },
  rollbackExecutor: rollback(async job => rollbackResult(job)), knownGoodAttestor: attestor(), outcomeRecorder: recorder(),
}), err => err.code === 'WFM_CANARY_EXECUTOR_UNSAFE');

console.log(JSON.stringify({
  schemaVersion: 1,
  proof: 'tier2-canary-blast-radius-and-known-good-rollback',
  status: 'PASS',
  maxCanaryInstances: MAX_CANARY_INSTANCES,
  maxTrafficPercent: MAX_TRAFFIC_PERCENT,
  healthyCanaryRequiresAllInvariants: true,
  unhealthyOrIndeterminateAutomaticallyRollsBack: true,
  crossTenantDenied: true,
  overBlastRadiusDeniedOrRolledBack: true,
  knownGoodAttestationRequiredBeforeCanary: true,
  rollbackMustBeIndependentlyVerified: true,
  modelCannotGrantAuthority: true,
  simulationOnly: true,
  productionMutation: false,
  customerMutation: false,
}, null, 2));
