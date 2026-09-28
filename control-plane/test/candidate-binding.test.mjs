import test from 'node:test';
import assert from 'node:assert/strict';
import { detectRegistryDrift, evaluateCandidateBinding } from '../lib/candidate-binding.js';

const candidate = {
  commitSha: '3030541675e41157405b933c30d82c8fd4b12927',
  deploymentId: 'e6399d9c-63ca-4272-ab0d-6d1010e444bd',
  runtimeSha: 'sha256:95f355ef7e0af5e65dc3ce63bc6c9a21dfb787a6d61b6a661ff5d5cff91333e2',
};
const expected = {
  serviceId: '55e288b7-ac40-4856-ad45-16515c74739a',
  publicOrigin: 'https://vector-forge-current-proof-production.up.railway.app',
};
const provider = {
  deploymentId: candidate.deploymentId,
  commitSha: candidate.commitSha,
  imageDigest: candidate.runtimeSha,
  status: 'SUCCESS',
};
const route = { ...expected };
const health = {
  status: 'ok', mode: 'hosted-staging', fixtureOnly: true,
  productionApproved: false, pilotReady: false,
  release: '0.6.76-hosted-staging-rc1',
};

test('provider + route + public health are insufficient for exact source binding without runtime identity', () => {
  const result = evaluateCandidateBinding({ candidate, expected, provider, route, health });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.exactSourceBinding, false);
  assert.ok(result.observations.includes('PROVIDER_TO_PUBLIC_APPLICATION_BINDING_PASS'));
  assert.ok(result.failures.includes('EXACT_RUNTIME_IDENTITY_UNPROVEN'));
});

test('exact runtime attestation closes the binding only when commit and image digest match', () => {
  const result = evaluateCandidateBinding({
    candidate, expected, provider, route, health,
    runtimeAttestation: { commitSha: candidate.commitSha, runtimeSha: candidate.runtimeSha },
  });
  assert.equal(result.status, 'PASS');
  assert.equal(result.exactSourceBinding, true);
  assert.deepEqual(result.failures, []);
});

test('runtime attestation mismatch fails closed', () => {
  const result = evaluateCandidateBinding({
    candidate, expected, provider, route, health,
    runtimeAttestation: { commitSha: 'f'.repeat(40), runtimeSha: candidate.runtimeSha },
  });
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.failures.includes('RUNTIME_SELF_ATTESTED_COMMIT_MISMATCH'));
});

test('27 September legacy redirect drift is detected against the stale 17 September registry claim', () => {
  const findings = detectRegistryDrift({
    registry: {
      serviceId: 'ddd54fb9-3564-4251-9959-28cf3308c272',
      deploymentId: '2d399257-e7ea-43e8-a728-d563e8cb366b',
    },
    provider: {
      serviceId: 'ddd54fb9-3564-4251-9959-28cf3308c272',
      deploymentId: '102724ed-98e3-44e3-ad32-f223f6fd2b50',
      commitSha: 'b63cf119dcc294cd7cbb0681e26f5bdf081e77dc',
      buildPath: 'legacy-redirect/Dockerfile',
    },
  });
  assert.ok(findings.includes('STALE_DEPLOYMENT_ID'));
  assert.ok(findings.includes('RETIRED_RUNTIME_REDIRECT'));
});
