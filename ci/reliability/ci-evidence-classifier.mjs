export const CI_EVIDENCE_STATES=Object.freeze({
  PENDING:'PENDING',
  INFRASTRUCTURE_UNAVAILABLE:'INFRASTRUCTURE_UNAVAILABLE',
  EXECUTED_PASS:'EXECUTED_PASS',
  EXECUTED_FAIL:'EXECUTED_FAIL',
  EVIDENCE_IDENTITY_MISMATCH:'EVIDENCE_IDENTITY_MISMATCH',
  UNPROVEN:'UNPROVEN'
});

const clean=v=>typeof v==='string'?v.trim():'';
const countSteps=o=>Number.isInteger(o?.executedStepCount)?o.executedStepCount:Array.isArray(o?.steps)?o.steps.length:0;

export function classifyCiObservation(observation={}){
  const provider=clean(observation.provider);
  const candidateSha=clean(observation.candidateSha);
  if(!provider||!candidateSha) return {state:CI_EVIDENCE_STATES.UNPROVEN,reason:'provider_or_candidate_missing'};
  if(observation.status && observation.status!=='completed') return {state:CI_EVIDENCE_STATES.PENDING,provider,candidateSha};

  const steps=countSteps(observation);
  if(steps===0){
    return {state:CI_EVIDENCE_STATES.INFRASTRUCTURE_UNAVAILABLE,provider,candidateSha,reason:'no_executable_steps_observed'};
  }

  const receipt=observation.receipt;
  if(!receipt||typeof receipt!=='object'){
    return {state:observation.conclusion==='failure'?CI_EVIDENCE_STATES.EXECUTED_FAIL:CI_EVIDENCE_STATES.UNPROVEN,provider,candidateSha,reason:'proof_receipt_missing'};
  }
  const receiptSha=clean(receipt?.exactCandidate?.sourceCommit);
  if(receiptSha!==candidateSha){
    return {state:CI_EVIDENCE_STATES.EVIDENCE_IDENTITY_MISMATCH,provider,candidateSha,receiptSha};
  }
  if(receipt?.executed?.result==='PASS'&&observation.conclusion==='success'){
    return {state:CI_EVIDENCE_STATES.EXECUTED_PASS,provider,candidateSha,receiptSha};
  }
  if(observation.conclusion==='failure'||receipt?.executed?.result==='FAIL'){
    return {state:CI_EVIDENCE_STATES.EXECUTED_FAIL,provider,candidateSha,receiptSha};
  }
  return {state:CI_EVIDENCE_STATES.UNPROVEN,provider,candidateSha,reason:'incomplete_or_conflicting_evidence'};
}

export function evaluateReleaseQuorum({candidateSha,observations=[],minIndependentPasses=2}={}){
  const target=clean(candidateSha);
  if(!target) return {status:'BLOCKED',reason:'candidate_sha_missing',classifications:[]};
  const classifications=observations.map(classifyCiObservation);
  if(classifications.some(x=>x.state===CI_EVIDENCE_STATES.EVIDENCE_IDENTITY_MISMATCH)){
    return {status:'BLOCKED',reason:'evidence_identity_mismatch',classifications};
  }
  if(classifications.some(x=>x.state===CI_EVIDENCE_STATES.EXECUTED_FAIL)){
    return {status:'BLOCKED',reason:'executed_proof_failed',classifications};
  }
  const providers=new Set(classifications.filter(x=>x.state===CI_EVIDENCE_STATES.EXECUTED_PASS&&x.candidateSha===target).map(x=>x.provider));
  if(providers.size>=Number(minIndependentPasses||2)){
    return {status:'PROVEN',reason:'independent_provider_quorum_met',providers:[...providers],classifications};
  }
  const infra=classifications.filter(x=>x.state===CI_EVIDENCE_STATES.INFRASTRUCTURE_UNAVAILABLE).map(x=>x.provider);
  return {status:'UNPROVEN',reason:'independent_provider_quorum_not_met',passingProviders:[...providers],infrastructureUnavailableProviders:infra,classifications};
}
