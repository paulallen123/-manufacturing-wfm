export const CONTROLLED_ENVIRONMENT_FLOW_VERSION='controlled-environment-flow-v0.1.0';

const clean=v=>typeof v==='string'?v.trim():'';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const ts=v=>{const n=Date.parse(String(v??''));return Number.isFinite(n)?n:null;};

function policyGate(policy, now){
  if(!policy||policy.authoritative!==true)return {ok:false,reason:'policy_not_authoritative'};
  if(!clean(policy.siteId)||!clean(policy.version)||!clean(policy.ref))return {ok:false,reason:'policy_provenance_missing'};
  const observed=ts(policy.observedAt),current=ts(now);
  const maxAge=Number(policy.maxAgeMinutes??1440);
  if(observed==null||current==null||!finite(maxAge)||maxAge<0||current<observed)return {ok:false,reason:'policy_time_invalid'};
  if((current-observed)/60000>maxAge)return {ok:false,reason:'policy_stale'};
  return {ok:true};
}

function transitionIndex(policy){
  const map=new Map();
  for(const row of Array.isArray(policy.transitions)?policy.transitions:[]){
    const from=clean(row?.from),to=clean(row?.to);
    if(!from||!to)continue;
    map.set(from+'>'+to,row);
  }
  return map;
}

export function evaluateControlledEnvironmentPlan({policy,workers=[],tasks=[],plan,now=new Date().toISOString()}={}){
  const gate=policyGate(policy,now);
  if(!gate.ok)return {status:'blocked',reason:gate.reason};

  const siteId=clean(policy.siteId);
  const workerById=new Map();
  for(const worker of workers){
    if(clean(worker?.siteId)!==siteId)return {status:'rejected',reason:'worker_site_mismatch',workerId:worker?.id??null};
    workerById.set(String(worker.id),worker);
  }
  const taskById=new Map();
  for(const task of tasks){
    if(clean(task?.siteId)!==siteId)return {status:'rejected',reason:'task_site_mismatch',taskId:task?.id??null};
    if(!clean(task?.zone)||!clean(task?.skill)||!Number.isInteger(task?.slot))return {status:'rejected',reason:'task_invalid',taskId:task?.id??null};
    taskById.set(String(task.id),task);
  }
  if(!plan||!clean(plan.id)||!Array.isArray(plan.assignments))return {status:'rejected',reason:'plan_invalid'};

  const required=new Map(tasks.map(t=>[String(t.id),Number(t.requiredHeadcount??1)]));
  const covered=new Map([...required.keys()].map(id=>[id,0]));
  const seenWorkerSlot=new Set();
  const zoneSlotCount=new Map();
  const byWorker=new Map();

  for(const a of plan.assignments){
    const task=taskById.get(String(a?.taskId));
    const worker=workerById.get(String(a?.workerId));
    if(!task||!worker)return {status:'rejected',reason:'unknown_assignment_reference'};
    const key=String(worker.id)+'@'+task.slot;
    if(seenWorkerSlot.has(key))return {status:'rejected',reason:'worker_double_booked',workerId:worker.id,slot:task.slot};
    seenWorkerSlot.add(key);
    if(!new Set(worker.skills||[]).has(task.skill))return {status:'rejected',reason:'skill_missing',workerId:worker.id,taskId:task.id};
    if(!new Set(worker.qualifiedZones||[]).has(task.zone))return {status:'rejected',reason:'zone_qualification_missing',workerId:worker.id,taskId:task.id};
    covered.set(String(task.id),(covered.get(String(task.id))||0)+1);
    const oz=task.zone+'@'+task.slot;
    zoneSlotCount.set(oz,(zoneSlotCount.get(oz)||0)+1);
    if(!byWorker.has(String(worker.id)))byWorker.set(String(worker.id),[]);
    byWorker.get(String(worker.id)).push(task);
  }

  for(const [taskId,count] of required){
    if(!Number.isInteger(count)||count<1)return {status:'rejected',reason:'headcount_requirement_invalid',taskId};
    if(covered.get(taskId)!==count)return {status:'rejected',reason:'task_coverage_mismatch',taskId,required:count,actual:covered.get(taskId)};
  }

  const zones=policy.zones&&typeof policy.zones==='object'?policy.zones:{};
  for(const [key,count] of zoneSlotCount){
    const zone=key.split('@')[0],limit=Number(zones?.[zone]?.maxPersonnel);
    if(Number.isFinite(limit)&&count>limit)return {status:'rejected',reason:'zone_occupancy_exceeded',zone,count,limit};
  }

  const tx=transitionIndex(policy);
  let transitions=0,gowningCycles=0,controlMinutes=0,controlCost=0,costComplete=true;
  const movement=[];
  for(const [workerId,rows] of byWorker){
    rows.sort((a,b)=>a.slot-b.slot||String(a.id).localeCompare(String(b.id)));
    const worker=workerById.get(workerId);
    let from=clean(worker.currentZone)||clean(policy.defaultOutsideZone)||'OUT';
    for(const task of rows){
      const to=task.zone;
      if(from!==to){
        const rule=tx.get(from+'>'+to);
        if(!rule||rule.allowed!==true)return {status:'rejected',reason:'transition_not_approved',workerId,from,to,taskId:task.id};
        transitions+=1;
        if(rule.gowningCycle===true)gowningCycles+=1;
        if(controlMinutes!==null&&finite(Number(rule.controlMinutes)))controlMinutes+=Number(rule.controlMinutes);
        else controlMinutes=null;
        if(finite(Number(rule.controlCost)))controlCost+=Number(rule.controlCost);
        else costComplete=false;
        movement.push({workerId,from,to,taskId:task.id,slot:task.slot,gowningCycle:rule.gowningCycle===true});
      }
      from=to;
    }
  }

  return {
    status:'safe_candidate',
    planId:plan.id,
    metrics:{
      taskCoverageComplete:true,
      transitions,
      gowningCycles,
      controlMinutes,
      controlCost:costComplete?controlCost:null,
      assignedPeople:new Set(plan.assignments.map(a=>String(a.workerId))).size
    },
    movement,
    claimBoundary:'This score compares approved workforce plans using authoritative site flow rules. It does not estimate contamination probability, relax cleanroom procedures, or prove product sterility.'
  };
}

export function compareControlledEnvironmentPlans(input={}){
  const plans=Array.isArray(input.plans)?input.plans:[];
  const evaluated=plans.map(plan=>evaluateControlledEnvironmentPlan({...input,plan}));
  const safe=evaluated.filter(x=>x.status==='safe_candidate');
  const rank=x=>[
    x.metrics.gowningCycles,
    x.metrics.controlMinutes==null?Number.POSITIVE_INFINITY:x.metrics.controlMinutes,
    x.metrics.transitions,
    x.metrics.controlCost==null?Number.POSITIVE_INFINITY:x.metrics.controlCost,
    x.metrics.assignedPeople
  ];
  safe.sort((a,b)=>{
    const ra=rank(a),rb=rank(b);
    for(let i=0;i<ra.length;i++){if(ra[i]!==rb[i])return ra[i]-rb[i];}
    return String(a.planId).localeCompare(String(b.planId));
  });
  return {
    status:safe.length?'ranked':'no_safe_candidate',
    preferred:safe[0]??null,
    safe,
    rejected:evaluated.filter(x=>x.status!=='safe_candidate'),
    authorityBoundary:'Ranking never changes schedules directly; the canonical scheduler and site quality authority remain consequential.'
  };
}
