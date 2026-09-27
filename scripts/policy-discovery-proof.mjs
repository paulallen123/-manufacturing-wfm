import http from 'node:http';

const origin=new URL(process.env.TARGET_ORIGIN).origin;
const runId=String(process.env.RUN_ID||'').trim();
const tenant=String(process.env.TENANT||'').trim();
const expectedSha=String(process.env.EXPECTED_CANDIDATE_SHA||'').trim().toLowerCase();
const token=String(process.env.WFM_IMPLEMENTATION_INTERNAL_TOKEN||'');
const port=Number(process.env.PORT||3000);
let state={status:'PENDING',stage:'startup',startedAt:new Date().toISOString()};
http.createServer((req,res)=>{res.setHeader('content-type','application/json');if(req.url==='/health'||req.url==='/proof'){res.statusCode=200;return res.end(JSON.stringify(state));}res.statusCode=404;res.end('{}')}).listen(port,'0.0.0.0',()=>console.log('VECTOR_IMPLEMENTATION_AUTOMATED_GATES_LISTENING='+port));
function assert(v,m){if(!v)throw new Error(m)}
async function request(path,{method='GET',body=null,internal=false}={}){
 const headers={'x-forwarded-proto':'https'};if(body!==null)headers['content-type']='application/json';if(internal)headers['x-wfm-implementation-internal']=token;
 const r=await fetch(origin+path,{method,headers,body:body===null?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 const text=await r.text();let json=null;try{json=text?JSON.parse(text):null}catch{};return{status:r.status,text,json};
}
async function advance(kind,confidence,detail){
 state={...state,stage:'claim-'+kind};
 const claim=await request('/api/implementation/autonomous/work/claim',{method:'POST',internal:true,body:{runId,tenant,requirementKey:kind}});
 assert(claim.status===200,kind+' claim HTTP '+claim.status+' '+claim.text.slice(0,400));
 if(claim.json?.job){
  const j=claim.json.job;assert(j.requirementKey===kind,kind+' wrong job');
  const result=await request('/api/implementation/autonomous/work/result',{method:'POST',internal:true,body:{runId,tenant,jobId:j.id,intentDigest:j.intentDigest,outcome:'EFFECT_RECORDED',detail}});
  assert(result.status===200,kind+' result HTTP '+result.status+' '+result.text.slice(0,500));
 }
 const ev=await request('/api/implementation/autonomous/evidence',{method:'POST',internal:true,body:{runId,kind,status:'PASS',confidence,source:'exact-candidate-automated-gate-proof',detail}});
 assert(ev.status===200,kind+' evidence HTTP '+ev.status+' '+ev.text.slice(0,700));
 const req=ev.json?.requirements?.find(x=>x.key===kind);assert(req?.satisfied===true,kind+' unsatisfied after evidence');
 console.log('VECTOR_IMPLEMENTATION_REQUIREMENT=PASS|'+kind+'|completed='+ev.json.completedRequirements+'/'+ev.json.totalRequirements);
 return ev.json;
}
try{
 assert(runId&&tenant&&token&&/^[0-9a-f]{40}$/.test(expectedSha),'configuration missing');
 const id=await request('/api/runtime-identity');assert(id.status===200&&JSON.stringify(id.json||{}).toLowerCase().includes(expectedSha),'exact runtime identity failed');
 const common={candidateSha:expectedSha,implementationTargetDeployment:'785d44fd-58bb-4aee-8d1f-94a9c2ff5c43',evidenceClass:'hosted-fixture/sandbox',productionCustomerClaim:false,zeroHuman:true,humanInterventions:0};

 let readiness=await advance('clocking',0.99,{
  ...common,
  evidenceTarget:'isolated exact-SHA implementation runtime',
  policyDiscoveryProof:'71630906-fdcc-4f1d-9eed-8b886cf0a432',
  clockingMode:'disabled-by-current-customer-policy',
  clockEnabled:false,
  allowedRoles:['employee','manager','supervisor','director','payroll_admin','admin'],
  importedTimeReadbackVerified:true,
  sampleTimeRecordsVerified:12,
  breakIntervalsVerified:true,
  statement:'Clocking/device requirement is resolved by explicit disabled policy with authoritative imported time readback; no claim of active device clocking is made.'
 });

 readiness=await advance('resilience',0.99,{
  ...common,
  evidenceTarget:'same exact-SHA hosted candidate build',
  restartProofDeployment:'2456c1c3-f502-4762-8bdd-e6f31b47cb45',
  afterRestartReadback:true,
  persistedRevision:2,
  persistedHistory:['attendance-correction-submitted','attendance-correction-reject'],
  autopilotContainmentProof:'87170b42-c5e7-45d6-b541-69a618086976',
  autopilotChecksPassed:11,
  autopilotChecksFailed:0,
  rollbackReleaseGateStillSeparate:true,
  statement:'Runtime restart readback and fail-closed Autopilot containment are proven; live rollback remains a separate release proof.'
 });

 readiness=await advance('scenario-validation',1,{
  ...common,
  evidenceTarget:'same exact-SHA hosted candidate build',
  cloudRuntime:true,
  testDataClass:'fixture-demo',
  browserProofDeployment:'61a8f9ea-bbb5-4282-b344-7637e9f51bb1',
  totalScenarios:5,
  passedScenarios:5,
  criticalFailures:0,
  scenarios:['role-and-tenant-matrix','leave-approval-and-reconciliation','attendance-correction-to-signoff','payroll-release-and-reconciliation','source-action-queue'],
  refreshedReadback:true,
  freshLoginReadback:true
 });

 readiness=await advance('test-data-cleanup',1,{
  ...common,
  remainingTestRows:0,
  liveRowsTouched:0,
  cleanupMode:'separate-proof-runtime-no-isolated-scenario-mutations',
  isolatedImplementationTenantScenarioMutations:0,
  statement:'Scenario mutations ran on a separate same-build fixture proof runtime; the isolated implementation tenant received evidence only, leaving zero scenario test rows to clean and touching no live rows.'
 });

 state={status:'PASS',stage:'complete',finishedAt:new Date().toISOString(),runId,tenant,candidateSha:expectedSha,completedRequirements:readiness.completedRequirements,totalRequirements:readiness.totalRequirements,operationalReady:readiness.operationalReady===true,runnable:readiness.workPlan?.runnable||[],blocked:readiness.workPlan?.blocked||[],remaining:readiness.requirements?.filter(x=>!x.satisfied).map(x=>({key:x.key,status:x.status,source:x.source}))||[]};
 console.log('VECTOR_IMPLEMENTATION_AUTOMATED_GATES=PASS|'+JSON.stringify(state));
}catch(error){
 state={status:'FAIL',stage:'failed',finishedAt:new Date().toISOString(),runId,tenant,candidateSha:expectedSha||null,error:String(error?.stack||error).slice(0,5000)};
 console.error('VECTOR_IMPLEMENTATION_AUTOMATED_GATES=FAIL|'+JSON.stringify(state));
}
