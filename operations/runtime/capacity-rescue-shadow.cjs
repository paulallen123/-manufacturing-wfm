'use strict';

const { createDecisionEpisode } = require('./decision-episode.cjs');

const TRIGGERS = Object.freeze(['OUTPUT_SHORTFALL','DEMAND_SURGE','CAPACITY_RISK','ORDER_AT_RISK']);
const DOMAINS = Object.freeze(['workforce','machine','material','maintenance','quality','schedule','demand','energy','upstream','downstream','unknown']);
const ACTION_TYPES = Object.freeze([
  'WORKFORCE_REALLOCATION','SKILL_SWAP','OVERTIME','AGENCY',
  'MAINTENANCE','MATERIAL_REALLOCATION','WORK_ORDER_RESEQUENCE',
  'CHANGEOVER_SHIFT','BREAK_RESEQUENCE','CROSS_LINE_REBALANCE',
  'CROSS_SITE_REBALANCE','DO_NOTHING'
]);

function text(v,max=240){ return String(v??'').trim().slice(0,max); }
function list(v,max=50,maxLen=220){ return Array.isArray(v)?[...new Set(v.map(x=>text(x,maxLen)).filter(Boolean))].slice(0,max):[]; }
function num(v,name,{min=-Infinity,max=Infinity,nullable=false}={}){
  if(v==null&&nullable) return null;
  const n=Number(v);
  if(!Number.isFinite(n)||n<min||n>max) throw new Error(name+' is invalid.');
  return n;
}
function clone(v){ return v==null?v:JSON.parse(JSON.stringify(v)); }

function normaliseConstraint(input={}){
  const id=text(input.id,120);
  if(!id) throw new Error('Constraint id is required.');
  const domain=DOMAINS.includes(text(input.domain,40).toLowerCase())?text(input.domain,40).toLowerCase():'unknown';
  const confidence=num(input.confidence??0, 'constraint confidence',{min:0,max:1});
  const severity=num(input.severity??0, 'constraint severity',{min:0,max:1});
  const limitingImpactPct=num(input.limitingImpactPct??0,'constraint limitingImpactPct',{min:0,max:100});
  const evidenceRefs=list(input.evidenceRefs,30,220);
  if(!evidenceRefs.length) throw new Error('Constraint evidence is required.');
  const score=confidence*severity*Math.max(0.01,limitingImpactPct/100);
  return Object.freeze({
    id,domain,label:text(input.label,180)||id,confidence,severity,limitingImpactPct,
    score:Number(score.toFixed(8)),
    evidenceRefs,
    reasonCodes:list(input.reasonCodes,20,100)
  });
}

function normaliseAction(input={},planId){
  const id=text(input.id,120)||planId+'-action';
  const type=text(input.type,60).toUpperCase();
  if(!ACTION_TYPES.includes(type)) throw new Error('Unsupported Capacity Rescue action type.');
  return Object.freeze({
    id,type,
    target:text(input.target,180)||null,
    reversible:input.reversible===true,
    requiresApproval:input.requiresApproval!==false,
    dependsOn:list(input.dependsOn,20,120),
    preconditions:list(input.preconditions,30,180),
    evidenceRefs:list(input.evidenceRefs,30,220)
  });
}

function economicValue(input={}){
  const keys=['recoveredContribution','avoidedDowntime','avoidedExpedite','avoidedLabourPremium','avoidedScrap','interventionCost','inducedDownstreamCost'];
  const out={};
  for(const k of keys) out[k]=num(input[k]??0,'economic '+k);
  out.netRecoveredValue=
    out.recoveredContribution+out.avoidedDowntime+out.avoidedExpedite+
    out.avoidedLabourPremium+out.avoidedScrap-out.interventionCost-out.inducedDownstreamCost;
  out.netRecoveredValue=Number(out.netRecoveredValue.toFixed(2));
  return out;
}

function causalEvidence(input={}){
  const comparable=Math.max(0,Math.floor(num(input.comparableInterventions??0,'comparableInterventions',{min:0})));
  const sourceDiversity=num(input.sourceDiversity??0,'sourceDiversity',{min:0,max:1});
  const dataCompleteness=num(input.dataCompleteness??0,'dataCompleteness',{min:0,max:1});
  const simulatorCalibration=num(input.simulatorCalibration??0,'simulatorCalibration',{min:0,max:1});
  const matchedControl=input.matchedControl===true;
  const experimental=input.experimental===true;
  let status='HYPOTHESIS_ONLY';
  if(experimental) status='EXPERIMENTAL_EVIDENCE';
  else if(matchedControl&&comparable>=2) status='CONTROLLED_ESTIMATE';
  else if(comparable>=3) status='OBSERVATIONAL_SUPPORT';
  const sampleFactor=Math.min(1,comparable/10);
  const design=experimental?1:matchedControl?0.8:comparable>=3?0.55:0.25;
  const confidence=Math.max(0,Math.min(1,
    0.3*dataCompleteness+0.2*sourceDiversity+0.2*simulatorCalibration+0.15*sampleFactor+0.15*design
  ));
  return Object.freeze({
    status,
    confidence:Number(confidence.toFixed(6)),
    comparableInterventions:comparable,
    matchedControl,experimental,sourceDiversity,dataCompleteness,simulatorCalibration
  });
}

function normalisePlan(input={}){
  const id=text(input.id,120);
  if(!id) throw new Error('Capacity Rescue plan id is required.');
  const actions=(Array.isArray(input.actions)?input.actions:[]).map(a=>normaliseAction(a,id));
  if(id==='do-nothing'&&actions.length===0) actions.push(normaliseAction({id:'do-nothing',type:'DO_NOTHING',reversible:true,requiresApproval:false},id));
  if(!actions.length) throw new Error('Non-empty Capacity Rescue actions are required.');
  const ids=new Set(actions.map(a=>a.id));
  for(const a of actions) for(const dep of a.dependsOn) if(!ids.has(dep)) throw new Error('Capacity Rescue action dependency is missing: '+dep);
  const nonWorkforce=actions.some(a=>['MAINTENANCE','MATERIAL_REALLOCATION','WORK_ORDER_RESEQUENCE','CHANGEOVER_SHIFT','CROSS_LINE_REBALANCE','CROSS_SITE_REBALANCE'].includes(a.type));
  const highConsequence=actions.some(a=>['MAINTENANCE','CROSS_SITE_REBALANCE'].includes(a.type)||a.reversible!==true);
  return Object.freeze({
    id,label:text(input.label,200)||id,
    feasible:input.feasible===true,
    policyAllowed:input.policyAllowed===true,
    hardConstraintsPassed:input.hardConstraintsPassed===true,
    uncertainty:num(input.uncertainty??1,'plan uncertainty',{min:0,max:1}),
    prediction:clone(input.prediction||{}),
    evidenceRefs:list(input.evidenceRefs,30,220),
    reasonCodes:list(input.reasonCodes,20,100),
    actions,
    economic:economicValue(input.economic||{}),
    causalEvidence:causalEvidence(input.causalEvidence||{}),
    executionClass:highConsequence?'ADVISORY_ONLY':nonWorkforce?'APPROVAL_REQUIRED':'EXISTING_AUTHORITY_ONLY'
  });
}

function buildCapacityRescueShadow(input={}){
  const triggerKind=text(input.triggerKind,80).toUpperCase();
  if(!TRIGGERS.includes(triggerKind)) throw new Error('Unsupported Capacity Rescue trigger.');
  const sourceEvidence=list(input.sourceEvidence,60,220);
  if(!sourceEvidence.length) throw new Error('Capacity Rescue source evidence is required.');

  const state=input.state&&typeof input.state==='object'&&!Array.isArray(input.state)?clone(input.state):{};
  const targetUnits=num(state.targetUnits??state.demandUnits??0,'targetUnits',{min:0});
  const projectedUnits=num(state.projectedUnits??0,'projectedUnits',{min:0});
  const currentUnits=num(state.currentUnits??0,'currentUnits',{min:0});
  const plannedHeadcount=num(state.plannedHeadcount??0,'plannedHeadcount',{min:0});
  const staffedHeadcount=num(state.staffedHeadcount??0,'staffedHeadcount',{min:0});
  const fullyManned=plannedHeadcount>0&&staffedHeadcount>=plannedHeadcount;
  const capacityGapUnits=Math.max(0,targetUnits-projectedUnits);

  const constraints=(Array.isArray(input.constraints)?input.constraints:[]).map(normaliseConstraint)
    .sort((a,b)=>b.score-a.score||b.confidence-a.confidence||a.id.localeCompare(b.id));
  if(!constraints.length) throw new Error('At least one evidenced Capacity Rescue constraint is required.');
  const primaryConstraint=constraints[0];

  const plans=(Array.isArray(input.plans)?input.plans:[]).map(normalisePlan);
  if(plans.length<2) throw new Error('At least two Capacity Rescue plans are required.');
  if(!plans.some(p=>p.id==='do-nothing')) throw new Error('Capacity Rescue requires a do-nothing plan.');

  const labourOnly=p=>p.actions.every(a=>['WORKFORCE_REALLOCATION','SKILL_SWAP','OVERTIME','AGENCY','DO_NOTHING'].includes(a.type));
  const labourQuantityPlan=p=>p.actions.some(a=>['OVERTIME','AGENCY'].includes(a.type));
  const labourAdditionSuppressed=fullyManned&&primaryConstraint.domain!=='workforce';

  const mappedPlans=plans.map(p=>{
    const forceIneligible=labourAdditionSuppressed&&labourQuantityPlan(p)&&p.id!=='do-nothing';
    return {
      ...p,
      feasible:forceIneligible?false:p.feasible,
      hardConstraintsPassed:forceIneligible?false:p.hardConstraintsPassed,
      reasonCodes:forceIneligible?[...new Set([...p.reasonCodes,'LABOUR_QUANTITY_NOT_PRIMARY_CONSTRAINT'])]:p.reasonCodes,
      labourOnly:labourOnly(p)
    };
  });

  const doNothing=mappedPlans.find(p=>p.id==='do-nothing');
  const counterfactuals=mappedPlans.map(p=>({
    planId:p.id,
    throughputDelta:Number((Number(p.prediction?.throughputUnits??0)-Number(doNothing?.prediction?.throughputUnits??0)).toFixed(3)),
    planAttainmentDelta:Number((Number(p.prediction?.planAttainmentPct??0)-Number(doNothing?.prediction?.planAttainmentPct??0)).toFixed(3)),
    labourCostDelta:Number((Number(p.prediction?.labourCost??0)-Number(doNothing?.prediction?.labourCost??0)).toFixed(2)),
    delayMinutesDelta:Number((Number(p.prediction?.delayMinutes??0)-Number(doNothing?.prediction?.delayMinutes??0)).toFixed(2)),
    netRecoveredValue:p.economic.netRecoveredValue,
    causalStatus:p.causalEvidence.status,
    causalConfidence:p.causalEvidence.confidence
  }));

  const episode=createDecisionEpisode({
    tenant:input.tenant,
    site:input.site,
    decisionType:'capacity-rescue',
    triggerId:input.triggerId,
    triggeredAt:input.triggeredAt,
    contextRevision:input.contextRevision,
    mode:'SHADOW',
    sourceEvidence,
    objective:input.objective,
    options:mappedPlans.map(p=>({
      id:p.id,label:p.label,feasible:p.feasible,policyAllowed:p.policyAllowed,
      hardConstraintsPassed:p.hardConstraintsPassed,uncertainty:p.uncertainty,
      prediction:p.prediction,evidenceRefs:p.evidenceRefs,reasonCodes:p.reasonCodes
    }))
  });

  const recommended=mappedPlans.find(p=>p.id===episode.recommendation.recommendedOptionId)||null;
  return Object.freeze({
    contractVersion:'VECTOR_CAPACITY_RESCUE_SHADOW_V1',
    triggerKind,
    state:{...state,targetUnits,projectedUnits,currentUnits,plannedHeadcount,staffedHeadcount,fullyManned,capacityGapUnits},
    constraintAssessment:{
      primaryConstraint,
      rankedConstraints:constraints,
      labourAdditionSuppressed,
      explanation:labourAdditionSuppressed
        ?'Headcount is already at or above plan and the primary evidenced constraint is not workforce quantity.'
        :'Workforce quantity has not been automatically excluded; compare marginal value against other constraints.'
    },
    interventionGraph:{
      plans:mappedPlans.map(p=>({id:p.id,label:p.label,actions:p.actions,executionClass:p.executionClass,economic:p.economic,causalEvidence:p.causalEvidence})),
      counterfactuals
    },
    recommendedPlan:recommended?{
      id:recommended.id,label:recommended.label,actions:recommended.actions,
      executionClass:recommended.executionClass,economic:recommended.economic,
      causalEvidence:recommended.causalEvidence
    }:null,
    shadowOnly:true,
    executionPermitted:false,
    episode
  });
}

module.exports=Object.freeze({
  TRIGGERS,DOMAINS,ACTION_TYPES,buildCapacityRescueShadow,normaliseConstraint,normalisePlan
});
