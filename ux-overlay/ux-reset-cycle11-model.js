/* WFM UX evolution cycle 11 model: deterministic, source-bound action prioritisation. */
(function(root){
'use strict';
const REASONS=Object.freeze({
  PAYROLL_CUTOFF:{weight:100,urgent:true,label:'Payroll cutoff'},
  COMPLIANCE_BLOCKER:{weight:100,urgent:true,label:'Compliance blocker'},
  SIGNOFF_STALE:{weight:96,urgent:true,label:'Signed week changed'},
  TIME_EXCEPTION_OPEN:{weight:90,urgent:true,label:'Time exception open'},
  COVERAGE_BLOCKER:{weight:86,urgent:true,label:'Coverage blocker'},
  UNFILLED_SHIFT:{weight:82,urgent:true,label:'Unfilled shift'},
  SIGNOFF_RETURNED:{weight:78,urgent:false,label:'Week returned'},
  LEAVE_COVERAGE_RISK:{weight:72,urgent:false,label:'Leave coverage risk'},
  SIGNOFF_READY:{weight:56,urgent:false,label:'Ready to sign'},
  LEAVE_DECISION_PENDING:{weight:46,urgent:false,label:'Leave decision pending'},
  NEEDS_REVIEW:{weight:40,urgent:false,label:'Needs review'},
  INFORMATION:{weight:10,urgent:false,label:'Information'}
});
const LIFECYCLES=new Set(['action_required','decision_sent','confirming_source','needs_verification','resolved']);
const KINDS=new Set(['action','information','receipt']);
const SOURCES=new Set(['absence','time-review','weekly-review','schedule-publication','today','automation']);
const nowMs=()=>Date.now();
const parseTime=v=>{const n=Date.parse(v||'');return Number.isFinite(n)?n:null;};
function normalise(input,now=nowMs()){
  const reason=REASONS[input?.reasonCode]||REASONS.NEEDS_REVIEW;
  const kind=KINDS.has(input?.kind)?input.kind:'action';
  const lifecycle=LIFECYCLES.has(input?.lifecycle)?input.lifecycle:(kind==='receipt'?'resolved':'action_required');
  const source=SOURCES.has(input?.source)?input.source:'today';
  const evidenceState=['current','stale','missing','unknown'].includes(input?.evidenceState)?input.evidenceState:'unknown';
  const mandatory=Boolean(input?.mandatory);
  const deadline=parseTime(input?.deadline);
  const createdAt=parseTime(input?.createdAt);
  let priority=reason.weight;
  if(kind!=='action'||lifecycle==='resolved')priority=0;
  if(['decision_sent','confirming_source'].includes(lifecycle))priority=Math.max(1,priority-8);
  if(lifecycle==='needs_verification')priority=Math.max(priority,48);
  // Missing/stale evidence can never manufacture a blocker/urgent state.
  if(evidenceState!=='current'&&priority>=80)priority=Math.min(priority,50);
  const urgent=kind==='action'&&lifecycle!=='resolved'&&evidenceState==='current'&&reason.urgent&&priority>=80;
  return Object.freeze({
    id:String(input?.id||`${source}:${input?.reasonCode||'NEEDS_REVIEW'}:${createdAt||0}`),
    kind,lifecycle,source,reasonCode:REASONS[input?.reasonCode]?input.reasonCode:'NEEDS_REVIEW',
    reasonLabel:reason.label,priority,urgent,mandatory,
    title:String(input?.title||reason.label),
    whyNow:String(input?.whyNow||reason.label),
    consequence:input?.consequence==null?'':String(input.consequence),
    authority:String(input?.authority||'Source workflow authority required'),
    evidenceState,evidenceLabel:String(input?.evidenceLabel||'Evidence status unavailable'),
    route:String(input?.route||source),
    deadline,createdAt,
    automated:Boolean(input?.automated),
    auditRef:input?.auditRef==null?'':String(input.auditRef),
    policy:input?.policy==null?'':String(input.policy),
    reversible:input?.reversible===true,
    sourceId:input?.sourceId==null?'':String(input.sourceId),
    meta:input?.meta&&typeof input.meta==='object'?Object.freeze({...input.meta}):Object.freeze({})
  });
}
function compare(a,b){
  const unresolved=x=>x.kind==='action'&&x.lifecycle!=='resolved';
  if(unresolved(a)!==unresolved(b))return unresolved(a)?-1:1;
  if(a.priority!==b.priority)return b.priority-a.priority;
  if(a.mandatory!==b.mandatory)return a.mandatory?-1:1;
  if(a.deadline!==b.deadline){
    if(a.deadline==null)return 1;if(b.deadline==null)return -1;return a.deadline-b.deadline;
  }
  if(a.createdAt!==b.createdAt){
    if(a.createdAt==null)return 1;if(b.createdAt==null)return -1;return a.createdAt-b.createdAt;
  }
  return a.id.localeCompare(b.id);
}
function newestFirst(a,b){return (b.createdAt||0)-(a.createdAt||0)||a.id.localeCompare(b.id);}
function build(inputs,now=nowMs()){
  const items=(Array.isArray(inputs)?inputs:[]).map(x=>normalise(x,now));
  const actions=items.filter(x=>x.kind==='action'&&x.lifecycle!=='resolved').sort(compare);
  // Automation receipts stay distinct from source-confirmed human decisions. Never imply judgment was automated.
  const receipts=items.filter(x=>x.kind==='receipt'||x.automated).sort(newestFirst);
  const resolved=items.filter(x=>x.kind==='action'&&x.lifecycle==='resolved'&&!x.automated).sort(newestFirst);
  const information=items.filter(x=>x.kind==='information').sort(compare);
  return Object.freeze({actions:Object.freeze(actions),receipts:Object.freeze(receipts),resolved:Object.freeze(resolved),information:Object.freeze(information),all:Object.freeze(items)});
}
function reason(reasonCode){return REASONS[reasonCode]||REASONS.NEEDS_REVIEW;}
root.WFMUXCycle11Model=Object.freeze({REASONS,normalise,compare,build,reason});
})(typeof window!=='undefined'?window:globalThis);
