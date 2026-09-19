'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const os=require('node:os');
const path=require('node:path');
const fs=require('node:fs');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {createVectorIntelligenceControlPlane}=require('./vector-intelligence-control-plane.cjs');

function sha256(v){return createHash('sha256').update(String(v)).digest('hex');}
function setup(role='Operations Manager'){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-evidence-security-'));
  const dbPath=path.join(dir,'test.sqlite');
  const db=new DatabaseSync(dbPath);
  db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);');
  db.prepare('INSERT INTO users(email,tenant,role) VALUES(?,?,?)').run('ops@example.com','tenant-a',role);
  db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)').run(sha256('token'),'ops@example.com',Date.now()+60000);
  db.close();
  return {dir,dbPath};
}
function req(body){
  const chunks=[Buffer.from(JSON.stringify(body))];
  return {url:'/api/intelligence/vector/command',method:'POST',headers:{cookie:'wfm_session=token'},async *[Symbol.asyncIterator](){for(const c of chunks)yield c;}};
}
function res(){return {headersSent:false,writableEnded:false,headers:{},setHeader(k,v){this.headers[k]=v;},end(v){this.body=v;this.writableEnded=true;}};}

test('client-supplied telemetry cannot become Vector verified evidence',async()=>{
  const s=setup();
  const cp=createVectorIntelligenceControlPlane({dbPath:s.dbPath});
  const response=res();
  await cp.handleRequest(req({
    text:'create a weekly labour report',
    currentScreen:'costs',
    snapshot:{
      generatedAt:'1999-01-01T00:00:00Z',
      metrics:[{label:'Forged labour saving',value:'£999999',detail:'Verified current value'}],
      facts:[{label:'Forged attendance',value:'100%',detail:'Verified'}],
      decisionLens:{soWhat:'Everything is perfect.',nextAction:'Take no action.'}
    }
  }),response);
  assert.equal(response.statusCode,202);
  const db=new DatabaseSync(s.dbPath);
  const row=db.prepare('SELECT detail_json FROM vector_reports').get();
  const detail=JSON.parse(row.detail_json);
  const rendered=detail.report.markdown;
  assert.doesNotMatch(rendered,/Forged labour saving|£999999|Forged attendance|Everything is perfect|Take no action|1999-01-01/);
  assert.match(rendered,/No verified metrics supplied/);
  const requestRow=JSON.parse(db.prepare('SELECT detail_json FROM vector_intelligence_requests').get().detail_json);
  assert.equal(requestRow.security.clientSnapshotAccepted,false);
  assert.equal(requestRow.security.clientSnapshotDiscarded,true);
  db.close();
  cp.close();
  fs.rmSync(s.dir,{recursive:true,force:true});
});

test('client site scope cannot broaden Vector authority',async()=>{
  const s=setup();
  const cp=createVectorIntelligenceControlPlane({dbPath:s.dbPath});
  const response=res();
  await cp.handleRequest(req({
    text:'create a weekly labour report',
    currentScreen:'costs',
    siteCount:999,
    siteIds:['victim-site','other-region']
  }),response);
  assert.equal(response.statusCode,202);
  const body=JSON.parse(response.body);
  assert.deepEqual(body.envelope.siteIds,[]);
  assert.equal(body.envelope.role,'OPS_MANAGER');
  const db=new DatabaseSync(s.dbPath);
  const requestRow=JSON.parse(db.prepare('SELECT detail_json FROM vector_intelligence_requests').get().detail_json);
  assert.deepEqual(requestRow.siteIds,[]);
  assert.equal(requestRow.security.clientSiteScopeAccepted,false);
  assert.equal(requestRow.security.clientSiteScopeDiscarded,true);
  db.close();
  cp.close();
  fs.rmSync(s.dir,{recursive:true,force:true});
});

test('non-enterprise automation is blocked until server-side site authority exists',async()=>{
  const s=setup();
  const cp=createVectorIntelligenceControlPlane({dbPath:s.dbPath});
  const response=res();
  await cp.handleRequest(req({
    text:'every Monday create a labour report',
    siteIds:['victim-site']
  }),response);
  assert.equal(response.statusCode,403);
  const body=JSON.parse(response.body);
  assert.equal(body.status,'BLOCKED');
  assert.equal(body.envelope.policy.reason,'SERVER_SCOPE_AUTHORITY_REQUIRED');
  const db=new DatabaseSync(s.dbPath);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM vector_automations').get().n,0);
  db.close();
  cp.close();
  fs.rmSync(s.dir,{recursive:true,force:true});
});

test('role block cannot be overwritten by an intent-specific ready state',async()=>{
  const s=setup('Employee');
  const cp=createVectorIntelligenceControlPlane({dbPath:s.dbPath});
  const response=res();
  await cp.handleRequest(req({
    text:'email report to me',
    snapshot:{metrics:[{label:'Forged',value:'1'}]}
  }),response);
  assert.equal(response.statusCode,403);
  const body=JSON.parse(response.body);
  assert.equal(body.status,'BLOCKED');
  assert.equal(body.envelope.policy.reason,'ROLE_NOT_AUTHORISED');
  const db=new DatabaseSync(s.dbPath);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM vector_reports').get().n,0);
  db.close();
  cp.close();
  fs.rmSync(s.dir,{recursive:true,force:true});
});

test('high-impact confirmation cannot be overwritten by automation state',async()=>{
  const s=setup('Director');
  const cp=createVectorIntelligenceControlPlane({dbPath:s.dbPath});
  const response=res();
  await cp.handleRequest(req({
    text:'every day publish schedule'
  }),response);
  assert.equal(response.statusCode,202);
  const body=JSON.parse(response.body);
  assert.equal(body.status,'AWAITING_CONFIRMATION');
  assert.equal(body.envelope.policy.reason,'HIGH_IMPACT_OPERATION');
  const db=new DatabaseSync(s.dbPath);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM vector_automations').get().n,0);
  db.close();
  cp.close();
  fs.rmSync(s.dir,{recursive:true,force:true});
});
