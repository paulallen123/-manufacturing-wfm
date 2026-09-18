export const ENERGY_PROFILE_BENCHMARK_VERSION='energy-profile-benchmark-v0.1.0';

const PHASES=new Set(['ramp_up','warmup','run','ramp_down','cooldown','idle']);
const n=(value)=>Number(value);
const t=(value)=>{const parsed=typeof value==='number'?value:Date.parse(value);return Number.isFinite(parsed)?parsed:null;};

export function evaluatePowerProfile(profile,{now,minQuality=0.8}={}){
  const nowMs=t(now);
  const failures=[];
  if(nowMs===null) throw new TypeError('now must be a valid timestamp');
  if(!Array.isArray(profile)||profile.length===0) return {valid:false,failures:['profile_missing'],energyKwh:0,cost:0,phaseEnergyKwh:{},phaseCost:{}};
  const phaseEnergyKwh={},phaseCost={};
  let energyKwh=0,cost=0;
  profile.forEach((segment,index)=>{
    const prefix=`segment_${index}`;
    if(!segment||typeof segment!=='object'){failures.push(`${prefix}:malformed`);return;}
    const kind=segment.kind;
    const duration=n(segment.durationMinutes),power=n(segment.powerKw),price=n(segment.unitPricePerKwh),quality=n(segment.qualityScore);
    const observed=t(segment.observedAt),freshUntil=t(segment.freshUntil);
    if(!PHASES.has(kind)) failures.push(`${prefix}:invalid_phase`);
    if(!Number.isFinite(duration)||duration<=0) failures.push(`${prefix}:invalid_duration`);
    if(!Number.isFinite(power)||power<0) failures.push(`${prefix}:invalid_power`);
    if(!Number.isFinite(price)||price<0) failures.push(`${prefix}:invalid_price`);
    if(!Number.isFinite(quality)||quality<0||quality>1) failures.push(`${prefix}:invalid_quality`);
    else if(quality<minQuality) failures.push(`${prefix}:quality_below_threshold`);
    if(typeof segment.sourceId!=='string'||!segment.sourceId.trim()) failures.push(`${prefix}:missing_source`);
    if(observed===null||observed>nowMs) failures.push(`${prefix}:invalid_observed_at`);
    if(freshUntil===null||freshUntil<nowMs) failures.push(`${prefix}:stale`);
    if(Number.isFinite(duration)&&duration>0&&Number.isFinite(power)&&power>=0&&Number.isFinite(price)&&price>=0){
      const kwh=power*duration/60,segmentCost=kwh*price;
      energyKwh+=kwh;cost+=segmentCost;
      phaseEnergyKwh[kind]=(phaseEnergyKwh[kind]??0)+kwh;
      phaseCost[kind]=(phaseCost[kind]??0)+segmentCost;
    }
  });
  return {valid:failures.length===0,failures,energyKwh,cost,phaseEnergyKwh,phaseCost};
}

export function deriveProfileOpportunity({baseline,candidate},{now,minQuality=0.8}={}){
  const baselineResult=evaluatePowerProfile(baseline,{now,minQuality});
  const candidateResult=evaluatePowerProfile(candidate,{now,minQuality});
  const failures=[...baselineResult.failures.map(x=>`baseline:${x}`),...candidateResult.failures.map(x=>`candidate:${x}`)];
  const avoidedEnergyCost=baselineResult.cost-candidateResult.cost;
  return {
    valid:failures.length===0,
    failures,
    baseline:baselineResult,
    candidate:candidateResult,
    avoidedEnergyCost,
    lowerCostCandidate:failures.length===0&&avoidedEnergyCost>0,
    transitionEnergyKwh:(candidateResult.phaseEnergyKwh.ramp_up??0)+(candidateResult.phaseEnergyKwh.warmup??0)+(candidateResult.phaseEnergyKwh.ramp_down??0)+(candidateResult.phaseEnergyKwh.cooldown??0)
  };
}

function safestValuable(options=[]){
  return options
    .filter(o=>o&&o.executable===true&&o.hardConstraintFailures?.length===0&&Number.isFinite(n(o.conservativeNetValue))&&n(o.conservativeNetValue)>0)
    .sort((a,b)=>n(b.conservativeNetValue)-n(a.conservativeNetValue)||String(a.id).localeCompare(String(b.id)))[0]??null;
}

export function compareCoordinationModels({options,now,acceptanceDeadline,manualCoordinationMinutes=15}){
  const nowMs=t(now),deadline=t(acceptanceDeadline);
  if(nowMs===null||deadline===null) throw new TypeError('now and acceptanceDeadline must be valid timestamps');
  const best=safestValuable(options);
  const joinedValue=best?n(best.conservativeNetValue):0;
  const slackMinutes=Math.max(0,(deadline-nowMs)/60000);
  const manualCanComplete=slackMinutes>=manualCoordinationMinutes;
  const manualValue=best&&manualCanComplete?joinedValue:0;
  return {
    energyIgnored:{selectedOptionId:null,conservativeValue:0},
    separateEmsManual:{selectedOptionId:manualValue>0?best.id:null,conservativeValue:manualValue,manualCanComplete,slackMinutes},
    joinedDecisionTwin:{selectedOptionId:best?.id??null,conservativeValue:joinedValue},
    authorityBoundary:'benchmark_only_no_actuation'
  };
}
