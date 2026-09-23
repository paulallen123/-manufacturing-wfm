'use strict';

const STATES=Object.freeze(['UNSEEN','LEARNING','PRACTISING','DEMONSTRATED','RETENTION_DUE','MASTERED']);
const AUTHENTIC=new Set(['INDEPENDENT_TASK','OBSERVED_SUCCESS','TEACH_BACK']);
const RETRIEVAL=new Set(['RETRIEVAL_CHECK','INDEPENDENT_TASK','OBSERVED_SUCCESS','TEACH_BACK']);

function safeJson(value){
  try{return value&&typeof value==='object'?value:JSON.parse(String(value||'{}'));}catch{return {};}
}
function iso(value){
  const ms=Date.parse(String(value||''));
  return Number.isFinite(ms)?new Date(ms).toISOString():null;
}
function buildLearnerMemory(input={}){
  const assignment=input.assignment||{};
  const evidence=Array.isArray(input.evidence)?input.evidence:[];
  const recentHelp=Math.max(0,Number(input.recentHelp||0));
  const nowMs=Number.isFinite(Number(input.nowMs))?Number(input.nowMs):Date.now();
  const score=Math.max(0,Math.min(100,Number(assignment.score||0)));
  const dueAtMs=Number(assignment.due_at_ms||0);
  const passed=evidence.filter(item=>String(item.result).toUpperCase()==='PASS');
  const failed=evidence.filter(item=>String(item.result).toUpperCase()!=='PASS');
  const authentic=passed.filter(item=>AUTHENTIC.has(String(item.evidence_type).toUpperCase()));
  const retrieval=passed.filter(item=>RETRIEVAL.has(String(item.evidence_type).toUpperCase()));
  const errors=new Map();
  for(const item of failed){
    const detail=safeJson(item.detail_json||item.detail);
    const key=String(detail.errorType||detail.reasonCode||'UNCLASSIFIED').slice(0,120);
    errors.set(key,(errors.get(key)||0)+1);
  }
  const lastAuthentic=authentic.map(x=>iso(x.created_at)).filter(Boolean).sort().at(-1)||null;
  const lastRetrieval=retrieval.map(x=>iso(x.created_at)).filter(Boolean).sort().at(-1)||null;
  const independentSuccessCount=authentic.length;
  const retrievalSuccessCount=retrieval.length;
  const due=dueAtMs>0&&dueAtMs<=nowMs;
  let state='UNSEEN';
  if(evidence.length||score>0) state='LEARNING';
  if(passed.some(x=>String(x.evidence_type).toUpperCase()==='GUIDED_PRACTICE')||score>=40) state='PRACTISING';
  if(authentic.length||score>=80) state='DEMONSTRATED';
  if(String(assignment.status).toUpperCase()==='MASTERED'&&!due) state='MASTERED';
  if((String(assignment.status).toUpperCase()==='REFRESH_DUE'||due)&&score>=80) state='RETENTION_DUE';
  const assistanceDependence=Math.max(0,Math.min(1,recentHelp/Math.max(3,recentHelp+independentSuccessCount)));
  const evidenceQuality=authentic.some(x=>String(x.evidence_type).toUpperCase()==='OBSERVED_SUCCESS')?'VERY_HIGH':
    authentic.length?'HIGH':retrieval.length?'MEDIUM':passed.length?'LOW':'NONE';
  return Object.freeze({
    contractVersion:'VECTOR_LEARNER_MEMORY_V1',
    state,
    masteryEstimate:score,
    reviewDue:due,
    dueAt:dueAtMs?new Date(dueAtMs).toISOString():null,
    lastAuthenticPerformanceAt:lastAuthentic,
    lastRetrievalAt:lastRetrieval,
    independentSuccessCount,
    retrievalSuccessCount,
    recentHelp,
    assistanceDependence:Number(assistanceDependence.toFixed(3)),
    evidenceQuality,
    commonErrors:[...errors.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([errorType,count])=>({errorType,count})),
    evidenceCount:evidence.length
  });
}

module.exports=Object.freeze({STATES,AUTHENTIC,RETRIEVAL,buildLearnerMemory});
