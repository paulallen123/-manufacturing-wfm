import crypto from 'node:crypto';

export const ENERGY_FLEX_ENGINE_VERSION = 'energy-flex-shadow-v0.3.0';

const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const ms=(v)=>{const x=typeof v==='number'?v:Date.parse(v);return Number.isFinite(x)?x:null;};
const stable=(v)=>Array.isArray(v)?v.map(stable):(v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v);
const hash=(v)=>crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');

export function reduceEnergySignalEvents(events=[]){
  const usable=(Array.isArray(events)?events:[]).filter(e=>e&&Number.isFinite(Number(e.revision))&&ms(e.publishedAt)!==null);
  if(!usable.length) return null;
  return [...usable].sort((a,b)=>Number(a.revision)-Number(b.revision)||(ms(a.publishedAt)-ms(b.publishedAt)))[usable.length-1];
}

function signalState(signal,now,input){
  const reasons=[];
  if(!signal) return {fresh:false,reasons:['missing_energy_signal']};
  if(['cancelled','superseded'].includes(signal.status)) reasons.push(`energy_signal_${signal.status}`);
  const published=ms(signal.publishedAt),freshUntil=ms(signal.freshUntil),windowEnd=ms(signal.windowEnd),deadline=ms(signal.acceptanceDeadline);
  if(published===null) reasons.push('energy_signal_missing_publication_time');
  if(published!==null&&published>now) reasons.push('energy_signal_from_future');
  if(freshUntil===null||freshUntil<now) reasons.push('energy_signal_stale');
  if(windowEnd===null||windowEnd<=now) reasons.push('energy_window_expired');
  if(deadline!==null&&deadline<now) reasons.push('acceptance_deadline_expired');
  if(num(signal.confidence,1)<0.5) reasons.push('energy_signal_low_confidence');
  if(input.latestKnownSignalRevision!==undefined&&String(signal.revision??'')!==String(input.latestKnownSignalRevision)) reasons.push('energy_signal_revision_superseded');
  return {fresh:reasons.length===0,reasons};
}

function processFailures(process={},option={}){
  const reasons=[];
  const flexKinds=new Set(['shift_earlier','shift_later','curtail','advance_production','maintenance_swap','training_swap','alternate_line']);
  const cls=process.flexibilityClass??'unknown';
  if(flexKinds.has(option.kind)&&!['shiftable','interruptible'].includes(cls)) reasons.push('process_not_shiftable');
  if(option.kind==='curtail'&&cls!=='interruptible') reasons.push('process_not_interruptible');
  if(process.batchContinuityRequired&&option.kind==='curtail') reasons.push('batch_continuity_required');
  if(process.stateFresh===false) reasons.push('process_state_stale');
  if(process.qualityHold===true) reasons.push('process_quality_hold');
  return reasons;
}

function workforceFailures(w={}){
  const reasons=[];
  if(w.restCompliant===false) reasons.push('working_time_or_rest_violation');
  if(w.qualificationsValid===false) reasons.push('qualification_invalid');
  if(w.supervisorRequired&&!w.supervisorAvailable) reasons.push('required_supervision_missing');
  if(w.consentRequired&&!w.consentAvailable) reasons.push('required_employee_consent_missing');
  if(num(w.staffingCount)<num(w.minimumStaffing)) reasons.push('minimum_staffing_not_met');
  for(const [skill,count] of Object.entries(w.requiredSkills??{})) if(num(w.skillCoverage?.[skill])<num(count)) reasons.push(`skill_gap:${skill}`);
  return reasons;
}

function authorityFailures(option={}){
  const c=option.controls??{},reasons=[];
  if(c.directGridBid) reasons.push('direct_grid_bid_forbidden');
  if(c.directMachineCommand) reasons.push('direct_machine_control_forbidden');
  if(c.directBatteryDispatch) reasons.push('direct_bess_control_forbidden');
  if(c.directRobotCommand) reasons.push('direct_robot_control_forbidden');
  if(option.publishedScheduleMutation===true&&option.approvalRequired!==true) reasons.push('schedule_mutation_without_approval');
  return reasons;
}

function nonNegative(v,label,failures,fallback=0){
  if(v===undefined||v===null) return fallback;
  const x=Number(v);
  if(!Number.isFinite(x)||x<0){failures.push(`invalid_economics:${label}`);return fallback;}
  return x;
}

function economics(option={}){
  const e=option.energy??{},l=option.labour??{},p=option.production??{},failures=[];
  const avoided=nonNegative(e.grossSaving,'grossSaving',failures),reward=nonNegative(e.flexibilityReward,'flexibilityReward',failures),stackingAllowed=e.valueStackingAllowed===true;
  const grossEnergyValue=stackingAllowed?avoided+reward:Math.max(avoided,reward);
  const doubleCountGuardApplied=!stackingAllowed&&avoided>0&&reward>0;
  const premium=nonNegative(l.premiumCost,'premiumCost',failures),agency=nonNegative(l.agencyCost,'agencyCost',failures),transport=nonNegative(l.transportCost,'transportCost',failures);
  const penalty=nonNegative(p.penaltyCost,'penaltyCost',failures),churn=nonNegative(option.scheduleChurnCost,'scheduleChurnCost',failures);
  const labourCost=premium+agency+transport,disruptionCost=churn+penalty;
  const uncertainty=Math.max(0,Math.min(1,nonNegative(e.uncertaintyPct,'uncertaintyPct',failures,0)));
  const energyValueLowerBound=Math.max(0,nonNegative(e.lowerBoundEnergyValue,'lowerBoundEnergyValue',failures,grossEnergyValue*(1-uncertainty)));
  const labourCostUpperBound=Math.max(labourCost,nonNegative(l.upperBoundCost,'upperBoundCost',failures,labourCost));
  const disruptionCostUpperBound=Math.max(disruptionCost,nonNegative(p.upperBoundPenalty,'upperBoundPenalty',failures,penalty)+nonNegative(option.upperBoundScheduleChurnCost,'upperBoundScheduleChurnCost',failures,churn));
  return {failures,avoidedEnergyCost:avoided,flexibilityReward:reward,stackingAllowed,doubleCountGuardApplied,grossEnergyValue,energyValueLowerBound,labourCost,labourCostUpperBound,disruptionCost,disruptionCostUpperBound,netControllableValue:grossEnergyValue-labourCost-disruptionCost,conservativeNetValue:energyValueLowerBound-labourCostUpperBound-disruptionCostUpperBound};
}

export function evaluateEnergyFlexibility(input){
  const now=ms(input?.now);
  if(now===null) throw new TypeError('input.now must be an ISO timestamp or epoch milliseconds');
  if(!input?.tenantId||!input?.siteId) throw new TypeError('tenantId and siteId are required');
  const valueBasis=input.valueBasis==='point'?'point':'conservative';
  const energySignal=Array.isArray(input.energyEvents)?reduceEnergySignalEvents(input.energyEvents):input.energySignal;
  const signal=signalState(energySignal,now,input);
  const minConfidence=Math.max(0,Math.min(1,num(input.minimumDecisionConfidence,0.6)));
  const evaluated=(Array.isArray(input.options)?input.options:[]).map((option,index)=>{
    const optionId=typeof option.id==='string'&&option.id?option.id:`option-${index}`;
    const money=economics(option);
    const confidence=Math.min(num(energySignal?.confidence,1),num(input.process?.confidence,1),num(option.workforce?.confidence,1));
    const hardConstraintFailures=[...(!signal.fresh&&option.kind!=='do_nothing'?signal.reasons:[]),...processFailures(input.process,option),...workforceFailures(option.workforce),...authorityFailures(option),...money.failures,...((option.kind!=='do_nothing'&&confidence<minConfidence)?['insufficient_data_confidence']:[]),...(option.production?.hardServiceBreach?['hard_service_or_otif_breach']:[]),...(option.production?.qualityRisk==='unacceptable'?['unacceptable_quality_risk']:[])];
    const executable=hardConstraintFailures.length===0;
    const selectionValue=valueBasis==='point'?money.netControllableValue:money.conservativeNetValue;
    const valuable=executable&&option.kind!=='do_nothing'&&selectionValue>num(input.minimumNetBenefit,0);
    return {id:optionId,kind:option.kind,executable,valuable,confidence,valueBasis,selectionValue,hardConstraintFailures,economics:{...money,failures:undefined},approvalRequired:Boolean(option.approvalRequired),actionContract:executable&&option.kind!=='do_nothing'?{type:'workflow_handoff_only',optionId,requiresApproval:true,forbiddenDirectActuation:['grid_bid','machine','bess','robot']}:null};
  });
  const rankedOptions=evaluated.filter(x=>x.valuable).sort((a,b)=>b.selectionValue-a.selectionValue||a.id.localeCompare(b.id));
  const baseline=evaluated.find(x=>x.kind==='do_nothing')??null;
  const tieTolerance=Math.max(0,num(input.tieTolerancePct,0.05));
  let decisionState=rankedOptions.length?'clear_leader':'no_safe_or_valuable_flexibility';
  if(rankedOptions.length>1){const top=rankedOptions[0].selectionValue,second=rankedOptions[1].selectionValue;if(Math.abs(top-second)/Math.max(Math.abs(top),1)<=tieTolerance) decisionState='multiple_close_options';}
  const result={engineVersion:ENERGY_FLEX_ENGINE_VERSION,valueBasis,status:rankedOptions.length?'recommend_options':'no_safe_or_valuable_flexibility',decisionState,signalFresh:signal.fresh,signalFailures:signal.reasons,effectiveSignalRevision:energySignal?.revision??null,baseline,rankedOptions,rejectedOptions:evaluated.filter(x=>!x.valuable),authorityBoundary:'planning_and_workflow_handoff_only_no_direct_actuation'};
  result.reproducibilityHash=hash({engineVersion:ENERGY_FLEX_ENGINE_VERSION,input,effectiveSignal:energySignal,result:{valueBasis:result.valueBasis,status:result.status,decisionState:result.decisionState,signalFresh:result.signalFresh,rankedOptions:result.rankedOptions,rejectedOptions:result.rejectedOptions,authorityBoundary:result.authorityBoundary}});
  return result;
}

export function isParetoBetterThanBaseline(option,baseline){
  if(!option?.valuable||!option.executable) return false;
  if(!baseline) return option.selectionValue>0;
  return option.selectionValue>baseline.selectionValue;
}
