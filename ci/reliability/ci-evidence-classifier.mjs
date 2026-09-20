export const CI_EVIDENCE_STATES=Object.freeze({
  PENDING:'PENDING',
  INFRASTRUCTURE_UNAVAILABLE:'INFRASTRUCTURE_UNAVAILABLE',
  EXECUTED_PASS:'EXECUTED_PASS',
  EXECUTED_FAIL:'EXECUTED_FAIL',
  EVIDENCE_IDENTITY_MISMATCH:'EVIDENCE_IDENTITY_MISMATCH',
  UNPROVEN:'UNPROVEN'
});

const TRUSTED_PROVIDERS=Object.freeze(['github-actions','circleci']);
const MAX_EVIDENCE_COUNT=100000;
const clean=v=>typeof v==='string'?v.trim():'';
const positiveInteger=v=>Number.isSafeInteger(v)&&v>0&&v<=MAX_EVIDENCE_COUNT;
const nonNegativeInteger=v=>Number.isSafeInteger(v)&&v>=0&&v<=MAX_EVIDENCE_COUNT;

function inspectSteps(observation){
  const hasDeclared=Object.hasOwn(observation,'executedStepCount');
  const declared=hasDeclared&&nonNegativeInteger(observation.executedStepCount)?observation.executedStepCount:null;
  if(hasDeclared&&declared===null) return {invalid:true,reason:'executed_step_count_invalid'};
  if(!Object.hasOwn(observation,'steps')) return {count:declared??0,failed:false};
  if(!Array.isArray(observation.steps)) return {invalid:true,reason:'steps_invalid'};
  let count=0;
  let failed=false;
  for(const step of observation.steps){
    if(Object.hasOwn(step??{},'status')&&clean(step?.status).toLowerCase()!=='completed') return {invalid:true,reason:'step_status_not_completed'};
    const conclusion=clean(step?.conclusion).toLowerCase();
    if(!['success','failure','skipped','cancelled','neutral'].includes(conclusion)) return {invalid:true,reason:'step_conclusion_invalid'};
    if(conclusion==='success'||conclusion==='failure') count+=1;
    if(conclusion==='failure') failed=true;
  }
  if(hasDeclared&&declared!==count) return {invalid:true,reason:'step_count_conflict'};
  return {count,failed};
}

export function classifyCiObservation(observation={},options={}){
  const trustedProviders=Array.isArray(options.trustedProviders)&&options.trustedProviders.length
    ?options.trustedProviders.map(clean).filter(Boolean)
    :TRUSTED_PROVIDERS;
  const expectedNodeVersion=clean(options.expectedNodeVersion)||'22.23.2';
  const provider=clean(observation.provider);
  const candidateSha=clean(observation.candidateSha);
  const runId=clean(observation.runId);
  const identity={provider,candidateSha,runId};
  if(!provider||!candidateSha) return {state:CI_EVIDENCE_STATES.UNPROVEN,...identity,reason:'provider_or_candidate_missing'};
  if(!trustedProviders.includes(provider)) return {state:CI_EVIDENCE_STATES.UNPROVEN,...identity,reason:'provider_not_trusted'};
  if(observation.status!=='completed') return {state:observation.status?CI_EVIDENCE_STATES.PENDING:CI_EVIDENCE_STATES.UNPROVEN,...identity,reason:'run_not_completed'};

  const stepEvidence=inspectSteps(observation);
  if(stepEvidence.invalid) return {state:CI_EVIDENCE_STATES.UNPROVEN,...identity,reason:stepEvidence.reason};
  if(stepEvidence.count===0) return {state:CI_EVIDENCE_STATES.INFRASTRUCTURE_UNAVAILABLE,...identity,reason:'no_executable_steps_observed'};
  if(stepEvidence.failed||observation.conclusion==='failure') return {state:CI_EVIDENCE_STATES.EXECUTED_FAIL,...identity,reason:'executed_run_failed'};
  if(observation.conclusion!=='success') return {state:CI_EVIDENCE_STATES.UNPROVEN,...identity,reason:'run_conclusion_not_success'};

  const receipt=observation.receipt;
  if(!receipt||typeof receipt!=='object') return {state:CI_EVIDENCE_STATES.UNPROVEN,...identity,reason:'proof_receipt_missing'};
  const receiptSha=clean(receipt?.exactCandidate?.sourceCommit);
  if(receiptSha!==candidateSha) return {state:CI_EVIDENCE_STATES.EVIDENCE_IDENTITY_MISMATCH,...identity,receiptSha};
  const receiptProvider=clean(receipt?.executed?.provider);
  const receiptRunId=clean(receipt?.executed?.runId);
  if(!runId||receiptProvider!==provider||receiptRunId!==runId){
    return {state:CI_EVIDENCE_STATES.UNPROVEN,...identity,reason:'receipt_attestation_binding_invalid'};
  }
  if(receipt?.executed?.result==='FAIL') return {state:CI_EVIDENCE_STATES.EXECUTED_FAIL,provider,candidateSha,receiptSha,runId,reason:'receipt_reports_failure'};
  if(receipt.proofClass!=='RELEASE') return {state:CI_EVIDENCE_STATES.UNPROVEN,provider,candidateSha,runId,reason:'receipt_not_release_class'};
  if(clean(receipt?.exactCandidate?.node)!==`v${expectedNodeVersion}`) return {state:CI_EVIDENCE_STATES.UNPROVEN,provider,candidateSha,runId,reason:'release_runtime_mismatch'};
  if(!positiveInteger(receipt?.executed?.mandatoryPassed)||receipt?.executed?.mandatoryFailed!==0||receipt?.executed?.mandatorySkipped!==0){
    return {state:CI_EVIDENCE_STATES.UNPROVEN,provider,candidateSha,runId,reason:'mandatory_test_counts_invalid'};
  }
  if(receipt?.executed?.result==='PASS') return {state:CI_EVIDENCE_STATES.EXECUTED_PASS,provider,candidateSha,receiptSha,runId};
  return {state:CI_EVIDENCE_STATES.UNPROVEN,provider,candidateSha,runId,reason:'receipt_result_invalid'};
}

export function evaluateReleaseQuorum({candidateSha,observations=[],minIndependentPasses=2,trustedProviders=TRUSTED_PROVIDERS,expectedNodeVersion='22.23.2'}={}){
  const target=clean(candidateSha);
  if(!target) return {status:'BLOCKED',reason:'candidate_sha_missing',classifications:[]};
  if(!Array.isArray(observations)) return {status:'BLOCKED',reason:'observations_invalid',classifications:[]};
  const providers=Array.isArray(trustedProviders)?[...new Set(trustedProviders.map(clean).filter(Boolean))]:[];
  if(!Number.isInteger(minIndependentPasses)||minIndependentPasses<2||minIndependentPasses>providers.length){
    return {status:'BLOCKED',reason:'quorum_configuration_invalid',classifications:[]};
  }
  const classifications=observations.map(o=>classifyCiObservation(o,{trustedProviders:providers,expectedNodeVersion}));
  if(classifications.some(x=>x.candidateSha!==target)) return {status:'BLOCKED',reason:'observation_candidate_mismatch',classifications};
  if(classifications.some(x=>x.state===CI_EVIDENCE_STATES.EVIDENCE_IDENTITY_MISMATCH)) return {status:'BLOCKED',reason:'evidence_identity_mismatch',classifications};
  if(classifications.some(x=>x.state===CI_EVIDENCE_STATES.EXECUTED_FAIL)) return {status:'BLOCKED',reason:'executed_proof_failed',classifications};
  const seenAttestations=new Map();
  for(const item of classifications){
    if(!item.provider||!item.runId) continue;
    const key=`${item.provider}:${item.runId}`;
    const previous=seenAttestations.get(key);
    if(previous&&previous!==item.state) return {status:'BLOCKED',reason:'conflicting_attestation_evidence',classifications};
    seenAttestations.set(key,item.state);
  }
  if(classifications.some(x=>x.state===CI_EVIDENCE_STATES.UNPROVEN||x.state===CI_EVIDENCE_STATES.PENDING)){
    return {status:'UNPROVEN',reason:'candidate_evidence_incomplete_or_invalid',classifications};
  }
  const passes=classifications.filter(x=>x.state===CI_EVIDENCE_STATES.EXECUTED_PASS&&x.candidateSha===target);
  const passingProviders=new Set(passes.map(x=>x.provider));
  const attestations=new Set(passes.map(x=>`${x.provider}:${x.runId}`));
  if(passingProviders.size>=minIndependentPasses&&attestations.size>=minIndependentPasses){
    return {status:'PROVEN',reason:'independent_provider_quorum_met',providers:[...passingProviders],classifications};
  }
  const infra=classifications.filter(x=>x.state===CI_EVIDENCE_STATES.INFRASTRUCTURE_UNAVAILABLE).map(x=>x.provider);
  return {status:'UNPROVEN',reason:'independent_provider_quorum_not_met',passingProviders:[...passingProviders],infrastructureUnavailableProviders:infra,classifications};
}
