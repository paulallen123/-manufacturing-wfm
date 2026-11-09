'use strict';

// Local executable design only. Every key, identity, approval and row below is
// generated for this test; none is an approval for a hosted business action.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { canonicalGrant, verifyGrant, CLAIM_FIELDS } = require('./proof-action-grant-contract.cjs');

const now = Date.parse('2026-10-30T12:00:00Z');
function fixture() {
  const approval = crypto.generateKeyPairSync('ed25519');
  const login = crypto.generateKeyPairSync('ed25519');
  const claims = {
    schema: 1, issuer: 'vector-proof-action-approval', audience: 'vector-synthetic-leave-decision',
    grantId: 'fixture-grant-000000000000000000001', approvalRecordId: 'fixture-review-1',
    action: 'approve-synthetic-leave', issuedAt: now - 1000, expiresAt: now + 60000,
    origin: 'https://fixture.invalid', tenant: 'fixture-tenant',
    managerEmail: 'manager@fixture.invalid', managerPersonId: 'fixture-manager',
    employeeEmail: 'employee@fixture.invalid', employeePersonId: 'fixture-employee',
    sourceSha: 'a'.repeat(40), deploymentId: 'fixture-deployment', runId: 'fixture-run',
    configurationDigest: 'b'.repeat(64), fixtureId: 'fixture-provenance', fixtureDigest: 'c'.repeat(64),
    requestId: 'fixture-request', date: '2026-11-02', hours: 8,
    periodStart: '2026-11-02', periodEnd: '2026-11-08', expectedVersion: 7, decision: 'approved',
  };
  const context = {
    ...claims, fixtureOnly: true, productionApproved: false,
    providerActionsEnabled: false, customerActionsEnabled: false,
    syntheticRequest: true, requestStatus: 'pending', managerRole: 'manager',
    managerSessionIssuer: 'wfm-proof-runner', managerSessionExpiresAt: now + 120000,
    managerMayReviewRequest: true, approvalRecordStatus: 'APPROVED', approvalRevoked: false,
    approvalRecordExpiresAt: claims.expiresAt,
    approvedGrantDigest: crypto.createHash('sha256').update(canonicalGrant(claims)).digest('hex'),
  };
  function sign(input = claims, key = approval.privateKey) {
    return { claims: structuredClone(input), signature: crypto.sign(null, canonicalGrant(input), key).toString('base64url') };
  }
  const options = { approvalPublicKey: approval.publicKey, proofLoginPublicKey: login.publicKey, now };
  return { approval, login, claims, context, sign, options };
}

test('the local signed fixture verifies exact scope without authorizing a hosted action', () => {
  const f = fixture();
  const verified = verifyGrant(f.sign(), f.context, f.options);
  assert.match(verified.grantDigest, /^[a-f0-9]{64}$/);
  assert.equal(verified.grantId, f.claims.grantId);
  assert.equal(verified.productionReady, false);
});

test('env-style self-assertions and missing protected approval key have no authority', () => {
  const f = fixture();
  assert.throws(() => verifyGrant({ ...f.claims, synthetic: true, approvalReference: 'approved' }, f.context, f.options));
  assert.throws(() => verifyGrant(f.sign(), f.context, { ...f.options, approvalPublicKey: undefined }));
  assert.throws(() => verifyGrant(f.sign(), f.context, { ...f.options, proofLoginPublicKey: undefined }));
});

test('proof login key cannot sign approvals or be registered as the approval key', () => {
  const f = fixture();
  assert.throws(() => verifyGrant(f.sign(f.claims, f.login.privateKey), f.context, f.options));
  assert.throws(() => verifyGrant(f.sign(), f.context, { ...f.options, proofLoginPublicKey: f.approval.publicKey }));
});

for (const field of CLAIM_FIELDS) {
  test('every signed claim is required: ' + field, () => {
    const f = fixture();
    const input = { ...f.claims }; delete input[field];
    assert.throws(() => canonicalGrant(input));
  });
}

const scopeFields = ['origin', 'tenant', 'managerEmail', 'managerPersonId', 'employeeEmail', 'employeePersonId',
  'sourceSha', 'deploymentId', 'runId', 'configurationDigest', 'fixtureId', 'fixtureDigest',
  'requestId', 'date', 'hours', 'periodStart', 'periodEnd', 'expectedVersion', 'approvalRecordId'];
for (const field of scopeFields) {
  test('server scope mismatch refuses ' + field, () => {
    const f = fixture();
    const value = f.context[field];
    const changed = typeof value === 'number' ? value + 1 : value + '-changed';
    assert.throws(() => verifyGrant(f.sign(), { ...f.context, [field]: changed }, f.options));
  });
}

for (const [field, value] of [
  ['fixtureOnly', false], ['productionApproved', true], ['providerActionsEnabled', true],
  ['customerActionsEnabled', true], ['syntheticRequest', false], ['requestStatus', 'approved'],
  ['managerRole', 'employee'], ['managerSessionIssuer', 'other'], ['managerSessionExpiresAt', now],
  ['managerMayReviewRequest', false],
  ['approvalRecordStatus', 'DRAFT'], ['approvalRevoked', true], ['approvalRecordExpiresAt', now],
  ['approvedGrantDigest', 'd'.repeat(64)],
]) {
  test('server boundary must be closed: ' + field, () => {
    const f = fixture();
    assert.throws(() => verifyGrant(f.sign(), { ...f.context, [field]: value }, f.options));
  });
}

test('claims reject unknown fields, malformed types, newline values and invalid dates', () => {
  const f = fixture();
  for (const patch of [
    { customerWrites: true }, { action: 'payroll-submit' }, { expectedVersion: '7' },
    { expectedVersion: Number.MAX_SAFE_INTEGER }, { expectedVersion: Number.MAX_SAFE_INTEGER + 1 },
    { hours: Infinity }, { hours: 0 }, { hours: 0.25 }, { hours: 13 }, { hours: 1.001 },
    { tenant: 'fixture\nforged' }, { date: '2026-02-30' }, { origin: 'https://fixture.invalid/path' },
    { schema: '1' }, { synthetic: true }, { managerEmail: 'Manager@fixture.invalid' },
    { periodStart: '2026-11-03' }, { periodEnd: '2026-11-01' },
  ]) assert.throws(() => canonicalGrant({ ...f.claims, ...patch }));
});

test('no expiry skew or lifetime widening is allowed', () => {
  const f = fixture();
  for (const patch of [
    { issuedAt: now + 1 }, { expiresAt: now }, { expiresAt: now - 1 },
    { issuedAt: now - 1800001, expiresAt: now + 1 },
  ]) assert.throws(() => verifyGrant(f.sign({ ...f.claims, ...patch }), f.context, f.options));
  assert.throws(() => canonicalGrant({ ...f.claims, issuedAt: NaN }));
  assert.throws(() => verifyGrant(f.sign(), f.context, { ...f.options, now: now + 60000 }));
});

test('tampering, noncanonical signatures and unexpected envelope properties fail closed', () => {
  const f = fixture();
  const signed = f.sign(); signed.claims.requestId = 'other-request';
  assert.throws(() => verifyGrant(signed, { ...f.context, requestId: 'other-request' }, f.options));
  for (const signature of ['', 'A'.repeat(86), f.sign().signature + '=', 'not a signature']) {
    assert.throws(() => verifyGrant({ claims: f.claims, signature }, f.context, f.options));
  }
  assert.throws(() => verifyGrant({ ...f.sign(), approved: true }, f.context, f.options));
});

// A deliberately local, same-database model demonstrates the required command
// transaction. It is not imported by the app, browser runner or deploy wrapper.
function localAtomicModel(f) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE request (id TEXT PRIMARY KEY, status TEXT, version INTEGER);
    CREATE TABLE current_server_context (id INTEGER PRIMARY KEY, context_json TEXT NOT NULL);
    CREATE TABLE protected_approval (id TEXT PRIMARY KEY, digest TEXT NOT NULL, status TEXT NOT NULL, revoked INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE consumed (grant_id TEXT PRIMARY KEY, digest TEXT NOT NULL);
    CREATE TABLE audit (grant_id TEXT UNIQUE, request_id TEXT, manager_id TEXT);
    CREATE TRIGGER no_audit_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'Append only'); END;
    CREATE TRIGGER no_audit_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'Append only'); END;
    CREATE TRIGGER no_consumed_update BEFORE UPDATE ON consumed BEGIN SELECT RAISE(ABORT,'Append only'); END;
    CREATE TRIGGER no_consumed_delete BEFORE DELETE ON consumed BEGIN SELECT RAISE(ABORT,'Append only'); END;
    INSERT INTO request VALUES('fixture-request','pending',7);`);
  // These fictional persisted rows stand in for the missing protected issuer
  // and server adapter. A production issuer/adapter is not created by this seed.
  db.prepare('INSERT INTO current_server_context VALUES(1,?)').run(JSON.stringify(f.context));
  db.prepare('INSERT INTO protected_approval VALUES(?,?,?,?,?)').run(f.context.approvalRecordId,
    f.context.approvedGrantDigest, f.context.approvalRecordStatus, Number(f.context.approvalRevoked), f.context.approvalRecordExpiresAt);
  function act(envelope, { clock = () => now, failAudit = false } = {}) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const request = db.prepare('SELECT * FROM request').get();
      const stored = JSON.parse(db.prepare('SELECT context_json FROM current_server_context WHERE id=1').get().context_json);
      const approved = db.prepare('SELECT * FROM protected_approval WHERE id=?').get(stored.approvalRecordId);
      if (!approved) throw new Error('Protected fixture approval absent');
      const current = { ...stored, requestId: request.id, requestStatus: request.status, expectedVersion: request.version,
        approvalRecordId: approved.id, approvalRecordStatus: approved.status, approvalRevoked: approved.revoked !== 0,
        approvalRecordExpiresAt: approved.expires, approvedGrantDigest: approved.digest };
      // Recheck expiry inside the same synchronous transaction immediately before
      // state writes. No network, browser callback, promise or provider call here.
      const grant = verifyGrant(envelope, current, { ...f.options, now: clock() });
      db.prepare('INSERT INTO consumed VALUES(?,?)').run(grant.grantId, grant.grantDigest);
      const result = db.prepare("UPDATE request SET status='approved', version=version+1 WHERE id=? AND version=? AND status='pending'")
        .run(current.requestId, current.expectedVersion);
      assert.equal(result.changes, 1);
      if (failAudit) throw new Error('fixture audit failed');
      db.prepare('INSERT INTO audit VALUES(?,?,?)').run(grant.grantId, current.requestId, current.managerPersonId);
      db.exec('COMMIT');
      return grant;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return { db, act };
}

test('local transaction couples consume, exact version transition and audit; response loss cannot replay', t => {
  const f = fixture(), model = localAtomicModel(f); t.after(() => model.db.close());
  const signed = f.sign();
  model.act(signed); // Model a committed action whose HTTP response was lost.
  assert.throws(() => model.act(signed));
  assert.equal(model.db.prepare('SELECT count(*) AS n FROM consumed').get().n, 1);
  assert.equal(model.db.prepare('SELECT count(*) AS n FROM audit').get().n, 1);
  assert.deepEqual({ ...model.db.prepare('SELECT status,version FROM request').get() }, { status: 'approved', version: 8 });
});

test('failed audit rolls back consumption and business state; expiry is checked at action time', t => {
  const f = fixture(), model = localAtomicModel(f); t.after(() => model.db.close());
  const signed = f.sign();
  assert.throws(() => model.act(signed, { failAudit: true }));
  assert.equal(model.db.prepare('SELECT count(*) AS n FROM consumed').get().n, 0);
  assert.deepEqual({ ...model.db.prepare('SELECT status,version FROM request').get() }, { status: 'pending', version: 7 });
  assert.throws(() => model.act(signed, { clock: () => now + 60000 }));
  assert.equal(model.db.prepare('SELECT count(*) AS n FROM audit').get().n, 0);
});

test('a new grant cannot authorize a stale request version', t => {
  const f = fixture(), model = localAtomicModel(f); t.after(() => model.db.close());
  model.act(f.sign());
  const renewed = f.sign({ ...f.claims, grantId: 'fixture-grant-000000000000000000002' });
  assert.throws(() => model.act(renewed));
  assert.equal(model.db.prepare('SELECT count(*) AS n FROM consumed').get().n, 1);
});

test('protected approval is reloaded inside the transaction and cannot be supplied by a caller', t => {
  const f = fixture(), model = localAtomicModel(f); t.after(() => model.db.close());
  const signed = f.sign();
  model.db.prepare('UPDATE protected_approval SET revoked=1').run();
  // f.context still looks approved; this old snapshot must have no effect.
  assert.equal(f.context.approvalRevoked, false);
  assert.throws(() => model.act(signed));
  assert.equal(model.db.prepare('SELECT count(*) AS n FROM consumed').get().n, 0);
  assert.equal(model.db.prepare('SELECT count(*) AS n FROM audit').get().n, 0);
});

test('consumption survives business-state reset and business audit is append only', t => {
  const f = fixture(), model = localAtomicModel(f); t.after(() => model.db.close());
  const signed = f.sign(); model.act(signed);
  // Controlled corruption in this local fixture proves the independent unique
  // consumption constraint also prevents replay after business state is reset.
  model.db.exec("UPDATE request SET status='pending',version=7");
  assert.throws(() => model.act(signed), /UNIQUE/);
  assert.throws(() => model.db.exec('DELETE FROM audit'), /Append only/);
  assert.throws(() => model.db.exec('UPDATE consumed SET digest=\'other\''), /Append only/);
  assert.equal(model.db.prepare('SELECT count(*) AS n FROM audit').get().n, 1);
});
