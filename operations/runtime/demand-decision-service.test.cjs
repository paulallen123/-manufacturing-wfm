'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createDemandDecisionService,lifecycleDemandSignal}=require('./demand-decision-service.cjs');

function sha256(v){return createHash('sha256').update(String(v)).digest('hex');}
function makeRes(){
  return {
    statusCode:200,headers:{},headersSent:false,writableEnded:false,body:'',
    setHeader(k,v){this.headers[String(k).toLowerCase()]=v;},
    end(v=''){this.body=String(v);this.writableEnded=true;this.headersSent=true;}
  };
}
function makeReq(method,url,{body,cookie,headers={}}={}){
  const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
  req.method=method;req.url=url;req.headers={...headers};
  if(cookie) req.headers.cookie=cookie;
  return req;
}
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-demand-'));
  const dbPath=path.join(dir,'db.sqlite');
  const db=new DatabaseSync(dbPath);
  db.exec(
    'CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL);'+
    'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);'+
    'CREATE TABLE workforce_lifecycle_events('+
      'id TEXT PRIMARY KEY,tenant TEXT NOT NULL,event_key TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,'+
      'employee_id TEXT,source_key TEXT,effective_at_ms INTEGER NOT NULL,payload_json TEXT NOT NULL,reason_code TEXT,detail_json TEXT NOT NULL,created_at TEXT NOT NULL);'
  );
  const tokenA='token-a',tokenB='token-b',tokenE='token-e';
  db.prepare('INSERT INTO users(email,tenant,role) VALUES(?,?,?)').run('a@example.test','alpha','manager');
  db.prepare('INSERT INTO users(email,tenant,role) VALUES(?,?,?)').run('b@example.test','beta','manager');
  db.prepare('INSERT INTO users(email,tenant,role) VALUES(?,?,?)').run('e@example.test','alpha','employee');
  for(const [token,email] of [[tokenA,'a@example.test'],[tokenB,'b@example.test'],[tokenE,'e@example.test']]){
    db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)').run(sha256(token),email,Date.now()+60000);
  }
  const ins=db.prepare('INSERT INTO workforce_lifecycle_events(id,tenant,event_key,kind,status,employee_id,source_key,effective_at_ms,payload_json,reason_code,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  ins.run('a1','alpha','a1','ABSENCE','ACCEPTED','emp-1',null,Date.parse('2026-09-22T08:00:00Z'),'{}','OK','{}','2026-09-22T08:00:00Z');
  ins.run('b1','beta','b1','AGENCY_ASSIGNMENT','ACCEPTED','emp-2',null,Date.parse('2026-09-22T08:00:00Z'),'{}','OK','{}','2026-09-22T08:00:00Z');
  db.close();
  return {dir,dbPath,tokenA,tokenB,tokenE};
}
async function call(service,req){
  const res=makeRes(); await service.handleRequest(req,res); return {res,json:res.body?JSON.parse(res.body):null};
}

test('maps lifecycle evidence to silent operational demand without inventing an outcome',()=>{
  const signal=lifecycleDemandSignal({id:'x',tenant:'alpha',kind:'ABSENCE',created_at:'2026-09-22T08:00:00Z',effective_at_ms:Date.now()});
  assert.equal(signal.decisionKey,'absence-recovery');
  assert.equal(signal.sourceType,'product-telemetry');
  assert.equal(signal.evidenceType,'operational');
  assert.equal(signal.silentDemand,false);
});

test('manager summary is tenant isolated and employee access is denied',async()=>{
  const f=fixture();
  const service=createDemandDecisionService({dbPath:f.dbPath,internalToken:'internal'});
  try{
    const a=await call(service,makeReq('GET','/api/operations/intelligence/summary',{cookie:'wfm_session='+f.tokenA}));
    assert.equal(a.res.statusCode,200);
    assert.equal(a.json.tenant,'alpha');
    assert.equal(a.json.topDemand.decisionKey,'absence-recovery');
    const b=await call(service,makeReq('GET','/api/operations/intelligence/summary',{cookie:'wfm_session='+f.tokenB}));
    assert.equal(b.json.topDemand.decisionKey,'agency-labour-control');
    const e=await call(service,makeReq('GET','/api/operations/intelligence/summary',{cookie:'wfm_session='+f.tokenE}));
    assert.equal(e.res.statusCode,403);
  }finally{service.close();fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('trusted worker can persist a shadow decision but cannot grant execution authority',async()=>{
  const f=fixture();
  const service=createDemandDecisionService({dbPath:f.dbPath,internalToken:'internal'});
  try{
    const body={tenant:'alpha',input:{
      site:'tamworth',triggerKind:'ABSENCE',triggerId:'absence:42',triggeredAt:'2026-09-22T08:00:00Z',
      contextRevision:'twin:abc',requiredSkills:['welding-l2'],affectedLines:['line-4'],
      sourceEvidence:['absence:42','skills:line-4','production:plan-a'],
      objective:{labourCost:0.25,planAttainmentPct:0.55,riskScore:0.2,uncertaintyPenalty:0.1},
      candidates:[
        {id:'do-nothing',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0.05,prediction:{labourCost:0,planAttainmentPct:80,riskScore:2},evidenceRefs:['sim:a']},
        {id:'redeploy',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0.1,prediction:{labourCost:120,planAttainmentPct:98,riskScore:1},evidenceRefs:['sim:b']}
      ]
    }};
    const denied=await call(service,makeReq('POST','/api/operations/intelligence/absence-recovery/shadow',{body,headers:{'x-wfm-demand-internal':'wrong'}}));
    assert.equal(denied.res.statusCode,403);
    const created=await call(service,makeReq('POST','/api/operations/intelligence/absence-recovery/shadow',{body,headers:{'x-wfm-demand-internal':'internal'}}));
    assert.equal(created.res.statusCode,201);
    assert.equal(created.json.shadow.executionPermitted,false);
    assert.equal(created.json.shadow.episode.recommendation.executionPermitted,false);
    const list=await call(service,makeReq('GET','/api/operations/intelligence/decisions',{cookie:'wfm_session='+f.tokenA}));
    assert.equal(list.json.episodes.length,1);
    assert.equal(list.json.episodes[0].mode,'SHADOW');
  }finally{service.close();fs.rmSync(f.dir,{recursive:true,force:true});}
});
