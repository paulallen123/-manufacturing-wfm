import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateCandidateBinding, validateCandidateIdentity } from '../lib/candidate-binding.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(fs.readFileSync(path.join(here, '../candidates/vector-forge-current-proof-2026-09-28.seed.json'), 'utf8'));

test('current FORGE shadow seed is a complete exact provider target identity', () => {
  assert.deepEqual(validateCandidateIdentity(seed.candidate), { ok: true, errors: [] });
  assert.equal(seed.candidate.projectId, seed.observed.projectId);
  assert.equal(seed.candidate.serviceId, seed.observed.serviceId);
  assert.equal(seed.candidate.publicOrigin, seed.observed.publicOrigin);
  assert.equal(seed.candidate.deploymentId, seed.observed.deploymentSource.deploymentId);
  assert.equal(seed.candidate.commitSha, seed.observed.deploymentSource.commitSha);
  assert.equal(seed.candidate.runtimeSha, seed.observed.deploymentSource.containerImageDigest);
  assert.equal(seed.candidate.failureDomainId, 'railway');
});

test('current FORGE seed remains blocked at exact source binding until runtime self-attests identity', () => {
  const result = evaluateCandidateBinding({
    candidate: seed.candidate,
    expected: { serviceId: seed.observed.serviceId, publicOrigin: seed.observed.publicOrigin },
    provider: {
      deploymentId: seed.observed.deploymentSource.deploymentId,
      commitSha: seed.observed.deploymentSource.commitSha,
      imageDigest: seed.observed.deploymentSource.containerImageDigest,
      status: seed.observed.deploymentSource.providerStatus,
    },
    route: { serviceId: seed.observed.serviceId, publicOrigin: seed.observed.publicOrigin },
    health: seed.observed.applicationHealth,
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.exactSourceBinding, false);
  assert.ok(result.observations.includes('PROVIDER_TO_PUBLIC_APPLICATION_BINDING_PASS'));
  assert.ok(result.failures.includes('EXACT_RUNTIME_IDENTITY_UNPROVEN'));
});
