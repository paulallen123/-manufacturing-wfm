'use strict';

const http=require('node:http');
const fs=require('node:fs');
const f=require('/app/operations/runtime/frontier-decision-control.cjs');

const IDENTITY='VECTOR_T9_LIVE_DEMO_V1';

function runScenario(stale=false){
  const episode={
    contractVersion:'VECTOR_DECISION_EPISODE_V1',
    episodeId:stale?'demo-stale':'demo-fresh',
    tenant:'demo-factory',
    contextRevision:'twin-r17'
  };
  const passport=f.createSimulationPassport({
    sourceEpisodeId:episode.episodeId,
    contextRevision:episode.contextRevision,
    stateSnapshotRef:'twin://demo/site-1/shift-a/r17',
    generatedAt:'2026-09-23T15:00:00Z',
    inputEvidenceRefs:['ev:absence:E17','ev:skills:E17','ev:production-plan:shift-a'],
    models:[{
      id:'absence-recovery-des',
      version:'17',
      type:'DISCRETE_EVENT',
      calibrationEvidenceRefs:['cal:17'],
      validityRef:'validity:17'
    }],
    candidates:[
      {optionId:'do-nothing',expected:{labourCost:0,planAttainmentPct:80},uncertainty:{aggregate:0.15},constraintViolationProbability:0,hardConstraintsPassed:true},
      {optionId:'overtime',expected:{labourCost:250,planAttainmentPct:98},uncertainty:{aggregate:0.1},constraintViolationProbability:0.001,hardConstraintsPassed:true}
    ],
    validity:{
      insideEnvelope:!stale,
      stale,
      outOfDistribution:false,
      modelDisagreement:false,
      assessedAt:'2026-09-23T15:00:00Z',
      evidenceRefs:[stale?'validity:stale':'validity:17']
    },
    reproducibility:{
      seed:'seed-17',
      codeDigest:'code:17',
      environmentDigest:'env:17',
      solverVersions:['vector-des@17']
    }
  });

  const assurance=f.createAssuranceEnvelope({
    episode,
    simulationPassport:passport,
    unknownsAssessment:{level:'KNOWN',autonomyCeiling:'FULL_BOUNDED',reasons:[]},
    actionContract:{
      actionType:'workforce.overtime_override',
      riskClass:'LOW',
      reversibility:'REVERSIBLE',
      maxBlastRadius:1,
      preconditions:['employee-active','rest-compliant'],
      postconditions:['overtime-visible','coverage-restored']
    },
    authority:{
      grantRef:'grant:demo',
      expiresAt:'2026-09-23T16:00:00Z',
      riskCeiling:'LOW',
      blastRadiusCeiling:1
    },
    verifier:{
      executorId:'workforce-lifecycle-executor',
      verifierId:'workforce-lifecycle-verifier',
      independentReadBack:true
    },
    causalPlan:{
      primaryOutcome:'planAttainmentPct',
      baselineMethod:'SWITCHBACK',
      evidenceGrade:'RANDOMIZED',
      outcomeWindow:'PT8H',
      guardrails:['quality','working-time']
    }
  });

  let executionAllowed=false;
  let gateReason=null;
  try{
    executionAllowed=f.assertExecutionAllowed(assurance,{
      requestedMode:'BOUNDED_AUTO',
      at:'2026-09-23T15:30:00Z',
      expectedEpisodeId:episode.episodeId,
      expectedContextRevision:episode.contextRevision,
      expectedActionType:'workforce.overtime_override'
    });
  }catch(error){
    gateReason=error.message;
  }

  return {
    identity:IDENTITY,
    scenario:stale?'STALE_SIMULATION':'FRESH_SIMULATION',
    factoryEvent:'Operator E17 unavailable; compare no action with 60 minutes overtime.',
    predictedOptions:passport.candidates,
    passportValid:f.validateSimulationPassport(passport),
    assuranceValid:f.validateAssuranceEnvelope(assurance),
    simulationValidity:passport.validity,
    autonomy:assurance.autonomy,
    execution:{allowed:executionAllowed,reason:gateReason},
    passportDigest:passport.passportDigest,
    assuranceDigest:assurance.assuranceDigest
  };
}

function learning(){
  const observational=f.createCausalPromotionAssessment({
    evidenceGrade:'OBSERVATIONAL',
    effect:0.04,
    confidenceInterval:{low:0.01,high:0.07},
    replicated:true,
    guardrailsPassed:true,
    driftFree:true,
    independentlyReviewed:true
  });
  const replicated=f.createCausalPromotionAssessment({
    evidenceGrade:'REPLICATED',
    effect:0.04,
    confidenceInterval:{low:0.015,high:0.065},
    replicated:true,
    guardrailsPassed:true,
    driftFree:true,
    independentlyReviewed:true
  });
  return {
    identity:IDENTITY,
    outcome:{
      predictedPlanAttainmentPct:98,
      verifiedPlanAttainmentPct:97,
      predictedLabourCost:250,
      verifiedLabourCost:245
    },
    observational:{
      promotionEligible:observational.promotionEligible,
      maySelfPromote:observational.maySelfPromote,
      maySelfGrantAuthority:observational.maySelfGrantAuthority
    },
    replicated:{
      promotionEligible:replicated.promotionEligible,
      maySelfPromote:replicated.maySelfPromote,
      maySelfGrantAuthority:replicated.maySelfGrantAuthority
    }
  };
}

function json(res,status,payload){
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-vector-app':IDENTITY});
  res.end(JSON.stringify(payload,null,2));
}

const html=fs.readFileSync('/app/demo/t9-wow.html','utf8');

const server=http.createServer((req,res)=>{
  try{
    const u=new URL(req.url,'http://localhost');
    if(u.pathname==='/healthz') return json(res,200,{identity:IDENTITY,status:'OK'});
    if(u.pathname==='/api/run') return json(res,200,runScenario(u.searchParams.get('mode')==='stale'));
    if(u.pathname==='/api/learning') return json(res,200,learning());
    if(u.pathname==='/'){
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-vector-app':IDENTITY});
      return res.end(html);
    }
    return json(res,404,{identity:IDENTITY,error:'NOT_FOUND'});
  }catch(error){
    return json(res,500,{identity:IDENTITY,error:error.message});
  }
});

const LISTEN_PORT=3000;
server.listen(LISTEN_PORT,'0.0.0.0',()=>{
  console.log(IDENTITY+' LISTENING '+LISTEN_PORT+' PUBLIC_TARGET=3000');
});
