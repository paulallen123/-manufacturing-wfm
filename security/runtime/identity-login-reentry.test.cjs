'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createIdentitySurvivalGuard, FORBIDDEN_IDENTITY_HEADERS } = require('./identity-survival-guard.cjs');
const hash = s => createHash('sha256').update(s).digest('hex');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-login-reentry-'));
  const dbPath = path.join(dir, 'auth.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT); CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);');
  db.prepare('INSERT INTO users VALUES(?,?,?)').run('employee@alpha.test', 'alpha', 'employee');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash('expired'), 'employee@alpha.test', Date.now() - 1000);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash('active'), 'employee@alpha.test', Date.now() + 60000);
  const guard = createIdentitySurvivalGuard({ dbPath });
  t.after(() => { guard.securityControlForTests().db.close(); db.close(); fs.rmSync(dir, { recursive:true, force:true }); });
  return {db, guard};
}
function response() { return {statusCode:200, headers:{}, setHeader(k,v){this.headers[k]=v;}, end(v){this.body=v;this.writableEnded=true;}}; }
function request(url, token='expired', method='POST', headers={}) { return {url,method,headers:{cookie:'wfm_session='+token,...headers}}; }
for (const url of ['/api/login', '/api/logout']) {
  test(`${url} reaches the sealed authentication handler despite an expired cookie`, t => {
    const {db,guard} = fixture(t), res = response();
    assert.equal(guard.beforeRequest(request(url),res), false);
    assert.equal(res.writableEnded, undefined);
    assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get().n,2, 'guard must not create a replacement session');
  });
}
test('unknown and security-revoked cookies cannot deadlock a fresh login', t => {
  const {guard}=fixture(t);
  assert.equal(guard.beforeRequest(request('/api/state','active','GET'),response()),false);
  guard.securityControlForTests().bumpEpoch('alpha');
  for (const token of ['unknown','active']) assert.equal(guard.beforeRequest(request('/api/login',token),response()),false);
});
test('login re-entry never exempts protected APIs or lookalike routes',t=>{
  const {guard}=fixture(t);
  for (const url of ['/api/state','/api/command','/api/payroll','/api/login/other','/api/login?next=/api/command']) {
    const res=response();assert.equal(guard.beforeRequest(request(url),res),true);assert.equal(res.statusCode,401);
  }
  const res=response();assert.equal(guard.beforeRequest(request('/api/login','expired','GET'),res),true);assert.equal(res.statusCode,401);
});
test('all forged identity headers are still rejected at login and logout', t=>{
  const {guard}=fixture(t);
  for(const url of ['/api/login','/api/logout']) for(const header of FORBIDDEN_IDENTITY_HEADERS){
    const res=response();assert.equal(guard.beforeRequest(request(url,'expired','POST',{[header]:'forged'}),res),true);assert.equal(res.statusCode,400);
  }
});
test('security holds and tenant revocation continue protecting business writes',t=>{
  const {guard}=fixture(t);
  assert.equal(guard.beforeRequest(request('/api/state','active','GET'),response()),false);
  guard.securityControlForTests().setFreeze('alpha',true);
  let res=response();assert.equal(guard.beforeRequest(request('/api/command','active'),res),true);assert.equal(res.statusCode,403);
  guard.securityControlForTests().bumpPolicy('alpha');
  res=response();assert.equal(guard.beforeRequest(request('/api/state','active','GET'),res),true);assert.equal(res.statusCode,401);
});
