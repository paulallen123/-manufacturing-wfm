'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createIdentitySurvivalGuard } = require('./identity-survival-guard.cjs');

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-id-guard-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const setup = new DatabaseSync(dbPath);
  setup.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE tenants(id TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL);
    CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL REFERENCES tenants(id),person_id TEXT NOT NULL,role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,permissions TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL REFERENCES users(email),expires INTEGER NOT NULL);
  `);
  setup.prepare('INSERT INTO tenants VALUES(?,?,?)').run('alpha', 1, '{}');
  setup.prepare('INSERT INTO tenants VALUES(?,?,?)').run('bravo', 1, '{}');
  setup.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('manager@alpha','alpha','m1','manager',1,'s','00','[]');
  setup.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('employee@alpha','alpha','e1','employee',0,'s','00','[]');
  setup.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('manager@bravo','bravo','m1','manager',1,'s','00','[]');
  const tokens = { alphaManager: 'a'.repeat(64), alphaEmployee: 'b'.repeat(64), bravoManager: 'c'.repeat(64) };
  const expires = Date.now() + 60_000;
  setup.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(tokens.alphaManager),'manager@alpha',expires);
  setup.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(tokens.alphaEmployee),'employee@alpha',expires);
  setup.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(tokens.bravoManager),'manager@bravo',expires);
  setup.close();

  const guard = createIdentitySurvivalGuard({ dbPath });
  const control = guard.securityControlForTests();
  return {
    dir, dbPath, guard, control, tokens,
    close() {
      try { control.db.close(); } catch {}
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

function req(token, { method='GET', url='/api/state', headers={} } = {}) {
  return { method, url, headers: { ...(token ? { cookie: `wfm_session=${token}` } : {}), ...headers } };
}

function res() {
  const headers = {};
  return {
    headersSent: false,
    writableEnded: false,
    statusCode: 200,
    body: '',
    setHeader(k,v){ headers[String(k).toLowerCase()] = v; },
    end(v=''){ this.body = String(v); this.writableEnded = true; this.headersSent = true; },
    headers
  };
}

function activeSession(db, token) {
  return db.prepare('SELECT token_hash FROM sessions WHERE token_hash=?').get(tokenHash(token));
}

test('valid authenticated session is resource-bound and allowed', () => {
  const f = fixture();
  try {
    const response = res();
    assert.equal(f.guard.beforeRequest(req(f.tokens.alphaManager), response), false);
    const binding = f.control.db.prepare('SELECT * FROM identity_session_bindings WHERE token_hash=?').get(tokenHash(f.tokens.alphaManager));
    assert.equal(binding.tenant, 'alpha');
    assert.equal(binding.issuer, 'wfm-local-auth');
    assert.equal(binding.audience, 'wfm-api');
    assert.equal(binding.session_epoch, 1);
    assert.equal(binding.policy_version, 1);
  } finally { f.close(); }
});

test('client-supplied tenant or role authority is rejected before application code', () => {
  const f = fixture();
  try {
    for (const header of ['x-wfm-tenant','x-wfm-role','x-wfm-issuer','x-wfm-audience']) {
      const response = res();
      assert.equal(f.guard.beforeRequest(req(f.tokens.alphaManager,{headers:{[header]:'attacker-value'}}), response), true);
      assert.equal(response.statusCode, 400);
    }
  } finally { f.close(); }
});

test('stale tenant session epoch self-revokes only the presented session', () => {
  const f = fixture();
  try {
    assert.equal(f.guard.beforeRequest(req(f.tokens.alphaManager), res()), false);
    assert.equal(f.guard.beforeRequest(req(f.tokens.bravoManager), res()), false);
    f.control.bumpEpoch('alpha');
    const response = res();
    assert.equal(f.guard.beforeRequest(req(f.tokens.alphaManager), response), true);
    assert.equal(response.statusCode, 401);
    assert.equal(activeSession(f.control.db, f.tokens.alphaManager), undefined);
    assert.ok(activeSession(f.control.db, f.tokens.bravoManager), 'other customer cell must remain active');
  } finally { f.close(); }
});

test('tampered cross-tenant binding is contained and session revoked', () => {
  const f = fixture();
  try {
    assert.equal(f.guard.beforeRequest(req(f.tokens.alphaManager), res()), false);
    f.control.db.prepare('UPDATE identity_session_bindings SET tenant=? WHERE token_hash=?')
      .run('bravo', tokenHash(f.tokens.alphaManager));
    const response = res();
    assert.equal(f.guard.beforeRequest(req(f.tokens.alphaManager), response), true);
    assert.equal(response.statusCode, 401);
    assert.equal(activeSession(f.control.db, f.tokens.alphaManager), undefined);
    const event = f.control.db.prepare("SELECT event FROM identity_guard_events WHERE event='session-binding-mismatch-contained' ORDER BY id DESC LIMIT 1").get();
    assert.equal(event.event, 'session-binding-mismatch-contained');
  } finally { f.close(); }
});

test('privileged freeze blocks manager mutation but preserves employee low-risk path and other tenant', () => {
  const f = fixture();
  try {
    assert.equal(f.guard.beforeRequest(req(f.tokens.alphaManager), res()), false);
    assert.equal(f.guard.beforeRequest(req(f.tokens.alphaEmployee), res()), false);
    assert.equal(f.guard.beforeRequest(req(f.tokens.bravoManager), res()), false);
    f.control.setFreeze('alpha', true);

    const managerMutation = res();
    assert.equal(f.guard.beforeRequest(req(f.tokens.alphaManager,{method:'POST',url:'/api/command'}), managerMutation), true);
    assert.equal(managerMutation.statusCode, 403);

    const employeeRead = res();
    assert.equal(f.guard.beforeRequest(req(f.tokens.alphaEmployee,{method:'GET',url:'/api/state'}), employeeRead), false);

    const otherTenant = res();
    assert.equal(f.guard.beforeRequest(req(f.tokens.bravoManager,{method:'POST',url:'/api/command'}), otherTenant), false);
  } finally { f.close(); }
});

test('policy version change forces re-authentication rather than silently changing authority', () => {
  const f = fixture();
  try {
    assert.equal(f.guard.beforeRequest(req(f.tokens.alphaManager), res()), false);
    f.control.bumpPolicy('alpha');
    const response = res();
    assert.equal(f.guard.beforeRequest(req(f.tokens.alphaManager), response), true);
    assert.equal(response.statusCode, 401);
    assert.equal(activeSession(f.control.db, f.tokens.alphaManager), undefined);
  } finally { f.close(); }
});

test('unknown or expired bearer is denied before the application', () => {
  const f = fixture();
  try {
    const response = res();
    assert.equal(f.guard.beforeRequest(req('d'.repeat(64)), response), true);
    assert.equal(response.statusCode, 401);
  } finally { f.close(); }
});


test('revocable mobile bearer inherits the same tenant binding and is translated only after guard approval', () => {
  const f = fixture();
  try {
    const token = 'vmb_' + 'm'.repeat(48);
    const hash = tokenHash(token);
    const expires = Date.now() + 60_000;
    f.control.db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)').run(hash,'manager@alpha',expires);
    f.control.db.prepare('INSERT INTO mobile_device_sessions(token_hash,email,tenant,expires,created_at,revoked_at) VALUES(?,?,?,?,?,NULL)')
      .run(hash,'manager@alpha','alpha',expires,new Date().toISOString());

    const request = req(null,{headers:{authorization:'Bearer '+token}});
    const response = res();
    assert.equal(f.guard.beforeRequest(request,response),false);
    assert.equal(request.headers.cookie,'wfm_session='+token);
    const binding = f.control.db.prepare('SELECT tenant FROM identity_session_bindings WHERE token_hash=?').get(hash);
    assert.equal(binding.tenant,'alpha');
  } finally { f.close(); }
});

test('revoked or mismatched mobile bearer is denied before application code', () => {
  const f = fixture();
  try {
    const token = 'vmb_' + 'n'.repeat(48);
    const hash = tokenHash(token);
    const expires = Date.now() + 60_000;
    f.control.db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)').run(hash,'manager@alpha',expires);
    f.control.db.prepare('INSERT INTO mobile_device_sessions(token_hash,email,tenant,expires,created_at,revoked_at) VALUES(?,?,?,?,?,?)')
      .run(hash,'manager@alpha','alpha',expires,new Date().toISOString(),new Date().toISOString());
    const response = res();
    assert.equal(f.guard.beforeRequest(req(null,{headers:{authorization:'Bearer '+token}}),response),true);
    assert.equal(response.statusCode,401);
  } finally { f.close(); }
});

test('conflicting cookie and mobile bearer authorities fail closed', () => {
  const f = fixture();
  try {
    const token = 'vmb_' + 'p'.repeat(48);
    const response = res();
    const request = req(f.tokens.alphaManager,{headers:{authorization:'Bearer '+token}});
    assert.equal(f.guard.beforeRequest(request,response),true);
    assert.equal(response.statusCode,400);
  } finally { f.close(); }
});


test('consumed stale login cookie cannot block a valid mobile bearer', () => {
  const f = fixture();
  try {
    const mobile = 'vmb_' + 'q'.repeat(48);
    const hash = tokenHash(mobile);
    const expires = Date.now() + 60_000;
    f.control.db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)').run(hash,'manager@alpha',expires);
    f.control.db.prepare('INSERT INTO mobile_device_sessions(token_hash,email,tenant,expires,created_at,revoked_at) VALUES(?,?,?,?,?,NULL)')
      .run(hash,'manager@alpha','alpha',expires,new Date().toISOString());
    f.control.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(f.tokens.alphaManager));
    const request = req(f.tokens.alphaManager,{headers:{authorization:'Bearer '+mobile}});
    assert.equal(f.guard.beforeRequest(request,res()),false);
    assert.equal(request.headers.cookie,'wfm_session='+mobile);
  } finally { f.close(); }
});
