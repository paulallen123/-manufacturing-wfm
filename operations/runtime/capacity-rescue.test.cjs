'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {buildCapacityRescueShadow}=require('./capacity-rescue-shadow.cjs');
const {evaluateCapacityRescueOutcome}=require('./capacity-rescue-learning.cjs');
const {createDemandDecisionService}=require('./demand-decision-service.cjs');

function sha256(v){return createHash('sha256').update(String(v)).digest('hex');}
function input(){
  return {
    tenant:'alpha',site:'plant-1',triggerKind:'OUTPUT_SHORTFALL',triggerId:'line-4:shift-a',
    triggeredAt:'2026-09-25T11:00:00Z',contextRevision:'twin:r42',
    sourceEvidence:['mes:line-4','wfm:shift-a','cmms:pack-3','material:buffer-12'],
    state:{lineId:'line-4',targetUnits:1000,projectedUnits:800,currentUnits:420,plannedHeadcount:30,staffedHeadcount:30},
    constraints:[
      {id:'packaging-speed-loss',domain:'machine',label:'Packaging speed loss',confidence:.9,severity:.8,limitingImpactPct:80,evidenceRefs:['mes:pack-3-rate','cmms:pack-3']},
      {id:'skill-mix',domain:'workforce',label:'Level-3 setter coverage',confidence:.75,severity:.5,limitingImpactPct:25,evidenceRefs:['skills:line-4']}
    ],
    objective:{throughputUnits:.45,planAttainmentPct:.3,labourCost:.1,riskScore:.15,uncertaintyPenalty:.1},
    plans:[
      {id:'do-nothing',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:.05,
        prediction:{throughputUnits:800,planAttainmentPct:80,labourCost:1000,riskScore:3},
        evidenceRefs:['sim:none'],economic:{}},
      {id:'add-agency',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:.1,
        actions:[{id:'agency',type:'AGENCY',target:'line-4',reversible:true,requiresApproval:true,evidenceRefs:['agency:pool']}],
        prediction:{throughputUnits:850,planAttainmentPct:85,labourCost:1300,riskScore:3},
        evidenceRefs:['sim:agency'],economic:{interventionCost:300}},
      {id:'recover-machine',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:.08,
        actions:[
          {id:'maintenance',type:'MAINTENANCE',target:'packaging-3',reversible:false,requiresApproval:true,evidenceRefs:['cmms:pack-3']},
          {id:'skill-swap',type:'SKILL_SWAP',target:'line-4',reversible:true,requiresApproval:true,dependsOn:['maintenance'],evidenceRefs:['skills:line-4']}
        ],
        prediction:{throughputUnits:980,planAttainmentPct:98,labourCost:1050,riskScore:1.5},
        evidenceRefs:['sim:maint-skill'],
        economic:{recoveredContribution:9500,interventionCost:350,inducedDownstreamCost:100},
        causalEvidence:{comparableInterventions:4,matchedControl:true,sourceDiversity:.8,dataCompleteness:.9,simulatorCalibration:.8}
      }
    ]
  };
}

test('fully manned line suppresses labour addition when machine is the primary constraint',()=>{
  const shadow=buildCapacityRescueShadow(input());
  assert.equal(shadow.constraintAssessment.primaryConstraint.domain,'machine');
  assert.equal(shadow.constraintAssessment.labourAdditionSuppressed,true);
  assert.equal(shadow.state.fullyManned,true);
  assert.equal(shadow.state.capacityGapUnits,200);
  const agency=shadow.interventionGraph.plans.find(p=>p.id==='add-agency');
  assert.equal(agency.executionClass,'EXISTING_AUTHORITY_ONLY');
  const agencyEpisode=shadow.episode.options.find(p=>p.id==='add-agency');
  assert.equal(agencyEpisode.feasible,false);
  assert.ok(agencyEpisode.reasonCodes.includes('LABOUR_QUANTITY_NOT_PRIMARY_CONSTRAINT'));
  assert.equal(shadow.episode.recommendation.recommendedOptionId,'recover-machine');
  assert.equal(shadow.recommendedPlan.executionClass,'ADVISORY_ONLY');
  assert.equal(shadow.executionPermitted,false);
});

test('capacity rescue preserves counterfactual and economic value evidence',()=>{
  const shadow=buildCapacityRescueShadow(input());
  const cf=shadow.interventionGraph.counterfactuals.find(x=>x.planId==='recover-machine');
  assert.equal(cf.throughputDelta,180);
  assert.equal(cf.planAttainmentDelta,18);
  assert.equal(cf.netRecoveredValue,9050);
  assert.equal(cf.causalStatus,'CONTROLLED_ESTIMATE');
});

test('outcome learning does not call association causal unless supported',()=>{
  const association=evaluateCapacityRescueOutcome({
    tenant:'alpha',caseId:'cr-1',planId:'recover-machine',observedAt:'2026-09-25T12:00:00Z',
    evidenceRefs:['mes:after'],actionTypes:['MAINTENANCE','SKILL_SWAP'],primaryConstraintDomain:'machine',
    predicted:{throughputUnits:980,planAttainmentPct:98,labourCost:1050,delayMinutes:5,riskScore:1.5},
    actual:{throughputUnits:970,planAttainmentPct:97,labourCost:1060,delayMinutes:7,riskScore:1.6},
    counterfactualWithoutAction:{throughputUnits:800,planAttainmentPct:80,labourCost:1000,delayMinutes:40,riskScore:3}
  });
  assert.equal(association.causalStatus,'ASSOCIATION_ONLY');
  assert.equal(association.causalEffect,null);

  const controlled=evaluateCapacityRescueOutcome({
    tenant:'alpha',caseId:'cr-2',planId:'recover-machine',observedAt:'2026-09-25T12:00:00Z',
    evidenceRefs:['mes:after','control:line-2'],actionTypes:['MAINTENANCE','SKILL_SWAP'],primaryConstraintDomain:'machine',
    predicted:{throughputUnits:980,planAttainmentPct:98,labourCost:1050,delayMinutes:5,riskScore:1.5},
    actual:{throughputUnits:970,planAttainmentPct:97,labourCost:1060,delayMinutes:7,riskScore:1.6},
    counterfactualWithoutAction:{throughputUnits:800,planAttainmentPct:80,labourCost:1000,delayMinutes:40,riskScore:3},
    preTreatmentThroughput:790,matchedControl:{preThroughput:810,postThroughput:820},
    economic:{recoveredContribution:9000,interventionCost:350}
  });
  assert.equal(controlled.causalStatus,'DIFFERENCE_IN_DIFFERENCES_ESTIMATE');
  assert.equal(controlled.causalEffect,170);
  assert.equal(controlled.economic.netRecoveredValue,8650);
  assert.equal(controlled.learnable,true);
});

function makeRes(){
  return {statusCode:200,headers:{},headersSent:false,writableEnded:false,body:'',
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
async function call(service,req){
  const res=makeRes();await service.handleRequest(req,res);
  return {res,json:res.body?JSON.parse(res.body):null};
}
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capacity-rescue-'));
  const dbPath=path.join(dir,'db.sqlite'),db=new DatabaseSync(dbPath);
  db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);');
  const users=[['a@example.test','alpha','manager','token-a'],['b@example.test','beta','manager','token-b']];
  for(const [email,tenant,role,token] of users){
    db.prepare('INSERT INTO users(email,tenant,role) VALUES(?,?,?)').run(email,tenant,role);
    db.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)').run(sha256(token),email,Date.now()+60000);
  }
  db.close();return{dir,dbPath};
}

test('decision service persists tenant-isolated capacity rescue and outcome evidence',async()=>{
  const f=fixture(),service=createDemandDecisionService({dbPath:f.dbPath,internalToken:'internal'});
  try{
    const created=await call(service,makeReq('POST','/api/operations/intelligence/capacity-rescue/shadow',{
      body:{tenant:'alpha',input:input()},headers:{'x-wfm-demand-internal':'internal'}
    }));
    assert.equal(created.res.statusCode,201);
    assert.equal(created.json.case.executionPermitted,false);
    const caseId=created.json.case.caseId;

    const alpha=await call(service,makeReq('GET','/api/operations/intelligence/capacity-rescue',{cookie:'wfm_session=token-a'}));
    assert.equal(alpha.res.statusCode,200);
    assert.equal(alpha.json.cases.length,1);
    assert.equal(alpha.json.cases[0].caseId,caseId);

    const beta=await call(service,makeReq('GET','/api/operations/intelligence/capacity-rescue',{cookie:'wfm_session=token-b'}));
    assert.equal(beta.res.statusCode,200);
    assert.equal(beta.json.cases.length,0);

    const outcome=await call(service,makeReq('POST','/api/operations/intelligence/capacity-rescue/outcome',{
      headers:{'x-wfm-demand-internal':'internal'},
      body:{tenant:'alpha',caseId,outcome:{
        planId:'recover-machine',observedAt:'2026-09-25T12:00:00Z',
        evidenceRefs:['mes:after','control:line-2'],
        predicted:{throughputUnits:980,planAttainmentPct:98,labourCost:1050,delayMinutes:5,riskScore:1.5},
        actual:{throughputUnits:970,planAttainmentPct:97,labourCost:1060,delayMinutes:7,riskScore:1.6},
        counterfactualWithoutAction:{throughputUnits:800,planAttainmentPct:80,labourCost:1000,delayMinutes:40,riskScore:3},
        preTreatmentThroughput:790,matchedControl:{preThroughput:810,postThroughput:820}
      }}
    }));
    assert.equal(outcome.res.statusCode,201);
    assert.equal(outcome.json.outcome.causalStatus,'DIFFERENCE_IN_DIFFERENCES_ESTIMATE');

    const listed=await call(service,makeReq('GET','/api/operations/intelligence/capacity-rescue',{cookie:'wfm_session=token-a'}));
    assert.equal(listed.json.outcomes.length,1);
    assert.equal(listed.json.executionAuthority,'SHADOW_ONLY_UNTIL_TYPED_ADAPTERS_AND_ROLLBACK_PROOF');
  }finally{service.close();fs.rmSync(f.dir,{recursive:true,force:true});}
});
