'use strict';

const UX_CONTRACT_VERSION='VECTOR_SCHEDULING_SIMPLICITY_V1';

const UX_BUDGET=Object.freeze({
  topLevelNavigationAdditions:0,
  planTabAdditions:0,
  permanentPanelsAdded:0,
  maxPrimaryActionsPerTask:1,
  maxSecondaryActionsPerTask:1,
  maxVisibleMetrics:3,
  maxVisibleReasonLines:2,
  maxDefaultTaskCards:5,
  advancedDetailsOpenByDefault:false
});

const OUTCOME_ACTIONS=Object.freeze({
  COVERAGE_GAP:{label:'Review cover',route:'cover'},
  REPAIR_READY:{label:'Review change',route:'schedule-publication'},
  RISK_REVIEW:{label:'Review risk',route:'compliance'}
});

function n(v,f=0){const x=Number(v);return Number.isFinite(x)?x:f;}
function count(v){return Math.max(0,Math.trunc(n(v,0)));}
function clean(v,max=160){return String(v??'').replace(/\s+/g,' ').trim().slice(0,max);}
function reasonsFrom(plan){
  const rows=[];
  for(const gap of Array.isArray(plan?.unfilled)?plan.unfilled:[]){
    for(const item of Array.isArray(gap?.topReasons)?gap.topReasons:[]){
      const reason=clean(item?.reason,100);
      if(reason&&!rows.includes(reason)) rows.push(reason);
      if(rows.length>=UX_BUDGET.maxVisibleReasonLines) return rows;
    }
  }
  return rows;
}
function metricsFrom(plan){
  const q=plan?.quality||{};
  const items=[];
  if(Number.isFinite(Number(q.coveragePct))) items.push({label:'Coverage',value:Number(q.coveragePct).toFixed(0)+'%'});
  if(Number.isFinite(Number(q.overtimeHours))&&Number(q.overtimeHours)>0) items.push({label:'Overtime',value:Number(q.overtimeHours).toFixed(1)+'h'});
  if(Number.isFinite(Number(q.labourCost))&&Number(q.labourCost)>0) items.push({label:'Labour cost',value:'£'+Number(q.labourCost).toFixed(0)});
  return items.slice(0,UX_BUDGET.maxVisibleMetrics);
}
function action(type){
  const a=OUTCOME_ACTIONS[type];
  return a?{label:a.label,route:a.route}:null;
}
function buildSchedulingTaskExperience(input={}){
  const plan=input.plan||null,repair=input.repair||null;
  if(!plan){
    return Object.freeze({
      contractVersion:UX_CONTRACT_VERSION,status:'EVIDENCE_UNAVAILABLE',
      title:'Schedule evidence unavailable',
      summary:'VECTOR will show a decision only when current scheduling evidence is available.',
      metrics:[],primaryAction:null,secondaryAction:null,
      details:{defaultOpen:false,reasons:[],technical:null},
      userTaskCount:0
    });
  }
  const gaps=count(plan?.quality?.unfilledSlots);
  const fatigue=count(plan?.quality?.fatigueRiskAssignments);
  const changes=count(repair?.changeCount);
  let status='READY',title='Schedule ready',summary='No manager action is required.';
  let primaryAction=null;

  if(changes>0){
    status='REPAIR_READY';
    title=changes===1?'1 schedule change ready':changes+' schedule changes ready';
    summary='VECTOR has recalculated the schedule and kept the existing plan stable where possible.';
    primaryAction=action('REPAIR_READY');
  }else if(gaps>0){
    status='COVERAGE_GAP';
    title=gaps===1?'1 staffing gap':' '+gaps+' staffing gaps';
    title=title.trim();
    summary='VECTOR has already checked qualified internal, cross-site, overtime, contingent and agency options.';
    primaryAction=action('COVERAGE_GAP');
  }else if(fatigue>0){
    status='RISK_REVIEW';
    title=fatigue===1?'1 fatigue risk':' '+fatigue+' fatigue risks';
    title=title.trim();
    summary='The schedule is covered, but one or more assignments need a compliance review.';
    primaryAction=action('RISK_REVIEW');
  }

  const secondaryAction=(primaryAction||reasonsFrom(plan).length)?{label:'View details',kind:'disclosure'}:null;
  const out={
    contractVersion:UX_CONTRACT_VERSION,status,title,summary,
    metrics:metricsFrom(plan),primaryAction,secondaryAction,
    details:{
      defaultOpen:false,
      reasons:reasonsFrom(plan),
      technical:{planId:clean(plan.planId,180)||null,contextRevision:clean(plan.contextRevision,180)||null}
    },
    userTaskCount:primaryAction?1:0
  };
  assertSchedulingTaskSimplicity(out);
  return Object.freeze(out);
}
function assertSchedulingTaskSimplicity(view){
  const primary=view?.primaryAction?1:0,secondary=view?.secondaryAction?1:0;
  if(primary>UX_BUDGET.maxPrimaryActionsPerTask) throw new Error('Scheduling task exceeds primary-action budget.');
  if(secondary>UX_BUDGET.maxSecondaryActionsPerTask) throw new Error('Scheduling task exceeds secondary-action budget.');
  if((view?.metrics||[]).length>UX_BUDGET.maxVisibleMetrics) throw new Error('Scheduling task exceeds visible-metric budget.');
  if((view?.details?.reasons||[]).length>UX_BUDGET.maxVisibleReasonLines) throw new Error('Scheduling task exceeds visible-reason budget.');
  if(view?.details?.defaultOpen!==false) throw new Error('Advanced scheduling details must use progressive disclosure.');
  if(view?.userTaskCount!==(view?.primaryAction?1:0)) throw new Error('User task count must reflect only the required outcome action.');
  const labels=[view?.primaryAction?.label,view?.secondaryAction?.label].filter(Boolean).map(x=>clean(x,80).toLowerCase());
  for(const label of labels){
    if(/run ai|recalculate|optimise|optimize|execute solver|generate schedule/.test(label)){
      throw new Error('Scheduling actions must describe the customer outcome, not internal machinery.');
    }
  }
  return true;
}
function simplicityContract(){
  return Object.freeze({
    contractVersion:UX_CONTRACT_VERSION,
    budget:{...UX_BUDGET},
    principles:[
      'complete-safe-work-in-background',
      'surface-exceptions-not-machinery',
      'one-user-decision-at-a-time',
      'outcome-language-not-engine-language',
      'progressive-disclosure',
      'reuse-existing-plan-and-today-surfaces',
      'no-button-without-measurable-task-value'
    ]
  });
}
module.exports=Object.freeze({UX_CONTRACT_VERSION,UX_BUDGET,buildSchedulingTaskExperience,assertSchedulingTaskSimplicity,simplicityContract});
