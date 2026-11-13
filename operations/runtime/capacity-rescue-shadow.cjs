'use strict';

const { createHash } = require('node:crypto');
const { createDecisionEpisode, BENEFIT_METRICS, COST_METRICS, snapshotData } = require('./decision-episode.cjs');

const TRIGGERS = Object.freeze(['OUTPUT_SHORTFALL','DEMAND_SURGE','CAPACITY_RISK','ORDER_AT_RISK']);
const DOMAINS = Object.freeze(['workforce','machine','material','maintenance','quality','schedule','demand','energy','upstream','downstream','unknown']);
const ACTION_TYPES = Object.freeze([
  'WORKFORCE_REALLOCATION','SKILL_SWAP','OVERTIME','AGENCY',
  'MAINTENANCE','MATERIAL_REALLOCATION','WORK_ORDER_RESEQUENCE',
  'CHANGEOVER_SHIFT','BREAK_RESEQUENCE','CROSS_LINE_REBALANCE',
  'CROSS_SITE_REBALANCE','DO_NOTHING'
]);

function text(v,max=240){ return String(v??'').trim().slice(0,max); }
function list(v,max=50,maxLen=220,name='Capacity Rescue list'){
  if(v===undefined) return [];
  if(!Array.isArray(v)||v.length>max||v.some(x=>typeof x!=='string'||!x.trim()||x.trim().length>maxLen))
    throw new Error(name+' is invalid.');
  return [...new Set(v.map(x=>x.trim()))];
}
function deepFreeze(value){
  if(value&&typeof value==='object'){
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
function num(v,name,{min=-Infinity,max=Infinity,nullable=false}={}){
  if(v==null&&nullable) return null;
  const n=typeof v==='number'?v:NaN;
  if(!Number.isFinite(n)||n<min||n>max) throw new Error(name+' is invalid.');
  return n;
}
function clone(v){ return v==null?v:JSON.parse(JSON.stringify(v)); }
function stable(v){
  if(Array.isArray(v)) return '['+v.map(stable).join(',')+']';
  if(v&&typeof v==='object') return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
  return JSON.stringify(v);
}
function digest(v){ return createHash('sha256').update(stable(v)).digest('hex'); }

function normaliseConstraint(input={}){
  const id=text(input.id,120);
  if(!id) throw new Error('Constraint id is required.');
  const domain=DOMAINS.includes(text(input.domain,40).toLowerCase())?text(input.domain,40).toLowerCase():'unknown';
  const confidence=num(input.confidence, 'constraint confidence',{min:0,max:1});
  const severity=num(input.severity, 'constraint severity',{min:0,max:1});
  const limitingImpactPct=num(input.limitingImpactPct,'constraint limitingImpactPct',{min:0,max:100});
  const evidenceRefs=list(input.evidenceRefs,30,220,'Constraint evidence');
  if(!evidenceRefs.length) throw new Error('Constraint evidence is required.');
  const score=confidence*severity*Math.max(0.01,limitingImpactPct/100);
  return deepFreeze({
    id,domain,label:text(input.label,180)||id,confidence,severity,limitingImpactPct,
    score:Number(score.toFixed(8)),
    evidenceRefs,
    reasonCodes:list(input.reasonCodes,20,100,'constraint reasonCodes')
  });
}

// Dependency edges must never be silently truncated or coerced away.
function dependencies(value){
  if(value===undefined) return [];
  if(!Array.isArray(value)||value.some(v=>typeof v!=='string'||!v.trim()||v.trim().length>120))
    throw new Error('Capacity Rescue action dependencies are invalid.');
  return [...new Set(value.map(v=>v.trim()))].sort();
}
function prediction(input={}){
  const out={};
  for(const key of ['throughputUnits','planAttainmentPct','labourCost','delayMinutes','riskScore','energyCost','qualityRisk'])
    out[key]=num(input[key],'prediction '+key,{nullable:true});
  return out;
}
function delta(value,baseline,places){
  return value==null||baseline==null?null:num(Number((value-baseline).toFixed(places)),'counterfactual delta');
}

function normaliseAction(input={},planId){
  const id=text(input.id,120)||planId+'-action';
  const type=text(input.type,60).toUpperCase();
  if(!ACTION_TYPES.includes(type)) throw new Error('Unsupported Capacity Rescue action type.');
  return deepFreeze({
    id,type,
    target:text(input.target,180)||null,
    reversible:input.reversible===true,
    requiresApproval:input.requiresApproval!==false,
    dependsOn:dependencies(input.dependsOn),
    preconditions:list(input.preconditions,30,180,'action preconditions'),
    evidenceRefs:list(input.evidenceRefs,30,220,'evidenceRefs')
  });
}

function economicValue(input={}){
  const keys=['recoveredContribution','avoidedDowntime','avoidedExpedite','avoidedLabourPremium','avoidedScrap','interventionCost','inducedDownstreamCost'];
  const out={};
  for(const k of keys) out[k]=num(input[k],'economic '+k,{min:0,nullable:true});
  out.netRecoveredValue=keys.some(k=>out[k]==null)?null:
    out.recoveredContribution+out.avoidedDowntime+out.avoidedExpedite+
    out.avoidedLabourPremium+out.avoidedScrap-out.interventionCost-out.inducedDownstreamCost;
  if(out.netRecoveredValue!=null) out.netRecoveredValue=num(Number(out.netRecoveredValue.toFixed(2)),'netRecoveredValue');
  return out;
}

function causalEvidence(input={}){
  const comparable=num(input.comparableInterventions,'comparableInterventions',{min:0,nullable:true});
  if(comparable!=null&&!Number.isSafeInteger(comparable)) throw new Error('comparableInterventions is invalid.');
  const sourceDiversity=num(input.sourceDiversity,'sourceDiversity',{min:0,max:1,nullable:true});
  const dataCompleteness=num(input.dataCompleteness,'dataCompleteness',{min:0,max:1,nullable:true});
  const simulatorCalibration=num(input.simulatorCalibration,'simulatorCalibration',{min:0,max:1,nullable:true});
  // Preserve submitted design metadata, but a client flag/count is not verified causal evidence.
  return deepFreeze({
    status:'HYPOTHESIS_ONLY',confidence:null,
    comparableInterventions:comparable,
    matchedControl:input.matchedControl===true,experimental:input.experimental===true,
    sourceDiversity,dataCompleteness,simulatorCalibration
  });
}

function compareId(a,b,deterministicOrder){return deterministicOrder===true?(a<b?-1:a>b?1:0):a.localeCompare(b);}
function normalisePlan(input={},deterministicOrder=false){
  const id=text(input.id,120);
  if(!id) throw new Error('Capacity Rescue plan id is required.');
  const actions=(Array.isArray(input.actions)?input.actions:[]).map(a=>normaliseAction(a,id));
  if(id==='do-nothing'&&actions.length===0) actions.push(normaliseAction({id:'do-nothing',type:'DO_NOTHING',reversible:true,requiresApproval:false},id));
  if(!actions.length) throw new Error('Non-empty Capacity Rescue actions are required.');
  const ids=new Set(actions.map(a=>a.id));
  if(ids.size!==actions.length) throw new Error('Capacity Rescue action ids must be unique.');
  for(const a of actions) for(const dep of a.dependsOn){
    if(dep===a.id) throw new Error('Capacity Rescue action self dependency: '+dep);
    if(!ids.has(dep)) throw new Error('Capacity Rescue action dependency is missing: '+dep);
  }
  const byId=new Map(actions.map(a=>[a.id,a])),visiting=new Set(),visited=new Set();
  function visit(id){
    if(visiting.has(id)) throw new Error('Capacity Rescue action dependency cycle: '+id);
    if(visited.has(id)) return;
    visiting.add(id);
    for(const dep of byId.get(id).dependsOn) visit(dep);
    visiting.delete(id);visited.add(id);
  }
  for(const a of actions) visit(a.id);
  if(id==='do-nothing'&&actions.some(a=>a.type!=='DO_NOTHING'))
    throw new Error('The do-nothing plan must contain only DO_NOTHING actions.');
  actions.sort((a,b)=>compareId(a.id,b.id,deterministicOrder));
  const nonWorkforce=actions.some(a=>['MAINTENANCE','MATERIAL_REALLOCATION','WORK_ORDER_RESEQUENCE','CHANGEOVER_SHIFT','CROSS_LINE_REBALANCE','CROSS_SITE_REBALANCE'].includes(a.type));
  const highConsequence=actions.some(a=>['MAINTENANCE','CROSS_SITE_REBALANCE'].includes(a.type)||a.reversible!==true);
  const planGraphDigest=digest(actions).slice(0,20);
  return deepFreeze({
    id,label:text(input.label,200)||id,
    feasible:input.feasible===true,
    policyAllowed:input.policyAllowed===true,
    hardConstraintsPassed:input.hardConstraintsPassed===true,
    uncertainty:num(input.uncertainty,'plan uncertainty',{min:0,max:1}),
    prediction:prediction(input.prediction||{}),
    evidenceRefs:list(input.evidenceRefs,30,220,'evidenceRefs'),
    reasonCodes:[...new Set([...list(input.reasonCodes,18,100,'plan reasonCodes'),'PLAN_GRAPH_'+planGraphDigest])],
    planGraphDigest,
    actions,
    economic:economicValue(input.economic||{}),
    causalEvidence:causalEvidence(input.causalEvidence||{}),
    executionClass:highConsequence?'ADVISORY_ONLY':nonWorkforce?'APPROVAL_REQUIRED':'EXISTING_AUTHORITY_ONLY'
  });
}

function buildCapacityRescueShadow(input={},evaluationOptions={}){
  const deterministicOrder=snapshotData(evaluationOptions,'capacity evaluation options')?.deterministicOrder===true;
  const triggerKind=text(input.triggerKind,80).toUpperCase();
  if(!TRIGGERS.includes(triggerKind)) throw new Error('Unsupported Capacity Rescue trigger.');
  const sourceEvidence=list(input.sourceEvidence,50,220,'Capacity Rescue source evidence');
  if(!sourceEvidence.length) throw new Error('Capacity Rescue source evidence is required.');

  const state=input.state&&typeof input.state==='object'&&!Array.isArray(input.state)?input.state:{};
  const targetUnits=num(state.targetUnits===undefined?state.demandUnits:state.targetUnits,'targetUnits',{min:0});
  const projectedUnits=num(state.projectedUnits,'projectedUnits',{min:0});
  const currentUnits=num(state.currentUnits,'currentUnits',{min:0});
  const plannedHeadcount=num(state.plannedHeadcount,'plannedHeadcount',{min:0});
  const staffedHeadcount=num(state.staffedHeadcount,'staffedHeadcount',{min:0});
  const fullyManned=plannedHeadcount>0&&staffedHeadcount>=plannedHeadcount;
  const capacityGapUnits=Math.max(0,targetUnits-projectedUnits);

  const constraints=(Array.isArray(input.constraints)?input.constraints:[]).map(normaliseConstraint)
    .sort((a,b)=>b.score-a.score||b.confidence-a.confidence||compareId(a.id,b.id,deterministicOrder));
  if(!constraints.length) throw new Error('At least one evidenced Capacity Rescue constraint is required.');
  const primaryConstraint=constraints[0];

  const plans=(Array.isArray(input.plans)?input.plans:[]).map(p=>normalisePlan(p,deterministicOrder));
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
    throughputDelta:delta(p.prediction.throughputUnits,doNothing.prediction.throughputUnits,3),
    planAttainmentDelta:delta(p.prediction.planAttainmentPct,doNothing.prediction.planAttainmentPct,3),
    labourCostDelta:delta(p.prediction.labourCost,doNothing.prediction.labourCost,2),
    delayMinutesDelta:delta(p.prediction.delayMinutes,doNothing.prediction.delayMinutes,2),
    netRecoveredValue:p.economic.netRecoveredValue,
    causalStatus:p.causalEvidence.status,
    causalConfidence:p.causalEvidence.confidence
  }));

  // Validate numeric types before the canonical module's Number coercion.
  for(const [key,value] of Object.entries(input.objective||{}))
    num(value,'objective '+key,{min:0,max:key==='uncertaintyPenalty'?1:Infinity});
  const objectiveTotal=[...BENEFIT_METRICS,...COST_METRICS]
    .reduce((total,key)=>total+(input.objective?.[key]??0),0);
  num(objectiveTotal,'objective total',{min:0});
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
  },{deterministicOrder});

  // Canonical cloning can turn non-finite arithmetic into null; never publish that as a rank.
  for(const rank of episode.recommendation.ranking) num(rank.score,'canonical rank score');
  const recommended=mappedPlans.find(p=>p.id===episode.recommendation.optionId)||null;
  return deepFreeze({
    contractVersion:'VECTOR_CAPACITY_RESCUE_SHADOW_V1',
    triggerKind,
    state:{...clone(state),targetUnits,projectedUnits,currentUnits,plannedHeadcount,staffedHeadcount,fullyManned,capacityGapUnits},
    constraintAssessment:{
      primaryConstraint,
      rankedConstraints:constraints,
      labourAdditionSuppressed,
      explanation:labourAdditionSuppressed
        ?'Headcount is already at or above plan and the primary evidenced constraint is not workforce quantity.'
        :'Workforce quantity has not been automatically excluded; compare marginal value against other constraints.'
    },
    interventionGraph:{
      plans:mappedPlans.map(p=>({id:p.id,label:p.label,planGraphDigest:p.planGraphDigest,actions:p.actions,executionClass:p.executionClass,economic:p.economic,causalEvidence:p.causalEvidence})),
      counterfactuals
    },
    recommendedPlan:recommended?{
      id:recommended.id,label:recommended.label,planGraphDigest:recommended.planGraphDigest,actions:recommended.actions,
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
