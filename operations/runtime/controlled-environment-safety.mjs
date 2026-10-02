import decisionEpisode from './decision-episode.cjs';
import {types} from 'node:util';

// Pure safety/projection port. Canonical callers retain read admission, scheduling,
// qualification, site procedure and immutable decision/outcome authority.
class GateError extends Error {}
const reject=reason=>{throw new GateError(reason);};
const pairKey=(a,b)=>JSON.stringify([a,b]);
const numeric=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const whole=v=>numeric(v)&&Number.isSafeInteger(v);
function id(value){
  if(typeof value!=='string'||value.length<1||value.length>200||value!==value.trim()||/[\u0000-\u001f\u007f]/.test(value))reject('canonical-identifier-required');
  return value;
}
function inert(value,depth=0,budget={nodes:0}){
  if(++budget.nodes>20000||depth>16)reject('input-budget-exceeded');
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='string'){if(value.length>1000)reject('input-budget-exceeded');return value;}
  if(typeof value==='number'){if(!Number.isFinite(value))reject('finite-number-required');return value;}
  if(!value||typeof value!=='object'||types.isProxy(value))reject('inert-input-required');
  if(Array.isArray(value)){
    if(Object.getPrototypeOf(value)!==Array.prototype)reject('inert-array-required');
    const length=Object.getOwnPropertyDescriptor(value,'length')?.value;
    if(!whole(length)||length>2000)reject('input-budget-exceeded');
    const keys=Reflect.ownKeys(value);
    if(keys.length!==length+1)reject('dense-array-required');
    const out=[];
    for(let i=0;i<length;i++){
      const descriptor=Object.getOwnPropertyDescriptor(value,String(i));
      if(!descriptor||!Object.hasOwn(descriptor,'value'))reject('inert-array-required');
      out.push(inert(descriptor.value,depth+1,budget));
    }
    return out;
  }
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null)reject('plain-record-required');
  const out=Object.create(null);
  for(const key of Reflect.ownKeys(value)){
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(typeof key!=='string'||['__proto__','constructor','prototype'].includes(key)||!descriptor||!Object.hasOwn(descriptor,'value'))reject('inert-record-required');
    out[key]=inert(descriptor.value,depth+1,budget);
  }
  return out;
}
function record(value){if(!value||typeof value!=='object'||Array.isArray(value))reject('record-required');return value;}
function array(value,max=1000){if(!Array.isArray(value)||value.length>max)reject('bounded-array-required');return value;}
function stringList(value){return [...new Set(array(value).map(id))];}
function time(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))reject('iso-time-required');
  const n=Date.parse(value);
  if(!Number.isFinite(n)||new Date(n).toISOString()!==(value.length===20?value.replace('Z','.000Z'):value))reject('valid-time-required');
  return n;
}
function currentRecord(value,ctx){
  const x=record(value);
  if(x.tenantId!==ctx.tenant||x.siteId!==ctx.siteId)reject('source-scope-mismatch');
  if(x.authoritative!==true)reject('source-authority-required');
  const ref=id(x.ref),revision=id(x.revision),observed=time(x.observedAt);
  if(observed>ctx.at||ctx.at-observed>ctx.maxAgeMinutes*60000)reject('source-time-invalid');
  if(Object.hasOwn(x,'ageMinutes')&&(!numeric(x.ageMinutes)||x.ageMinutes>ctx.maxAgeMinutes))reject('source-age-invalid');
  return {tenantId:ctx.tenant,siteId:ctx.siteId,ref,revision,observedAt:new Date(observed).toISOString()};
}
function optionalMetric(value,key){
  if(!Object.hasOwn(value,key)||value[key]===null)return null;
  if(!numeric(value[key]))reject('nonnegative-metric-required');
  return value[key];
}
function context(input){
  const x=record(inert(input));
  const ctx={tenant:id(x.tenant),siteId:id(x.siteId),contextRevision:id(x.contextRevision),at:time(x.now)};
  const p=record(x.policy);
  if(!numeric(p.maxAgeMinutes)||p.maxAgeMinutes>1440)reject('bounded-policy-age-required');
  ctx.maxAgeMinutes=p.maxAgeMinutes;
  const source=currentRecord(p,ctx),version=id(p.version),outside=id(p.defaultOutsideZone);
  const zones=Object.create(null);
  for(const [zone,rule] of Object.entries(record(p.zones))){id(zone);record(rule);if(!whole(rule.maxPersonnel))reject('zone-occupancy-required');zones[zone]={maxPersonnel:rule.maxPersonnel};}
  const transitions=[],index=new Map();
  for(const rule of array(p.transitions)){
    record(rule);const from=id(rule.from),to=id(rule.to),key=pairKey(from,to);
    if(typeof rule.allowed!=='boolean')reject('transition-permission-required');
    if(index.has(key))reject('duplicate-transition-rule');
    if(Object.hasOwn(rule,'gowningCycle')&&typeof rule.gowningCycle!=='boolean')reject('transition-metric-invalid');
    const checked={from,to,allowed:rule.allowed,gowningCycle:rule.gowningCycle??null,controlMinutes:optionalMetric(rule,'controlMinutes'),controlCost:optionalMetric(rule,'controlCost')};
    index.set(key,checked);transitions.push(checked);
  }
  ctx.policy={...source,version,maxAgeMinutes:ctx.maxAgeMinutes,defaultOutsideZone:outside,zones,transitions};
  ctx.transitions=index;
  return {input:x,ctx};
}
function knownZone(zone,ctx){id(zone);if(!Object.hasOwn(ctx.policy.zones,zone))reject('zone-policy-missing');return zone;}
function uniqueRows(values,ctx,normalise){
  const ids=new Set();return array(values).map(value=>{
    record(value);const key=id(value.id);if(ids.has(key))reject('duplicate-record-identity');ids.add(key);
    return normalise(value,key,currentRecord(value,ctx));
  });
}
function frozen(value){if(value&&typeof value==='object'){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;}
function identified(ctx,kind,result,sourceRows){
  const material={contractVersion:decisionEpisode.CONTRACT_VERSION,kind,tenant:ctx.tenant,siteId:ctx.siteId,contextRevision:ctx.contextRevision,observedAt:new Date(ctx.at).toISOString(),policy:ctx.policy,sourceRows,result};
  return frozen({...result,tenant:ctx.tenant,siteId:ctx.siteId,contextRevision:ctx.contextRevision,evidenceDigest:decisionEpisode.digest(material),executionPermitted:false});
}
function guarded(fn){try{return fn();}catch(error){return frozen({status:'blocked',reason:error instanceof GateError?error.message:'invalid-input',executionPermitted:false});}}
const addKnown=(total,value)=>{
  if(total===null||value===null)return null;
  const sum=total+value;if(!Number.isFinite(sum))reject('metric-budget-exceeded');return sum;
};

/** Assess a caller-supplied plan, without scheduling or granting authority. */
export function assessControlledEnvironmentPlan(raw){return guarded(()=>{
  const {input,ctx}=context(raw);
  const workers=uniqueRows(input.workers,ctx,(x,key,source)=>({...source,id:key,skills:stringList(x.skills),qualifiedZones:stringList(x.qualifiedZones),currentZone:id(x.currentZone)}));
  const tasks=uniqueRows(input.tasks,ctx,(x,key,source)=>{
    if(!whole(x.slot)||!whole(x.requiredHeadcount)||x.requiredHeadcount<1)reject('task-requirement-invalid');
    return {...source,id:key,zone:knownZone(x.zone,ctx),skill:id(x.skill),slot:x.slot,requiredHeadcount:x.requiredHeadcount};
  });
  if(!tasks.length)reject('required-tasks-missing');
  const workerById=new Map(workers.map(x=>[x.id,x])),taskById=new Map(tasks.map(x=>[x.id,x]));
  const plan=record(input.plan),planId=id(plan.id),assignments=array(plan.assignments).map(x=>({workerId:id(record(x).workerId),taskId:id(x.taskId)}));
  const covered=new Map(tasks.map(x=>[x.id,0])),workerSlot=new Set(),zoneSlots=new Map(),byWorker=new Map();
  for(const assignment of assignments){
    const worker=workerById.get(assignment.workerId),task=taskById.get(assignment.taskId);
    if(!worker||!task)reject('unknown-assignment-reference');
    const key=pairKey(worker.id,task.slot);if(workerSlot.has(key))reject('worker-double-booked');workerSlot.add(key);
    if(!worker.skills.includes(task.skill)||!worker.qualifiedZones.includes(task.zone))reject('qualification-required');
    covered.set(task.id,covered.get(task.id)+1);
    const zoneKey=pairKey(task.zone,task.slot);zoneSlots.set(zoneKey,(zoneSlots.get(zoneKey)||0)+1);
    if(!byWorker.has(worker.id))byWorker.set(worker.id,[]);byWorker.get(worker.id).push(task);
  }
  for(const task of tasks)if(covered.get(task.id)!==task.requiredHeadcount)reject('task-coverage-mismatch');
  for(const [key,count] of zoneSlots){const [zone]=JSON.parse(key);if(count>ctx.policy.zones[zone].maxPersonnel)reject('zone-occupancy-exceeded');}
  let transitions=0,gowningCycles=0,controlMinutes=0,controlCost=0;const movement=[];
  for(const [workerId,rows] of byWorker){
    rows.sort((a,b)=>a.slot-b.slot||a.id.localeCompare(b.id));let from=workerById.get(workerId).currentZone;
    for(const task of rows){
      if(from!==task.zone){
        const rule=ctx.transitions.get(pairKey(from,task.zone));if(rule?.allowed!==true)reject('transition-not-approved');
        transitions++;gowningCycles=rule.gowningCycle===null?null:addKnown(gowningCycles,rule.gowningCycle?1:0);
        controlMinutes=addKnown(controlMinutes,rule.controlMinutes);controlCost=addKnown(controlCost,rule.controlCost);
        movement.push({workerId,from,to:task.zone,taskId:task.id,slot:task.slot,gowningCycle:rule.gowningCycle});
      }
      from=task.zone;
    }
  }
  return identified(ctx,'CONTROLLED_ENVIRONMENT_PLAN_V1',{status:'safe_candidate',planId,metrics:{taskCoverageComplete:true,transitions,gowningCycles,controlMinutes,controlCost,assignedPeople:byWorker.size},movement},[{workers,tasks,assignments}]);
});}

/** Project observed movement only. Presence never proves task completion. */
export function projectControlledEnvironmentMovement(raw){return guarded(()=>{
  const {input,ctx}=context(raw);
  const tasks=uniqueRows(input.tasks,ctx,(x,key,source)=>{
    if(x.policyVersion!==ctx.policy.version)reject('task-policy-revision-mismatch');
    const start=time(x.startAt),end=time(x.endAt);if(end<=start||end>ctx.at)reject('task-window-invalid');
    return {...source,id:key,workerId:id(x.workerId),zone:knownZone(x.zone,ctx),startMs:start,endMs:end};
  });
  if(!Array.isArray(input.presenceEvents)||input.presenceEvents.length>2000)reject('bounded-events-required');
  const eventIds=new Set();const events=input.presenceEvents.map(x=>{
    record(x);const key=id(x.id);if(eventIds.has(key))reject('duplicate-event-identity');eventIds.add(key);
    const source=currentRecord(x,ctx);if(x.policyVersion!==ctx.policy.version)reject('event-policy-revision-mismatch');
    if(!['enter','exit'].includes(x.direction))reject('event-direction-invalid');
    return {...source,id:key,workerId:id(x.workerId),zone:knownZone(x.zone,ctx),atMs:time(x.observedAt),direction:x.direction};
  }).sort((a,b)=>a.atMs-b.atMs||a.id.localeCompare(b.id));
  const open=new Map(),sessions=[],dataQualityIssues=[];
  for(const event of events){
    const key=pairKey(event.workerId,event.zone);
    if(event.direction==='enter'){
      if(open.has(key)){dataQualityIssues.push({code:'duplicate-enter-without-exit',workerId:event.workerId,zone:event.zone,eventId:event.id});continue;}
      open.set(key,event);continue;
    }
    const start=open.get(key);
    if(!start){dataQualityIssues.push({code:'exit-without-enter',workerId:event.workerId,zone:event.zone,eventId:event.id});continue;}
    open.delete(key);
    if(event.atMs<=start.atMs){dataQualityIssues.push({code:'non-positive-session',workerId:event.workerId,zone:event.zone,eventId:event.id});continue;}
    sessions.push({workerId:event.workerId,zone:event.zone,enterAt:start.observedAt,exitAt:event.observedAt,enterMs:start.atMs,exitMs:event.atMs});
  }
  for(const event of open.values())dataQualityIssues.push({code:'open-session-missing-exit',workerId:event.workerId,zone:event.zone,eventId:event.id});
  const byWorker=new Map();for(const session of sessions){if(!byWorker.has(session.workerId))byWorker.set(session.workerId,[]);byWorker.get(session.workerId).push(session);}
  for(const [workerId,rows] of byWorker){rows.sort((a,b)=>a.enterMs-b.enterMs);let lastEnd=-Infinity;for(const row of rows){if(row.enterMs<lastEnd)dataQualityIssues.push({code:'overlapping-presence-sessions',workerId});lastEnd=Math.max(lastEnd,row.exitMs);}}
  for(const zone of Object.keys(ctx.policy.zones)){
    const boundaries=sessions.filter(x=>x.zone===zone).flatMap(x=>[{at:x.enterMs,delta:1},{at:x.exitMs,delta:-1}]).sort((a,b)=>a.at-b.at||a.delta-b.delta);
    let count=0;for(const point of boundaries){count+=point.delta;if(count>ctx.policy.zones[zone].maxPersonnel){dataQualityIssues.push({code:'observed-zone-occupancy-exceeded',zone});break;}}
  }
  const movement=[];
  for(const session of sessions){
    for(const [from,to,at] of [[ctx.policy.defaultOutsideZone,session.zone,session.enterAt],[session.zone,ctx.policy.defaultOutsideZone,session.exitAt]]){
      const rule=ctx.transitions.get(pairKey(from,to));movement.push({workerId:session.workerId,from,to,at,approved:rule?.allowed===true,gowningCycle:rule?.gowningCycle??null,controlMinutes:rule?.controlMinutes??null,controlCost:rule?.controlCost??null});
    }
  }
  const unapprovedMovement=movement.filter(x=>!x.approved);
  const sessionRows=sessions.map(session=>{
    const matched=tasks.filter(task=>task.workerId===session.workerId&&task.zone===session.zone&&session.enterMs<task.endMs&&task.startMs<session.exitMs);
    return {workerId:session.workerId,zone:session.zone,enterAt:session.enterAt,exitAt:session.exitAt,durationMinutes:(session.exitMs-session.enterMs)/60000,matchedTaskIds:matched.map(x=>x.id),attribution:matched.length?'task_window_overlap':'needs_review'};
  });
  const entries=movement.filter(x=>x.to!==ctx.policy.defaultOutsideZone);
  const minutes=entries.reduce((sum,x)=>addKnown(sum,x.controlMinutes),0),cost=entries.reduce((sum,x)=>addKnown(sum,x.controlCost),0);
  const gowning=entries.reduce((sum,x)=>x.gowningCycle===null?null:addKnown(sum,x.gowningCycle?1:0),0);
  const result={status:dataQualityIssues.length||unapprovedMovement.length?'needs_review':'movement_ready',metrics:{observedSessions:sessions.length,observedEntries:sessions.length,observedGowningCycles:gowning,observedControlMinutes:minutes,observedControlCost:cost,sessionsWithoutTaskOverlap:sessionRows.filter(x=>x.attribution==='needs_review').length},sessions:sessionRows,movement,dataQualityIssues,unapprovedMovement,taskCompletionProven:false};
  return identified(ctx,'CONTROLLED_ENVIRONMENT_MOVEMENT_V1',result,[{tasks,events}]);
});}
