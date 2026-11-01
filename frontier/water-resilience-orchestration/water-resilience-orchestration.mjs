import {types as utilTypes} from 'node:util';

export const WATER_RESILIENCE_VERSION='water-resilience-orchestration-v0.2.0';

const clean=v=>typeof v==='string'?v.trim():'';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const nonNegativeNumber=v=>finite(v)&&v>=0;
const has=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);

function freeze(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    for(const key of Object.keys(value))freeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

function dataRecord(value,allowed,required=[]){
  try{
    if(!value||typeof value!=='object'||Array.isArray(value)||utilTypes.isProxy(value))return null;
    const prototype=Object.getPrototypeOf(value);
    if(prototype!==Object.prototype&&prototype!==null)return null;
    const descriptors=Object.getOwnPropertyDescriptors(value);
    const keys=Reflect.ownKeys(descriptors);
    if(keys.some(key=>typeof key!=='string'||!allowed.includes(key)))return null;
    const copy=Object.create(null);
    for(const key of keys){
      const descriptor=descriptors[key];
      if(!descriptor.enumerable||!has(descriptor,'value'))return null;
      copy[key]=descriptor.value;
    }
    if(required.some(key=>!has(copy,key)))return null;
    return copy;
  }catch{return null;}
}

function dataList(value,itemSnapshot=value=>value){
  try{
    if(!Array.isArray(value)||utilTypes.isProxy(value)||Object.getPrototypeOf(value)!==Array.prototype)return null;
    const descriptors=Object.getOwnPropertyDescriptors(value);
    const keys=Reflect.ownKeys(descriptors);
    if(keys.some(key=>typeof key!=='string'))return null;
    if(keys.length!==value.length+1||!has(descriptors,'length'))return null;
    const copy=[];
    for(let index=0;index<value.length;index++){
      const key=String(index),descriptor=descriptors[key];
      if(!descriptor||!descriptor.enumerable||!has(descriptor,'value'))return null;
      const item=itemSnapshot(descriptor.value);
      if(item===null)return null;
      copy.push(item);
    }
    return Object.freeze(copy);
  }catch{return null;}
}

function instant(value){
  if(typeof value!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/.test(value))return null;
  const milliseconds=Date.parse(value);
  if(!Number.isFinite(milliseconds))return null;
  const canonical=new Date(milliseconds).toISOString();
  const expected=value.includes('.')?value:value.replace(/Z$/,'.000Z');
  return canonical===expected?milliseconds:null;
}

// Preserve raw string IDs and legacy finite numeric worker IDs/references. Slot keys retain
// numeric-string compatibility, but must not be coerced from missing/boolean/object values.
const referenceKey=id=>(clean(id)||finite(id))?String(id):null;
const slotKey=slot=>(clean(slot)||finite(slot))&&Number.isInteger(Number(slot))?Number(slot):null;

const ROOT_FIELDS=['policy','workers','tasks','plan','plans','now'];
const POLICY_FIELDS=['authoritative','siteId','version','ref','observedAt','maxAgeMinutes','slots'];
const SLOT_FIELDS=['slot','authoritative','waterSource','freshWaterAvailableM3','minimumReserveM3','effluentCapacityM3','scarcityWeight','waterTariffPerM3','restrictionActive'];
const WORKER_FIELDS=['id','siteId','skills'];
const TASK_FIELDS=['id','siteId','skill','freshWaterM3','effluentM3','earliestSlot','latestSlot','preferredSlot','latePenalty','allowedWaterSources','allowedDuringRestriction'];
const PLAN_FIELDS=['id','assignments'];
const ASSIGNMENT_FIELDS=['taskId','workerId','slot'];

function snapshotSlot(value){
  const record=dataRecord(value,SLOT_FIELDS,['slot']);
  if(!record)return null;
  if(has(record,'waterSource')&&(typeof record.waterSource!=='string'||!clean(record.waterSource)))return null;
  if(has(record,'restrictionActive')&&typeof record.restrictionActive!=='boolean')return null;
  if(has(record,'minimumReserveM3')&&!nonNegativeNumber(record.minimumReserveM3))return null;
  return Object.freeze(record);
}
function snapshotPolicy(value){
  const record=dataRecord(value,POLICY_FIELDS);
  if(!record)return {error:'policy_invalid'};
  const slots=dataList(record.slots,snapshotSlot);
  if(!slots)return {error:'water_slots_invalid'};
  record.slots=slots;
  return {value:Object.freeze(record)};
}

function snapshotWorker(value){
  const record=dataRecord(value,WORKER_FIELDS,['id','siteId','skills']);
  if(!record)return null;
  const skills=dataList(record.skills,skill=>typeof skill==='string'&&clean(skill)?skill:null);
  if(!skills)return null;
  record.skills=skills;
  return Object.freeze(record);
}

function snapshotTask(value){
  const record=dataRecord(value,TASK_FIELDS,['id','siteId','skill','freshWaterM3','effluentM3','earliestSlot','latestSlot','allowedWaterSources','allowedDuringRestriction']);
  if(!record)return null;
  const sources=dataList(record.allowedWaterSources,source=>typeof source==='string'&&clean(source)?source:null);
  if(!sources)return null;
  record.allowedWaterSources=sources;
  return Object.freeze(record);
}

const snapshotAssignment=value=>{
  const record=dataRecord(value,ASSIGNMENT_FIELDS,['taskId','workerId','slot']);
  return record?Object.freeze(record):null;
};
function snapshotPlan(value){
  const record=dataRecord(value,PLAN_FIELDS,['id','assignments']);
  if(!record)return null;
  const assignments=dataList(record.assignments,snapshotAssignment);
  if(!assignments)return null;
  record.assignments=assignments;
  return Object.freeze(record);
}

function policyGate(policy,now){
  if(policy.authoritative!==true)return {ok:false,reason:'policy_not_authoritative'};
  if(!clean(policy.siteId)||!clean(policy.version)||!clean(policy.ref))return {ok:false,reason:'policy_provenance_missing'};
  const observed=instant(policy.observedAt),current=instant(now);
  const maxAge=has(policy,'maxAgeMinutes')?policy.maxAgeMinutes:1440;
  if(observed==null||current==null||!nonNegativeNumber(maxAge)||current<observed)return {ok:false,reason:'policy_time_invalid'};
  if((current-observed)/60000>maxAge)return {ok:false,reason:'policy_stale'};
  return {ok:true};
}

function uniqueRows(rows,keyFor){
  const map=new Map();
  let duplicate=false;
  for(let index=0;index<rows.length;index++){
    const row=rows[index],key=keyFor(row);
    if(key===null)return {error:'invalid'};
    if(map.has(key))duplicate=true;
    else map.set(key,row);
  }
  return duplicate?{error:'id_duplicate'}:{map};
}

function sourceAllowed(task,slot){
  if(!task.allowedWaterSources.length)return false;
  const source=clean(slot.waterSource);
  for(let index=0;index<task.allowedWaterSources.length;index++)if(task.allowedWaterSources[index]===source)return true;
  return false;
}

function addWorkerUse(workerUse,workerId,slot){
  const key=String(workerId)+'@'+slot;
  if(workerUse.has(key))return false;
  workerUse.add(key);
  return true;
}

function invalidResult(status,reason,details={}){return freeze({status,reason,...details});}

function evaluateSnapshot({policy,workers,tasks,plan,now}){
  const gate=policyGate(policy,now);
  if(!gate.ok)return invalidResult('blocked',gate.reason);
  const siteId=clean(policy.siteId);
  if(!clean(plan.id))return invalidResult('rejected','plan_invalid');

  const slotIndex=uniqueRows(policy.slots,row=>slotKey(row.slot));
  if(slotIndex.error)return invalidResult('blocked',slotIndex.error==='invalid'?'water_slots_invalid':'water_slot_id_duplicate');
  const slots=slotIndex.map;
  if(!slots.size)return invalidResult('blocked','water_slots_missing');
  for(let index=0;index<policy.slots.length;index++){
    const waterSlot=policy.slots[index];
    if(!has(waterSlot,'waterSource'))return invalidResult('blocked','water_source_missing',{slot:slotKey(waterSlot.slot)});
  }

  const workerIndex=uniqueRows(workers,worker=>referenceKey(worker.id));
  if(workerIndex.error)return invalidResult('rejected',workerIndex.error==='invalid'?'workers_invalid':'worker_id_duplicate');
  const taskIndex=uniqueRows(tasks,task=>clean(task.id)?task.id:null);
  if(taskIndex.error)return invalidResult('rejected',taskIndex.error==='invalid'?'tasks_invalid':'task_id_duplicate');
  const workerById=workerIndex.map,taskById=taskIndex.map;
  for(let index=0;index<workers.length;index++){
    const worker=workers[index];
    if(clean(worker.siteId)!==siteId)return invalidResult('rejected','worker_site_mismatch',{workerId:worker.id??null});
  }
  for(let index=0;index<tasks.length;index++){
    const task=tasks[index];
    if(clean(task.siteId)!==siteId)return invalidResult('rejected','task_site_mismatch',{taskId:task.id??null});
    if(!clean(task.id)||!clean(task.skill)||!nonNegativeNumber(task.freshWaterM3)||!nonNegativeNumber(task.effluentM3))return invalidResult('rejected','task_invalid',{taskId:task.id??null});
    if(!Number.isInteger(task.earliestSlot)||!Number.isInteger(task.latestSlot)||task.latestSlot<task.earliestSlot)return invalidResult('rejected','task_window_invalid',{taskId:task.id});
    if(has(task,'latePenalty')&&!nonNegativeNumber(task.latePenalty))return invalidResult('rejected','task_invalid',{taskId:task.id});
    if(has(task,'preferredSlot')&&!Number.isInteger(task.preferredSlot))return invalidResult('rejected','task_invalid',{taskId:task.id});
  }

  for(let index=0;index<policy.slots.length;index++){
    const waterSlot=policy.slots[index],slot=slotKey(waterSlot.slot);
    if((has(waterSlot,'scarcityWeight')&&waterSlot.scarcityWeight!=null&&!nonNegativeNumber(waterSlot.scarcityWeight))||(has(waterSlot,'waterTariffPerM3')&&waterSlot.waterTariffPerM3!=null&&!nonNegativeNumber(waterSlot.waterTariffPerM3)))return invalidResult('blocked','water_slot_economics_invalid',{slot});
    if(!nonNegativeNumber(waterSlot.freshWaterAvailableM3)||!nonNegativeNumber(waterSlot.effluentCapacityM3))return invalidResult('blocked',!nonNegativeNumber(waterSlot.freshWaterAvailableM3)?'water_capacity_invalid':'effluent_capacity_invalid',{slot});
  }

  const seenTask=new Set(),workerUse=new Set(),perSlot=new Map();
  let latenessPenalty=0,scarcityWeightedWater=0,waterCost=0;
  for(let index=0;index<plan.assignments.length;index++){
    const assignment=plan.assignments[index];
    const task=taskById.get(referenceKey(assignment.taskId));
    const worker=workerById.get(referenceKey(assignment.workerId));
    const slot=slotKey(assignment.slot);
    if(!task||!worker||!Number.isInteger(slot)||!slots.has(slot))return invalidResult('rejected','unknown_assignment_reference');
    if(seenTask.has(String(task.id)))return invalidResult('rejected','task_double_scheduled',{taskId:task.id});
    seenTask.add(String(task.id));
    if(slot<task.earliestSlot||slot>task.latestSlot)return invalidResult('rejected','task_outside_flex_window',{taskId:task.id,slot});
    let skilled=false;
    for(let skillIndex=0;skillIndex<worker.skills.length;skillIndex++)if(worker.skills[skillIndex]===task.skill){skilled=true;break;}
    if(!skilled)return invalidResult('rejected','skill_missing',{workerId:worker.id,taskId:task.id});
    if(!addWorkerUse(workerUse,worker.id,slot))return invalidResult('rejected','worker_double_booked',{workerId:worker.id,slot});

    const waterSlot=slots.get(slot);
    if(waterSlot.authoritative!==true)return invalidResult('blocked','water_slot_not_authoritative',{slot});
    if(waterSlot.restrictionActive===true&&task.allowedDuringRestriction!==true)return invalidResult('rejected','task_not_allowed_during_restriction',{taskId:task.id,slot});
    if(!sourceAllowed(task,waterSlot))return invalidResult('rejected','water_source_not_approved',{taskId:task.id,slot});

    if(!perSlot.has(slot))perSlot.set(slot,{freshWaterM3:0,effluentM3:0,tasks:[]});
    const row=perSlot.get(slot);
    row.freshWaterM3+=task.freshWaterM3;
    row.effluentM3+=task.effluentM3;
    row.tasks.push(task.id);
    const scarcity=waterSlot.scarcityWeight==null?1:waterSlot.scarcityWeight;
    const tariff=waterSlot.waterTariffPerM3==null?0:waterSlot.waterTariffPerM3;
    scarcityWeightedWater+=task.freshWaterM3*scarcity;
    waterCost+=task.freshWaterM3*tariff;
    const due=Number.isInteger(task.preferredSlot)?task.preferredSlot:task.latestSlot;
    latenessPenalty+=Math.max(0,slot-due)*(task.latePenalty??0);
  }

  if(seenTask.size!==taskById.size)return invalidResult('rejected','task_coverage_mismatch',{required:taskById.size,actual:seenTask.size});
  let reserveBreachM3=0,effluentBreachM3=0,restrictionExposureM3=0,freshWaterM3=0,effluentM3=0;
  for(const [slot,row] of perSlot.entries()){
    const waterSlot=slots.get(slot);
    const reserve=waterSlot.minimumReserveM3??0;
    reserveBreachM3+=Math.max(0,row.freshWaterM3-Math.max(0,waterSlot.freshWaterAvailableM3-reserve));
    effluentBreachM3+=Math.max(0,row.effluentM3-waterSlot.effluentCapacityM3);
    if(waterSlot.restrictionActive===true)restrictionExposureM3+=row.freshWaterM3;
    freshWaterM3+=row.freshWaterM3;
    effluentM3+=row.effluentM3;
  }
  if(reserveBreachM3>0)return invalidResult('rejected','minimum_water_reserve_breached',{reserveBreachM3});
  if(effluentBreachM3>0)return invalidResult('rejected','effluent_capacity_breached',{effluentBreachM3});
  if(![freshWaterM3,effluentM3,scarcityWeightedWater,waterCost,restrictionExposureM3,latenessPenalty].every(finite))return invalidResult('blocked','water_metrics_invalid');
  return freeze({status:'safe_candidate',planId:plan.id,metrics:{freshWaterM3,effluentM3,scarcityWeightedWater,waterCost,restrictionExposureM3,latenessPenalty},authorityBoundary:'Ranks only already-policy-compliant candidate schedules; it never changes recipes, water quality rules, permits, staffing, process controls or production directly.',claimBoundary:'Scarcity weights and modeled costs are planning inputs, not proof of water availability, avoided production loss or realised financial savings.'});
}

function snapshotEvaluation(raw){
  const root=dataRecord(raw??{},ROOT_FIELDS);
  if(!root)return {error:invalidResult('blocked','input_invalid')};
  const policy=snapshotPolicy(root.policy);
  if(policy.error)return {error:invalidResult('blocked',policy.error)};
  const workers=dataList(has(root,'workers')?root.workers:[],snapshotWorker);
  if(!workers)return {error:invalidResult('rejected','workers_invalid')};
  const tasks=dataList(has(root,'tasks')?root.tasks:[],snapshotTask);
  if(!tasks)return {error:invalidResult('rejected','tasks_invalid')};
  const plan=snapshotPlan(root.plan);
  if(!plan)return {error:invalidResult('rejected','plan_invalid')};
  const now=has(root,'now')?root.now:new Date().toISOString();
  return {value:{policy:policy.value,workers,tasks,plan,now}};
}

export function evaluateWaterResiliencePlan(input={}){
  try{const snapshot=snapshotEvaluation(input);return snapshot.error??evaluateSnapshot(snapshot.value);}
  catch{return invalidResult('blocked','input_invalid');}
}

function rankingOrder(left,right){
  const leftId=String(left.planId),rightId=String(right.planId);
  return left.metrics.restrictionExposureM3-right.metrics.restrictionExposureM3||left.metrics.scarcityWeightedWater-right.metrics.scarcityWeightedWater||left.metrics.waterCost-right.metrics.waterCost||left.metrics.latenessPenalty-right.metrics.latenessPenalty||(leftId<rightId?-1:leftId>rightId?1:0);
}
function stableSort(values,compare){
  let source=[];
  for(let index=0;index<values.length;index++)source.push(values[index]);
  for(let width=1;width<source.length;width*=2){
    const target=[];
    for(let start=0;start<source.length;start+=width*2){
      let left=start,right=Math.min(start+width,source.length),leftEnd=right,rightEnd=Math.min(start+width*2,source.length);
      while(left<leftEnd||right<rightEnd){
        if(right>=rightEnd||(left<leftEnd&&compare(source[left],source[right])<=0))target.push(source[left++]);
        else target.push(source[right++]);
      }
    }
    source=target;
  }
  return source;
}

export function compareWaterResiliencePlans(input={}){
  const empty=()=>freeze({status:'no_safe_candidate',preferred:null,safe:[],rejected:[]});
  try{
    const root=dataRecord(input??{},ROOT_FIELDS);
    if(!root)return empty();
    const planRows=dataList(has(root,'plans')?root.plans:[],item=>Object.freeze({item}));
    if(!planRows)return empty();
    const policy=snapshotPolicy(root.policy);
    const workers=dataList(has(root,'workers')?root.workers:[],snapshotWorker);
    const tasks=dataList(has(root,'tasks')?root.tasks:[],snapshotTask);
    if(policy.error||!workers||!tasks){
      const failure=policy.error?invalidResult('blocked',policy.error):!workers?invalidResult('rejected','workers_invalid'):invalidResult('rejected','tasks_invalid');
      const rejected=[];
      for(let index=0;index<planRows.length;index++)rejected.push(failure);
      return freeze({status:'no_safe_candidate',preferred:null,safe:[],rejected});
    }
    const now=has(root,'now')?root.now:new Date().toISOString(),safe=[],rejected=[];
    for(let index=0;index<planRows.length;index++){
      const plan=snapshotPlan(planRows[index].item);
      const result=plan?evaluateSnapshot({policy:policy.value,workers,tasks,plan,now}):invalidResult('rejected','plan_invalid');
      (result.status==='safe_candidate'?safe:rejected).push(result);
    }
    const ordered=stableSort(safe,rankingOrder);
    return freeze({status:ordered.length?'ranked':'no_safe_candidate',preferred:ordered[0]??null,safe:ordered,rejected});
  }catch{return empty();}
}

const OUTCOME_ROOT_FIELDS=['recommendation','decision','observed','operations','financial','now'];
const RECOMMENDATION_FIELDS=['id','tenantId','siteId','sourceRef','decisionSourceRef','observedSourceRef','operationsSourceRef','financialSourceRef','generatedAt','maxAgeMinutes','predictedFreshWaterM3'];
const DECISION_FIELDS=['status','recommendationId','tenantId','siteId','sourceRef','observedAt'];
const OBSERVED_FIELDS=['authoritative','recommendationId','tenantId','siteId','sourceRef','observedAt','actualFreshWaterM3'];
const OPERATIONS_FIELDS=['authoritative','recommendationId','tenantId','siteId','sourceRef','observedAt','productionCompleted'];
const FINANCIAL_FIELDS=['authoritative','recommendationId','tenantId','siteId','sourceRef','observedAt','realisedWaterCost'];

function canonicalText(value){return typeof value==='string'&&value!==''&&value.trim()===value;}
function evidenceIdentityValid(recommendation,evidence,expectedSourceRef){
  return evidence.recommendationId===recommendation.id&&evidence.tenantId===recommendation.tenantId&&evidence.siteId===recommendation.siteId&&evidence.sourceRef===expectedSourceRef;
}
function evidenceTime(recommendation,evidence,now,notBefore){
  const observed=instant(evidence.observedAt);
  if(observed===null||observed<notBefore||observed>now)return {error:'evidence_time_invalid'};
  if((now-observed)/60000>recommendation.maxAgeMinutes)return {error:'evidence_stale'};
  return {value:observed};
}

export function reconcileWaterOutcome(input={}){
  try{
    const root=dataRecord(input??{},OUTCOME_ROOT_FIELDS);
    if(!root)return invalidResult('incomplete','evidence_invalid');
    const recommendation=dataRecord(root.recommendation,RECOMMENDATION_FIELDS,RECOMMENDATION_FIELDS);
    const decision=dataRecord(root.decision,DECISION_FIELDS,DECISION_FIELDS);
    if(!recommendation||!decision||![recommendation.id,recommendation.tenantId,recommendation.siteId,recommendation.sourceRef,recommendation.decisionSourceRef,recommendation.observedSourceRef,recommendation.operationsSourceRef,recommendation.financialSourceRef].every(canonicalText)||!['accepted','rejected'].includes(decision.status))return invalidResult('incomplete','decision_missing');
    if(!nonNegativeNumber(recommendation.maxAgeMinutes))return invalidResult('incomplete','evidence_time_invalid');
    const now=instant(root.now),generated=instant(recommendation.generatedAt);
    if(now===null||generated===null||generated>now)return invalidResult('incomplete','evidence_time_invalid');
    if(!evidenceIdentityValid(recommendation,decision,recommendation.decisionSourceRef))return invalidResult('incomplete','evidence_identity_invalid');
    if((now-generated)/60000>recommendation.maxAgeMinutes)return invalidResult('incomplete','evidence_stale');
    const decisionTime=evidenceTime(recommendation,decision,now,generated);
    if(decisionTime.error)return invalidResult('incomplete',decisionTime.error);
    if(decision.status==='rejected')return freeze({status:'recorded',outcomeClass:'rejected_by_human',recommendationId:recommendation.id,evidenceRefs:{recommendation:recommendation.sourceRef,decision:decision.sourceRef}});
    const observed=dataRecord(root.observed,OBSERVED_FIELDS,OBSERVED_FIELDS);
    const operations=dataRecord(root.operations,OPERATIONS_FIELDS,OPERATIONS_FIELDS);
    const financial=has(root,'financial')?dataRecord(root.financial,FINANCIAL_FIELDS,FINANCIAL_FIELDS):null;
    if(!observed||!operations||(has(root,'financial')&&!financial))return invalidResult('incomplete','operational_evidence_missing');
    if(!evidenceIdentityValid(recommendation,observed,recommendation.observedSourceRef)||!evidenceIdentityValid(recommendation,operations,recommendation.operationsSourceRef)||(financial&&!evidenceIdentityValid(recommendation,financial,recommendation.financialSourceRef)))return invalidResult('incomplete','evidence_identity_invalid');
    for(const evidence of [observed,operations,...(financial?[financial]:[])]){
      const timing=evidenceTime(recommendation,evidence,now,decisionTime.value);
      if(timing.error)return invalidResult('incomplete',timing.error);
    }
    if(observed.authoritative!==true||operations.authoritative!==true)return invalidResult('incomplete','operational_evidence_missing');
    if(typeof operations.productionCompleted!=='boolean')return invalidResult('incomplete','operational_evidence_invalid');
    if(financial&&typeof financial.authoritative!=='boolean')return invalidResult('incomplete','financial_evidence_invalid');
    if(!nonNegativeNumber(recommendation.predictedFreshWaterM3)||!nonNegativeNumber(observed.actualFreshWaterM3)||(financial&&!nonNegativeNumber(financial.realisedWaterCost)))return invalidResult('incomplete','water_values_invalid');
    const realisedCost=financial?.authoritative===true&&nonNegativeNumber(financial.realisedWaterCost)?financial.realisedWaterCost:null;
    return freeze({status:'reconciled',recommendationId:recommendation.id,predicted:{freshWaterM3:recommendation.predictedFreshWaterM3},realised:{freshWaterM3:observed.actualFreshWaterM3,productionCompleted:operations.productionCompleted===true,realisedWaterCost:realisedCost},calibration:{waterErrorM3:observed.actualFreshWaterM3-recommendation.predictedFreshWaterM3,absoluteWaterErrorM3:Math.abs(observed.actualFreshWaterM3-recommendation.predictedFreshWaterM3)},evidenceRefs:{recommendation:recommendation.sourceRef,decision:decision.sourceRef,observed:observed.sourceRef,operations:operations.sourceRef,financial:financial?.sourceRef??null},authorityBoundary:'Outcome learning may calibrate future advice but cannot automatically alter water policy, quality limits, permits, recipes or workforce rules.'});
  }catch{return invalidResult('incomplete','evidence_invalid');}
}
