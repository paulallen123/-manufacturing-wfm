'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const contractPath = path.resolve(process.env.PROOF_GRANT_CONTRACT || 'proof-scope-unblock/test-only/proof-action-grant-contract.cjs');
const contract = require(contractPath);
const now = Date.parse('2026-10-30T18:30:00Z');
function fixture() {
  const approval = crypto.generateKeyPairSync('ed25519'), login = crypto.generateKeyPairSync('ed25519');
  const claims = { schema: 1, issuer: 'vector-proof-action-approval', audience: 'vector-synthetic-leave-decision',
    grantId: 'heldout-grant-000000000000000000000000000001', approvalRecordId: 'heldout-owner-review-7',
    action: 'approve-synthetic-leave', issuedAt: now - 5000, expiresAt: now + 90000,
    origin: 'https://independent-proof.invalid', tenant: 'independent-tenant',
    managerEmail: 'reviewer@independent.invalid', managerPersonId: 'reviewer-person-81',
    employeeEmail: 'worker@independent.invalid', employeePersonId: 'worker-person-26',
    sourceSha: 'd'.repeat(40), deploymentId: 'independent-deployment', runId: 'independent-run',
    configurationDigest: 'e'.repeat(64), fixtureId: 'independent-approved-cohort', fixtureDigest: 'f'.repeat(64),
    requestId: 'independent-pending-leave', date: '2026-11-17', hours: 7.5,
    periodStart: '2026-11-16', periodEnd: '2026-11-22', expectedVersion: 81, decision: 'approved' };
  const context = { ...claims, fixtureOnly: true, productionApproved: false,
    providerActionsEnabled: false, customerActionsEnabled: false, syntheticRequest: true,
    requestStatus: 'pending', managerRole: 'manager', managerSessionIssuer: 'wfm-proof-runner',
    managerSessionExpiresAt: now + 120000, managerMayReviewRequest: true,
    approvalRecordStatus: 'APPROVED', approvalRevoked: false,
    approvalRecordExpiresAt: claims.expiresAt,
    approvedGrantDigest: crypto.createHash('sha256').update(contract.canonicalGrant(claims)).digest('hex') };
  const options = { approvalPublicKey: approval.publicKey, proofLoginPublicKey: login.publicKey, now };
  const sign = (value = claims, signer = approval.privateKey) => ({ claims: structuredClone(value),
    signature: crypto.sign(null, contract.canonicalGrant(value), signer).toString('base64url') });
  return { approval, login, claims, context, options, sign };
}
test('heldout separate authority key and exact server context produce test-only evidence', () => {
  const f = fixture(), result = contract.verifyGrant(f.sign(), f.context, f.options);
  assert.equal(result.productionReady, false); assert.equal(Object.isFrozen(result), true);
  assert.match(result.grantDigest, /^[0-9a-f]{64}$/);
});
for (const field of ['issuedAt', 'expiresAt', 'expectedVersion']) {
  for (const value of [null, true, '81', 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    test('heldout ' + field + ' rejects malformed numeric ' + String(value), () => {
      const f = fixture(); assert.throws(() => contract.canonicalGrant({ ...f.claims, [field]: value }));
    });
  }
}
test('heldout signature from login key remains invalid even with a matched current request', () => {
  const f = fixture(); assert.throws(() => contract.verifyGrant(f.sign(f.claims, f.login.privateKey), f.context, f.options));
});
test('heldout same authority key in separate PEM/KeyObject representations is refused', () => {
  const f = fixture();
  assert.throws(() => contract.verifyGrant(f.sign(), f.context, { ...f.options,
    proofLoginPublicKey: f.approval.publicKey.export({ type: 'spki', format: 'pem' }) }));
});
for (const field of ['tenant', 'managerPersonId', 'employeePersonId', 'sourceSha', 'deploymentId', 'runId',
  'configurationDigest', 'fixtureId', 'fixtureDigest', 'requestId', 'date', 'hours', 'expectedVersion']) {
  test('heldout server-derived ' + field + ' cannot be replaced by a valid unrelated approval', () => {
    const f = fixture(); const value = f.context[field];
    const context = { ...f.context, [field]: typeof value === 'number' ? value + 1 : value + '-other' };
    assert.throws(() => contract.verifyGrant(f.sign(), context, f.options));
  });
}
for (const value of [undefined, 'different-protected-review']) {
  test('heldout missing or substituted server approval record must refuse ' + String(value), () => {
    const f = fixture(), context = { ...f.context }; if (value === undefined) delete context.approvalRecordId;
    else context.approvalRecordId = value;
    assert.throws(() => contract.verifyGrant(f.sign(), context, f.options));
  });
}
for (const status of [undefined, 'pending', 'revoked']) {
  test('heldout unapproved protected record must refuse ' + String(status), () => {
    const f = fixture(), context = { ...f.context }; if (status === undefined) delete context.approvalRecordStatus;
    else context.approvalRecordStatus = status;
    assert.throws(() => contract.verifyGrant(f.sign(), context, f.options));
  });
}
for (const value of [undefined, true, null, 'false']) {
  test('heldout protected approval revocation boundary refuses ' + String(value), () => {
    const f = fixture(), context = { ...f.context }; if (value === undefined) delete context.approvalRevoked;
    else context.approvalRevoked = value;
    assert.throws(() => contract.verifyGrant(f.sign(), context, f.options));
  });
}
for (const value of [undefined, '0'.repeat(64), '']) {
  test('heldout protected approval digest is required and exact: ' + String(value), () => {
    const f = fixture(), context = { ...f.context }; if (value === undefined) delete context.approvedGrantDigest;
    else context.approvedGrantDigest = value;
    assert.throws(() => contract.verifyGrant(f.sign(), context, f.options));
  });
}
for (const value of [undefined, now, now + 90001, String(now + 90000)]) {
  test('heldout protected approval expiry is exact and live: ' + String(value), () => {
    const f = fixture(), context = { ...f.context }; if (value === undefined) delete context.approvalRecordExpiresAt;
    else context.approvalRecordExpiresAt = value;
    assert.throws(() => contract.verifyGrant(f.sign(), context, f.options));
  });
}
test('heldout maximum safe version cannot approve an unrepresentable next revision', () => {
  const f = fixture(); assert.throws(() => contract.canonicalGrant({ ...f.claims, expectedVersion: Number.MAX_SAFE_INTEGER }));
});
for (const hours of [0.1, 12.5, 7.511]) {
  test('heldout out-of-domain leave hours cannot form an approval: ' + hours, () => {
    const f = fixture(); assert.throws(() => contract.canonicalGrant({ ...f.claims, hours }));
  });
}
for (const offset of [90000, 90001, 1800000]) {
  test('heldout grant is expired at dispatch offset ' + offset, () => {
    const f = fixture(); assert.throws(() => contract.verifyGrant(f.sign(), f.context, { ...f.options, now: now + offset }));
  });
}
test('heldout proof session expires independently before grant lifetime', () => {
  const f = fixture(); assert.throws(() => contract.verifyGrant(f.sign(), { ...f.context, managerSessionExpiresAt: now }, f.options));
});
test('heldout a signed claim cannot reopen provider or customer boundaries', () => {
  const f = fixture(); for (const field of ['fixtureOnly', 'productionApproved', 'providerActionsEnabled', 'customerActionsEnabled', 'syntheticRequest']) {
    const context = { ...f.context, [field]: !f.context[field] }; assert.throws(() => contract.verifyGrant(f.sign(), context, f.options));
  }
});
test('heldout local transaction rolls back business and audit together, then blocks committed replay', t => {
  const modelSource = fs.readFileSync(path.join(path.dirname(contractPath), 'proof-action-grant-contract.test.cjs'), 'utf8');
  const begin = modelSource.indexOf('function localAtomicModel('), end = modelSource.indexOf('\n}\n\ntest(', begin) + 2;
  assert.ok(begin >= 0 && end > begin);
  const makeModel = vm.runInNewContext('(' + modelSource.slice(begin, end) + ')', { DatabaseSync,
    verifyGrant: contract.verifyGrant, assert, now });
  const f = fixture(); Object.assign(f.claims, { requestId: 'fixture-request', expectedVersion: 7 });
  Object.assign(f.context, { requestId: 'fixture-request', expectedVersion: 7 });
  f.context.approvedGrantDigest = crypto.createHash('sha256').update(contract.canonicalGrant(f.claims)).digest('hex');
  const model = makeModel(f); t.after(() => model.db.close()); const signed = f.sign();
  assert.throws(() => model.act(signed, { failAudit: true }));
  assert.equal(model.db.prepare('SELECT count(*) n FROM consumed').get().n, 0);
  assert.equal(model.db.prepare('SELECT status FROM request').get().status, 'pending');
  model.act(signed); assert.throws(() => model.act(signed));
  assert.equal(model.db.prepare('SELECT count(*) n FROM consumed').get().n, 1);
  assert.equal(model.db.prepare('SELECT count(*) n FROM audit').get().n, 1);
});
