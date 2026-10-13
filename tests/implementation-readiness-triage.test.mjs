import test from 'node:test';
import assert from 'node:assert/strict';
import { triageImplementationReadiness } from '../scripts/implementation-readiness-triage.mjs';

const expected = { sourceSha: 'a'.repeat(40), configurationDigest: 'b'.repeat(64),
  tenant: 'fixture', runId: 'run-1', deploymentId: 'deployment-1' };
const bound = { expected: { candidateSha: expected.sourceSha, deploymentId: expected.deploymentId,
  tenant: expected.tenant, runId: expected.runId } };
function input() {
  return { expected, capture: { status: 200, sourceSha: expected.sourceSha,
    sourceBinding: 'build-file-matched', fixtureOnly: 'true', body: {
      tenant: expected.tenant, runId: expected.runId, operationalReady: false,
      tenantEnvironment: { runId: expected.runId, isolation: { tenant: expected.tenant },
        configurationDigest: expected.configurationDigest },
      runtimeIdentity: { candidateSha: expected.sourceSha, fixtureOnly: true },
      totalRequirements: 3, completedRequirements: 1,
      requirements: [
        { key: 'configuration-scope', status: 'PASS', satisfied: true, confidence: 1,
          minConfidence: 1, evidenceBinding: structuredClone(bound) },
        { key: 'organisation-model', status: 'MISSING', satisfied: false, confidence: 0,
          minConfidence: 0.98 },
        { key: 'security-controls', status: 'REVALIDATION_REQUIRED', satisfied: false,
          confidence: 1, minConfidence: 1, evidenceValidation: { reason: 'policy changed' } }
      ], blockingDecisions: [], launchBoundary: { ready: false, blockers: ['WHOLE_GOLDEN_JOURNEY_UNPROVEN'] }
    } } };
}
test('reports a bound blocker and only a declared low-risk fixture data candidate', () => {
  const value = input();
  value.fixtureManifest = { ...expected, requirementKeys: ['organisation-model'] };
  const result = triageImplementationReadiness(value);
  assert.equal(result.status, 'BLOCKED');
  assert.deepEqual(result.unresolved.map(r => r.classification),
    ['DECLARED_FIXTURE_DATA_CANDIDATE', 'REAL_OR_UNRESOLVED_BLOCKER']);
  assert.equal(result.unresolved[1].reason, 'policy changed');
  assert.equal(result.fixtureClassificationIsUnverified, true);
  assert.equal(result.customerReady, false);
  assert.equal(JSON.stringify(result).includes('policy changed'), true);
});
test('unmanifested missing data stays a blocker', () => {
  const result = triageImplementationReadiness(input());
  assert.equal(result.unresolved[0].classification, 'REAL_OR_UNRESOLVED_BLOCKER');
  assert.equal(result.fixtureClassificationIsUnverified, false);
});
test('a fully satisfied capture remains a scoped readout, never customer proof', () => {
  const value = input();
  value.capture.body.requirements = [value.capture.body.requirements[0]];
  value.capture.body.totalRequirements = 1;
  value.capture.body.launchBoundary = { ready: true, blockers: [] };
  value.capture.body.operationalReady = true;
  const result = triageImplementationReadiness(value);
  assert.equal(result.status, 'REQUIREMENTS_SATISFIED_IN_CAPTURE');
  assert.equal(result.hostedProof, false);
  assert.equal(result.customerReady, false);
});
test('manifest cannot relabel a security or policy requirement as fixture data', () => {
  for (const key of ['security-controls', 'approvals', 'tenant-environment']) {
    const value = input();
    value.capture.body.requirements[2].key = key;
    value.capture.body.requirements[2].status = 'MISSING';
    value.fixtureManifest = { ...expected, requirementKeys: [key] };
    assert.equal(triageImplementationReadiness(value).unresolved[1].classification,
      'REAL_OR_UNRESOLVED_BLOCKER');
  }
});
test('rejects source, deployment, tenant and fixture manifest drift', () => {
  for (const mutate of [
    v => { v.capture.sourceSha = 'c'.repeat(40); },
    v => { v.capture.body.requirements[0].evidenceBinding.expected.deploymentId = 'old'; },
    v => { v.capture.body.tenantEnvironment.isolation.tenant = 'other'; },
    v => { v.fixtureManifest = { ...expected, tenant: 'other', requirementKeys: [] }; }
  ]) {
    const value = input(); mutate(value);
    assert.throws(() => triageImplementationReadiness(value));
  }
});
test('rejects contradictory readiness and incomplete requirement accounting', () => {
  for (const mutate of [
    v => { v.capture.body.operationalReady = true; },
    v => { v.capture.body.completedRequirements = 2; },
    v => { v.capture.body.requirements[2].key = 'organisation-model'; },
    v => { v.capture.body.requirements[2].status = 'UNKNOWN'; }
  ]) {
    const value = input(); mutate(value);
    assert.throws(() => triageImplementationReadiness(value));
  }
});
