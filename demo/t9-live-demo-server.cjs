'use strict';

const http=require('node:http');
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

const html=`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vector T9 Live Proof</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0d1117;color:#f0f6fc;margin:0;padding:24px}
main{max-width:900px;margin:auto}.tag{color:#8b949e;font-size:13px}.card{background:#161b22;border:1px solid #30363d;border-radius:16px;padding:18px;margin:14px 0}
h1{font-size:32px;margin:8px 0}h2{font-size:20px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
button{background:#238636;border:0;color:white;border-radius:10px;padding:12px 16px;font-weight:700;margin-right:8px}
button.alt{background:#da3633}.pill{display:inline-block;border-radius:999px;padding:4px 9px;background:#21262d;margin:3px;font-size:12px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#0d1117;border-radius:10px;padding:14px;font-size:12px}
.good{color:#3fb950}.bad{color:#f85149}@media(max-width:700px){.grid{grid-template-columns:1fr}}
</style></head>
<body><main>
<div class="tag">${IDENTITY} · isolated synthetic factory proof</div>
<h1>Vector T9 decision control — live</h1>
<p>This page calls the actual T9 decision-control runtime in this hosted container. It does not mutate production or customer data.</p>
<div class="grid">
  <div class="card"><h2>Fresh evidence</h2><p>Low risk, reversible, independently verifiable.</p><button onclick="run('fresh')">Run fresh decision</button></div>
  <div class="card"><h2>Stale evidence</h2><p>Same decision, but the simulation is stale.</p><button class="alt" onclick="run('stale')">Run stale decision</button></div>
</div>
<div class="card"><h2>Result</h2><div id="summary">Choose a scenario.</div><pre id="result"></pre></div>
<div class="card"><h2>Causal learning gate</h2><button onclick="learn()">Run learning gate</button><pre id="learning"></pre></div>
<script>
async function run(mode){
 const r=await fetch('/api/run?mode='+mode); const x=await r.json();
 document.getElementById('summary').innerHTML =
  '<span class="pill">Passport '+(x.passportValid?'VALID':'INVALID')+'</span>'+
  '<span class="pill">Assurance '+(x.assuranceValid?'VALID':'INVALID')+'</span>'+
  '<span class="pill">Autonomy '+x.autonomy.ceiling+'</span>'+
  '<span class="'+(x.execution.allowed?'good':'bad')+'">'+(x.execution.allowed?' EXECUTION ALLOWED':' EXECUTION BLOCKED')+'</span>';
 document.getElementById('result').textContent=JSON.stringify(x,null,2);
}
async function learn(){const r=await fetch('/api/learning');document.getElementById('learning').textContent=JSON.stringify(await r.json(),null,2);}
</script>
</main></body></html>`;

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

server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>{
  console.log(IDENTITY+' LISTENING '+String(process.env.PORT||3000));
});
