import {evaluateEnergyFlexibility,reduceEnergySignalEventsDetailed} from './energy-flexibility.mjs';

export const ENERGY_INPUT_HARDENING_VERSION='energy-input-hardening-v0.1.0';

const isFiniteNumber=(value)=>Number.isFinite(Number(value));
const isFraction=(value)=>isFiniteNumber(value)&&Number(value)>=0&&Number(value)<=1;

function effectiveSignal(input={}){
  if(Array.isArray(input.energyEvents)) return reduceEnergySignalEventsDetailed(input.energyEvents).signal;
  return input.energySignal??null;
}

function requireScope(label,obj,input,failures){
  if(!obj||obj.tenantId===undefined||obj.tenantId===null||String(obj.tenantId).trim()==='') failures.push(`${label}_tenant_missing`);
  else if(String(obj.tenantId)!==String(input.tenantId)) failures.push(`${label}_tenant_mismatch`);
  if(!obj||obj.siteId===undefined||obj.siteId===null||String(obj.siteId).trim()==='') failures.push(`${label}_site_missing`);
  else if(String(obj.siteId)!==String(input.siteId)) failures.push(`${label}_site_mismatch`);
}

function requireConfidence(label,value,failures){
  if(value===undefined||value===null||value==='') failures.push(`${label}_confidence_missing`);
  else if(!isFraction(value)) failures.push(`${label}_confidence_invalid`);
}

function validateEnergyEvidence(option,failures){
  const energy=option?.energy??{};
  const avoided=isFiniteNumber(energy.grossSaving)?Number(energy.grossSaving):0;
  const reward=isFiniteNumber(energy.flexibilityReward)?Number(energy.flexibilityReward):0;
  const gross=energy.valueStackingAllowed===true?avoided+reward:Math.max(avoided,reward);

  if(energy.uncertaintyPct!==undefined&&energy.uncertaintyPct!==null&&!isFraction(energy.uncertaintyPct)) failures.push('energy_uncertainty_invalid');

  if(energy.lowerBoundEnergyValue!==undefined&&energy.lowerBoundEnergyValue!==null){
    if(!isFiniteNumber(energy.lowerBoundEnergyValue)||Number(energy.lowerBoundEnergyValue)<0) failures.push('energy_lower_bound_invalid');
    else if(Number(energy.lowerBoundEnergyValue)>gross) failures.push('energy_lower_bound_exceeds_gross');
  } else if(energy.uncertaintyPct===undefined||energy.uncertaintyPct===null){
    failures.push('energy_uncertainty_evidence_missing');
  }
}

export function validateEnergyDecisionInput(input={}){
  const failures=[];
  const signal=effectiveSignal(input);
  const options=Array.isArray(input.options)?input.options:[];
  const actionable=options.filter(option=>option&&option.kind!=='do_nothing');

  if(actionable.length===0) return {valid:true,failures,actionableCount:0};

  requireScope('energy_signal',signal,input,failures);
  requireScope('process',input.process,input,failures);
  requireConfidence('energy_signal',signal?.confidence,failures);
  requireConfidence('process',input.process?.confidence,failures);

  actionable.forEach((option,index)=>{
    const optionLabel=typeof option.id==='string'&&option.id?`option:${option.id}`:`option:${index}`;
    requireScope(optionLabel,option,input,failures);
    requireConfidence(`${optionLabel}:workforce`,option.workforce?.confidence,failures);
    const energyFailures=[];
    validateEnergyEvidence(option,energyFailures);
    failures.push(...energyFailures.map(reason=>`${optionLabel}:${reason}`));
  });

  return {valid:failures.length===0,failures:[...new Set(failures)].sort(),actionableCount:actionable.length};
}

export function evaluateEnergyFlexibilityHardened(input){
  const preflight=validateEnergyDecisionInput(input);
  if(!preflight.valid){
    return {
      hardeningVersion:ENERGY_INPUT_HARDENING_VERSION,
      preflightValid:false,
      preflightFailures:preflight.failures,
      status:'input_rejected',
      decisionState:'hardening_preflight_failed',
      rankedOptions:[],
      authorityBoundary:'planning_and_workflow_handoff_only_no_direct_actuation'
    };
  }
  return {
    ...evaluateEnergyFlexibility(input),
    hardeningVersion:ENERGY_INPUT_HARDENING_VERSION,
    preflightValid:true,
    preflightFailures:[]
  };
}
