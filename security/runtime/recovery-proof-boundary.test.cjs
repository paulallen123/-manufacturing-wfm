'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createRecoveryProofBoundary } = require('./recovery-proof-boundary.cjs');

const SHA = '7d9cc3645f96994df7a4aeed3e2163b54b737059';
const DEPLOYMENT = '52076e88-9051-4740-a448-b5788e26235f';
const TENANT = 'northstar-demo';
const RUN = '09c83c6c-ddc6-4ba7-b8aa-adaa5d80295e';
const EMAIL = 'superuser@northstar.example';
const TOKEN = 'proof-session-token-0123456789abcdef';
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-recovery-proof-boundary-'));
  const dbPath = path.join(dir, 'state.sqlite');
  const db = new DatabaseSync(dbPath);
  const now = 1_000_000;
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE tenants(id TEXT PRIMARY KEY);
    CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL);
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE proof_runner_sessions(
      token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,tenant TEXT NOT NULL,role TEXT NOT NULL,
      issued_at INTEGER NOT NULL,expires INTEGER NOT NULL
    );
    CREATE TABLE identity_session_bindings(
      token_hash TEXT PRIMARY KEY,tenant TEXT NOT NULL,issuer TEXT NOT NULL,audience TEXT NOT NULL,
      session_epoch INTEGER NOT NULL,policy_version INTEGER NOT NULL,bound_at TEXT NOT NULL
    );
  `);
  db.prepare('INSERT INTO tenants VALUES(?)').run(TENANT);
  db.prepare('INSERT INTO users VALUES(?,?,?)').run(EMAIL,TENANT,'superuser');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(TOKEN_HASH,EMAIL,now + 60_000);
  db.prepare('INSERT INTO proof_runner_sessions VALUES(?,?,?,?,?,?)').run(TOKEN_HASH,EMAIL,TENANT,'superuser',now - 1000,now + 60_000);
  db.prepare('INSERT INTO identity_session_bindings VALUES(?,?,?,?,?,?,?)')
    .run(TOKEN_HASH,TENANT,'wfm-proof-runner','wfm-api',1,1,new Date(now).toISOString());
  db.close();

  const make = () => createRecoveryProofBoundary({
    dbPath,
    expected:{candidateSha:SHA,deploymentId:DEPLOYMENT,tenant:TENANT,runId:RUN},
    buildSha:SHA,
    now:()=>now,
  });
  return {
    dir,dbPath,now,make,
    req(token=TOKEN){return {headers:{cookie:'wfm_session='+token}};},
    input(overrides={}){return {
      candidateSha:SHA,deploymentId:DEPLOYMENT,tenant:TENANT,runId:RUN,
      proofKey:'recovery-proof-key-0001',
      fault:'synthetic-canary-verification-failure',
      ...overrides,
    };},
    db(){return new DatabaseSync(dbPath);},
    clean(){fs.rmSync(dir,{recursive:true,force:true});}
  };
}

test('proof-runner session authorizes only the bound synthetic proof and grants no recovery authority',()=>{
  const f=fixture(),boundary=f.make();
  try{
    const out=boundary.authorize(f.req(),f.input());
    assert.equal(out.status,'authorized');
    assert.equal(out.actor.tenant,TENANT);
    assert.equal(out.recoveryAuthorityGranted,false);
    assert.equal(out.productionAuthorityGranted,false);
    assert.equal(out.customerMutation,false);
    assert.deepEqual(boundary.expectedBinding,{candidateSha:SHA,deploymentId:DEPLOYMENT,tenant:TENANT,runId:RUN});
    assert.equal(boundary.capabilities().recoveryAuthority,false);
  }finally{boundary.close();f.clean();}
});

test('same proof request replays but changed payload under the proof key is denied',()=>{
  const f=fixture(),boundary=f.make();
  try{
    assert.equal(boundary.authorize(f.req(),f.input()).status,'authorized');
    assert.equal(boundary.authorize(f.req(),f.input()).status,'replay');
    assert.throws(()=>boundary.authorize(f.req(),f.input({fault:'synthetic-worker-unhealthy'})),e=>e.code==='WFM_RECOVERY_PROOF_CONFLICT');
  }finally{boundary.close();f.clean();}
});

for(const [name,edit,code] of [
  ['candidate SHA',i=>i.candidateSha='a'.repeat(40),'WFM_RECOVERY_PROOF_BINDING'],
  ['deployment',i=>i.deploymentId='wrong-deployment-0000','WFM_RECOVERY_PROOF_BINDING'],
  ['tenant',i=>i.tenant='other-tenant','WFM_RECOVERY_PROOF_BINDING'],
  ['run',i=>i.runId='other-run','WFM_RECOVERY_PROOF_BINDING'],
]){
  test('wrong '+name+' fails before proof authorization',()=>{
    const f=fixture(),boundary=f.make();
    try{const input=f.input();edit(input);assert.throws(()=>boundary.authorize(f.req(),input),e=>e.code===code);}
    finally{boundary.close();f.clean();}
  });
}

test('ordinary non-proof session cannot access recovery proof boundary',()=>{
  const f=fixture();
  const db=f.db();
  db.prepare('DELETE FROM proof_runner_sessions').run();
  db.close();
  const boundary=f.make();
  try{assert.throws(()=>boundary.authorize(f.req(),f.input()),e=>e.code==='WFM_RECOVERY_PROOF_SESSION');}
  finally{boundary.close();f.clean();}
});

for(const mutation of [
  db=>db.prepare('UPDATE identity_session_bindings SET issuer=?').run('wfm-local-auth'),
  db=>db.prepare('UPDATE identity_session_bindings SET audience=?').run('wrong-audience'),
  db=>db.prepare('UPDATE users SET role=? WHERE email=?').run('payroll',EMAIL),
  db=>db.prepare('UPDATE proof_runner_sessions SET expires=?').run(999999),
]){
  test('proof identity drift fails closed',()=>{
    const f=fixture(),db=f.db();mutation(db);db.close();const boundary=f.make();
    try{assert.throws(()=>boundary.authorize(f.req(),f.input()),e=>e.code==='WFM_RECOVERY_PROOF_SESSION');}
    finally{boundary.close();f.clean();}
  });
}

test('unsupported or caller-defined faults are denied',()=>{
  const f=fixture(),boundary=f.make();
  try{assert.throws(()=>boundary.authorize(f.req(),f.input({fault:'release.rollback'})),e=>e.code==='WFM_RECOVERY_PROOF_FAULT');}
  finally{boundary.close();f.clean();}
});

test('audit failure rolls back proof request admission and clean retry succeeds',()=>{
  const f=fixture(),boundary=f.make(),db=f.db();
  try{
    db.exec("CREATE TRIGGER recovery_proof_audit_outage BEFORE INSERT ON recovery_proof_events BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");
    assert.throws(()=>boundary.authorize(f.req(),f.input()),/audit unavailable/);
    assert.equal(db.prepare('SELECT count(*) n FROM recovery_proof_requests').get().n,0);
    db.exec('DROP TRIGGER recovery_proof_audit_outage');
    assert.equal(boundary.authorize(f.req(),f.input()).status,'authorized');
  }finally{db.close();boundary.close();f.clean();}
});

test('constructor refuses source drift before serving proof requests',()=>{
  const f=fixture();
  try{
    assert.throws(()=>createRecoveryProofBoundary({
      dbPath:f.dbPath,
      expected:{candidateSha:SHA,deploymentId:DEPLOYMENT,tenant:TENANT,runId:RUN},
      buildSha:'a'.repeat(40),
      now:()=>f.now,
    }),e=>e.code==='WFM_RECOVERY_PROOF_BUILD');
  }finally{f.clean();}
});
