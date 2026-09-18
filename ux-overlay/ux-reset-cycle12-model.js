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
root.WFMUXCycle12Model=Object.freeze({PROVIDERS,normalise,collect});
})(typeof window!=='undefined'?window:globalThis);
