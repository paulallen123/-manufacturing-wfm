'use strict';

// Synthetic signed-credential boundary for issue #55. This is advisory only:
// it does not verify a W3C VC, connect to a wallet, or grant schedule authority.
const { createHash, createPublicKey, verify } = require('node:crypto');

const CREDENTIAL_FIELDS = ['credentialId', 'expiresAt', 'format', 'issuedAt', 'issuer', 'skillCode', 'subjectRef', 'tenant'];
const STATUS_FIELDS = ['checkedAt', 'credentialHash', 'issuer', 'revision', 'state'];
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const HASH = /^[a-f0-9]{64}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const exactFields = (value, fields) => value && typeof value === 'object' &&
  !Array.isArray(value) && Object.keys(value).sort().join('|') === fields.slice().sort().join('|');
const id = value => typeof value === 'string' && ID.test(value);
const time = value => typeof value === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value
    ? Date.parse(value) : null;
const canonical = value => JSON.stringify(Object.fromEntries(
  Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
function signed(payload, signature, publicKey) {
  if (!SIGNATURE.test(signature || '') || typeof publicKey !== 'string' || publicKey.length > 4096)
    return false;
  try {
    const key = createPublicKey(publicKey);
    return key.asymmetricKeyType === 'ed25519' &&
      verify(null, Buffer.from(canonical(payload)), key, Buffer.from(signature, 'base64url'));
  } catch { return false; }
}
function denied(reason) {
  return Object.freeze({
    contractVersion: 'SKILLS_TRUST_SHADOW_V1', decision: 'REVIEW_REQUIRED', reason,
    candidateEligibility: false, assignmentAuthority: false, skillEvidence: null
  });
}
function evaluatePortableSkillEvidence(input) {
  if (!input || !id(input.tenant) || !id(input.subjectRef) || time(input.now) === null)
    return denied('INVALID_REQUEST');
  const payload = input.credential?.payload;
  if (!exactFields(payload, CREDENTIAL_FIELDS) ||
      !['credentialId', 'issuer', 'tenant', 'subjectRef', 'skillCode'].every(field => id(payload[field])) ||
      payload.format !== 'synthetic-vc-v1' || time(payload.issuedAt) === null ||
      time(payload.expiresAt) === null)
    return denied('UNSUPPORTED_CREDENTIAL');
  if (payload.tenant !== input.tenant || payload.subjectRef !== input.subjectRef)
    return denied('SUBJECT_OR_TENANT_MISMATCH');
  const now = time(input.now);
  if (time(payload.issuedAt) > now || time(payload.expiresAt) <= now ||
      time(payload.issuedAt) >= time(payload.expiresAt))
    return denied('CREDENTIAL_NOT_CURRENT');
  const issuer = input.policy?.issuers?.[payload.issuer];
  if (input.policy?.tenant !== input.tenant || !id(input.policy?.version) ||
      !Number.isSafeInteger(input.policy.maxStatusAgeMs) ||
      input.policy.maxStatusAgeMs < 1 || input.policy.maxStatusAgeMs > 86400000 ||
      !issuer || !Array.isArray(issuer.allowedFormats) ||
      !issuer.allowedFormats.includes(payload.format))
    return denied('ISSUER_POLICY_DENIED');
  if (!signed(payload, input.credential.signature, issuer.publicKey))
    return denied('CREDENTIAL_PROOF_INVALID');
  const status = input.status?.payload;
  if (!exactFields(status, STATUS_FIELDS) || !id(status.issuer) || !id(status.revision) ||
      !HASH.test(status.credentialHash) || time(status.checkedAt) === null ||
      status.issuer !== payload.issuer || status.credentialHash !== hash(payload) ||
      !['VALID', 'REVOKED', 'SUSPENDED', 'UNKNOWN'].includes(status.state))
    return denied('STATUS_UNBOUND');
  if (!signed(status, input.status.signature, issuer.publicKey))
    return denied('STATUS_PROOF_INVALID');
  if (time(status.checkedAt) < time(payload.issuedAt) || time(status.checkedAt) > now ||
      now - time(status.checkedAt) >= input.policy.maxStatusAgeMs)
    return denied('STATUS_STALE');
  if (status.state !== 'VALID') return denied('STATUS_' + status.state);
  const mapping = input.mapping;
  if (!mapping || mapping.tenant !== input.tenant || !id(mapping.version) || !id(mapping.externalSkill) ||
      !id(mapping.canonicalSkill) || mapping.approved !== true ||
      mapping.externalSkill !== payload.skillCode)
    return denied('MAPPING_NOT_APPROVED');
  return Object.freeze({
    contractVersion: 'SKILLS_TRUST_SHADOW_V1', decision: 'CANDIDATE_VERIFIED',
    reason: 'SYNTHETIC_SHADOW_ONLY', candidateEligibility: true, assignmentAuthority: false,
    skillEvidence: Object.freeze({
      tenant: payload.tenant, subjectRef: payload.subjectRef,
      canonicalSkill: mapping.canonicalSkill, mappingVersion: mapping.version,
      sharingScope: 'TENANT_ONLY',
      issuer: payload.issuer, credentialFormat: payload.format,
      proofHash: status.credentialHash, statusRevision: status.revision,
      verifiedAt: status.checkedAt, expiresAt: payload.expiresAt,
      policyVersion: input.policy.version, authoritativeUse: 'INFORMATIONAL_ONLY'
    })
  });
}
module.exports = { evaluatePortableSkillEvidence };
