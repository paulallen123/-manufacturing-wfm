'use strict';

const { createHash } = require('node:crypto');

const CONTRACT_VERSION = 'VECTOR_DECISION_EPISODE_V1';
const MODES = Object.freeze(['SHADOW','HUMAN_APPROVAL','POLICY_BOUNDED']);
const AUTHORITY = Object.freeze({
  SHADOW: 'NO_EXECUTION',
  HUMAN_APPROVAL: 'HUMAN_APPROVAL_REQUIRED',
  POLICY_BOUNDED: 'POLICY_GATE_REQUIRED'
});
const BENEFIT_METRICS = new Set(['throughputUnits','planAttainmentPct']);
const COST_METRICS = new Set(['labourCost','delayMinutes','riskScore','energyCost','qualityRisk']);

function clone(value){ return value == null ? value : JSON.parse(JSON.stringify(value)); }
function stable(value){
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key)+':'+stable(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}
function digest(value){ return createHash('sha256').update(stable(value)).digest('hex'); }
function text(value,max=240){ return String(value??'').trim().slice(0,max); }
function iso(value){
  const raw=text(value,80);
  const ms=Date.parse(raw);
  if(!raw || !Number.isFinite(ms)) throw new Error('Valid ISO timestamp required.');
  return new Date(ms).toISOString();
}
function bounded(value,min,max,name){
  const n=Number(value);
  if(!Number.isFinite(n) || n<min || n>max) throw new Error(`${name} must be between ${min} and ${max}.`);
  return n;
}
function numberOrNull(value,name){
  if(value==null) return null;
  const n=Number(value);
  if(!Number.isFinite(n)) throw new Error(`${name} must be numeric when provided.`);
  return n;
}
function list(value,max=50,maxLen=200){
  if(!Array.isArray(value)) return [];
  return [...new Set(value.map(v=>text(v,maxLen)).filter(Boolean))].slice(0,max);
}
function normalisePrediction(input={}){
  const out={};
  for(const key of [...BENEFIT_METRICS,...COST_METRICS]) out[key]=numberOrNull(input[key],key);
  return out;
}
function normaliseOption(input={}){
  const id=text(input.id,120);
  if(!id) throw new Error('Decision option id is required.');
  return {
    id,
    label:text(input.label,200)||id,
    feasible:input.feasible===true,
    policyAllowed:input.policyAllowed===true,
    hardConstraintsPassed:input.hardConstraintsPassed===true,
    uncertainty:bounded(input.uncertainty??1,0,1,'uncertainty'),
    prediction:normalisePrediction(input.prediction||{}),
    evidenceRefs:list(input.evidenceRefs,30,220),
    reasonCodes:list(input.reasonCodes,20,100)
  };
}
function normaliseObjective(objective={}){
  const weights={};
  let total=0;
  for(const key of [...BENEFIT_METRICS,...COST_METRICS]){
    const n=Number(objective[key]??0);
    if(!Number.isFinite(n)||n<0) throw new Error(`Objective weight ${key} must be a non-negative number.`);
    weights[key]=n; total+=n;
  }
  const uncertaintyPenalty=Number(objective.uncertaintyPenalty??0.15);
  if(!Number.isFinite(uncertaintyPenalty)||uncertaintyPenalty<0||uncertaintyPenalty>1)
    throw new Error('uncertaintyPenalty must be between 0 and 1.');
  if(total<=0) throw new Error('At least one objective weight is required.');
  return {weights,total,uncertaintyPenalty};
}
function rankOptions(options,objective){
  const eligible=options.filter(o=>o.feasible&&o.policyAllowed&&o.hardConstraintsPassed);
  if(!eligible.length) return {ranked:[],recommendedOptionId:null,reason:'NO_ELIGIBLE_OPTIONS'};
  const weightedKeys=Object.entries(objective.weights).filter(([,w])=>w>0).map(([k])=>k);
  const complete=eligible.filter(o=>weightedKeys.every(k=>o.prediction[k]!=null));
  if(!complete.length) return {ranked:[],recommendedOptionId:null,reason:'MISSING_WEIGHTED_METRICS'};
  const ranges={};
  for(const key of weightedKeys){
    const vals=complete.map(o=>o.prediction[key]);
    ranges[key]={min:Math.min(...vals),max:Math.max(...vals)};
  }
  const ranked=complete.map(option=>{
    let raw=0;
    for(const key of weightedKeys){
      const {min,max}=ranges[key];
      const value=option.prediction[key];
      const normalized=max===min ? 1 : (BENEFIT_METRICS.has(key) ? (value-min)/(max-min) : (max-value)/(max-min));
      raw += normalized*objective.weights[key];
    }
    const normalizedScore=raw/objective.total;
    const score=normalizedScore-(option.uncertainty*objective.uncertaintyPenalty);
    return {optionId:option.id,score:Number(score.toFixed(8)),uncertainty:option.uncertainty};
  }).sort((a,b)=>b.score-a.score || a.uncertainty-b.uncertainty || a.optionId.localeCompare(b.optionId));
  return {ranked,recommendedOptionId:ranked[0]?.optionId||null,reason:'RANKED'};
}
function createDecisionEpisode(input={}){
  const tenant=text(input.tenant,120);
  const site=text(input.site,160);
  const decisionType=text(input.decisionType,120);
  const triggerId=text(input.triggerId,180);
  const contextRevision=text(input.contextRevision,180);
  const mode=text(input.mode,40).toUpperCase();
  if(!tenant||!site||!decisionType||!triggerId||!contextRevision) throw new Error('tenant, site, decisionType, triggerId and contextRevision are required.');
  if(!MODES.includes(mode)) throw new Error('Unsupported decision mode.');
  const triggeredAt=iso(input.triggeredAt);
  const sourceEvidence=list(input.sourceEvidence,50,220);
  if(!sourceEvidence.length) throw new Error('At least one source evidence reference is required.');
  const options=(Array.isArray(input.options)?input.options:[]).map(normaliseOption);
  if(options.length<2) throw new Error('At least two decision options are required.');
  if(!options.some(o=>o.id==='do-nothing')) throw new Error('Decision episode requires a do-nothing option.');
  if(new Set(options.map(o=>o.id)).size!==options.length) throw new Error('Decision option ids must be unique.');
  const objective=normaliseObjective(input.objective||{});
  const ranking=rankOptions(options,objective);
  const payload={
    contractVersion:CONTRACT_VERSION,
    tenant,site,decisionType,triggerId,triggeredAt,contextRevision,mode,
    sourceEvidence,
    objective,
    options:options.sort((a,b)=>a.id.localeCompare(b.id)),
    recommendation:{
      optionId:ranking.recommendedOptionId,
      reason:ranking.reason,
      ranking:ranking.ranked,
      authorityRequired:AUTHORITY[mode],
      executionPermitted:false
    }
  };
  return Object.freeze({...clone(payload),episodeId:digest(payload)});
}
function selectDecisionOption(episode,input={}){
  if(!episode||episode.contractVersion!==CONTRACT_VERSION) throw new Error('Valid decision episode required.');
  const optionId=text(input.optionId,120);
  const option=(episode.options||[]).find(o=>o.id===optionId);
  if(!option) throw new Error('Selected option is not part of the episode.');
  if(!option.feasible||!option.policyAllowed||!option.hardConstraintsPassed) throw new Error('Selected option is not eligible.');
  const selectedAt=iso(input.selectedAt);
  const authorityDecision=text(input.authorityDecision,80).toUpperCase();
  if(episode.mode==='SHADOW' && authorityDecision!=='SHADOW_OBSERVED') throw new Error('Shadow mode cannot grant execution authority.');
  if(episode.mode==='HUMAN_APPROVAL' && authorityDecision!=='HUMAN_APPROVED') throw new Error('Human approval is required.');
  if(episode.mode==='POLICY_BOUNDED' && authorityDecision!=='POLICY_GATE_PASSED') throw new Error('Policy gate approval is required.');
  return Object.freeze({
    ...clone(episode),
    selection:Object.freeze({
      optionId,
      selectedAt,
      actorRef:text(input.actorRef,180)||null,
      authorityDecision,
      executionPermitted:episode.mode!=='SHADOW'
    })
  });
}
function recordDecisionOutcome(selectedEpisode,input={}){
  if(!selectedEpisode?.selection) throw new Error('A selected decision episode is required before recording outcome.');
  const observedAt=iso(input.observedAt);
  const evidenceRefs=list(input.evidenceRefs,50,220);
  if(!evidenceRefs.length) throw new Error('Outcome evidence reference is required.');
  const actual=normalisePrediction(input.actual||{});
  const predicted=(selectedEpisode.options||[]).find(o=>o.id===selectedEpisode.selection.optionId)?.prediction||{};
  const predictionError={};
  for(const key of [...BENEFIT_METRICS,...COST_METRICS]){
    predictionError[key]=(predicted[key]!=null&&actual[key]!=null)?Number((actual[key]-predicted[key]).toFixed(8)):null;
  }
  const outcome={observedAt,evidenceRefs,actual,predictionError,notes:text(input.notes,600)||null};
  return Object.freeze({...clone(selectedEpisode),outcome:Object.freeze(outcome),outcomeDigest:digest({episodeId:selectedEpisode.episodeId,selection:selectedEpisode.selection,outcome})});
}

module.exports=Object.freeze({
  CONTRACT_VERSION,MODES,AUTHORITY,BENEFIT_METRICS,COST_METRICS,
  stable,digest,createDecisionEpisode,selectDecisionOption,recordDecisionOutcome,rankOptions
});
