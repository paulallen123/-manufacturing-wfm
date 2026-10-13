import assert from 'node:assert/strict';
import test from 'node:test';
import { assessBadDeploymentRollback } from '../scripts/bad-deployment-rollback-oracle.mjs';

function fixture() {
  const context = { goodSha: 'a'.repeat(40), badSha: 'b'.repeat(40),
    environmentId: 'disposable-env', serviceId: 'proof-service', volumeId: 'volume-1',
    syntheticTenant: 'synthetic-tenant', sequenceDomain: 'server-proof-log',
    environmentClass: 'DISPOSABLE_PROOF' };
  const scope = { environmentId: context.environmentId, serviceId: context.serviceId,
    volumeId: context.volumeId, syntheticTenant: context.syntheticTenant,
    sequenceDomain: context.sequenceDomain };
  const r = (captureId, sequence, fields) => ({ ...scope, captureId, sequence, ...fields });
  return { context,
    before: r('pre', 1, { deploymentId: 'good-1', deploymentCommitSha: context.goodSha,
      observedSourceSha: context.goodSha, platformStatus: 'SUCCESS', healthStatus: 200,
      semanticHealth: 'PASS', stateDigest: 'c'.repeat(64), stateEpoch: 8 }),
    bad: r('bad', 2, { deploymentId: 'bad-2', deploymentCommitSha: context.badSha,
      observedSourceSha: context.badSha, becameServing: true, semanticHealth: 'FAIL',
      businessMutation: false }),
    decision: r('decision', 3, { rejectedDeploymentId: 'bad-2',
      restoreDeploymentId: 'good-1', reason: 'SEMANTIC_HEALTH_REGRESSION',
      approvalRef: 'approved-rollback-1' }),
    providerRollback: r('provider', 4, { fromDeploymentId: 'bad-2',
      toDeploymentId: 'good-1', status: 'SUCCESS', restoredCommitSha: context.goodSha }),
    after: r('post', 5, { deploymentId: 'good-1', deploymentCommitSha: context.goodSha,
      observedSourceSha: context.goodSha, healthStatus: 200, semanticHealth: 'PASS',
      freshSessionProtectedRead: 200 }),
    readback: r('read', 6, { deploymentId: 'good-1', stateDigest: 'c'.repeat(64),
      stateEpoch: 8, freshSession: true, auditRollbackRef: 'approved-rollback-1',
      businessMutation: false }) };
}

test('accepts a fully bound synthetic rollback receipt set', () => {
  assert.deepEqual(assessBadDeploymentRollback(fixture()), { status: 'PASS', failures: [] });
});

for (const [label, mutate, expected] of [
  ['real environment', p => { p.context.environmentClass = 'PRODUCTION'; }, 'INVALID_CONTEXT'],
  ['duplicate capture', p => { p.after.captureId = 'pre'; }, 'REUSED_CAPTURE'],
  ['different volume', p => { p.readback.volumeId = 'volume-2'; }, 'SCOPE_READBACK'],
  ['out of order events', p => { p.providerRollback.sequence = 2; }, 'EVENT_ORDER'],
  ['unserved bad build', p => { p.bad.becameServing = false; }, 'BAD_BUILD_NOT_OBSERVED'],
  ['wrong bad SHA', p => { p.bad.observedSourceSha = 'd'.repeat(40); }, 'BAD_BUILD_NOT_OBSERVED'],
  ['unauthorised rollback', p => { p.decision.approvalRef = ''; }, 'ROLLBACK_NOT_AUTHORISED'],
  ['provider-only success', p => { p.after.healthStatus = 503; }, 'RESTORED_SERVICE_NOT_PROVEN'],
  ['wrong restored SHA', p => { p.providerRollback.restoredCommitSha = p.context.badSha; }, 'PROVIDER_ROLLBACK_NOT_BOUND'],
  ['lost durable state', p => { p.readback.stateDigest = 'e'.repeat(64); }, 'DURABLE_READBACK_NOT_PROVEN']
]) {
  test(`rejects ${label}`, () => {
    const proof = fixture(); mutate(proof);
    assert.ok(assessBadDeploymentRollback(proof).failures.includes(expected));
  });
}

