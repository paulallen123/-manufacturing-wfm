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

function rejectEmbeddedSecrets(value, path = '$', findings = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectEmbeddedSecrets(item, `${path}[${index}]`, findings));
    return findings;
  }
  if (!isObject(value)) return findings;
  for (const [key, child] of Object.entries(value)) {
    const next = `${path}.${key}`;
    if (SECRET_KEYS.test(key) && typeof child === 'string' && child.trim() !== '') {
      // Secret references are permitted; raw values are not.
      if (!/(Ref|_ref|Reference)$/i.test(key)) findings.push(next);
    }
    rejectEmbeddedSecrets(child, next, findings);
  }
  return findings;
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

  if (!isObject(profile.transport) || !ALLOWED_TRANSPORTS.has(profile.transport.kind)) {
    errors.push('transport.kind is unsupported');
  }
  if (!isObject(profile.authentication) || !ALLOWED_AUTH.has(profile.authentication.method)) {
    errors.push('authentication.method is unsupported');
  }
  if (profile.authentication?.method !== 'none' && !profile.authentication?.credentialRef) {
    errors.push('authentication.credentialRef is required');
  }
  if (profile.authentication?.method === 'none' && profile.transport?.kind !== 'webhook') {
    errors.push('unauthenticated connections are limited to separately verified webhook ingress');
  }

  if (!isObject(profile.provider) || !profile.provider.key || !profile.provider.mappingVersion) {
    errors.push('provider metadata and mappingVersion are required');
  }
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
  if (!isObject(profile.recovery) || typeof profile.recovery.maxAttempts !== 'number' || profile.recovery.maxAttempts < 1) {
    errors.push('recovery.maxAttempts must be at least 1');
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

  for (const path of rejectEmbeddedSecrets(profile)) errors.push(`embedded secret-like value is forbidden at ${path}`);
  return { ok: errors.length === 0, errors };
}

export function activationReadiness(profile) {
  const validation = validateConnectionProfile(profile);
  const reasons = [...validation.errors];
  if (profile?.mapping?.status !== 'reviewed') reasons.push('mapping must be reviewed');
  if (profile?.connectionTest?.status !== 'passed') reasons.push('safe connection test must pass');
  if (profile?.connectionTest?.mode !== 'bounded_non_mutating') reasons.push('connection test must be bounded and non-mutating');
  if (profile?.recovery?.maxAttempts > 1 && profile?.recoveryProof?.status !== 'passed') {
    reasons.push('retry/recovery must be proven before activation');
  }
  if (profile?.reconciliation?.status !== 'passed') reasons.push('reconciliation must pass');
  if (profile?.activation?.approved !== true) reasons.push('explicit activation approval is required');

  const expected = approvalFingerprint(profile);
  if (profile?.activation?.fingerprint !== expected) reasons.push('activation approval is stale or does not match the reviewed configuration');
  return { ready: reasons.length === 0, reasons, fingerprint: expected };
}
