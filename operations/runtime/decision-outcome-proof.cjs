'use strict';

const { createHash } = require('node:crypto');

const CLASSIFICATIONS = Object.freeze(['SIMULATED','VERIFIED_OPERATIONAL','REALISED_FINANCIAL']);
const DIRECTIONS = Object.freeze(['MAXIMIZE','MINIMIZE']);
const FINANCIAL_METRICS = new Set(['labourCost','energyCost']);

function stable(value){
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  if(value&&typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function digest(value){return createHash('sha256').update(stable(value)).digest('hex');}
function text(value,max=240){return String(value??'').trim().slice(0,max);}
function list(value,max=50,maxLen=220){
  return Array.isArray(value)?[...new Set(value.map(v=>text(v,maxLen)).filter(Boolean))].slice(0,max):[];
}
function number(value,name){
  const n=Number(value);
  if(!Number.isFinite(n)) throw new Error(name+' must be numeric.');
  return n;
}
function iso(value,name){
  const raw=text(value,80),ms=Date.parse(raw);
  if(!raw||!Number.isFinite(ms)) throw new Error(name+' must be a valid ISO timestamp.');
  return new Date(ms).toISOString();
}
function improvement(direction,baseline,result){
  return direction==='MAXIMIZE'?result-baseline:baseline-result;
}

function createDecisionOutcomeProof(input={}){
  const episode=input.episode;
  if(!episode?.episodeId||!episode?.tenant||!episode?.decisionType) throw new Error('Completed decision episode is required.');
  if(!episode.selection||!episode.outcome) throw new Error('Selected decision episode with recorded outcome is required.');

  const metric=text(input.metric,80);
  const direction=text(input.direction,20).toUpperCase();
  const classification=text(input.classification,40).toUpperCase();
  if(!metric) throw new Error('metric is required.');
  if(!DIRECTIONS.includes(direction)) throw new Error('Unsupported metric direction.');
  if(!CLASSIFICATIONS.includes(classification)) throw new Error('Unsupported outcome classification.');

  const selected=(episode.options||[]).find(o=>o.id===episode.selection.optionId);
  const baselineOption=(episode.options||[]).find(o=>o.id==='do-nothing');
  if(!selected||!baselineOption) throw new Error('Selected and do-nothing options are required.');
  if(selected.prediction?.[metric]==null||baselineOption.prediction?.[metric]==null) throw new Error('Prediction metric is missing.');

  const predictedBaseline=number(baselineOption.prediction[metric],'predicted baseline');
  const predictedSelected=number(selected.prediction[metric],'predicted selected');
  const predictedImprovement=improvement(direction,predictedBaseline,predictedSelected);

  const resultActual=episode.outcome.actual?.[metric];
  const resultEvidence=list(episode.outcome.evidenceRefs);
  const baselineEvidence=list(input.baselineEvidenceRefs);
  const financeEvidence=list(input.financeEvidenceRefs);

  if(classification==='SIMULATED'){
    const core={
      schemaVersion:1,
      recordType:'vector-decision-outcome-proof',
      classification,
      tenant:episode.tenant,
      site:episode.site||null,
      episodeId:episode.episodeId,
      decisionType:episode.decisionType,
      selectedOptionId:episode.selection.optionId,
      metric,direction,
      predicted:{baseline:predictedBaseline,selected:predictedSelected,improvement:predictedImprovement},
      observed:null,
      evidence:{baseline:[],result:[],finance:[]},
      verifiedOperationalOutcome:false,
      realisedFinancialOutcome:false,
      learningEligible:false,
      claimBoundary:'Simulation only. No verified operational or realised financial outcome is claimed.'
    };
    return Object.freeze({...core,proofDigest:digest(core)});
  }

  if(resultActual==null) throw new Error('Recorded actual result is required for verified outcomes.');
  const baselineActual=number(input.baselineActual,'baseline actual');
  const result=number(resultActual,'result actual');
  if(!baselineEvidence.length||!resultEvidence.length) throw new Error('Baseline and result evidence are required for verified outcomes.');

  let measurementWindow=null,currency=null;
  if(classification==='REALISED_FINANCIAL'){
    if(!FINANCIAL_METRICS.has(metric)) throw new Error('Realised financial classification requires a supported financial metric.');
    if(!financeEvidence.length) throw new Error('Finance evidence is required for realised financial value.');
    currency=text(input.currency,12).toUpperCase();
    if(!/^[A-Z]{3}$/.test(currency)) throw new Error('Three-letter currency is required for realised financial value.');
    const start=iso(input.measurementWindow?.start,'measurementWindow.start');
    const end=iso(input.measurementWindow?.end,'measurementWindow.end');
    if(Date.parse(end)<=Date.parse(start)) throw new Error('Measurement window end must be after start.');
    measurementWindow={start,end};
  }

  const observedImprovement=improvement(direction,baselineActual,result);
  const core={
    schemaVersion:1,
    recordType:'vector-decision-outcome-proof',
    classification,
    tenant:episode.tenant,
    site:episode.site||null,
    episodeId:episode.episodeId,
    decisionType:episode.decisionType,
    selectedOptionId:episode.selection.optionId,
    metric,direction,
    predicted:{baseline:predictedBaseline,selected:predictedSelected,improvement:predictedImprovement},
    observed:{
      baseline:baselineActual,
      result,
      improvement:observedImprovement,
      predictionError:selected.prediction?.[metric]!=null?Number((result-number(selected.prediction[metric],'selected prediction')).toFixed(8)):null,
      observedAt:episode.outcome.observedAt
    },
    evidence:{baseline:baselineEvidence,result:resultEvidence,finance:financeEvidence},
    measurementWindow,
    currency,
    verifiedOperationalOutcome:true,
    realisedFinancialOutcome:classification==='REALISED_FINANCIAL',
    learningEligible:true,
    claimBoundary:classification==='REALISED_FINANCIAL'
      ?'Realised financial value is evidence-bound to authoritative baseline, result and finance references for the stated measurement window.'
      :'Verified operational outcome only. No realised financial saving is claimed.'
  };
  return Object.freeze({...core,proofDigest:digest(core)});
}

function toAdaptiveOutcomeInput(proof){
  if(!proof||proof.recordType!=='vector-decision-outcome-proof'||!proof.learningEligible||!proof.observed) throw new Error('Learning requires a verified decision outcome proof.');
  const {proofDigest,...issuedCore}=proof;
  if(typeof proofDigest!=='string'||!(/^[a-f0-9]{64}$/).test(proofDigest)||digest(issuedCore)!==proofDigest){
    throw new Error('Decision outcome proof integrity check failed.');
  }
  const sign=proof.direction==='MAXIMIZE'?1:-1;
  return Object.freeze({
    tenantScope:proof.tenant,
    source:'decision-outcome-proof',
    category:proof.metric,
    fingerprint:proof.decisionType+':'+proof.metric,
    baseline:sign*proof.observed.baseline,
    result:sign*proof.observed.result,
    verified:true,
    evidenceRef:proof.proofDigest,
    crossTenantRawMemory:false,
    containsSecret:false,
    memoryGrantsAuthority:false
  });
}

module.exports=Object.freeze({CLASSIFICATIONS,DIRECTIONS,FINANCIAL_METRICS,createDecisionOutcomeProof,toAdaptiveOutcomeInput,digest});

