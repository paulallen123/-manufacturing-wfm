'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { DatabaseSync } = require('node:sqlite');
const { generateKeyPairSync, sign, randomBytes } = require('node:crypto');
const { createProofRunnerAuth, canonicalAssertion } = require('../proof-runner-auth.cjs');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-auth-review-'));
  const dbPath = path.join(dir, 'db.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=0;
    CREATE TABLE users(email TEXT PRIMARY KEY, tenant TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL REFERENCES users(email),expires INTEGER NOT NULL);
    INSERT INTO users VALUES('review@example.test','tenant-a','manager');`);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const origin = 'https://review.vector.test';
  const auth = createProofRunnerAuth({ dbPath, hosted:true, nodeEnv:'staging', enabled:true,
    publicOrigin:origin, publicKey, allowedEmails:['review@example.test'] });
  const now = Date.now();
  const payload = { email:'review@example.test', origin, nonce:randomBytes(24).toString('base64url'),
    issuedAt:now, expiresAt:now + 60_000 };
  payload.signature = sign(null, Buffer.from(canonicalAssertion(payload)), privateKey).toString('base64url');
  async function invoke() {
    const req = Readable.from([JSON.stringify(payload)]);
    req.method = 'POST'; req.url = '/api/proof-runner/session';
    req.headers = { origin, 'x-forwarded-proto':'https' };
    const res = { statusCode:200, headers:{}, setHeader(k,v) { this.headers[k]=v; },
      end(value) { this.body=value; this.writableEnded=true; } };
    await auth.handleRequest(req,res);
    return res;
  }
  return { db, invoke, close() { auth.close(); db.close(); fs.rmSync(dir,{recursive:true,force:true}); } };
}

function noCredentials(f,res,status) {
  assert.equal(res.statusCode,status);
  assert.equal(res.headers['Set-Cookie'],undefined);
  for(const table of ['sessions','proof_runner_sessions','proof_runner_nonces']) {
    assert.equal(f.db.prepare('SELECT count(*) n FROM '+table).get().n,0);
  }
}

test('missing principal releases transaction and leaves nonce usable after identity correction', async () => {
  const f=fixture();
  try {
    f.db.exec('DELETE FROM users');
    noCredentials(f,await f.invoke(),403);
    f.db.exec("INSERT INTO users VALUES('review@example.test','tenant-a','manager')");
    assert.equal((await f.invoke()).statusCode,200);
  } finally { f.close(); }
});

for(const failAudit of [false,true]) {
  test('same-tenant ambiguity remains refused and recoverable; failed audit='+failAudit,async () => {
    const f=fixture();
    try {
      f.db.exec("INSERT INTO users VALUES('REVIEW@EXAMPLE.TEST','tenant-a','manager')");
      if(failAudit) f.db.exec("CREATE TRIGGER block_audit BEFORE INSERT ON proof_runner_auth_events BEGIN SELECT RAISE(ABORT,'test audit unavailable'); END;");
      noCredentials(f,await f.invoke(),409);
      f.db.exec("DELETE FROM users WHERE email='REVIEW@EXAMPLE.TEST'");
      if(failAudit) f.db.exec('DROP TRIGGER block_audit');
      assert.equal((await f.invoke()).statusCode,200);
    } finally { f.close(); }
  });
}

test('busy issuance lock refuses without escaping exception and permits retry once released',async () => {
  const f=fixture();
  try {
    f.db.exec('BEGIN IMMEDIATE');
    noCredentials(f,await f.invoke(),503);
    f.db.exec('ROLLBACK');
    assert.equal((await f.invoke()).statusCode,200);
  } finally { try { f.db.exec('ROLLBACK'); } catch {} f.close(); }
});
