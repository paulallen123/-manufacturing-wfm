import { isOpaqueReference, validateConnectionProfile } from './connection-contract.mjs';
import { missingProviderConfigRefs, providerCompatibility, validateProviderManifest } from './connection-setup-plan.mjs';
import { transportSafetyRequirements, validateTransportSafetyEvidence } from './transport-safety.mjs';

const FORBIDDEN_RESULT_KEYS = new Set([
  'records', 'rows', 'items', 'payload', 'body', 'rawPayload', 'rawRecords', 'rawRows',
  'accessToken', 'refreshToken', 'token', 'secret', 'password', 'privateKey', 'clientSecret',
  'credential', 'credentials'
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function findForbiddenResultKeys(value, path = '$', findings = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenResultKeys(item, `${path}[${index}]`, findings));
    return findings;
  }
  if (!isObject(value)) return findings;
  for (const [key, child] of Object.entries(value)) {
    const next = `${path}.${key}`;
    if (FORBIDDEN_RESULT_KEYS.has(key)) findings.push(next);
    findForbiddenResultKeys(child, next, findings);
  }
  return findings;
}

function safePolicy(manifest) {
  const validation = validateProviderManifest(manifest);
  if (!validation.ok) return { ok: false, errors: validation.errors };
  const safe = manifest.safeTest;
  if (!isObject(safe)) return { ok: false, errors: ['provider manifest does not define a safeTest policy'] };
  return { ok: true, policy: safe, errors: [] };
}

function validateExecutor(executor) {
  const errors = [];
  if (!isObject(executor)) return ['trusted executor is required'];
  if (executor.trustClass !== 'trusted_executor') errors.push('executor trustClass must be trusted_executor');
  if (!isOpaqueReference(executor.identityRef)) errors.push('executor.identityRef must be an opaque runtime reference');
  if (typeof executor.probe !== 'function') errors.push('executor.probe is required');
  return errors;
}

function buildBaseRequest(profile, manifest, policy) {
  return {
    schemaVersion: 1,
    intent: 'bounded_non_mutating_connection_test',
    connectionId: profile.connectionId,
    scope: profile.scope,
    providerKey: manifest.providerKey,
    direction: profile.direction || 'inbound',
    transport: {
      kind: profile.transport.kind,
      endpointRef: profile.transport.endpointRef,
      requiredSafetyEvidence: transportSafetyRequirements(profile.transport.kind)
    },
    authentication: {
      method: profile.authentication.method,
      credentialRef: profile.authentication.credentialRef,
      verifierRef: profile.authentication.verifierRef
    },
    providerConfigRefs: { ...(profile.provider.configRefs || {}) },
    limits: { maxRecords: policy.maxRecords, maxBytes: policy.maxBytes, timeoutMs: policy.timeoutMs },
    safety: { mutationAllowed: false, productionMutationAllowed: false, persistRawSensitiveData: false, applyToWorkforce: false },
    requiredEvidence: [...policy.requiredEvidence]
  };
}

function basicReadiness(profile, manifest, executor) {
  const errors = [];
  errors.push(...validateConnectionProfile(profile).errors);
  errors.push(...providerCompatibility(profile, manifest).reasons);
  errors.push(...missingProviderConfigRefs(profile, manifest).map((name) => `missing provider configuration reference: ${name}`));
  const policy = safePolicy(manifest);
  errors.push(...policy.errors);
  errors.push(...validateExecutor(executor));
  if (profile?.transport?.kind && transportSafetyRequirements(profile.transport.kind).length === 0) {
    errors.push(`transport safety policy is not defined for ${profile.transport.kind}`);
  }
  return { errors, policy: policy.policy || null };
}

async function boundedCall(fn, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('trusted executor timed out')), timeoutMs);
        timer.unref?.();
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function validateProbeResult(result, profile, manifest, policy) {
  const errors = [];
  if (!isObject(result)) return ['trusted executor returned an invalid result'];
  const forbidden = findForbiddenResultKeys(result);
  if (forbidden.length) errors.push(`trusted executor returned raw/sensitive payload fields: ${forbidden.join(', ')}`);
  if (!isOpaqueReference(result.evidenceRef)) errors.push('reviewable connection-test evidence reference is missing');
  if (result.providerCallObserved !== true) errors.push('provider call was not observed');
  if (result.providerIdentity?.verified !== true || result.providerIdentity?.providerKey !== manifest.providerKey) {
    errors.push('provider identity was not verified against the requested provider');
  }
  if (result.authenticationObserved !== true) errors.push('provider authentication was not observed');
  if (result.schemaObserved !== true || !isOpaqueReference(result.schemaEvidenceRef)) errors.push('reviewable schema evidence is missing');
  if (!Number.isInteger(result.sampleRecordCount) || result.sampleRecordCount < 0 || result.sampleRecordCount > policy.maxRecords) {
    errors.push('bounded sample record count is invalid or exceeds policy');
  }
  if (!Number.isInteger(result.sampleBytes) || result.sampleBytes < 0 || result.sampleBytes > policy.maxBytes) {
    errors.push('bounded sample byte count is invalid or exceeds policy');
  }
  if (result.mutationObserved !== false) errors.push('connection test did not prove absence of provider/workforce mutation');
  if (result.rawSensitiveDataPersisted !== false) errors.push('connection test did not prove raw sensitive data was not persisted');
  if (result.workforceApplyObserved !== false) errors.push('connection test did not prove workforce apply was disabled');
  errors.push(...validateTransportSafetyEvidence(profile, result));
  if (result.reconciliation?.status !== 'passed') errors.push('bounded source/staging reconciliation did not pass');
  if (!Number.isInteger(result.reconciliation?.sourceCount) || !Number.isInteger(result.reconciliation?.stagedCount)) {
    errors.push('reconciliation counts are missing');
  } else if (result.reconciliation.sourceCount !== result.reconciliation.stagedCount) {
    errors.push('source and staged reconciliation counts do not match');
  }
  if (!isOpaqueReference(result.reconciliation?.evidenceRef)) errors.push('reconciliation evidence reference is missing');
  if (result.connectionId !== undefined && result.connectionId !== profile.connectionId) errors.push('executor result connectionId does not match request');
  return errors;
}

export async function runSafeConnectionTest(profile, manifest, executor) {
  const readiness = basicReadiness(profile, manifest, executor);
  if (readiness.errors.length) return { status: 'failed', mode: 'bounded_non_mutating', errors: readiness.errors };
  const request = buildBaseRequest(profile, manifest, readiness.policy);
  let result;
  try {
    result = await boundedCall(() => executor.probe(request), readiness.policy.timeoutMs);
  } catch (error) {
    return { status: 'failed', mode: 'bounded_non_mutating', errors: [String(error?.message || error)] };
  }
  const errors = validateProbeResult(result, profile, manifest, readiness.policy);
  if (errors.length) return { status: 'failed', mode: 'bounded_non_mutating', errors };
  return {
    status: 'passed', mode: 'bounded_non_mutating', observedBy: 'trusted_executor',
    executorIdentityRef: executor.identityRef, evidenceRef: result.evidenceRef,
    providerCallObserved: true, providerIdentityVerified: true, authenticationObserved: true,
    boundedSampleObserved: true, mutationObserved: false, rawSensitiveDataPersisted: false,
    schemaEvidenceRef: result.schemaEvidenceRef, sampleRecordCount: result.sampleRecordCount,
    sampleBytes: result.sampleBytes, transportSafety: result.transportSafety,
    reconciliation: {
      status: 'passed', observedBy: 'trusted_executor', evidenceRef: result.reconciliation.evidenceRef,
      sourceCount: result.reconciliation.sourceCount, stagedCount: result.reconciliation.stagedCount
    }
  };
}

export async function runRecoveryProof(profile, manifest, executor) {
  if ((profile?.recovery?.maxAttempts || 1) <= 1) return { status: 'not_required', reason: 'connection retry is disabled' };
  const readiness = basicReadiness(profile, manifest, executor);
  if (readiness.errors.length) return { status: 'failed', errors: readiness.errors };
  if (typeof executor.proveRecovery !== 'function') return { status: 'failed', errors: ['executor.proveRecovery is required'] };
  const request = {
    ...buildBaseRequest(profile, manifest, readiness.policy),
    intent: 'bounded_recovery_proof',
    recovery: {
      maxAttempts: profile.recovery.maxAttempts,
      idempotencyKey: profile.recovery.idempotencyKey,
      requireObservedTransientFailure: true,
      requireSameOperationRecovery: true,
      requirePostRecoveryReconciliation: true
    }
  };
  let result;
  try {
    result = await boundedCall(() => executor.proveRecovery(request), readiness.policy.timeoutMs);
  } catch (error) {
    return { status: 'failed', errors: [String(error?.message || error)] };
  }
  const errors = [];
  if (!isObject(result)) errors.push('trusted executor returned an invalid recovery result');
  const forbidden = findForbiddenResultKeys(result);
  if (forbidden.length) errors.push(`trusted executor returned raw/sensitive payload fields: ${forbidden.join(', ')}`);
  if (result?.transientFailureObserved !== true) errors.push('recovery proof requires an observed transient failure');
  if (result?.successfulRecoveryObserved !== true) errors.push('recovery proof requires successful recovery after the observed failure');
  if (result?.sameOperationRecovered !== true) errors.push('recovery must prove the same operation recovered, not a different request');
  if (!Number.isInteger(result?.attempts) || result.attempts < 2 || result.attempts > profile.recovery.maxAttempts) errors.push('recovery attempt count is invalid or exceeds the approved policy');
  if (result?.duplicateApplicationCount !== 0) errors.push('recovery produced duplicate staged/application effects');
  if (result?.mutationObserved !== false) errors.push('recovery proof did not prove absence of provider/workforce mutation');
  if (result?.rawSensitiveDataPersisted !== false) errors.push('recovery proof did not prove raw sensitive data was not persisted');
  if (result?.reconciliation?.status !== 'passed') errors.push('post-recovery reconciliation did not pass');
  if (!isOpaqueReference(result?.reconciliation?.evidenceRef)) errors.push('post-recovery reconciliation evidence reference is missing');
  if (!isOpaqueReference(result?.evidenceRef)) errors.push('recovery evidence reference is missing');
  if (errors.length) return { status: 'failed', errors };
  return {
    status: 'passed', observedBy: 'trusted_executor', executorIdentityRef: executor.identityRef,
    evidenceRef: result.evidenceRef, transientFailureObserved: true, successfulRecoveryObserved: true,
    sameOperationRecovered: true, attempts: result.attempts, duplicateApplicationCount: 0,
    reconciliationPassed: true, reconciliationEvidenceRef: result.reconciliation.evidenceRef,
    mutationObserved: false, rawSensitiveDataPersisted: false
  };
}
