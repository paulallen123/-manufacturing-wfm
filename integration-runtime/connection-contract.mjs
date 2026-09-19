import crypto from 'node:crypto';

const ALLOWED_TRANSPORTS = new Set([
  'rest_api', 'webhook', 'queue', 'stream', 'sftp', 'https_file',
  'readonly_database', 'onprem_agent', 'ipaas', 'identity'
]);
const ALLOWED_AUTH = new Set([
  'oauth2_client', 'signed_assertion', 'mtls', 'managed_identity',
  'api_token_ref', 'basic_ref', 'ssh_key_ref', 'none'
]);
const SAFE_MODES = new Set(['read_only', 'staging_only']);
const SECRET_KEYS = /(password|secret|token|private[_-]?key|client[_-]?secret|access[_-]?key)/i;
const REFERENCE_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]+$/i;
const DISALLOWED_RAW_REFERENCE_SCHEMES = new Set(['http', 'https', 'ftp', 'ftps', 'ws', 'wss', 'data', 'file']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function isOpaqueReference(value) {
  if (typeof value !== 'string' || !REFERENCE_PATTERN.test(value)) return false;
  const scheme = value.slice(0, value.indexOf(':')).toLowerCase();
  return !DISALLOWED_RAW_REFERENCE_SCHEMES.has(scheme);
}

function rejectEmbeddedSecrets(value, path = '$', findings = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectEmbeddedSecrets(item, `${path}[${index}]`, findings));
    return findings;
  }
  if (!isObject(value)) return findings;
  for (const [key, child] of Object.entries(value)) {
    const next = `${path}.${key}`;
    if (SECRET_KEYS.test(key) && typeof child === 'string' && child.trim() !== '') {
      if (/(Ref|_ref|Reference)$/i.test(key)) {
        if (!isOpaqueReference(child)) findings.push(next);
      } else {
        findings.push(next);
      }
    }
    rejectEmbeddedSecrets(child, next, findings);
  }
  return findings;
}

function validateScope(scope, errors) {
  if (!isObject(scope) || typeof scope.tenantId !== 'string' || scope.tenantId.trim() === '') {
    errors.push('scope.tenantId is required for tenant isolation');
    return;
  }
  if (scope.siteIds !== undefined) {
    if (!Array.isArray(scope.siteIds) || scope.siteIds.some((siteId) => typeof siteId !== 'string' || siteId.trim() === '')) {
      errors.push('scope.siteIds must be an array of non-empty site IDs');
    } else if (new Set(scope.siteIds).size !== scope.siteIds.length) {
      errors.push('scope.siteIds must not contain duplicates');
    }
  }
}

function validateProviderConfigRefs(provider, errors) {
  if (provider?.configRefs === undefined) return;
  if (!isObject(provider.configRefs)) {
    errors.push('provider.configRefs must be an object of opaque configuration references');
    return;
  }
  for (const [name, ref] of Object.entries(provider.configRefs)) {
    if (!/^[a-z][A-Za-z0-9]*Ref$/.test(name) || !isOpaqueReference(ref)) {
      errors.push(`provider.configRefs.${name} must be an opaque configuration reference`);
    }
  }
}

export function materialForApproval(profile) {
  const value = clone(profile);
  delete value.activation;
  delete value.runtime;
  return canonicalize(value);
}

export function approvalFingerprint(profile) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(materialForApproval(profile)))
    .digest('hex');
}

export function validateConnectionProfile(profile) {
  const errors = [];
  if (!isObject(profile)) return { ok: false, errors: ['profile must be an object'] };
  if (profile.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!profile.connectionId || typeof profile.connectionId !== 'string') errors.push('connectionId is required');
  validateScope(profile.scope, errors);

  if (!isObject(profile.transport) || !ALLOWED_TRANSPORTS.has(profile.transport.kind)) {
    errors.push('transport.kind is unsupported');
  }
  if (!isOpaqueReference(profile.transport?.endpointRef)) {
    errors.push('transport.endpointRef must be an opaque configuration reference, not a raw network endpoint');
  }
  if (!isObject(profile.authentication) || !ALLOWED_AUTH.has(profile.authentication.method)) {
    errors.push('authentication.method is unsupported');
  }
  if (profile.authentication?.method !== 'none' && !isOpaqueReference(profile.authentication?.credentialRef)) {
    errors.push('authentication.credentialRef must be an opaque secret reference');
  }
  if (profile.authentication?.method === 'none' && profile.transport?.kind !== 'webhook') {
    errors.push('unauthenticated connections are limited to separately verified webhook ingress');
  }
  if (profile.authentication?.method === 'none' && !isOpaqueReference(profile.authentication?.verifierRef)) {
    errors.push('unauthenticated webhook ingress requires an opaque verifierRef');
  }

  if (!isObject(profile.provider) || !profile.provider.key || !profile.provider.mappingVersion) {
    errors.push('provider metadata and mappingVersion are required');
  }
  validateProviderConfigRefs(profile.provider, errors);
  if (!isObject(profile.mapping) || !profile.mapping.version || !['draft', 'reviewed'].includes(profile.mapping.status)) {
    errors.push('mapping must have version and draft/reviewed status');
  }
  if (profile.mapping?.version && profile.provider?.mappingVersion && profile.mapping.version !== profile.provider.mappingVersion) {
    errors.push('provider mappingVersion must match mapping.version');
  }

  if (!isObject(profile.safety) || !SAFE_MODES.has(profile.safety.mode)) {
    errors.push('safety.mode must be read_only or staging_only');
  }
  if (profile.safety?.productionMutationAllowed !== false) {
    errors.push('productionMutationAllowed must be false');
  }
  if (profile.transport?.kind === 'readonly_database' && profile.safety?.mode !== 'read_only') {
    errors.push('readonly_database requires read_only mode');
  }

  if (!isObject(profile.authority) || !profile.authority.entityOwners || Object.keys(profile.authority.entityOwners).length === 0) {
    errors.push('deterministic entity authority is required');
  }
  if (!isObject(profile.recovery) || !Number.isInteger(profile.recovery.maxAttempts) || profile.recovery.maxAttempts < 1 || profile.recovery.maxAttempts > 10) {
    errors.push('recovery.maxAttempts must be an integer between 1 and 10');
  }
  if (profile.recovery?.maxAttempts > 1 && !profile.recovery?.idempotencyKey) {
    errors.push('retrying connections require an idempotencyKey');
  }
  if (!isObject(profile.monitoring) || typeof profile.monitoring.freshnessSeconds !== 'number' || profile.monitoring.freshnessSeconds < 1) {
    errors.push('monitoring.freshnessSeconds must be positive');
  }
  if (profile.monitoring?.reconciliationRequired !== true) {
    errors.push('monitoring.reconciliationRequired must be true');
  }

  for (const path of rejectEmbeddedSecrets(profile)) errors.push(`embedded secret-like value or unsafe reference is forbidden at ${path}`);
  return { ok: errors.length === 0, errors };
}

function requireTrustedEvidence(evidence, label, reasons) {
  if (evidence?.observedBy !== 'trusted_executor') reasons.push(`${label} must be observed by the trusted executor`);
  if (!isOpaqueReference(evidence?.evidenceRef)) reasons.push(`${label} requires a reviewable evidence reference`);
}

export function activationReadiness(profile) {
  const validation = validateConnectionProfile(profile);
  const reasons = [...validation.errors];
  if (profile?.mapping?.status !== 'reviewed') reasons.push('mapping must be reviewed');
  if (profile?.connectionTest?.status !== 'passed') reasons.push('safe connection test must pass');
  if (profile?.connectionTest?.mode !== 'bounded_non_mutating') reasons.push('connection test must be bounded and non-mutating');
  if (profile?.connectionTest?.status === 'passed') {
    requireTrustedEvidence(profile.connectionTest, 'connection test', reasons);
    if (profile.connectionTest.mutationObserved !== false) reasons.push('connection test must prove no mutation was observed');
    if (profile.connectionTest.rawSensitiveDataPersisted !== false) reasons.push('connection test must prove raw sensitive data was not persisted');
  }
  if (profile?.recovery?.maxAttempts > 1) {
    if (profile?.recoveryProof?.status !== 'passed') {
      reasons.push('retry/recovery must be proven before activation');
    } else {
      requireTrustedEvidence(profile.recoveryProof, 'recovery proof', reasons);
      if (profile.recoveryProof.transientFailureObserved !== true) reasons.push('recovery proof must include an observed transient failure');
      if (profile.recoveryProof.successfulRecoveryObserved !== true) reasons.push('recovery proof must include successful recovery after the observed failure');
      if (profile.recoveryProof.reconciliationPassed !== true) reasons.push('recovery proof must reconcile successfully after recovery');
      if (profile.recoveryProof.mutationObserved !== false) reasons.push('recovery proof must show no mutation was observed');
    }
  }
  if (profile?.reconciliation?.status !== 'passed') {
    reasons.push('reconciliation must pass');
  } else {
    requireTrustedEvidence(profile.reconciliation, 'reconciliation', reasons);
  }
  if (profile?.activation?.approved !== true) reasons.push('explicit activation approval is required');

  const expected = approvalFingerprint(profile);
  if (profile?.activation?.fingerprint !== expected) reasons.push('activation approval is stale or does not match the reviewed configuration');
  return { ready: reasons.length === 0, reasons, fingerprint: expected };
}
