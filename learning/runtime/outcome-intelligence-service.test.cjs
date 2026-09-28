'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { Readable } = require('node:stream');
const { createOutcomeIntelligenceService } = require('./outcome-intelligence-service.cjs');

function hash(v) { return createHash('sha256').update(String(v)).digest('hex'); }
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-outcomes-'));
  const dbPath = path.join(dir, 'db.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);');
  db.prepare('INSERT INTO users(email,tenant,role) VALUES(?,?,?)').run('manager@alpha','alpha','manager');
  db.prepare('INSERT INTO users(email,tenant,role) VALUES(?,?,?)').run('employee@alpha','alpha','employee');
  db.prepare('INSERT INTO users(email,tenant,role) VALUES(?,?,?)').run('manager@bravo','bravo','manager');
  db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)').run(hash('mgr'),'manager@alpha',Date.now()+60000);
  db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)').run(hash('emp'),'employee@alpha',Date.now()+60000);
  db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)').run(hash('bravo'),'manager@bravo',Date.now()+60000);
  db.close();
  const service = createOutcomeIntelligenceService({ dbPath, internalToken:'learning-token', minRepeatedWins:3 });
  return { dir, dbPath, service, close(){ service.close(); fs.rmSync(dir,{recursive:true,force:true}); } };
}
function outcome(n, delta=10) {
  return {
    tenantScope:'alpha', source:'decision-outcome-proof', category:'planAttainmentPct',
    fingerprint:'absence-recovery:planAttainmentPct', baseline:80+n, result:80+n+delta,
    verified:true, evidenceRef:'proof:'+n, crossTenantRawMemory:false, containsSecret:false,
    memoryGrantsAuthority:false
  };
}
function res() { return {statusCode:200,headers:{},headersSent:false,writableEnded:false,body:'',setHeader(k,v){this.headers[k]=v;},end(v=''){this.body=String(v);this.headersSent=true;this.writableEnded=true;}}; }
function req(method,url,{cookie,body,headers={}}={}) {
  const r=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
  r.method=method;r.url=url;r.headers={...headers};if(cookie)r.headers.cookie=cookie;return r;
}
async function call(service,r){const x=res();await service.handleRequest(r,x);return {status:x.statusCode,json:x.body?JSON.parse(x.body):null};}

test('three verified wins create a tenant-scoped skill candidate without authority',()=>{
  const f=fixture();
  try {
    assert.equal(f.service.ingestAdaptiveInput(outcome(1)).skillCandidate,null);
    assert.equal(f.service.ingestAdaptiveInput(outcome(2)).skillCandidate,null);
    const third=f.service.ingestAdaptiveInput(outcome(3));
    assert.equal(third.skillCandidate.verifiedWinCount,3);
    assert.equal(third.skillCandidate.authority,'none');
    assert.equal(third.executionAuthority,'NONE');
  } finally { f.close(); }
});

test('verified regression creates a release-blocking evaluation',()=>{
  const f=fixture();
  try {
    const r=f.service.ingestAdaptiveInput(outcome(1,-7));
    assert.equal(r.regressionEvaluation.releaseBlocking,true);
    assert.equal(r.regressionEvaluation.origin,'regression');
  } finally { f.close(); }
});

test('unsafe learning memory and evidence rebinding fail closed',()=>{
  const f=fixture();
  try {
    assert.throws(()=>f.service.ingestAdaptiveInput({...outcome(1),memoryGrantsAuthority:true}),/Unsafe learning memory/);
    f.service.ingestAdaptiveInput(outcome(1));
    assert.throws(()=>f.service.ingestAdaptiveInput({...outcome(1),result:999}),/already bound/);
  } finally { f.close(); }
});

test('replay is idempotent and does not duplicate wins',()=>{
  const f=fixture();
  try {
    f.service.ingestAdaptiveInput(outcome(1));
    const replay=f.service.ingestAdaptiveInput(outcome(1));
    assert.equal(replay.idempotent,true);
    assert.equal(f.service.summaryForTenant('alpha').verifiedOutcomeCount,1);
  } finally { f.close(); }
});

test('manager summary is tenant isolated and employee access is denied',async()=>{
  const f=fixture();
  try {
    f.service.ingestAdaptiveInput(outcome(1));
    const manager=await call(f.service,req('GET','/api/learning/outcomes/summary',{cookie:'wfm_session=mgr'}));
    assert.equal(manager.status,200);
    assert.equal(manager.json.tenant,'alpha');
    assert.equal(manager.json.verifiedOutcomeCount,1);
    const bravo=await call(f.service,req('GET','/api/learning/outcomes/summary',{cookie:'wfm_session=bravo'}));
    assert.equal(bravo.status,200);
    assert.equal(bravo.json.verifiedOutcomeCount,0);
    const employee=await call(f.service,req('GET','/api/learning/outcomes/summary',{cookie:'wfm_session=emp'}));
    assert.equal(employee.status,403);
  } finally { f.close(); }
});

test('internal ingestion requires the learning worker credential',async()=>{
  const f=fixture();
  try {
    const denied=await call(f.service,req('POST','/api/learning/outcomes/ingest',{body:outcome(1),headers:{'x-wfm-learning-internal':'bad'}}));
    assert.equal(denied.status,403);
    const accepted=await call(f.service,req('POST','/api/learning/outcomes/ingest',{body:outcome(1),headers:{'x-wfm-learning-internal':'learning-token'}}));
    assert.equal(accepted.status,200);
    assert.equal(accepted.json.receipt.verified,true);
  } finally { f.close(); }
});
