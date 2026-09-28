'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Readable}=require('node:stream');
const {DatabaseSync}=require('node:sqlite');
const {createDemandDecisionService}=require('./demand-decision-service.cjs');
const {createWorkforceLifecycleGuard}=require('./workforce-lifecycle-guard.cjs');
const {createAutopilotExecutionEngine}=require('./autopilot-execution-engine.cjs');
const {createOutcomeIntelligenceService}=require('../../learning/runtime/outcome-intelligence-service.cjs');

function response(){
  return{statusCode:200,headersSent:false,writableEnded:false,body:'',setHeader(){},end(v=''){this.body=String(v);this.headersSent=true;this.writableEnded=true;}};
}
async function call(service,method,url,body,headers={}){
  const req=Readable.from(body===undefined?[]:[JSON.stringify(body)]);req.method=method;req.url=url;req.headers=headers;
  const res=response();assert.equal(await service.handleRequest(req,res),true);
  return{status:res.statusCode,body:res.body?JSON.parse(res.body):null};
}

test('real modules close the loop from shadow decision through verified outcome into release-blocking learning',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-outcome-loop-')),dbPath=path.join(dir,'loop.sqlite');
  const seed=new DatabaseSync(dbPath);
  seed.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);');
  seed.close();

  const demand=createDemandDecisionService({dbPath,internalToken:'demand-proof-token'});
  const lifecycle=createWorkforceLifecycleGuard({dbPath,internalToken:'lifecycle-proof-token'});
  const learning=createOutcomeIntelligenceService({dbPath,internalToken:'learning-proof-token'});
  const autopilot=createAutopilotExecutionEngine({dbPath,lifecycleAdapter:lifecycle,outcomeLearningAdapter:learning});
  try{
    const starter=lifecycle.applyTrustedEvent({tenant:'A',eventKey:'starter-proof',event:{
      kind:'STARTER',employeeId:'E1',effectiveAt:'2026-09-28T07:00:00Z',payload:{location:'Proof Plant',department:'Proof Ops'}
    }});
    assert.equal(starter.decision.status,'ACCEPTED');

    const shadow=await call(demand,'POST','/api/operations/intelligence/absence-recovery/shadow',{
      tenant:'A',
      input:{
        triggerKind:'ABSENCE',site:'S1',triggerId:'absence-proof',triggeredAt:'2026-09-28T07:05:00Z',contextRevision:'ctx-proof-1',
        requiredSkills:['qualified-line-operator'],affectedLines:['L1'],sourceEvidence:['starter-proof','coverage-gap-proof'],
        objective:{planAttainmentPct:1,labourCost:.2,uncertaintyPenalty:.1},
        candidates:[
          {id:'do-nothing',label:'Leave gap uncovered',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:.05,prediction:{planAttainmentPct:80,labourCost:100},evidenceRefs:['baseline-proof']},
          {id:'overtime',label:'Approved overtime cover',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:.05,prediction:{planAttainmentPct:95,labourCost:120},evidenceRefs:['overtime-proof']}
        ]
      }
    },{'x-wfm-demand-internal':'demand-proof-token'});
    assert.equal(shadow.status,201);
    const episode=shadow.body.shadow.episode;
    assert.equal(episode.mode,'SHADOW');
    assert.equal(episode.recommendation.optionId,'overtime');

    const permit=autopilot.issueHumanPermit({
      tenant:'A',episodeId:episode.episodeId,optionId:'overtime',actorRef:'manager@a',
      contextRevision:'ctx-proof-1',
      plan:{adapter:'workforce-lifecycle',reversible:true,action:{eventKey:'overtime-proof',kind:'OVERTIME_OVERRIDE',employeeId:'E1',effectiveAt:'2026-09-28T07:10:00Z',payload:{minutes:60}},rollback:{eventKey:'rollback-proof',reason:'Compensating proof rollback'}}
    });
    const execution=await autopilot.executePermit({tenant:'A',permitId:permit.permitId,currentContextRevision:'ctx-proof-1'});
    assert.equal(execution.state,'VERIFIED');
    assert.equal(execution.detail.outcomeStatus,'UNPROVEN');
    assert.equal(execution.detail.outcomeDigest,null);

    const measured={
      tenant:'A',executionId:execution.executionId,observedAt:'2026-09-28T08:00:00Z',
      resultEvidenceRefs:['mes:plan-attainment:proof'],actual:{planAttainmentPct:70},
      metric:'planAttainmentPct',direction:'MAXIMIZE',classification:'VERIFIED_OPERATIONAL',
      baselineActual:82,baselineEvidenceRefs:['mes:baseline:proof'],financeEvidenceRefs:[]
    };
    const outcome=autopilot.recordMeasuredOutcome(measured);
    assert.equal(outcome.executionAuthority,'NONE');
    assert.equal(outcome.proof.verifiedOperationalOutcome,true);
    assert.equal(outcome.proof.realisedFinancialOutcome,false);
    assert.equal(outcome.learning.receipt.source,'decision-outcome-proof');
    assert.equal(outcome.learning.receipt.tenant,'A');
    assert.equal(outcome.learning.receipt.fingerprint,'absence-recovery:planAttainmentPct');
    assert.equal(outcome.learning.executionAuthority,'NONE');
    assert.equal(outcome.learning.regressionEvaluation.releaseBlocking,true);

    const admission=learning.releaseAdmissionForTenant('A');
    assert.equal(admission.releasePromotionAllowed,false);
    assert.equal(admission.reason,'VERIFIED_OUTCOME_REGRESSION');
    assert.equal(admission.executionAuthority,'NONE');

    const replay=autopilot.recordMeasuredOutcome(measured);
    assert.equal(replay.idempotent,true);
    assert.equal(learning.summaryForTenant('A').verifiedOutcomeCount,1);

    assert.throws(()=>autopilot.recordMeasuredOutcome({
      ...measured,observedAt:'2026-09-28T08:05:00Z',resultEvidenceRefs:['mes:conflicting-result:proof'],actual:{planAttainmentPct:99}
    }),error=>error?.statusCode===409&&/different measured outcome/i.test(error.message));
    assert.equal(learning.summaryForTenant('A').verifiedOutcomeCount,1);
  }finally{
    try{autopilot.close();}catch{}
    try{learning.close();}catch{}
    try{lifecycle.close();}catch{}
    try{demand.close();}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
