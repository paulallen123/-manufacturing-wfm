import http from 'node:http';

const origin=new URL(process.env.TARGET_ORIGIN).origin;
const tenant=String(process.env.TENANT||'').trim();
const expectedSha=String(process.env.EXPECTED_CANDIDATE_SHA||'').trim().toLowerCase();
const learningToken=String(process.env.WFM_LEARNING_INTERNAL_TOKEN||'');
const port=Number(process.env.PORT||3000);
let state={status:'PENDING',stage:'startup',startedAt:new Date().toISOString()};
http.createServer((req,res)=>{
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  if(req.url==='/health'||req.url==='/proof'){res.statusCode=200;return res.end(JSON.stringify(state));}
  res.statusCode=404;res.end('{}');
}).listen(port,'0.0.0.0',()=>console.log('VECTOR_LEARNING_READINESS_PROBE_LISTENING='+port));
function assert(v,m){if(!v)throw new Error(m)}
async function request(path,{method='GET',body=null,headers={}}={}){
  const h={'x-forwarded-proto':'https',...headers};
  if(body!==null)h['content-type']='application/json';
  const r=await fetch(origin+path,{method,headers:h,body:body===null?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const text=await r.text();let json=null;try{json=text?JSON.parse(text):null}catch{}
  return {status:r.status,text,json};
}
try{
  assert(tenant&&learningToken&&/^[0-9a-f]{40}$/.test(expectedSha),'learning probe configuration missing');
  state={...state,stage:'identity'};
  const id=await request('/api/runtime-identity');
  assert(id.status===200,'runtime identity HTTP '+id.status);
  assert(JSON.stringify(id.json||{}).toLowerCase().includes(expectedSha),'runtime not bound to exact candidate SHA');

  state={...state,stage:'bootstrap-summary'};
  const summary=await request('/api/learning/adaptive/bootstrap-tenant',{
    method:'POST',
    headers:{'x-wfm-learning-internal':learningToken},
    body:{tenant}
  });
  assert(summary.status===200,'adaptive learning bootstrap HTTP '+summary.status+' '+summary.text.slice(0,500));
  const s=summary.json||{};
  state={
    status:'PASS',stage:'complete',finishedAt:new Date().toISOString(),tenant,candidateSha:expectedSha,
    users:s.users??null,assignments:s.assignments??null,mastered:s.mastered??null,
    masteryPercent:s.masteryPercent??null,criticalAssignments:s.criticalAssignments??null,
    criticalMastered:s.criticalMastered??null,criticalMasteryPercent:s.criticalMasteryPercent??null,
    privilegedAssignments:s.privilegedAssignments??null,privilegedMastered:s.privilegedMastered??null,
    privilegedReady:s.privilegedReady===true,fullyCertified:s.fullyCertified===true
  };
  console.log('VECTOR_LEARNING_READINESS_PROBE=PASS|'+JSON.stringify(state));
}catch(error){
  state={status:'FAIL',stage:'failed',finishedAt:new Date().toISOString(),tenant,candidateSha:expectedSha||null,error:String(error?.stack||error).slice(0,5000)};
  console.error('VECTOR_LEARNING_READINESS_PROBE=FAIL|'+JSON.stringify(state));
}
