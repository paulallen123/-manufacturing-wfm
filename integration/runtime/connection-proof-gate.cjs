'use strict';

const { createHash } = require('node:crypto');

const TRANSPORTS = Object.freeze({
  api: Object.freeze({ auth: ['oauth2', 'service-account', 'mtls', 'api-key-ref', 'managed-identity'], recoveryRequired: false }),
  webhook: Object.freeze({ auth: ['hmac-ref', 'mtls', 'oauth2'], recoveryRequired: true }),
  'queue-stream': Object.freeze({ auth: ['oauth2', 'mtls', 'managed-identity', 'sasl-ref'], recoveryRequired: true }),
  'secure-file': Object.freeze({ auth: ['sftp-key-ref', 'managed-file-transfer', 'mtls'], recoveryRequired: true }),
  'read-only-db': Object.freeze({ auth: ['managed-identity', 'service-account', 'mtls', 'password-ref'], recoveryRequired: true }),
  identity: Object.freeze({ auth: ['oauth2', 'oidc', 'scim-token-ref', 'mtls'], recoveryRequired: false }),
  'on-prem-agent': Object.freeze({ auth: ['mtls', 'device-cert-ref'], recoveryRequired: true }),
  ipaas: Object.freeze({ auth: ['oauth2', 'service-account', 'mtls', 'webhook-signature-ref'], recoveryRequired: true })
});

const CREDENTIAL_REF = /^(vault|secret|managed|railway|keyvault|awssecrets|gcpsecrets):\/\/[A-Za-z0-9._:/-]{3,240}$/;
const CAPABILITY = /^[a-z0-9][a-z0-9.-]{1,79}$/;

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stable(value[key]);
    return out;
  }, {});
}

function digest(value) {
  return sha256(JSON.stringify(stable(value)));
}

function asPositiveInt(value, fallback = null) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function validCredentialRef(value) {
  return CREDENTIAL_REF.test(String(value || ''));
}

function cleanAuthority(items, connectionId) {
  if (!Array.isArray(items) || !items.length) throw new Error('At least one deterministic authority assignment is required.');
  const seen = new Set();
  return items.map((item) => {
    const capability = String(item?.capability || '').trim().toLowerCase();
    const sourceId = String(item?.sourceId || '').trim();
    if (!CAPABILITY.test(capability)) throw new Error('Authority capability is invalid.');
    if (!sourceId || sourceId !== connectionId) throw new Error('Authority must name this exact connection as source.');
    if (seen.has(capability)) throw new Error('Each capability may have only one authoritative source in a review.');
    seen.add(capability);
    return { capability, sourceId };
  }).sort((a, b) => a.capability.localeCompare(b.capability));
}

function reviewConnection(input = {}) {
  const connectionId = String(input.connectionId || '').trim();
  const tenantId = String(input.tenantId || '').trim();
  const providerKey = String(input.providerKey || '').trim().toLowerCase();
  const transport = String(input.transport || '').trim().toLowerCase();
  const targetIdentity = String(input.targetIdentity || '').trim();
  const environment = String(input.environment || '').trim().toLowerCase();
  const authMethod = String(input.auth?.method || '').trim().toLowerCase();
  const credentialRef = String(input.auth?.credentialRef || '').trim();
  const mappingVersion = asPositiveInt(input.mapping?.version);
  const mappingDigest = String(input.mapping?.digest || '').trim();
  const maxFreshnessSeconds = asPositiveInt(input.monitoring?.maxFreshnessSeconds, 900);
  const maxLatencyMs = asPositiveInt(input.monitoring?.maxLatencyMs, 5000);

  if (!connectionId || !tenantId || !providerKey || !targetIdentity) throw new Error('Connection, tenant, provider and target identity are required.');
  if (!TRANSPORTS[transport]) throw new Error('Unsupported enterprise transport.');
  if (!TRANSPORTS[transport].auth.includes(authMethod)) throw new Error('Authentication method is not allowed for this transport.');
  if (!validCredentialRef(credentialRef)) throw new Error('Authentication must use a protected credential reference, never a raw secret.');
  if (!mappingVersion || !/^[a-f0-9]{32,128}$/i.test(mappingDigest)) throw new Error('A reviewed mapping version and digest are required.');

  if (transport === 'read-only-db') {
    if (input.transportOptions?.readOnly !== true) throw new Error('Database transport must be explicitly read-only.');
    if (String(input.transportOptions?.queryMode || '').toLowerCase() !== 'read-only') throw new Error('Database query mode must be read-only.');
  }

  const authority = cleanAuthority(input.authority, connectionId);
  const reviewed = {
    connectionId,
    tenantId,
    providerKey,
    transport,
    targetIdentity,
    environment: environment || 'non-production',
    auth: { method: authMethod, credentialRef },
    mapping: { version: mappingVersion, digest: mappingDigest.toLowerCase() },
    authority,
    monitoring: { maxFreshnessSeconds, maxLatencyMs },
    transportOptions: transport === 'read-only-db' ? { readOnly: true, queryMode: 'read-only' } : {}
  };

  return Object.freeze({
    ...reviewed,
    reviewedDigest: digest(reviewed),
    recoveryProofRequired: TRANSPORTS[transport].recoveryRequired
  });
}

function approvalFor(review, actor = {}) {
  const approvedBy = String(actor.approvedBy || '').trim();
  const role = String(actor.role || '').trim().toLowerCase();
  if (!approvedBy || !['authorized-admin', 'integration-owner'].includes(role)) {
    throw new Error('Explicit approval requires an authorised administrator or integration owner.');
  }
  return Object.freeze({
    decision: 'APPROVED',
    approvedBy,
    role,
    approvedAt: new Date().toISOString(),
    reviewedDigest: review.reviewedDigest
  });
}

function sameReview(evidence, review) {
  return evidence && evidence.reviewedDigest === review.reviewedDigest;
}

function newerOrEqual(left, right) {
  const a = Date.parse(String(left || ''));
  const b = Date.parse(String(right || ''));
  return Number.isFinite(a) && Number.isFinite(b) && a >= b;
}

function evaluateActivation(review, evidence = {}, currentConfig) {
  const blockers = [];
  let currentReview;
  try {
    currentReview = currentConfig ? reviewConnection(currentConfig) : review;
  } catch (error) {
    blockers.push('Current connection configuration is invalid: ' + error.message);
  }
  if (currentReview && currentReview.reviewedDigest !== review.reviewedDigest) blockers.push('Reviewed connection changed after approval; review again.');

  const approval = evidence.approval;
  if (!approval || approval.decision !== 'APPROVED' || !sameReview(approval, review)) blockers.push('Explicit activation approval for this exact reviewed connection is missing.');

  const test = evidence.connectionTest;
  if (!test || test.status !== 'PASS' || !sameReview(test, review)) blockers.push('Safe connection test for this exact review has not passed.');
  else {
    if (test.nonMutating !== true) blockers.push('Connection test was not proven non-mutating.');
    if (test.targetIdentityVerified !== true) blockers.push('Target system identity was not verified.');
    if (!asPositiveInt(test.measuredLatencyMs)) blockers.push('Connection latency was not measured.');
    else if (test.measuredLatencyMs > review.monitoring.maxLatencyMs) blockers.push('Measured connection latency exceeds the reviewed limit.');
  }

  const mapping = evidence.mappingReview;
  if (!mapping || mapping.status !== 'APPROVED' || !sameReview(mapping, review) || Number(mapping.mappingVersion) !== review.mapping.version) {
    blockers.push('Mapping review does not match the current reviewed mapping.');
  }

  const recon = evidence.reconciliation;
  if (!recon || recon.status !== 'PASS' || !sameReview(recon, review) || Number(recon.mappingVersion) !== review.mapping.version) {
    blockers.push('Reconciliation has not passed for the current mapping.');
  } else if (test?.observedAt && !newerOrEqual(recon.observedAt, test.observedAt)) {
    blockers.push('Reconciliation is older than the latest connection proof.');
  }

  if (review.recoveryProofRequired) {
    const recovery = evidence.recoveryProof;
    if (!recovery || recovery.status !== 'PASS' || !sameReview(recovery, review)) blockers.push('Recovery proof is required for this transport.');
    else {
      if (recovery.observedFailure !== true || recovery.recovered !== true) blockers.push('Recovery proof must include an observed failure and successful recovery.');
      if (recovery.reconciliationStatus !== 'PASS') blockers.push('Recovery proof must finish with reconciliation passing.');
    }
  }

  return Object.freeze({
    canActivate: blockers.length === 0,
    state: blockers.length === 0 ? 'APPROVED_FOR_ACTIVATION' : 'BLOCKED',
    reviewedDigest: review.reviewedDigest,
    blockers
  });
}

function evaluateRuntimeHealth(review, runtime = {}, now = Date.now()) {
  const blockers = [];
  const warnings = [];
  if (runtime.reviewedDigest !== review.reviewedDigest) blockers.push('Runtime configuration no longer matches the approved review.');
  if (runtime.authorityConflict === true) blockers.push('More than one source is claiming authority for the same capability.');
  if (runtime.retryExhausted === true) blockers.push('Automatic recovery is exhausted and requires review.');
  if (Number(runtime.quarantined || 0) > 0) blockers.push('One or more integration messages are quarantined.');

  const lastSyncMs = Date.parse(String(runtime.lastSyncAt || ''));
  const reconMs = Date.parse(String(runtime.lastReconciliationAt || ''));
  if (!Number.isFinite(lastSyncMs)) blockers.push('No successful sync freshness evidence is available.');
  else {
    const ageSeconds = Math.max(0, Math.floor((now - lastSyncMs) / 1000));
    if (ageSeconds > review.monitoring.maxFreshnessSeconds) warnings.push('Integration data is older than the reviewed freshness target.');
  }
  if (!Number.isFinite(reconMs) || (Number.isFinite(lastSyncMs) && reconMs < lastSyncMs)) blockers.push('Latest successful sync has not been reconciled.');

  const latency = Number(runtime.measuredLatencyMs);
  if (!Number.isFinite(latency) || latency < 0) blockers.push('Runtime latency is not measured.');
  else if (latency > review.monitoring.maxLatencyMs) warnings.push('Runtime latency exceeds the reviewed target.');

  if (Number(runtime.pendingRetries || 0) > 0) warnings.push('Retries are pending.');
  const state = blockers.length ? 'BLOCKED' : warnings.length ? 'DEGRADED' : 'HEALTHY';
  return Object.freeze({ state, blockers, warnings });
}

function buildSafeConnectionTestPlan(review) {
  const base = [
    'Resolve the protected authentication reference inside the trusted integration executor.',
    'Authenticate with the minimum approved read scope.',
    'Verify the exact target system identity before reading any business data.',
    'Read only bounded metadata or a synthetic/non-sensitive sample.',
    'Measure end-to-end latency and record freshness evidence.',
    'Reconcile source and staged counts/digests without storing raw employee or payroll values.'
  ];
  if (review.transport === 'read-only-db') base.splice(3, 0, 'Enforce a read-only database session and reject any write-capable statement before execution.');
  if (review.recoveryProofRequired) base.push('Exercise a controlled transient failure in a non-production harness, prove recovery, then reconcile again.');
  return Object.freeze({
    transport: review.transport,
    nonMutating: true,
    requiresExplicitActivationApproval: true,
    steps: base
  });
}

module.exports = {
  TRANSPORTS,
  validCredentialRef,
  reviewConnection,
  approvalFor,
  evaluateActivation,
  evaluateRuntimeHealth,
  buildSafeConnectionTestPlan
};