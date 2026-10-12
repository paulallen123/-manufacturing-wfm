export const WATER_RESILIENCE_VERSION='water-resilience-orchestration-v0.1.1';

const clean=v=>typeof v==='string'?v.trim():'';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const ts=v=>{const n=Date.parse(String(v??''));return Number.isFinite(n)?n:null;};

function policyGate(policy,now){
  if(!policy||policy.authoritative!==true)return {ok:false,reason:'policy_not_authoritative'};
  if(!clean(policy.siteId)||!clean(policy.version)||!clean(policy.ref))return {ok:false,reason:'policy_provenance_missing'};
  const observed=ts(policy.observedAt),current=ts(now),maxAge=Number(policy.maxAgeMinutes??1440);
  if(observed==null||current==null||!finite(maxAge)||maxAge<0||current<observed)return {ok:false,reason:'policy_time_invalid'};
  if((current-observed)/60000>maxAge)return {ok:false,reason:'policy_stale'};
  return {ok:true};
}

// Preserve raw string IDs and legacy finite numeric worker IDs/references. Slot keys retain
// numeric-string compatibility, but must not be coerced from missing/boolean/object values.
const referenceKey=id=>(clean(id)||finite(id))?String(id):null;
const slotKey=slot=>(clean(slot)||finite(slot))&&Number.isInteger(Number(slot))?Number(slot):null;

function uniqueRows(rows,keyFor){
  if(!Array.isArray(rows))return {error:'invalid'};
  const map=new Map();
  let duplicate=false;
  for(const row of rows){
    if(!row||typeof row!=='object'||Array.isArray(row))return {error:'invalid'};
    const key=keyFor(row);
    if(key===null)return {error:'invalid'};
    if(map.has(key))duplicate=true;
    else map.set(key,row);
  }
  return duplicate?{error:'id_duplicate'}:{map};
}

function sourceAllowed(task,slot){
  const allowed=Array.isArray(task.allowedWaterSources)?task.allowedWaterSources:[];
  if(!allowed.length)return false;
  const source=clean(slot.waterSource)||'fresh';
  return allowed.includes(source);
}

function addWorkerUse(workerUse,workerId,slot){
  const key=String(workerId)+'@'+slot;
  if(workerUse.has(key))return false;
  workerUse.add(key);
  return true;
}

export function evaluateWaterResiliencePlan({policy,workers=[],tasks=[],plan,now=new Date().toISOString()}={}){
  const gate=policyGate(policy,now);
  if(!gate.ok)return {status:'blocked',reason:gate.reason};
  const siteId=clean(policy.siteId);
  if(!plan||!clean(plan.id)||!Array.isArray(plan.assignments))return {status:'rejected',reason:'plan_invalid'};

  const slotIndex=uniqueRows(policy.slots,row=>slotKey(row.slot));
  if(slotIndex.error)return {status:'blocked',reason:slotIndex.error==='invalid'?'water_slots_invalid':'water_slot_id_duplicate'};
  const slots=slotIndex.map;
  if(!slots.size)return {status:'blocked',reason:'water_slots_missing'};

  const workerIndex=uniqueRows(workers,w=>referenceKey(w.id));
  if(workerIndex.error)return {status:'rejected',reason:workerIndex.error==='invalid'?'workers_invalid':'worker_id_duplicate'};
  const taskIndex=uniqueRows(tasks,t=>clean(t.id)?t.id:null);
  if(taskIndex.error)return {status:'rejected',reason:taskIndex.error==='invalid'?'tasks_invalid':'task_id_duplicate'};
  const workerById=workerIndex.map,taskById=taskIndex.map;
  for(const w of workers){
    if(clean(w?.siteId)!==siteId)return {status:'rejected',reason:'worker_site_mismatch',workerId:w?.id??null};
  }
  for(const t of tasks){
    if(clean(t?.siteId)!==siteId)return {status:'rejected',reason:'task_site_mismatch',taskId:t?.id??null};
    if(!clean(t?.id)||!clean(t?.skill)||!finite(Number(t?.freshWaterM3))||Number(t.freshWaterM3)<0||!finite(Number(t?.effluentM3))||Number(t.effluentM3)<0){
      return {status:'rejected',reason:'task_invalid',taskId:t?.id??null};
    }
    if(!Number.isInteger(t.earliestSlot)||!Number.isInteger(t.latestSlot)||t.latestSlot<t.earliestSlot)return {status:'rejected',reason:'task_window_invalid',taskId:t.id};
  }

  const seenTask=new Set(),workerUse=new Set();
  const perSlot=new Map();
  let latenessPenalty=0,scarcityWeightedWater=0,waterCost=0;

  for(const a of plan.assignments){
    const task=taskById.get(referenceKey(a?.taskId));
    const worker=workerById.get(referenceKey(a?.workerId));
    const slot=slotKey(a?.slot);
    if(!task||!worker||!Number.isInteger(slot)||!slots.has(slot))return {status:'rejected',reason:'unknown_assignment_reference'};
    if(seenTask.has(String(task.id)))return {status:'rejected',reason:'task_double_scheduled',taskId:task.id};
    seenTask.add(String(task.id));
    if(slot<task.earliestSlot||slot>task.latestSlot)return {status:'rejected',reason:'task_outside_flex_window',taskId:task.id,slot};
    if(!new Set(worker.skills||[]).has(task.skill))return {status:'rejected',reason:'skill_missing',workerId:worker.id,taskId:task.id};
    if(!addWorkerUse(workerUse,worker.id,slot))return {status:'rejected',reason:'worker_double_booked',workerId:worker.id,slot};

    const s=slots.get(slot);
    if(s.authoritative!==true)return {status:'blocked',reason:'water_slot_not_authoritative',slot};
    if(s.restrictionActive===true&&task.allowedDuringRestriction!==true)return {status:'rejected',reason:'task_not_allowed_during_restriction',taskId:task.id,slot};
    if(!sourceAllowed(task,s))return {status:'rejected',reason:'water_source_not_approved',taskId:task.id,slot};

    if(!perSlot.has(slot))perSlot.set(slot,{freshWaterM3:0,effluentM3:0,tasks:[]});
    const row=perSlot.get(slot);
    row.freshWaterM3+=Number(task.freshWaterM3);
    row.effluentM3+=Number(task.effluentM3);
    row.tasks.push(task.id);

    const scarcity=finite(Number(s.scarcityWeight))?Number(s.scarcityWeight):1;
    const tariff=finite(Number(s.waterTariffPerM3))?Number(s.waterTariffPerM3):0;
    scarcityWeightedWater+=Number(task.freshWaterM3)*scarcity;
    waterCost+=Number(task.freshWaterM3)*tariff;
    const due=Number.isInteger(task.preferredSlot)?task.preferredSlot:task.latestSlot;
    latenessPenalty+=Math.max(0,slot-due)*Number(task.latePenalty??0);
  }

  if(seenTask.size!==taskById.size)return {status:'rejected',reason:'task_coverage_mismatch',required:taskById.size,actual:seenTask.size};

  let reserveBreachM3=0,effluentBreachM3=0,restrictionExposureM3=0;
  for(const [slot,row] of perSlot){
    const s=slots.get(slot);
    const available=Number(s.freshWaterAvailableM3);
    const reserve=Number(s.minimumReserveM3??0);
    const effluentCap=Number(s.effluentCapacityM3);
    if(!finite(available)||!finite(reserve)||reserve<0)return {status:'blocked',reason:'water_capacity_invalid',slot};
    if(!finite(effluentCap)||effluentCap<0)return {status:'blocked',reason:'effluent_capacity_invalid',slot};
    const usable=Math.max(0,available-reserve);
    reserveBreachM3+=Math.max(0,row.freshWaterM3-usable);
    effluentBreachM3+=Math.max(0,row.effluentM3-effluentCap);
    if(s.restrictionActive===true)restrictionExposureM3+=row.freshWaterM3;
  }
  if(reserveBreachM3>0)return {status:'rejected',reason:'minimum_water_reserve_breached',reserveBreachM3};
  if(effluentBreachM3>0)return {status:'rejected',reason:'effluent_capacity_breached',effluentBreachM3};

  const freshWaterM3=[...perSlot.values()].reduce((s,x)=>s+x.freshWaterM3,0);
  const effluentM3=[...perSlot.values()].reduce((s,x)=>s+x.effluentM3,0);
  return {
    status:'safe_candidate',planId:plan.id,
    metrics:{freshWaterM3,effluentM3,scarcityWeightedWater,waterCost,restrictionExposureM3,latenessPenalty},
    authorityBoundary:'Ranks only already-policy-compliant candidate schedules; it never changes recipes, water quality rules, permits, staffing, process controls or production directly.',
    claimBoundary:'Scarcity weights and modeled costs are planning inputs, not proof of water availability, avoided production loss or realised financial savings.'
  };
}

export function compareWaterResiliencePlans(input={}){
  const evaluated=(Array.isArray(input.plans)?input.plans:[]).map(plan=>evaluateWaterResiliencePlan({...input,plan}));
  const safe=evaluated.filter(x=>x.status==='safe_candidate');
  safe.sort((a,b)=>
    a.metrics.restrictionExposureM3-b.metrics.restrictionExposureM3||
    a.metrics.scarcityWeightedWater-b.metrics.scarcityWeightedWater||
    a.metrics.waterCost-b.metrics.waterCost||
    a.metrics.latenessPenalty-b.metrics.latenessPenalty||
    String(a.planId).localeCompare(String(b.planId))
  );
  return {status:safe.length?'ranked':'no_safe_candidate',preferred:safe[0]??null,safe,rejected:evaluated.filter(x=>x.status!=='safe_candidate')};
}

export function reconcileWaterOutcome({recommendation,decision,observed,operations,financial}={}){
  if(!clean(recommendation?.id)||!['accepted','rejected'].includes(clean(decision?.status)))return {status:'incomplete',reason:'decision_missing'};
  const recommendationId=clean(recommendation.id),tenantId=clean(recommendation.tenantId),siteId=clean(recommendation.siteId);
  const bound=(evidence)=>clean(evidence?.recommendationId)===recommendationId&&clean(evidence?.tenantId)===tenantId&&clean(evidence?.siteId)===siteId;
  if(!tenantId||!siteId||!bound(decision)||(decision.status==='accepted'&&(!bound(observed)||!bound(operations)||(financial!=null&&!bound(financial)))))return {status:'incomplete',reason:'outcome_attribution_invalid'};
  if(decision.status==='rejected')return {status:'recorded',outcomeClass:'rejected_by_human',recommendationId:recommendation.id};
  if(observed?.authoritative!==true||operations?.authoritative!==true)return {status:'incomplete',reason:'operational_evidence_missing'};
  const predicted=Number(recommendation.predictedFreshWaterM3),actual=Number(observed.actualFreshWaterM3);
  if(!finite(predicted)||!finite(actual))return {status:'incomplete',reason:'water_values_invalid'};
  const realisedCost=financial?.authoritative===true&&finite(Number(financial.realisedWaterCost))?Number(financial.realisedWaterCost):null;
  return {
    status:'reconciled',recommendationId:recommendation.id,
    predicted:{freshWaterM3:predicted},
    realised:{freshWaterM3:actual,productionCompleted:operations.productionCompleted===true,realisedWaterCost:realisedCost},
    calibration:{waterErrorM3:actual-predicted,absoluteWaterErrorM3:Math.abs(actual-predicted)},
    authorityBoundary:'Outcome learning may calibrate future advice but cannot automatically alter water policy, quality limits, permits, recipes or workforce rules.'
  };
}

