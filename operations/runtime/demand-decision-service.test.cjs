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
  const tokenA='token-a',tokenB='token-b',tokenE='token-e',tokenU='token-unknown';
  db.prepare('INSERT INTO users(email,tenant,role) VALUES(?,?,?)').run('a@example.test','alpha','manager');
  db.prepare('INSERT INTO users(email,tenant,role) VALUES(?,?,?)').run('b@example.test','beta','manager');
  db.prepare('INSERT INTO users(email,tenant,role) VALUES(?,?,?)').run('e@example.test','alpha','employee');
  db.prepare('INSERT INTO users(email,tenant,role) VALUES(?,?,?)').run('u@example.test','alpha','revoked-role');
  for(const [token,email] of [[tokenA,'a@example.test'],[tokenB,'b@example.test'],[tokenE,'e@example.test'],[tokenU,'u@example.test']]){
    db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)').run(sha256(token),email,Date.now()+60000);
  }
  const ins=db.prepare('INSERT INTO workforce_lifecycle_events(id,tenant,event_key,kind,status,employee_id,source_key,effective_at_ms,payload_json,reason_code,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  ins.run('a1','alpha','a1','ABSENCE','ACCEPTED','emp-1',null,Date.parse('2026-09-22T08:00:00Z'),'{}','OK','{}','2026-09-22T08:00:00Z');
  ins.run('b1','beta','b1','AGENCY_ASSIGNMENT','ACCEPTED','emp-2',null,Date.parse('2026-09-22T08:00:00Z'),'{}','OK','{}','2026-09-22T08:00:00Z');
  db.close();
  return {dir,dbPath,tokenA,tokenB,tokenE,tokenU};
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

test('unknown current role cannot read intelligence summaries, demand, episodes, or delivery wrappers',async()=>{
  const f=fixture(),service=createDemandDecisionService({dbPath:f.dbPath,internalToken:'internal'});
  try{
    for(const route of ['summary','demand','decisions','delivery-disruptions']){
      const response=await call(service,makeReq('GET','/api/operations/intelligence/'+route,{cookie:'wfm_session='+f.tokenU}));
      assert.equal(response.res.statusCode,403,route);
      assert.equal(Object.hasOwn(response.json,'tenant'),false,route);
    }
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

function deliveryInput(){
  const at='2026-10-12T08:00:00.000Z',scope={tenant:'alpha',site:'north',line:'L1',order:'O1',material:'M1',shipment:'S1'};
  const event=(kind,id,payload)=>({kind,id,revision:1,scope:{...scope},source:'test-'+kind,sourceRevision:'1',
    recordHash:'a'.repeat(64),observedAt:'2026-10-12T07:55:00.000Z',confidence:0.95,payload});
  return {scope,asOf:at,policy:{version:'p1',currency:'GBP',maxAgeMinutes:30,minConfidence:0.6},evidence:[
    event('inventory','inv',{quantityOnHand:100,safetyStock:20,unit:'kg'}),
    event('consumption','cons',{quantityPerHour:40,startsAt:at,unit:'kg'}),
    event('requirement','req',{remainingQuantity:200,requiredAt:'2026-10-12T09:00:00.000Z',unit:'kg'}),
    event('eta','eta',{arrivesAt:'2026-10-12T13:00:00.000Z'}),
    event('economics','econ',{currency:'GBP',lostContributionPerHour:10000,idleLabourPerHour:1000,recoveryOvertimePerHour:500,customerPenalty:2000,componentsNonOverlapping:true})
  ],options:[{id:'transfer',kind:'INTER_SITE_TRANSFER',recoveredHours:2,costUpper:3000,avoidedCostLower:15000,
    feasibility:{safety:true,quality:true,qualifiedStaff:true,capacity:true,approvalRoute:true},sourceRef:'transfer:1'}]};
}
test('delivery route requires source verification and isolates immutable shadow results by tenant',async()=>{
  const f=fixture(),url='/api/operations/intelligence/delivery-disruption/shadow';
  const disabled=createDemandDecisionService({dbPath:f.dbPath,internalToken:'internal'});
  const body={tenant:'alpha',input:deliveryInput()};
  try{
    assert.equal((await call(disabled,makeReq('POST',url,{body,headers:{'x-wfm-demand-internal':'internal'}}))).res.statusCode,503);
  }finally{disabled.close();}
  let authenticated=0,attested=false;
  const service=createDemandDecisionService({dbPath:f.dbPath,internalToken:'internal',verifyDeliveryEvidence(input,tenant){
    authenticated++;return attested&&tenant==='alpha'&&input.scope.tenant==='alpha'&&input.evidence.length===5;
  }});
  try{
    const post=b=>call(service,makeReq('POST',url,{body:b,headers:{'x-wfm-demand-internal':'internal'}}));
    assert.equal((await call(service,makeReq('POST',url,{body,headers:{'x-wfm-demand-internal':'wrong'}}))).res.statusCode,403);
    assert.equal((await post({...body,tenant:'beta'})).res.statusCode,400);
    // The verifier sees the parsed snapshot; demonstrate an explicit refusal before allowing it.
    const rejected=await post(body);assert.equal(rejected.res.statusCode,422);
    assert.equal(authenticated,1);
    attested=true;
    const created=await post(body);assert.equal(created.res.statusCode,201);
    assert.equal(created.json.shadow.status,'RECOVERY_OPTIONS');
    assert.equal(created.json.shadow.episode.recommendation.executionPermitted,false);
    assert.equal((await post(body)).json.idempotent,true);
    const get=(token)=>call(service,makeReq('GET','/api/operations/intelligence/delivery-disruptions',{cookie:'wfm_session='+token}));
    assert.equal((await get(f.tokenA)).json.shadows.length,1);
    assert.equal((await get(f.tokenB)).json.shadows.length,0);
    assert.equal((await get(f.tokenE)).res.statusCode,403);
    const decisions=await call(service,makeReq('GET','/api/operations/intelligence/decisions',{cookie:'wfm_session='+f.tokenA}));
    assert.equal(decisions.json.episodes.length,1);
  }finally{service.close();fs.rmSync(f.dir,{recursive:true,force:true});}
});

