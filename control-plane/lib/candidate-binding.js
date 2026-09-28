export function validateCandidateIdentity(candidate) {
  const errors = [];
  if (!candidate || typeof candidate !== 'object') return { ok: false, errors: ['CANDIDATE_REQUIRED'] };
  const required = ['repository', 'ref', 'commitSha', 'projectId', 'environment', 'serviceId', 'deploymentId', 'runtimeSha', 'releaseId', 'publicOrigin', 'provider', 'failureDomainId'];
  for (const field of required) {
    if (typeof candidate[field] !== 'string' || candidate[field].trim() === '') errors.push(`MISSING_${field.toUpperCase()}`);
  }
  if (candidate.repository && !/^[^/\\s]+\\/[^/\\s]+$/.test(candidate.repository)) errors.push('INVALID_REPOSITORY');
  if (candidate.commitSha && !/^[0-9a-f]{40}$/.test(candidate.commitSha)) errors.push('INVALID_COMMIT_SHA');
  if (candidate.runtimeSha && !/^sha256:[0-9a-f]{64}$/.test(candidate.runtimeSha)) errors.push('INVALID_RUNTIME_SHA');
  if (candidate.publicOrigin) {
    try {
      const url = new URL(candidate.publicOrigin);
      if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) errors.push('INVALID_PUBLIC_ORIGIN');
    } catch {
      errors.push('INVALID_PUBLIC_ORIGIN');
    }
  }
  if (candidate.provider === 'railway' && candidate.failureDomainId !== 'railway') errors.push('RAILWAY_FAILURE_DOMAIN_MUST_BE_RAILWAY');
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

function normalizeDigest(value) {
  if (!value) return null;
  const text = String(value).trim().toLowerCase();
  return text.startsWith('sha256:') ? text : `sha256:${text}`;
}

export function evaluateCandidateBinding({ candidate, expected, provider, route, health, runtimeAttestation = null }) {
  const failures = [];
  const observations = [];

  if (!candidate || !expected || !provider || !route || !health) {
    return {
      status: 'BLOCKED',
      exactSourceBinding: false,
      failures: ['INCOMPLETE_BINDING_EVIDENCE'],
      observations,
    };
  }

  if (provider.deploymentId !== candidate.deploymentId) failures.push('DEPLOYMENT_ID_MISMATCH');
  if (provider.commitSha !== candidate.commitSha) failures.push('SOURCE_COMMIT_MISMATCH');
  if (normalizeDigest(provider.imageDigest) !== normalizeDigest(candidate.runtimeSha)) failures.push('RUNTIME_IMAGE_DIGEST_MISMATCH');
  if (provider.status !== 'SUCCESS') failures.push('PROVIDER_DEPLOYMENT_NOT_SUCCESS');
  if (route.serviceId !== expected.serviceId) failures.push('SERVICE_ID_MISMATCH');
  if (route.publicOrigin !== expected.publicOrigin) failures.push('PUBLIC_ORIGIN_MISMATCH');
  if (health.status !== 'ok' || health.mode !== 'hosted-staging') failures.push('TERMINAL_APPLICATION_HEALTH_NOT_PASS');
  if (health.productionApproved !== false || health.pilotReady !== false) failures.push('CLAIM_BOUNDARY_MISMATCH');

  if (failures.length === 0) observations.push('PROVIDER_TO_PUBLIC_APPLICATION_BINDING_PASS');

  const runtimeCandidateSha = runtimeAttestation?.commitSha || health.candidateSha || null;
  const runtimeImageDigest = runtimeAttestation?.runtimeSha || health.runtimeSha || health.imageDigest || null;
  if (!runtimeCandidateSha || !runtimeImageDigest) {
    failures.push('EXACT_RUNTIME_IDENTITY_UNPROVEN');
  } else {
    if (runtimeCandidateSha !== candidate.commitSha) failures.push('RUNTIME_SELF_ATTESTED_COMMIT_MISMATCH');
    if (normalizeDigest(runtimeImageDigest) !== normalizeDigest(candidate.runtimeSha)) failures.push('RUNTIME_SELF_ATTESTED_IMAGE_MISMATCH');
  }

  return {
    status: failures.length === 0 ? 'PASS' : 'BLOCKED',
    exactSourceBinding: failures.length === 0,
    failures,
    observations,
  };
}

export function detectRegistryDrift({ registry, provider }) {
  const findings = [];
  if (!registry || !provider) return ['INCOMPLETE_DRIFT_INPUT'];
  if (registry.deploymentId !== provider.deploymentId) findings.push('STALE_DEPLOYMENT_ID');
  if (registry.commitSha && provider.commitSha && registry.commitSha !== provider.commitSha) findings.push('STALE_SOURCE_COMMIT');
  if (registry.serviceId && provider.serviceId && registry.serviceId !== provider.serviceId) findings.push('SERVICE_OWNER_MISMATCH');
  if (provider.buildPath && /legacy-redirect/i.test(provider.buildPath)) findings.push('RETIRED_RUNTIME_REDIRECT');
  return findings;
}
