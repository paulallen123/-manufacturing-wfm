'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, sign, createHash } = require('node:crypto');
let evaluatePortableSkillEvidence;
try { ({ evaluatePortableSkillEvidence } = require('./skills-trust-shadow.cjs')); }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND' || !error.message.includes("'./skills-trust-shadow.cjs'")) throw error;
  evaluatePortableSkillEvidence = () => null;
}

const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
const now = '2026-10-12T12:00:00.000Z';
const canonical = value => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
const signature = value => sign(null, Buffer.from(canonical(value)), keys.privateKey).toString('base64url');
function fixture() {
  const payload = {
    format: 'synthetic-vc-v1', issuer: 'issuer-a', tenant: 'tenant-a',
    subjectRef: 'worker-42', skillCode: 'weld-1',
    issuedAt: '2026-10-01T00:00:00.000Z', expiresAt: '2026-11-01T00:00:00.000Z',
    credentialId: 'credential-42'
  };
  const hash = createHash('sha256').update(canonical(payload)).digest('hex');
  const statusPayload = {
    issuer: 'issuer-a', credentialHash: hash, state: 'VALID', revision: 'r1',
    checkedAt: '2026-10-12T11:59:00.000Z'
  };
  return {
    now, tenant: 'tenant-a', subjectRef: 'worker-42',
    credential: { payload, signature: signature(payload) },
    status: { payload: statusPayload, signature: signature(statusPayload) },
    policy: {
      version: 'trust-v1', maxStatusAgeMs: 300000,
      issuers: { 'issuer-a': { publicKey, allowedFormats: ['synthetic-vc-v1'] } }
    },
    mapping: { version: 'mapping-v1', externalSkill: 'weld-1', canonicalSkill: 'WELD_L1', approved: true }
  };
}

test('valid signed synthetic evidence yields an advisory candidate with minimal claims', () => {
  const input = fixture();
  const result = evaluatePortableSkillEvidence(input);
  assert.equal(result.decision, 'CANDIDATE_VERIFIED');
  assert.equal(result.candidateEligibility, true);
  assert.equal(result.assignmentAuthority, false);
  assert.equal(result.skillEvidence.canonicalSkill, 'WELD_L1');
  assert.equal(result.skillEvidence.tenant, 'tenant-a');
  assert.equal(result.skillEvidence.subjectRef, 'worker-42');
  assert.equal(result.skillEvidence.mappingVersion, 'mapping-v1');
  assert.equal(result.skillEvidence.proofHash, input.status.payload.credentialHash);
  assert.equal(JSON.stringify(result).includes(publicKey), false);
  assert.equal(JSON.stringify(result).includes(input.credential.signature), false);
  assert.ok(Object.isFrozen(result.skillEvidence));
  assert.deepEqual(evaluatePortableSkillEvidence(input), result);
});

test('tampering, subject mismatch, expiry, revocation and stale status fail closed', () => {
  const cases = [
    input => { input.credential.payload.skillCode = 'forklift'; },
    input => { input.subjectRef = 'worker-99'; },
    input => { input.credential.payload.expiresAt = '2026-10-01T00:00:00.000Z'; input.credential.signature = signature(input.credential.payload); },
    input => { input.status.payload.state = 'REVOKED'; input.status.signature = signature(input.status.payload); },
    input => { input.status.payload.state = 'SUSPENDED'; input.status.signature = signature(input.status.payload); },
    input => { input.status.payload.checkedAt = '2026-10-12T11:54:59.000Z'; input.status.signature = signature(input.status.payload); },
    input => { input.status.payload.credentialHash = '0'.repeat(64); input.status.signature = signature(input.status.payload); },
    input => { input.status.signature = 'bad'; },
    input => { input.tenant = 'tenant-b'; },
    input => { input.mapping.approved = false; },
    input => { input.policy.issuers = {}; },
    input => { input.credential.payload.format = 'unsupported'; input.credential.signature = signature(input.credential.payload); },
    input => { input.credential.payload.privateClaim = 'hidden'; input.credential.signature = signature(input.credential.payload); },
    input => { input.status = null; }
  ];
  for (let i = 0; i < 560; i++) {
    const input = fixture();
    cases[i % cases.length](input);
    const result = evaluatePortableSkillEvidence(input);
    assert.equal(result.candidateEligibility, false, `case ${i}`);
    assert.equal(result.assignmentAuthority, false, `case ${i}`);
    assert.equal(result.skillEvidence, null, `case ${i}`);
  }
});
