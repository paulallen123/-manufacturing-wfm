import assert from 'node:assert/strict';

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
// A fixture declaration can only flag a missing structural data sample for
// review. It cannot relabel a policy, provider, security, execution or training gate.
const FIXTURE_DATA_CANDIDATE_KEYS = new Set(['organisation-model']);

// Inspect an authenticated, already captured implementation status. This never
// supplies evidence to the implementation engine or changes its readiness state.
export function triageImplementationReadiness({ capture, expected, fixtureManifest = null }) {
  assert.match(expected?.sourceSha || '', SHA, 'Exact source SHA required');
  assert.match(expected?.configurationDigest || '', DIGEST, 'Exact configuration digest required');
  for (const key of ['tenant', 'runId', 'deploymentId'])
    assert.ok(typeof expected[key] === 'string' && expected[key].length > 0, `Exact ${key} required`);
  assert.equal(capture?.status, 200, 'Implementation status request failed');
  assert.equal(capture.sourceSha, expected.sourceSha, 'Serving source mismatch');
  assert.equal(capture.sourceBinding, 'build-file-matched', 'Serving source binding missing');
  assert.equal(capture.fixtureOnly, 'true', 'Hosted fixture boundary missing');
  const body = capture.body;
  assert.equal(body?.tenant, expected.tenant, 'Implementation tenant mismatch');
  assert.equal(body.runId, expected.runId, 'Implementation run mismatch');
  assert.equal(body.tenantEnvironment?.runId, expected.runId, 'Environment run mismatch');
  assert.equal(body.tenantEnvironment?.isolation?.tenant, expected.tenant, 'Environment tenant mismatch');
  assert.equal(body.tenantEnvironment?.configurationDigest, expected.configurationDigest, 'Configuration mismatch');
  assert.ok(Array.isArray(body.requirements) && body.requirements.length > 0, 'Requirement list missing');
  assert.equal(body.totalRequirements, body.requirements.length, 'Requirement count mismatch');
  assert.ok(Array.isArray(body.blockingDecisions), 'Blocking decision list missing');
  assert.ok(Array.isArray(body.launchBoundary?.blockers), 'Launch blocker list missing');
  assert.equal(body.runtimeIdentity?.candidateSha, expected.sourceSha, 'Runtime identity mismatch');
  assert.equal(body.runtimeIdentity.fixtureOnly, true, 'Runtime is not the declared fixture');

  const bindings = body.requirements.map(r => r.evidenceBinding?.expected)
    .filter(b => b?.candidateSha || b?.deploymentId);
  assert.ok(bindings.length > 0, 'Configured implementation binding missing');
  for (const binding of bindings) {
    assert.equal(binding.candidateSha, expected.sourceSha, 'Requirement source mismatch');
    assert.equal(binding.deploymentId, expected.deploymentId, 'Requirement deployment mismatch');
    assert.equal(binding.tenant, expected.tenant, 'Requirement tenant mismatch');
    assert.equal(binding.runId, expected.runId, 'Requirement run mismatch');
  }

  let declaredFixtureKeys = new Set();
  if (fixtureManifest !== null) {
    for (const key of ['sourceSha', 'tenant', 'runId', 'deploymentId', 'configurationDigest'])
      assert.equal(fixtureManifest[key], expected[key], `Fixture manifest ${key} mismatch`);
    assert.ok(Array.isArray(fixtureManifest.requirementKeys), 'Fixture requirement keys missing');
    assert.equal(new Set(fixtureManifest.requirementKeys).size, fixtureManifest.requirementKeys.length,
      'Duplicate fixture requirement key');
    declaredFixtureKeys = new Set(fixtureManifest.requirementKeys);
  }

  const seen = new Set();
  const unresolved = [];
  let satisfied = 0;
  for (const requirement of body.requirements) {
    const key = requirement?.key;
    assert.ok(typeof key === 'string' && key.length > 0 && !seen.has(key), 'Invalid or duplicate requirement');
    seen.add(key);
    assert.ok(['PASS', 'MISSING', 'FAIL', 'REVALIDATION_REQUIRED'].includes(requirement.status),
      'Unknown requirement status');
    assert.equal(requirement.satisfied, requirement.status === 'PASS' &&
      Number(requirement.confidence) >= Number(requirement.minConfidence), 'Requirement satisfaction mismatch');
    if (requirement.satisfied) { satisfied++; continue; }
    const fixtureCandidate = declaredFixtureKeys.has(key) && FIXTURE_DATA_CANDIDATE_KEYS.has(key) &&
      requirement.status === 'MISSING';
    unresolved.push({ key, status: requirement.status,
      classification: fixtureCandidate ? 'DECLARED_FIXTURE_DATA_CANDIDATE' : 'REAL_OR_UNRESOLVED_BLOCKER',
      reason: requirement.evidenceValidation?.reason || requirement.evidenceBinding?.reason || null });
  }
  for (const key of declaredFixtureKeys) assert.ok(seen.has(key), 'Manifest names unknown requirement');
  assert.equal(body.completedRequirements, satisfied, 'Completed requirement count mismatch');
  const blocked = unresolved.length > 0 || body.blockingDecisions.length > 0 ||
    body.launchBoundary.blockers.length > 0;
  assert.equal(body.operationalReady, !blocked, 'Operational readiness contradicts blockers');
  assert.equal(body.launchBoundary.ready, body.launchBoundary.blockers.length === 0,
    'Launch boundary contradicts blockers');
  return {
    status: blocked ? 'BLOCKED' : 'REQUIREMENTS_SATISFIED_IN_CAPTURE',
    sourceSha: expected.sourceSha, tenant: expected.tenant, runId: expected.runId,
    unresolved, blockingDecisionCount: body.blockingDecisions.length,
    launchBlockers: [...body.launchBoundary.blockers],
    fixtureClassificationIsUnverified: declaredFixtureKeys.size > 0,
    hostedProof: false, customerReady: false
  };
}
