'use strict';

const { createDecisionEpisode } = require('./decision-episode.cjs');

function text(value,max=240){ return String(value??'').trim().slice(0,max); }
function list(value,max=30,maxLen=180){ return Array.isArray(value)?[...new Set(value.map(v=>text(v,maxLen)).filter(Boolean))].slice(0,max):[]; }
// Only traverse the normalized owned result: createDecisionEpisode has already
// cloned its payload, and list() creates fresh arrays. Caller data stays mutable.
function freezeResult(value){
  if(value&&typeof value==='object'){
    for(const child of Object.values(value))freezeResult(child);
    Object.freeze(value);
  }
  return value;
}

function buildAbsenceRecoveryShadow(input={}){
  const triggerKind=text(input.triggerKind,80).toUpperCase();
  if(!['ABSENCE','QUALIFIED_LABOUR_SHORTAGE'].includes(triggerKind)) throw new Error('Unsupported absence-recovery trigger.');
  const requiredSkills=list(input.requiredSkills,30,120);
  if(!requiredSkills.length) throw new Error('At least one required skill is required.');
  const sourceEvidence=list(input.sourceEvidence,50,220);
  if(!sourceEvidence.length) throw new Error('Source evidence is required.');
  const candidates=Array.isArray(input.candidates)?input.candidates:[];
  if(candidates.length<2) throw new Error('At least two simulated candidate actions are required.');
  const episode=createDecisionEpisode({
    tenant:input.tenant,
    site:input.site,
    decisionType:'absence-recovery',
    triggerId:input.triggerId,
    triggeredAt:input.triggeredAt,
    contextRevision:input.contextRevision,
    mode:'SHADOW',
    sourceEvidence,
    objective:input.objective,
    options:candidates.map(candidate=>({
      id:candidate.id,
      label:candidate.label,
      feasible:candidate.feasible===true,
      policyAllowed:candidate.policyAllowed===true,
      hardConstraintsPassed:candidate.hardConstraintsPassed===true,
      uncertainty:candidate.uncertainty,
      prediction:candidate.prediction,
      evidenceRefs:list(candidate.evidenceRefs,30,220),
      reasonCodes:list(candidate.reasonCodes,20,100)
    }))
  });
  return freezeResult({
    triggerKind,
    requiredSkills,
    affectedLines:list(input.affectedLines,30,120),
    shadowOnly:true,
    executionPermitted:false,
    episode
  });
}
module.exports=Object.freeze({buildAbsenceRecoveryShadow});
