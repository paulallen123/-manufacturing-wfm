import {deriveProfileOpportunity} from './energy-profile-benchmark.mjs';
import {evaluateEnergyFlexibilityHardened} from './energy-input-hardening.mjs';

export const ENERGY_PROFILE_BINDING_VERSION='energy-profile-binding-v0.3.0';

const finite=(value)=>Number.isFinite(Number(value));
const fraction=(value)=>finite(value)&&Number(value)>=0&&Number(value)<=1;

function requireScope(label,evidence,input,failures){
  if(!evidence||evidence.tenantId===undefined||evidence.tenantId===null||String(evidence.tenantId).trim()==='') failures.push(`${label}:tenant_missing`);
  else if(String(evidence.tenantId)!==String(input.tenantId)) failures.push(`${label}:tenant_mismatch`);
  if(!evidence||evidence.siteId===undefined||evidence.siteId===null||String(evidence.siteId).trim()==='') failures.push(`${label}:site_missing`);
  else if(String(evidence.siteId)!==String(input.siteId)) failures.push(`${label}:site_mismatch`);
}

function sourceIds(profile){
  return [...new Set((Array.isArray(profile)?profile:[]).map(segment=>segment?.sourceId).filter(value=>typeof value==='string'&&value.trim()))].sort();
}

function profileQualityStats(profileEvidence){
  const qualities=[...(profileEvidence?.baseline??[]),...(profileEvidence?.candidate??[])]
    .map(segment=>Number(segment?.qualityScore))
    .filter(value=>Number.isFinite(value)&&value>=0&&value<=1);
  const weakestQualityScore=qualities.length?Math.min(...qualities):null;
  const qualityImpliedUncertaintyPct=weakestQualityScore===null?1:Math.max(0,Math.min(1,1-weakestQualityScore));
  return {weakestQualityScore,qualityImpliedUncertaintyPct};
}

export function bindMeasuredProfileEconomics(input,{minQuality=0.8,minUncertaintyPct}={}){
  const next=structuredClone(input??{});
  const failures=[];
  const evidence=[];
  const options=Array.isArray(next.options)?next.options:[];
  const acceptedMinQuality=fraction(minQuality)?Number(minQuality):0.8;
  const fixedUncertaintyFloorPct=fraction(minUncertaintyPct)?Number(minUncertaintyPct):1-acceptedMinQuality;

  options.forEach((option,index)=>{
    if(!option||option.kind==='do_nothing') return;
    const profileEvidence=option.energy?.profileEvidence;
    if(!profileEvidence) return;

    const optionId=typeof option.id==='string'&&option.id?option.id:`option-${index}`;
    const label=`option:${optionId}:profile`;
    requireScope(label,profileEvidence,next,failures);

    if(!fraction(profileEvidence.uncertaintyPct)) failures.push(`${label}:uncertainty_invalid_or_missing`);

    let derived;
    try {
      derived=deriveProfileOpportunity(
        {baseline:profileEvidence.baseline,candidate:profileEvidence.candidate},
        {now:next.now,minQuality:acceptedMinQuality}
      );
    } catch (error) {
      failures.push(`${label}:evaluation_error`);
      evidence.push({optionId,valid:false,failures:['evaluation_error'],errorName:error?.name??'Error'});
      return;
    }

    if(!derived.valid){
      const profileFailures=derived.failures.map(reason=>`${label}:${reason}`);
      failures.push(...profileFailures);
      evidence.push({optionId,valid:false,failures:derived.failures});
      return;
    }

    if(!fraction(profileEvidence.uncertaintyPct)){
      evidence.push({optionId,valid:false,failures:['uncertainty_invalid_or_missing']});
      return;
    }

    const declaredUncertaintyPct=Number(profileEvidence.uncertaintyPct);
    const {weakestQualityScore,qualityImpliedUncertaintyPct}=profileQualityStats(profileEvidence);
    const uncertaintyPct=Math.max(declaredUncertaintyPct,fixedUncertaintyFloorPct);
    const uncertaintyFloorApplied=uncertaintyPct>declaredUncertaintyPct;
    const derivedAvoidedEnergyCost=Math.max(0,Number(derived.avoidedEnergyCost));
    const headlineGrossSaving=finite(option.energy?.grossSaving)?Number(option.energy.grossSaving):null;
    const conservativeLowerBound=derivedAvoidedEnergyCost*(1-uncertaintyPct);

    option.energy={
      ...(option.energy??{}),
      grossSaving:derivedAvoidedEnergyCost,
      uncertaintyPct,
      lowerBoundEnergyValue:conservativeLowerBound,
      valueStackingAllowed:false,
      profileDerived:true
    };

    evidence.push({
      optionId,
      valid:true,
      headlineGrossSaving,
      derivedAvoidedEnergyCost,
      conservativeLowerBound,
      declaredUncertaintyPct,
      weakestQualityScore,
      qualityImpliedUncertaintyPct,
      fixedUncertaintyFloorPct,
      effectiveUncertaintyPct:uncertaintyPct,
      uncertaintyFloorApplied,
      uncertaintyPolicy:'fixed_floor_until_adapter_calibration',
      uncertaintyPct,
      baselineCost:derived.baseline.cost,
      candidateCost:derived.candidate.cost,
      transitionEnergyKwh:derived.transitionEnergyKwh,
      sourceIds:[...new Set([...sourceIds(profileEvidence.baseline),...sourceIds(profileEvidence.candidate)])].sort()
    });
  });

  return {
    bindingVersion:ENERGY_PROFILE_BINDING_VERSION,
    valid:failures.length===0,
    failures:[...new Set(failures)].sort(),
    input:next,
    evidence
  };
}

export function evaluateEnergyFlexibilityProfileAware(input,options={}){
  const binding=bindMeasuredProfileEconomics(input,options);
  if(!binding.valid){
    return {
      bindingVersion:ENERGY_PROFILE_BINDING_VERSION,
      profileBindingValid:false,
      profileBindingFailures:binding.failures,
      profileEvidence:binding.evidence,
      status:'input_rejected',
      decisionState:'profile_binding_failed',
      rankedOptions:[],
      authorityBoundary:'planning_and_workflow_handoff_only_no_direct_actuation'
    };
  }

  return {
    ...evaluateEnergyFlexibilityHardened(binding.input),
    bindingVersion:ENERGY_PROFILE_BINDING_VERSION,
    profileBindingValid:true,
    profileBindingFailures:[],
    profileEvidence:binding.evidence
  };
}
