'use strict';

// Executable design, not a production authority or runtime integration. A trusted
// approval issuer, protected registration and authoritative context adapter do
// not exist for this action in the inspected current application.
const { createHash, createPublicKey, verify } = require('node:crypto');

const CLAIM_FIELDS = Object.freeze([
  'schema', 'issuer', 'audience', 'grantId', 'approvalRecordId', 'action', 'issuedAt', 'expiresAt',
  'origin', 'tenant', 'managerEmail', 'managerPersonId', 'employeeEmail', 'employeePersonId',
  'sourceSha', 'deploymentId', 'runId', 'configurationDigest', 'fixtureId', 'fixtureDigest',
  'requestId', 'date', 'hours', 'periodStart', 'periodEnd', 'expectedVersion', 'decision',
]);
const SCOPE_FIELDS = Object.freeze([
  'origin', 'tenant', 'managerEmail', 'managerPersonId', 'employeeEmail', 'employeePersonId',
  'sourceSha', 'deploymentId', 'runId', 'configurationDigest', 'fixtureId', 'fixtureDigest',
  'requestId', 'date', 'hours', 'periodStart', 'periodEnd', 'expectedVersion',
  'approvalRecordId',
]);
const MAX_LIFETIME_MS = 30 * 60 * 1000;

function refuse(message) { throw new Error('Test-only proof grant refused: ' + message); }
function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse('invalid object');
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((v, i) => v !== expected[i])) refuse('unexpected or missing fields');
}
function compact(value, max = 240) {
  return typeof value === 'string' && value.length > 0 && value.length <= max &&
    value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const millis = Date.parse(value + 'T00:00:00.000Z');
  return Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === value;
}
function validateClaims(claims) {
  exactKeys(claims, CLAIM_FIELDS);
  if (claims.schema !== 1 || claims.issuer !== 'vector-proof-action-approval' ||
      claims.audience !== 'vector-synthetic-leave-decision' || claims.action !== 'approve-synthetic-leave' ||
      claims.decision !== 'approved') refuse('unsupported grant purpose');
  for (const field of CLAIM_FIELDS) {
    if (['schema', 'issuedAt', 'expiresAt', 'hours', 'expectedVersion'].includes(field)) continue;
    if (!compact(claims[field])) refuse('malformed ' + field);
  }
  if (!/^[A-Za-z0-9_-]{32,96}$/.test(claims.grantId)) refuse('malformed grant id');
  if (!/^[a-f0-9]{40}$/.test(claims.sourceSha)) refuse('malformed source');
  for (const field of ['configurationDigest', 'fixtureDigest']) {
    if (!/^[a-f0-9]{64}$/.test(claims[field])) refuse('malformed ' + field);
  }
  let origin;
  try { origin = new URL(claims.origin); } catch { refuse('malformed origin'); }
  if (origin.protocol !== 'https:' || origin.origin !== claims.origin || origin.username || origin.password) refuse('invalid origin');
  for (const field of ['managerEmail', 'employeeEmail']) {
    if (claims[field] !== claims[field].toLowerCase() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims[field])) refuse('invalid email');
  }
  if (claims.managerPersonId === claims.employeePersonId || claims.managerEmail === claims.employeeEmail) refuse('self-review');
  if (!Number.isSafeInteger(claims.issuedAt) || !Number.isSafeInteger(claims.expiresAt) ||
      claims.issuedAt < 0 || claims.expiresAt <= claims.issuedAt ||
      claims.expiresAt - claims.issuedAt > MAX_LIFETIME_MS) refuse('invalid lifetime');
  if (!Number.isSafeInteger(claims.expectedVersion) || claims.expectedVersion < 1 || claims.expectedVersion >= Number.MAX_SAFE_INTEGER ||
      !Number.isFinite(claims.hours) || claims.hours < 0.5 || claims.hours > 12 || !Number.isInteger(claims.hours * 60)) refuse('invalid request numbers');
  if (![claims.date, claims.periodStart, claims.periodEnd].every(date) ||
      claims.periodStart > claims.date || claims.periodEnd < claims.date) refuse('invalid period');
}

function canonicalGrant(claims) {
  validateClaims(claims);
  // Fixed, complete ordering and JSON encoding avoid delimiter ambiguities.
  return Buffer.from(JSON.stringify(['VECTOR_PROOF_ACTION_GRANT_V1', ...CLAIM_FIELDS.map(field => claims[field])]), 'utf8');
}
function publicKey(value) {
  if (!value) refuse('missing protected key');
  let key;
  try { key = value.type === 'public' ? value : createPublicKey(value); } catch { refuse('invalid protected key'); }
  if (key.asymmetricKeyType !== 'ed25519') refuse('approval key must be Ed25519');
  return key;
}
function der(key) { return key.export({ type: 'spki', format: 'der' }); }

function verifyGrant(envelope, serverContext, options = {}) {
  exactKeys(envelope, ['claims', 'signature']);
  const message = canonicalGrant(envelope.claims);
  const approvalKey = publicKey(options.approvalPublicKey);
  const loginKey = publicKey(options.proofLoginPublicKey);
  if (der(approvalKey).equals(der(loginKey))) refuse('login key cannot be an approval key');
  if (typeof envelope.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature)) refuse('invalid signature encoding');
  const signature = Buffer.from(envelope.signature, 'base64url');
  if (signature.length !== 64 || signature.toString('base64url') !== envelope.signature ||
      !verify(null, message, approvalKey, signature)) refuse('signature verification failed');
  const now = options.now;
  if (!Number.isSafeInteger(now) || now < 0 || envelope.claims.issuedAt > now || envelope.claims.expiresAt <= now) refuse('expired or future grant');
  if (!serverContext || typeof serverContext !== 'object') refuse('missing authoritative context');
  if (serverContext.fixtureOnly !== true || serverContext.productionApproved !== false ||
      serverContext.providerActionsEnabled !== false || serverContext.customerActionsEnabled !== false ||
      serverContext.syntheticRequest !== true) refuse('synthetic isolation unavailable');
  if (serverContext.requestStatus !== 'pending' || serverContext.managerRole !== 'manager' ||
      serverContext.managerSessionIssuer !== 'wfm-proof-runner' || serverContext.managerMayReviewRequest !== true ||
      !Number.isSafeInteger(serverContext.managerSessionExpiresAt) || serverContext.managerSessionExpiresAt <= now) refuse('current principal/request authority unavailable');
  const grantDigest = createHash('sha256').update(message).digest('hex');
  if (serverContext.approvalRecordStatus !== 'APPROVED' || serverContext.approvalRevoked !== false ||
      serverContext.approvalRecordExpiresAt !== envelope.claims.expiresAt || serverContext.approvedGrantDigest !== grantDigest) refuse('current protected approval unavailable');
  for (const field of SCOPE_FIELDS) {
    if (serverContext[field] !== envelope.claims[field]) refuse('current scope mismatch: ' + field);
  }
  // This is evidence for the local design model only, never a live allow token.
  return Object.freeze({ grantId: envelope.claims.grantId,
    grantDigest, productionReady: false });
}

module.exports = { canonicalGrant, verifyGrant, CLAIM_FIELDS, MAX_LIFETIME_MS };
