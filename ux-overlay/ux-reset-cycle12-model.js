/* WFM UX evolution cycle 12 model: governed capability-signal contract for one unified action surface. */
(function(root){
'use strict';
const PROVIDERS=Object.freeze({
  implementation:{label:'Implementation',defaultRoute:'onboarding'},
  integrations:{label:'Integrations',defaultRoute:'integrations'},
  attendance:{label:'Attendance',defaultRoute:'attendance'},
  agency:{label:'Agency labour',defaultRoute:'temporary'},
  'manufacturing-cost':{label:'Manufacturing cost',defaultRoute:'costs'},
  energy:{label:'Energy',defaultRoute:'insights'},
  support:{label:'Support',defaultRoute:'support'},
  learning:{label:'Learning',defaultRoute:'onboarding'},
  handover:{label:'Shift handover',defaultRoute:'handover'},
  documents:{label:'Documents',defaultRoute:'support'},
  payroll:{label:'Payroll',defaultRoute:'payroll-run'}
});
const KINDS=new Set(['action','information','receipt']);
const LIFECYCLES=new Set(['action_required','decision_sent','confirming_source','needs_verification','resolved']);
const EVIDENCE=new Set(['current','stale','missing','unknown']);
const REASONS=new Set([
  'IMPLEMENTATION_BLOCKER','ATTENDANCE_GAP','PAYROLL_VALIDATION','HANDOVER_CRITICAL',
  'INTEGRATION_DEGRADED','AGENCY_COVER_SHORTAGE','PRODUCTION_DISRUPTION',
  'COST_SAVING_OPPORTUNITY','ENERGY_SAVING_OPPORTUNITY','TRAINING_DUE',
  'DOCUMENT_ACK_REQUIRED','SUPPORT_RECOVERY','NEEDS_REVIEW','INFORMATION'
]);
function provider(providerId){return PROVIDERS[providerId]||null;}
function normalise(providerId,input){
  const p=provider(providerId);if(!p||!input||typeof input!=='object')return null;
  const id=String(input.id||'').trim();if(!id)return null;
  const kind=KINDS.has(input.kind)?input.kind:'action';
  const lifecycle=LIFECYCLES.has(input.lifecycle)?input.lifecycle:(kind==='receipt'?'resolved':'action_required');
  const evidenceState=EVIDENCE.has(input.evidenceState)?input.evidenceState:'unknown';
  const reasonCode=REASONS.has(input.reasonCode)?input.reasonCode:(kind==='information'?'INFORMATION':'NEEDS_REVIEW');
  // Providers own facts, not presentation authority. The source is always bound to the registered provider.
  return Object.freeze({
    id:`${providerId}:${id}`,
    source:providerId,
    sourceId:input.sourceId==null?id:String(input.sourceId),
    route:String(input.route||p.defaultRoute),
    reasonCode,kind,lifecycle,evidenceState,
    evidenceLabel:String(input.evidenceLabel||'Source evidence not yet verified'),
    title:String(input.title||p.label),
    whyNow:String(input.whyNow||'Review the source workflow.'),
    consequence:input.consequence==null?'':String(input.consequence),
    authority:String(input.authority||'Source workflow authority required'),
    deadline:input.deadline||null,createdAt:input.createdAt||null,
    mandatory:Boolean(input.mandatory),automated:Boolean(input.automated),
    auditRef:input.auditRef==null?'':String(input.auditRef),
    policy:input.policy==null?'':String(input.policy),reversible:input.reversible===true,
    meta:Object.freeze(input.meta&&typeof input.meta==='object'?{...input.meta}:{})
  });
}
function implementationSignals(status){
  const out=[];if(!status||typeof status!=='object')return Object.freeze(out);
  const state=String(status.state||'');if(!state||['NOT_STARTED','AWAITING_CUSTOMER_START','INVITATION_EXPIRED'].includes(state))return Object.freeze(out);
  const completed=Number(status.completedRequirements||0),total=Number(status.totalRequirements||0);
  const requirements=Array.isArray(status.requirements)?status.requirements:[];
  const missing=requirements.filter(x=>x&&!x.satisfied);
  const decisions=Array.isArray(status.blockingDecisions)?status.blockingDecisions:[];
  for(const d of decisions){
    if(!d?.key)continue;
    out.push({id:'decision:'+d.key,sourceId:d.key,route:'onboarding',reasonCode:'IMPLEMENTATION_BLOCKER',kind:'action',lifecycle:'action_required',evidenceState:'current',evidenceLabel:`Implementation decision ${d.status||'PENDING'} - risk ${d.risk||'HIGH'}`,title:String(d.question||'Implementation decision required'),whyNow:'This authorised decision is blocking implementation readiness.',consequence:'Go-live remains blocked until the source workflow records an authorised outcome.',authority:'Authorised implementation manager or administrator',deadline:status.deadlineAt||null,createdAt:d.createdAt||status.startedAt||null,mandatory:true,auditRef:status.runId?`Implementation run ${status.runId}`:''});
  }
  if(missing.length){
    const anyObserved=missing.some(x=>x.status==='FAIL'||x.status==='WARN');
    out.push({id:'readiness-gap',sourceId:status.runId||'current',route:'onboarding',reasonCode:'IMPLEMENTATION_BLOCKER',kind:'action',lifecycle:'action_required',evidenceState:anyObserved?'current':'missing',evidenceLabel:anyObserved?'Authoritative implementation readiness contains unresolved controls.':'Required launch evidence is incomplete.',title:`${missing.length} launch ${missing.length===1?'control':'controls'} not proven`,whyNow:`${completed}/${total||requirements.length} readiness controls are proven.`,consequence:`State ${state}${Number.isFinite(Number(status.criticalPathRemainingMinutes))?` - critical path ${Number(status.criticalPathRemainingMinutes)} min remaining`:''}.`,authority:'Implementation owner',deadline:status.deadlineAt||null,createdAt:status.startedAt||null,mandatory:true,auditRef:status.runId?`Implementation run ${status.runId}`:'',meta:{missingKeys:missing.map(x=>x.key).filter(Boolean).slice(0,20)}});
  }
  if(state==='AT_RISK'||state==='SLA_MISSED'){
    out.push({id:'target-risk',sourceId:status.runId||'current',route:'onboarding',reasonCode:'IMPLEMENTATION_BLOCKER',kind:'action',lifecycle:'action_required',evidenceState:'current',evidenceLabel:`Implementation engine state ${state}`,title:state==='SLA_MISSED'?'Implementation target missed':'Implementation target at risk',whyNow:`Critical path needs ${Number(status.criticalPathRemainingMinutes||0)} min with ${Number(status.remainingMinutes||0)} min to target.`,consequence:'The one-day launch target needs an exception decision or faster source resolution.',authority:'Implementation owner',deadline:status.deadlineAt||null,createdAt:status.startedAt||null,mandatory:true,auditRef:status.runId?`Implementation run ${status.runId}`:''});
  }
  return Object.freeze(out.map(x=>Object.freeze(x)));
}
function collect(registry){
  const out=[];if(!registry||typeof registry.entries!=='function')return Object.freeze(out);
  for(const [providerId,getter] of registry.entries()){
    if(!provider(providerId)||typeof getter!=='function')continue;
    let rows=[];try{rows=getter();}catch{rows=[];}
    if(!Array.isArray(rows))continue;
    for(const row of rows){const item=normalise(providerId,row);if(item)out.push(item);}
  }
  return Object.freeze(out);
}
root.WFMUXCycle12Model=Object.freeze({PROVIDERS,normalise,implementationSignals,collect});
})(typeof window!=='undefined'?window:globalThis);
