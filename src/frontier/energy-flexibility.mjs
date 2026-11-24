import crypto from 'node:crypto';

export const ENERGY_FLEX_ENGINE_VERSION = 'energy-flex-shadow-v0.4.1';

const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const ms=(v)=>{const x=typeof v==='number'?v:Date.parse(v);return Number.isFinite(x)?x:null;};
const stable=(v)=>Array.isArray(v)?v.map(stable):(v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v);
const hash=(v)=>crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
const statusPrecedence=(status)=>status==='cancelled'?3:status==='superseded'?2:status==='active'?1:0;

export function reduceEnergySignalEventsDetailed(events=[]){
  const inputEvents=Array.isArray(events)?events:[];
  const usable=inputEvents.filter(e=>e&&Number.isFinite(Number(e.revision))&&ms(e.publishedAt)!==null);
  if(!usable.length) return {signal:null,eventCount:inputEvents.length,usableCount:0,uniqueEventCount:0,duplicateCount:0,conflict:false};

  const uniqueByHash=new Map();
  for(const event of usable) uniqueByHash.set(hash(event),event);
  const unique=[...uniqueByHash.values()];
  const maxRevision=Math.max(...unique.map(e=>Number(e.revision)));
  const atRevision=unique.filter(e=>Number(e.revision)===maxRevision);
  const maxPublished=Math.max(...atRevision.map(e=>ms(e.publishedAt)));
  const latest=atRevision.filter(e=>ms(e.publishedAt)===maxPublished);
  const conflict=atRevision.length>1;
  const signal=[...latest].sort((a,b)=>statusPrecedence(a.status)-statusPrecedence(b.status)||hash(a).localeCompare(hash(b)))[latest.length-1];
  return {signal,eventCount:inputEvents.length,usableCount:usable.length,uniqueEventCount:unique.length,duplicateCount:usable.length-unique.length,conflict};
}

export function reduceEnergySignalEvents(events=[]){
  return reduceEnergySignalEventsDetailed(events).signal;
}

function signalState(signal,now,input,reduction){
  const reasons=[];
  if(!signal) return {fresh:false,reasons:['missing_energy_signal']};
  if(reduction?.conflict) reasons.push('energy_signal_revision_conflict');
  if(['cancelled','superseded'].includes(signal.status)) reasons.push(`energy_signal_${signal.status}`);
  else if(signal.status!=='active') reasons.push('energy_signal_status_unsupported');
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

function scopeFailures(input,signal,process,option){
  const reasons=[];
  for(const [label,obj] of [['energy_signal',signal],['process',process],['option',option]]){
    if(!obj) continue;
    if(obj.tenantId!==undefined&&String(obj.tenantId)!==String(input.tenantId)) reasons.push(`${label}_tenant_mismatch`);
    if(obj.siteId!==undefined&&String(obj.siteId)!==String(input.siteId)) reasons.push(`${label}_site_mismatch`);
  }
  return reasons;
}

function processFailures(process={},option={}){
  const reasons=[];
  const flexKinds=new Set(['shift_earlier','shift_later','curtail','advance_production','maintenance_swap','training_swap','alternate_line']);
  const cls=process.flexibilityClass??'unknown';
  if(flexKinds.has(option.kind)&&!['shiftable','interruptible'].includes(cls)) reasons.push('process_not_shiftable');
  if(option.kind==='curtail'&&cls!=='interruptible') reasons.push('process_not_interruptible');
  if(process.batchContinuityRequired&&(option.kind==='curtail'||num(option.interruptionMinutes)>0)) reasons.push('batch_continuity_required');
  if(process.stateFresh===false) reasons.push('process_state_stale');
  if(process.qualityHold===true) reasons.push('process_quality_hold');

  const shift=Math.abs(num(option.shiftMinutes,0));
  if(Number.isFinite(Number(process.maxShiftMinutes))&&shift>Number(process.maxShiftMinutes)) reasons.push('process_shift_window_exceeded');
  if(option.requiresRestart===true){
    if(Number.isFinite(Number(process.minimumWarmupMinutes))&&num(option.warmupMinutes,0)<Number(process.minimumWarmupMinutes)) reasons.push('process_warmup_insufficient');
    if(Number.isFinite(Number(process.minimumCooldownMinutes))&&num(option.cooldownMinutes,0)<Number(process.minimumCooldownMinutes)) reasons.push('process_cooldown_insufficient');
  }
  if(Number.isFinite(Number(option.expectedPowerKw))){
    if(Number.isFinite(Number(process.powerKwMin))&&Number(option.expectedPowerKw)<Number(process.powerKwMin)) reasons.push('process_power_below_profile_band');
    if(Number.isFinite(Number(process.powerKwMax))&&Number(option.expectedPowerKw)>Number(process.powerKwMax)) reasons.push('process_power_above_profile_band');
  }
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
  if(energyValueLowerBound>grossEnergyValue) failures.push('invalid_economics:lowerBoundEnergyValue');
  const labourCostUpperBound=Math.max(labourCost,nonNegative(l.upperBoundCost,'upperBoundCost',failures,labourCost));
  const disruptionCostUpperBound=Math.max(disruptionCost,nonNegative(p.upperBoundPenalty,'upperBoundPenalty',failures,penalty)+nonNegative(option.upperBoundScheduleChurnCost,'upperBoundScheduleChurnCost',failures,churn));
  return {failures,avoidedEnergyCost:avoided,flexibilityReward:reward,stackingAllowed,doubleCountGuardApplied,grossEnergyValue,energyValueLowerBound,labourCost,labourCostUpperBound,disruptionCost,disruptionCostUpperBound,netControllableValue:grossEnergyValue-labourCost-disruptionCost,conservativeNetValue:energyValueLowerBound-labourCostUpperBound-disruptionCostUpperBound};
}

function dominates(a,b){
  const aMoney=a.economics,bMoney=b.economics;
  const noWorse=a.selectionValue>=b.selectionValue&&aMoney.labourCostUpperBound<=bMoney.labourCostUpperBound&&aMoney.disruptionCostUpperBound<=bMoney.disruptionCostUpperBound&&a.confidence>=b.confidence;
  const strictlyBetter=a.selectionValue>b.selectionValue||aMoney.labourCostUpperBound<bMoney.labourCostUpperBound||aMoney.disruptionCostUpperBound<bMoney.disruptionCostUpperBound||a.confidence>b.confidence;
  return noWorse&&strictlyBetter;
}

export function paretoFront(options=[]){
  const candidates=Array.isArray(options)?options:[];
  return candidates.filter(candidate=>!candidates.some(other=>other!==candidate&&dominates(other,candidate)));
}

function canonicalDecisionInput(input,effectiveSignal){
  const canonical={...input,energySignal:effectiveSignal};
  delete canonical.energyEvents;
  if(Array.isArray(canonical.options)) canonical.options=[...canonical.options].sort((a,b)=>String(a.id??'').localeCompare(String(b.id??''))||String(a.kind??'').localeCompare(String(b.kind??'')));
  return canonical;
}

export function evaluateEnergyFlexibility(input){
  const now=ms(input?.now);
  if(now===null) throw new TypeError('input.now must be an ISO timestamp or epoch milliseconds');
  if(!input?.tenantId||!input?.siteId) throw new TypeError('tenantId and siteId are required');
  const valueBasis=input.valueBasis==='point'?'point':'conservative';
  const eventReduction=Array.isArray(input.energyEvents)?reduceEnergySignalEventsDetailed(input.energyEvents):null;
  const energySignal=eventReduction?.signal??input.energySignal;
  const signal=signalState(energySignal,now,input,eventReduction);
  const minConfidence=Math.max(0,Math.min(1,num(input.minimumDecisionConfidence,0.6)));
  const evaluated=(Array.isArray(input.options)?input.options:[]).map((option,index)=>{
    const optionId=typeof option.id==='string'&&option.id?option.id:`option-${index}`;
    const money=economics(option);
    const confidence=Math.min(num(energySignal?.confidence,1),num(input.process?.confidence,1),num(option.workforce?.confidence,1));
    const hardConstraintFailures=[...(!signal.fresh&&option.kind!=='do_nothing'?signal.reasons:[]),...(option.kind!=='do_nothing'?scopeFailures(input,energySignal,input.process,option):[]),...processFailures(input.process,option),...workforceFailures(option.workforce),...authorityFailures(option),...money.failures,...((option.kind!=='do_nothing'&&confidence<minConfidence)?['insufficient_data_confidence']:[]),...(option.production?.hardServiceBreach?['hard_service_or_otif_breach']:[]),...(option.production?.qualityRisk==='unacceptable'?['unacceptable_quality_risk']:[])];
    const executable=hardConstraintFailures.length===0;
    const selectionValue=valueBasis==='point'?money.netControllableValue:money.conservativeNetValue;
    const valuable=executable&&option.kind!=='do_nothing'&&selectionValue>num(input.minimumNetBenefit,0);
    return {id:optionId,kind:option.kind,executable,valuable,confidence,valueBasis,selectionValue,hardConstraintFailures,economics:{...money,failures:undefined},approvalRequired:Boolean(option.approvalRequired),actionContract:executable&&option.kind!=='do_nothing'?{type:'workflow_handoff_only',optionId,requiresApproval:true,forbiddenDirectActuation:['grid_bid','machine','bess','robot']}:null};
  });
  const valuableOptions=evaluated.filter(x=>x.valuable);
  const front=paretoFront(valuableOptions);
  const frontIds=new Set(front.map(x=>x.id));
  const rankedOptions=[...front].sort((a,b)=>b.selectionValue-a.selectionValue||a.economics.disruptionCostUpperBound-b.economics.disruptionCostUpperBound||a.economics.labourCostUpperBound-b.economics.labourCostUpperBound||b.confidence-a.confidence||a.id.localeCompare(b.id));
  const dominatedOptions=valuableOptions.filter(x=>!frontIds.has(x.id)).map(x=>({...x,dominatedBy:front.filter(y=>dominates(y,x)).map(y=>y.id).sort()}));
  const baseline=evaluated.find(x=>x.kind==='do_nothing')??null;
  const tieTolerance=Math.max(0,num(input.tieTolerancePct,0.05));
  let decisionState=rankedOptions.length?'clear_leader':'no_safe_or_valuable_flexibility';
  if(rankedOptions.length>1){const top=rankedOptions[0].selectionValue,second=rankedOptions[1].selectionValue;if(Math.abs(top-second)/Math.max(Math.abs(top),1)<=tieTolerance) decisionState='multiple_close_options';}
  const result={engineVersion:ENERGY_FLEX_ENGINE_VERSION,valueBasis,status:rankedOptions.length?'recommend_options':'no_safe_or_valuable_flexibility',decisionState,signalFresh:signal.fresh,signalFailures:signal.reasons,effectiveSignalRevision:energySignal?.revision??null,eventReduction:eventReduction?{eventCount:eventReduction.eventCount,usableCount:eventReduction.usableCount,uniqueEventCount:eventReduction.uniqueEventCount,duplicateCount:eventReduction.duplicateCount,conflict:eventReduction.conflict}:null,baseline,rankedOptions,dominatedOptions,rejectedOptions:evaluated.filter(x=>!x.valuable),authorityBoundary:'planning_and_workflow_handoff_only_no_direct_actuation'};
  result.reproducibilityHash=hash({engineVersion:ENERGY_FLEX_ENGINE_VERSION,input:canonicalDecisionInput(input,energySignal),result:{valueBasis:result.valueBasis,status:result.status,decisionState:result.decisionState,signalFresh:result.signalFresh,rankedOptions:result.rankedOptions,dominatedOptions:result.dominatedOptions,rejectedOptions:result.rejectedOptions,authorityBoundary:result.authorityBoundary}});
  return result;
}

export function isParetoBetterThanBaseline(option,baseline){
  if(!option?.valuable||!option.executable) return false;
  if(!baseline) return option.selectionValue>0;
  return option.selectionValue>baseline.selectionValue;
}

