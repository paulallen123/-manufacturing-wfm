'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Readable}=require('node:stream');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {createMobileRecommendationService}=require('./mobile-recommendation-service.cjs');

function sha(v){return createHash('sha256').update(String(v)).digest('hex');}
function req(method,url,body,headers={}){
  const r=Readable.from(body==null?[]:[Buffer.from(JSON.stringify(body))]);
  r.method=method;r.url=url;r.headers=headers;return r;
}
function res(){
  return {
    statusCode:200,headers:{},body:'',
    setHeader(k,v){this.headers[String(k).toLowerCase()]=v;},
    end(v=''){this.body+=String(v);this.writableEnded=true;},
    get headersSent(){return false;}
  };
}
function episode(){
  return {
    contractVersion:'VECTOR_DECISION_EPISODE_V1',
    tenant:'alpha',site:'A',decisionType:'absence-recovery',triggerId:'t1',
    triggeredAt:'2026-09-25T10:00:00.000Z',contextRevision:'ctx-1',mode:'SHADOW',
    sourceEvidence:['attendance:a'],
    options:[
      {id:'do-nothing',label:'Do nothing',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0.1,prediction:{},evidenceRefs:['e0'],reasonCodes:[]},
      {id:'agency-1',label:'Use approved agency worker',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0.1,prediction:{},evidenceRefs:['e1'],reasonCodes:['coverage']}
    ],
    recommendation:{optionId:'agency-1',reason:'RANKED',ranking:[],authorityRequired:'NO_EXECUTION',executionPermitted:false},
    episodeId:'episode-1'
  };
}

test('mobile approval is audited and only executes a trusted stored plan',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vecta-mobile-'));
  const dbPath=path.join(dir,'db.sqlite');
  const db=new DatabaseSync(dbPath);
  db.exec("CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);CREATE TABLE vector_decision_episodes(tenant TEXT NOT NULL,episode_id TEXT NOT NULL,decision_type TEXT NOT NULL,episode_json TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(tenant,episode_id));");
  db.prepare('INSERT INTO users VALUES(?,?,?)').run('manager@example.test','alpha','manager');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha('session-token'),'manager@example.test',Date.now()+60000);
  db.prepare('INSERT INTO vector_decision_episodes VALUES(?,?,?,?,?)').run('alpha','episode-1','absence-recovery',JSON.stringify(episode()),new Date().toISOString());
  db.close();

  const calls=[];
  const autopilot={
    issueHumanPermit(input){calls.push(['permit',input]);return {permitId:'p1'};},
    async executePermit(input){calls.push(['execute',input]);return {executionId:'x1',state:'VERIFIED'};}
  };
  const service=createMobileRecommendationService({dbPath,internalToken:'trusted-token',autopilot});

  let r=res();
  await service.handleRequest(req('POST','/api/mobile/recommendations/episode-1/decision',{
    episodeId:'episode-1',optionId:'agency-1',contextRevision:'ctx-1',decision:'APPROVE',execute:true
  },{cookie:'wfm_session=session-token'}),r);
  assert.equal(r.statusCode,202);
  assert.equal(JSON.parse(r.body).status,'APPROVED_AWAITING_EXECUTION_PLAN');
  assert.equal(calls.length,0);

  r=res();
  await service.handleRequest(req('POST','/api/mobile/recommendations/episode-1/action-plan',{
    tenant:'alpha',optionId:'agency-1',contextRevision:'ctx-1',sourceRef:'test',
    plan:{
      adapter:'workforce-lifecycle',reversible:true,
      action:{eventKey:'a1',kind:'AGENCY_ASSIGNMENT',employeeId:'emp-1',effectiveAt:'2026-09-25T12:00:00.000Z',payload:{}},
      rollback:{eventKey:'rb1',reason:'test rollback'}
    }
  },{'x-wfm-mobile-internal':'trusted-token'}),r);
  assert.equal(r.statusCode,201);

  r=res();
  await service.handleRequest(req('POST','/api/mobile/recommendations/episode-1/decision',{
    episodeId:'episode-1',optionId:'agency-1',contextRevision:'ctx-1',decision:'APPROVE',execute:true
  },{cookie:'wfm_session=session-token'}),r);
  assert.equal(r.statusCode,200);
  assert.equal(JSON.parse(r.body).status,'APPROVED_AND_VERIFIED');
  assert.deepEqual(calls.map(x=>x[0]),['permit','execute']);

  service.close();
  fs.rmSync(dir,{recursive:true,force:true});
});
