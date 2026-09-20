export const DEGRADED_MODE_READINESS_VERSION='degraded-mode-readiness-v0.1.0';

const finite=v=>typeof v==='number'&&Number.isFinite(v);
const clean=v=>typeof v==='string'?v.trim():'';

function clonePeople(people=[]){
  return people.map(p=>({
    id:clean(p.id), siteId:clean(p.siteId), shift:clean(p.shift),
    competencies:new Set(Array.isArray(p.competencies)?p.competencies.map(clean).filter(Boolean):[]),
    eligibleTraining:Array.isArray(p.eligibleTraining)?p.eligibleTraining.map(clean).filter(Boolean):[]
  }));
}

function validAsset(asset,siteId){
  if(!clean(asset?.id)||clean(asset.siteId)!==siteId||!clean(asset.shift))return 'invalid_asset_scope';
  if(asset.degradedModeApproved===true){
    if(!clean(asset.requiredCompetency)||!Number.isInteger(asset.minimumOperators)||asset.minimumOperators<1)return 'invalid_degraded_mode_requirement';
  }
  if(!finite(Number(asset.riskWeight))||Number(asset.riskWeight)<0||Number(asset.riskWeight)>1)return 'invalid_risk_weight';
  if(!finite(Number(asset.valueAtRisk))||Number(asset.valueAtRisk)<0)return 'invalid_value_at_risk';
  return null;
}

function coverage(people,asset){
  if(asset.degradedModeApproved!==true)return null;
  return people.filter(p=>p.siteId===asset.siteId&&p.shift===asset.shift&&p.competencies.has(asset.requiredCompetency)).length;
}

function exposureForAsset(people,asset){
  if(asset.degradedModeApproved!==true){
    return {
      assetId:asset.id,
      state:'engineering_resilience_only',
      exposure:0,
      coverage:null,
      gap:null,
      reason:'manual_or_degraded_operation_not_approved'
    };
  }
  const c=coverage(people,asset);
  const gap=Math.max(0,asset.minimumOperators-c);
  const exposure=gap*Number(asset.riskWeight)*Number(asset.valueAtRisk);
  return {assetId:asset.id,state:gap>0?'workforce_gap':'covered',coverage:c,gap,exposure};
}

export function evaluateDegradedModeReadiness(input={}){
  const siteId=clean(input.siteId);
  if(!siteId)return {status:'blocked',reason:'missing_site_scope'};
  const people=clonePeople(input.people);
  if(people.some(p=>!p.id||p.siteId!==siteId||!p.shift))return {status:'blocked',reason:'invalid_people_scope'};
  const assets=Array.isArray(input.assets)?input.assets:[];
  if(!assets.length)return {status:'blocked',reason:'no_assets'};
  for(const asset of assets){
    const invalid=validAsset(asset,siteId);
    if(invalid)return {status:'blocked',reason:invalid,assetId:asset?.id??null};
  }
  const effects=assets.map(a=>exposureForAsset(people,a));
  const workforceExposure=effects.reduce((s,e)=>s+e.exposure,0);
  const engineeringOnly=effects.filter(e=>e.state==='engineering_resilience_only').map(e=>e.assetId);
  return {
    status:'evaluated',siteId,workforceExposure,effects,engineeringOnly,
    claimBoundary:'Workforce readiness only. This engine never authorises manual control, changes OT state, bypasses interlocks, or treats unapproved degraded operation as a staffing solution.'
  };
}

export function recommendFallbackTraining(input={},budget=1){
  const base=evaluateDegradedModeReadiness(input);
  if(base.status!=='evaluated')return base;
  if(!Number.isInteger(budget)||budget<0)return {status:'blocked',reason:'invalid_training_budget'};
  const people=clonePeople(input.people);
  const assets=input.assets;
  const recommendations=[];

  for(let step=0;step<budget;step++){
    let best=null;
    const current=evaluateDegradedModeReadiness({...input,people:people.map(p=>({...p,competencies:[...p.competencies]}))});
    for(const effect of current.effects){
      if(effect.state!=='workforce_gap'||effect.exposure<=0)continue;
      const asset=assets.find(a=>a.id===effect.assetId);
      const candidates=people.filter(p=>
        p.siteId===asset.siteId&&p.shift===asset.shift&&!p.competencies.has(asset.requiredCompetency)&&p.eligibleTraining.includes(asset.requiredCompetency)
      );
      for(const person of candidates){
        const reduction=Number(asset.riskWeight)*Number(asset.valueAtRisk);
        if(!best||reduction>best.exposureReduction){
          best={personId:person.id,assetId:asset.id,competency:asset.requiredCompetency,shift:asset.shift,exposureReduction:reduction};
        }
      }
    }
    if(!best)break;
    const target=people.find(p=>p.id===best.personId);
    target.competencies.add(best.competency);
    recommendations.push(best);
  }

  const after=evaluateDegradedModeReadiness({...input,people:people.map(p=>({...p,competencies:[...p.competencies]}))});
  return {
    status:'recommended',siteId:base.siteId,beforeExposure:base.workforceExposure,afterExposure:after.workforceExposure,
    exposureReduction:base.workforceExposure-after.workforceExposure,recommendations,
    engineeringOnly:base.engineeringOnly,
    safetyBoundary:base.claimBoundary
  };
}

export function rarityOnlyAlternative(input={},budget=1){
  const base=evaluateDegradedModeReadiness(input);
  if(base.status!=='evaluated')return base;
  const people=clonePeople(input.people);
  const approved=(input.assets||[]).filter(a=>a.degradedModeApproved===true);
  for(let step=0;step<budget;step++){
    const options=[];
    for(const asset of approved){
      const count=people.filter(p=>p.siteId===asset.siteId&&p.competencies.has(asset.requiredCompetency)).length;
      const candidate=people.find(p=>!p.competencies.has(asset.requiredCompetency)&&p.eligibleTraining.includes(asset.requiredCompetency));
      if(candidate)options.push({count,asset,candidate});
    }
    if(!options.length)break;
    options.sort((a,b)=>a.count-b.count||String(a.asset.id).localeCompare(String(b.asset.id)));
    options[0].candidate.competencies.add(options[0].asset.requiredCompetency);
  }
  const after=evaluateDegradedModeReadiness({...input,people:people.map(p=>({...p,competencies:[...p.competencies]}))});
  return {status:'alternative',beforeExposure:base.workforceExposure,afterExposure:after.workforceExposure,exposureReduction:base.workforceExposure-after.workforceExposure};
}
