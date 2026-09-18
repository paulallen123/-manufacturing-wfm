import crypto from 'node:crypto';

export const ENERGY_FLEX_ENGINE_VERSION = 'energy-flex-shadow-v0.2.0';

const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const ms=(v)=>{const x=typeof v==='number'?v:Date.parse(v);return Number.isFinite(x)?x:null;};
const stable=(v)=>Array.isArray(v)?v.map(stable):(v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v);
const hash=(v)=>crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');

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
  if(n(signal.confidence,1)<0.5) reasons.push('energy_signal_low_confidence');
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
  if(n(w.staffingCount)<n(w.minimumStaffing)) reasons.push('minimum_staffing_not_met');
  for(const [skill,count] of Object.entries(w.requiredSkills??{})) if(n(w.skillCoverage?.[skill])<n(count)) reasons.push(`skill_gap:${skill}`);
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

function economics(option={}){
  const e=option.energy??{},l=option.labour??{},p=option.production??{};
  const avoided=n(e.grossSaving),reward=n(e.flexibilityReward),stackingAllowed=e.valueStackingAllowed===true;
  const grossEnergyValue=stackingAllowed?avoided+reward:Math.max(avoided,reward);
  const doubleCountGuardApplied=!stackingAllowed&&avoided>0&&reward>0;
  const labourCost=n(l.premiumCost)+n(l.agencyCost)+n(l.transportCost);
  const disruptionCost=n(option.scheduleChurnCost)+n(p.penaltyCost);
  const uncertainty=Math.max(0,Math.min(1,n(e.uncertaintyPct,0)));
  const energyValueLowerBound=Math.max(0,n(e.lowerBoundEnergyValue,grossEnergyValue*(1-uncertainty)));
  const labourCostUpperBound=Math.max(labourCost,n(l.upperBoundCost,labourCost));
  const disruptionCostUpperBound=Math.max(disruptionCost,n(p.upperBoundPenalty,n(p.penaltyCost))+n(option.upperBoundScheduleChurnCost,n(option.scheduleChurnCost)));
  const netControllableValue=grossEnergyValue-labourCost-disruptionCost;
  const conservativeNetValue=energyValueLowerBound-labourCostUpperBound-disruptionCostUpperBound;
  return {avoidedEnergyCost:avoided,flexibilityReward:reward,stackingAllowed,doubleCountGuardApplied,grossEnergyValue,energyValueLowerBound,labourCost,labourCostUpperBound,disruptionCost,disruptionCostUpperBound,netControllableValue,conservativeNetValue};
}

export function evaluateEnergyFlexibility(input){
  const now=ms(input?.now);
  if(now===null) throw new TypeError('input.now must be an ISO timestamp or epoch milliseconds');
  if(!input?.tenantId||!input?.siteId) throw new TypeError('tenantId and siteId are required');
  const valueBasis=input.valueBasis==='point'?'point':'conservative';
  const signal=signalState(input.energySignal,now,input);
  const evaluated=(Array.isArray(input.options)?input.options:[]).map(option=>{
    const hardConstraintFailures=[...(!signal.fresh&&option.kind!=='do_nothing'?signal.reasons:[]),...processFailures(input.process,option),...workforceFailures(option.workforce),...authorityFailures(option),...(option.production?.hardServiceBreach?['hard_service_or_otif_breach']:[]),...(option.production?.qualityRisk==='unacceptable'?['unacceptable_quality_risk']:[])];
    const money=economics(option);
    const confidence=Math.min(n(input.energySignal?.confidence,1),n(input.process?.confidence,1),n(option.workforce?.confidence,1));
    const executable=hardConstraintFailures.length===0;
    const selectionValue=valueBasis==='point'?money.netControllableValue:money.conservativeNetValue;
    const valuable=executable&&option.kind!=='do_nothing'&&selectionValue>n(input.minimumNetBenefit,0);
    return {id:option.id,kind:option.kind,executable,valuable,confidence,valueBasis,selectionValue,hardConstraintFailures,economics:money,approvalRequired:Boolean(option.approvalRequired),actionContract:executable&&option.kind!=='do_nothing'?{type:'workflow_handoff_only',optionId:option.id,requiresApproval:true,forbiddenDirectActuation:['grid_bid','machine','bess','robot']}:null};
  });
  const rankedOptions=evaluated.filter(x=>x.valuable).sort((a,b)=>b.selectionValue-a.selectionValue||a.id.localeCompare(b.id));
  const baseline=evaluated.find(x=>x.kind==='do_nothing')??null;
  const result={engineVersion:ENERGY_FLEX_ENGINE_VERSION,valueBasis,status:rankedOptions.length?'recommend_options':'no_safe_or_valuable_flexibility',signalFresh:signal.fresh,signalFailures:signal.reasons,baseline,rankedOptions,rejectedOptions:evaluated.filter(x=>!x.valuable),authorityBoundary:'planning_and_workflow_handoff_only_no_direct_actuation'};
  result.reproducibilityHash=hash({engineVersion:ENERGY_FLEX_ENGINE_VERSION,input,result:{valueBasis:result.valueBasis,status:result.status,signalFresh:result.signalFresh,rankedOptions:result.rankedOptions,rejectedOptions:result.rejectedOptions,authorityBoundary:result.authorityBoundary}});
  return result;
}

export function isParetoBetterThanBaseline(option,baseline){
  if(!option?.valuable||!option.executable) return false;
  if(!baseline) return option.selectionValue>0;
  return option.selectionValue>baseline.selectionValue;
}
