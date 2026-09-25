'use strict';

const { createHash } = require('node:crypto');

const CONTRACT_VERSION = 'VECTOR_DECISION_RECEIPT_V1';
const EPISODE_VERSION = 'VECTOR_DECISION_EPISODE_V1';

function stable(value){
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  if(value&&typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function digest(value){return createHash('sha256').update(stable(value)).digest('hex');}
function text(value,max=240){return String(value??'').trim().slice(0,max);}
function list(value,max=50,maxLen=220){return Array.isArray(value)?[...new Set(value.map(v=>text(v,maxLen)).filter(Boolean))].slice(0,max):[];}
function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}

function validProofs(proofs,episode){
  return (Array.isArray(proofs)?proofs:[]).filter(proof=>
    proof &&
    proof.recordType==='vector-decision-outcome-proof' &&
    proof.episodeId===episode.episodeId &&
    proof.tenant===episode.tenant
  ).map(proof=>({
    classification:text(proof.classification,40),
    metric:text(proof.metric,80),
    proofDigest:text(proof.proofDigest,128),
    realisedFinancialOutcome:proof.realisedFinancialOutcome===true,
    verifiedOperationalOutcome:proof.verifiedOperationalOutcome===true,
    currency:proof.currency?text(proof.currency,12):null,
    claimBoundary:text(proof.claimBoundary,500)
  }));
}

function statusFor(episode,proofs){
  if(proofs.some(p=>p.realisedFinancialOutcome)) return 'REALISED_VALUE_VERIFIED';
  if(proofs.some(p=>p.verifiedOperationalOutcome)) return 'OPERATIONAL_OUTCOME_VERIFIED';
  if(episode.outcome) return 'OUTCOME_RECORDED';
  if(episode.selection?.executionPermitted===true) return 'AUTHORISED';
  if(episode.selection) return 'SELECTED_NO_EXECUTION';
  return 'RECOMMENDED';
}

function createDecisionReceipt(input={}){
  const episode=input.episode;
  if(!episode || episode.contractVersion!==EPISODE_VERSION || !episode.episodeId) throw new Error('Valid decision episode is required.');
  if(!episode.tenant || !episode.decisionType || !episode.triggeredAt) throw new Error('Decision episode identity is incomplete.');

  const ranking=new Map((episode.recommendation?.ranking||[]).map(r=>[r.optionId,r]));
  const options=(episode.options||[]).map(option=>({
    id:text(option.id,120),
    label:text(option.label,200)||text(option.id,120),
    eligible:option.feasible===true&&option.policyAllowed===true&&option.hardConstraintsPassed===true,
    feasible:option.feasible===true,
    policyAllowed:option.policyAllowed===true,
    hardConstraintsPassed:option.hardConstraintsPassed===true,
    uncertainty:Number.isFinite(Number(option.uncertainty))?Number(option.uncertainty):null,
    score:ranking.has(option.id)?Number(ranking.get(option.id).score):null,
    prediction:clone(option.prediction||{}),
    evidenceRefs:list(option.evidenceRefs,30,220),
    reasonCodes:list(option.reasonCodes,20,100)
  }));

  const proofs=validProofs(input.outcomeProofs,episode);
  const selected=episode.selection?{
    optionId:text(episode.selection.optionId,120),
    selectedAt:text(episode.selection.selectedAt,80),
    actorRef:episode.selection.actorRef?text(episode.selection.actorRef,180):null,
    authorityDecision:text(episode.selection.authorityDecision,80),
    executionPermitted:episode.selection.executionPermitted===true
  }:null;
  const outcome=episode.outcome?{
    observedAt:text(episode.outcome.observedAt,80),
    actual:clone(episode.outcome.actual||{}),
    predictionError:clone(episode.outcome.predictionError||{}),
    evidenceRefs:list(episode.outcome.evidenceRefs,50,220),
    notes:episode.outcome.notes?text(episode.outcome.notes,600):null
  }:null;

  const core={
    contractVersion:CONTRACT_VERSION,
    episodeId:episode.episodeId,
    tenant:text(episode.tenant,120),
    site:episode.site?text(episode.site,160):null,
    decisionType:text(episode.decisionType,120),
    triggerId:text(episode.triggerId,180),
    triggeredAt:text(episode.triggeredAt,80),
    contextRevision:text(episode.contextRevision,180),
    mode:text(episode.mode,40),
    status:statusFor(episode,proofs),
    sourceEvidence:list(episode.sourceEvidence,50,220),
    recommendation:{
      optionId:episode.recommendation?.optionId?text(episode.recommendation.optionId,120):null,
      reason:text(episode.recommendation?.reason,120),
      authorityRequired:text(episode.recommendation?.authorityRequired,80),
      executionPermitted:false
    },
    options,
    selection:selected,
    outcome,
    outcomeProofs:proofs,
    readOnly:true,
    grantsExecutionAuthority:false,
    claimBoundary:proofs.some(p=>p.realisedFinancialOutcome)
      ?'Financial value is shown only where an evidence-bound realised financial outcome proof exists.'
      :'No realised financial saving is claimed unless an evidence-bound realised financial outcome proof exists.'
  };
  return Object.freeze({...core,receiptDigest:digest(core)});
}

module.exports=Object.freeze({CONTRACT_VERSION,createDecisionReceipt,digest,stable});
