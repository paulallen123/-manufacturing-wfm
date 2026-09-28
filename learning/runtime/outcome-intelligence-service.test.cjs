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
    fingerprint:'absence-recovery:redeploy:planAttainmentPct', baseline:80+n, result:80+n+delta,
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

test('verified regression blocks release admission while a clean tenant is admitted',async()=>{
  const f=fixture();
  try {
    f.service.ingestAdaptiveInput(outcome(1,-7));
    const blocked=f.service.releaseAdmissionForTenant('alpha');
    assert.equal(blocked.releasePromotionAllowed,false);
    assert.equal(blocked.blockerCount,1);
    assert.equal(blocked.reason,'VERIFIED_OUTCOME_REGRESSION');
    assert.equal(blocked.executionAuthority,'NONE');

    const blockedHttp=await call(f.service,req('POST','/api/learning/outcomes/release-admission',{
      body:{tenant:'alpha'},headers:{'x-wfm-learning-internal':'learning-token'}
    }));
    assert.equal(blockedHttp.status,409);
    assert.equal(blockedHttp.json.releasePromotionAllowed,false);

    const cleanHttp=await call(f.service,req('POST','/api/learning/outcomes/release-admission',{
      body:{tenant:'bravo'},headers:{'x-wfm-learning-internal':'learning-token'}
    }));
    assert.equal(cleanHttp.status,200);
    assert.equal(cleanHttp.json.releasePromotionAllowed,true);
    assert.equal(cleanHttp.json.blockerCount,0);
  } finally { f.close(); }
});

test('regression resolution is append-only and learned reuse requires a new post-resolution win',async()=>{
  const f=fixture();
  try {
    f.service.ingestAdaptiveInput(outcome(1));
    f.service.ingestAdaptiveInput(outcome(2));
    f.service.ingestAdaptiveInput(outcome(3));
    const before=f.service.recommendationPrior({
      tenant:'alpha',decisionType:'absence-recovery',optionId:'redeploy',metric:'planAttainmentPct'
    });
    assert.equal(before.eligible,true);
    assert.equal(before.skillCandidate.verifiedWinCount,3);
    assert.equal(before.rankingAuthority,false);
    assert.equal(before.executionAuthority,'NONE');

    const regression=f.service.ingestAdaptiveInput(outcome(4,-7));
    const blocked=f.service.recommendationPrior({
      tenant:'alpha',decisionType:'absence-recovery',optionId:'redeploy',metric:'planAttainmentPct'
    });
    assert.equal(blocked.eligible,false);
    assert.equal(blocked.reason,'VERIFIED_REGRESSION_BLOCK');
    assert.equal(f.service.releaseAdmissionForTenant('alpha').releasePromotionAllowed,false);

    assert.throws(()=>f.service.resolveRegression({
      tenant:'alpha',evaluationId:regression.regressionEvaluation.id,verificationSource:'independent-retest',
      verificationDigest:hash('resolution-proof'),evidenceRefs:['retest:1'],verified:false
    }),/Unsafe or unverified/);

    const resolved=f.service.resolveRegression({
      tenant:'alpha',evaluationId:regression.regressionEvaluation.id,verificationSource:'independent-retest',
      verificationDigest:hash('resolution-proof'),evidenceRefs:['retest:1','recovery:1'],verified:true,
      memoryGrantsAuthority:false,containsSecret:false,crossTenantRawMemory:false
    });
    assert.equal(resolved.releaseAdmission.releasePromotionAllowed,true);
    assert.equal(resolved.resolution.verifiedWinCountAtResolution,3);
    assert.equal(resolved.executionAuthority,'NONE');

    const stalePrior=f.service.recommendationPrior({
      tenant:'alpha',decisionType:'absence-recovery',optionId:'redeploy',metric:'planAttainmentPct'
    });
    assert.equal(stalePrior.eligible,false);
    assert.equal(stalePrior.reason,'POST_RESOLUTION_WINS_REQUIRED');

    const post=f.service.ingestAdaptiveInput(outcome(5,12));
    assert.equal(post.skillCandidate.verifiedWinCount,4);
    const restored=f.service.recommendationPrior({
      tenant:'alpha',decisionType:'absence-recovery',optionId:'redeploy',metric:'planAttainmentPct'
    });
    assert.equal(restored.eligible,true);
    assert.equal(restored.reason,'REPEATED_VERIFIED_WIN');
    assert.equal(restored.skillCandidate.verifiedWinCount,4);
    assert.equal(restored.resolution.verifiedWinCountAtResolution,3);

    const replay=f.service.resolveRegression({
      tenant:'alpha',evaluationId:regression.regressionEvaluation.id,verificationSource:'independent-retest',
      verificationDigest:hash('resolution-proof'),evidenceRefs:['retest:1','recovery:1'],verified:true
    });
    assert.equal(replay.idempotent,true);
  } finally { f.close(); }
});

test('trusted resolution endpoint unblocks only the exact tenant regression',async()=>{
  const f=fixture();
  try {
    const regression=f.service.ingestAdaptiveInput(outcome(1,-5));
    const denied=await call(f.service,req('POST','/api/learning/outcomes/resolve-regression',{
      body:{
        tenant:'alpha',evaluationId:regression.regressionEvaluation.id,verificationSource:'retest',
        verificationDigest:hash('endpoint-proof'),evidenceRefs:['proof:endpoint'],verified:true
      },headers:{'x-wfm-learning-internal':'bad'}
    }));
    assert.equal(denied.status,403);

    const accepted=await call(f.service,req('POST','/api/learning/outcomes/resolve-regression',{
      body:{
        tenant:'alpha',evaluationId:regression.regressionEvaluation.id,verificationSource:'retest',
        verificationDigest:hash('endpoint-proof'),evidenceRefs:['proof:endpoint'],verified:true
      },headers:{'x-wfm-learning-internal':'learning-token'}
    }));
    assert.equal(accepted.status,200);
    assert.equal(accepted.json.releaseAdmission.releasePromotionAllowed,true);
    assert.equal(accepted.json.executionAuthority,'NONE');
    assert.equal(f.service.releaseAdmissionForTenant('bravo').releasePromotionAllowed,true);
  } finally { f.close(); }
});
