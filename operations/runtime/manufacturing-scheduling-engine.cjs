'use strict';

const { createHash } = require('node:crypto');
const { types } = require('node:util');

const CONTRACT_VERSION = 'VECTOR_MANUFACTURING_SCHEDULER_V1';
const SOLVER_VERSION = 'VECTOR_DETERMINISTIC_OPTIMISER_V1';
const WORKER_TYPES = Object.freeze(['EMPLOYEE','CONTINGENT','AGENCY']);
const REPAIR_EVENTS = Object.freeze(['ABSENCE','NO_SHOW','PRODUCTION_CHANGE','LINE_DOWNTIME','DEMAND_CHANGE']);

function clone(v){ return v==null?v:ownedCopy(v); }
function ownedCopy(v,ancestors=new WeakSet()){
  if(v===null||v===undefined||typeof v==='string'||typeof v==='boolean'||typeof v==='number') return v;
  if(typeof v!=='object'||types.isProxy(v)||ancestors.has(v))
    throw new Error('Value must be inert enumerable data.');
  ancestors.add(v);
  let out;
  if(Array.isArray(v)){
    const keys=Object.keys(v);
    if(keys.length!==v.length||Object.getOwnPropertyNames(v).length!==v.length+1||
      Object.getOwnPropertySymbols(v).length)
      throw new Error('Array must contain dense inert enumerable data.');
    out=[];
    for(let i=0;i<v.length;i++){
      const descriptor=Object.getOwnPropertyDescriptor(v,String(i));
      if(!descriptor||descriptor.enumerable!==true||
        !Object.prototype.hasOwnProperty.call(descriptor,'value'))
        throw new Error('Array must contain inert data values.');
      out[i]=ownedCopy(descriptor.value,ancestors);
    }
  }else{
    const prototype=Object.getPrototypeOf(v),keys=Object.keys(v);
    if((prototype!==Object.prototype&&prototype!==null)||
      Object.getOwnPropertyNames(v).length!==keys.length||Object.getOwnPropertySymbols(v).length)
      throw new Error('Object must contain inert enumerable data only.');
    out={};
    for(let i=0;i<keys.length;i++){
      const key=keys[i],descriptor=Object.getOwnPropertyDescriptor(v,key);
      if(!descriptor||!Object.prototype.hasOwnProperty.call(descriptor,'value'))
        throw new Error('Object must contain inert data values.');
      Object.defineProperty(out,key,{value:ownedCopy(descriptor.value,ancestors),
        enumerable:true,writable:true,configurable:true});
    }
  }
  ancestors.delete(v);
  return out;
}
function stable(v){
  if(Array.isArray(v)){
    let out='[';
    for(let i=0;i<v.length;i++) out+=(i?',':'')+stable(v[i]);
    return out+']';
  }
  if(v&&typeof v==='object'){
    const keys=Object.keys(v);
    for(let i=1;i<keys.length;i++){
      const key=keys[i];
      let j=i-1;
      while(j>=0&&keys[j]>key){ keys[j+1]=keys[j]; j--; }
      keys[j+1]=key;
    }
    let out='{';
    for(let i=0;i<keys.length;i++){
      const key=keys[i];
      out+=(i?',':'')+JSON.stringify(key)+':'+stable(v[key]);
    }
    return out+'}';
  }
  return JSON.stringify(v);
}
function digest(v){ return createHash('sha256').update(stable(v)).digest('hex'); }
function jsonDigest(v){
  function owned(value){
    if(value===null||typeof value!=='object') return value;
    if(Array.isArray(value)){
      const out=[];
      Object.setPrototypeOf(out,null);
      for(let i=0;i<value.length;i++) out[i]=owned(value[i]);
      return out;
    }
    const out=Object.create(null),keys=Object.keys(value);
    for(let i=0;i<keys.length;i++) out[keys[i]]=owned(value[keys[i]]);
    return out;
  }
  return createHash('sha256').update(JSON.stringify(owned(v))).digest('hex');
}
function planIdentity(v){
  const identity=Object.create(null);
  const keys=Object.keys(v);
  for(let i=0;i<keys.length;i++){
    const key=keys[i];
    if(key!=='createdAt'&&key!=='planId'&&key!=='authorityScope') identity[key]=v[key];
  }
  return digest(identity);
}
function deepFreeze(v){
  if(v===null||typeof v!=='object'||Object.isFrozen(v)) return v;
  const keys=Object.keys(v);
  for(let i=0;i<keys.length;i++) deepFreeze(v[keys[i]]);
  return Object.freeze(v);
}
function inertSnapshot(v,ancestors=new WeakSet()){
  if(v===null||typeof v==='string'||typeof v==='boolean') return v;
  if(typeof v==='number'){
    if(!Number.isFinite(v)) throw new Error('Non-finite plan value.');
    return v;
  }
  if(typeof v!=='object'||types.isProxy(v)||ancestors.has(v))
    throw new Error('Prior plan must be an inert acyclic data structure.');
  ancestors.add(v);
  let out;
  if(Array.isArray(v)){
    const length=v.length,keys=Object.keys(v);
    if(keys.length!==length||Object.getOwnPropertySymbols(v).length)
      throw new Error('Prior plan arrays must be dense inert data.');
    out=[];
    for(let i=0;i<length;i++){
      const descriptor=Object.getOwnPropertyDescriptor(v,String(i));
      if(!descriptor||descriptor.enumerable!==true||
        !Object.prototype.hasOwnProperty.call(descriptor,'value'))
        throw new Error('Prior plan arrays must contain inert values.');
      out[i]=inertSnapshot(descriptor.value,ancestors);
    }
  }else{
    const prototype=Object.getPrototypeOf(v),keys=Object.keys(v);
    if((prototype!==Object.prototype&&prototype!==null)||
      Object.getOwnPropertyNames(v).length!==keys.length||Object.getOwnPropertySymbols(v).length)
      throw new Error('Prior plan objects must contain enumerable inert data only.');
    out={};
    for(let i=0;i<keys.length;i++){
      const key=keys[i],descriptor=Object.getOwnPropertyDescriptor(v,key);
      if(!descriptor||!Object.prototype.hasOwnProperty.call(descriptor,'value'))
        throw new Error('Prior plan objects must contain inert values.');
      Object.defineProperty(out,key,{value:inertSnapshot(descriptor.value,ancestors),
        enumerable:true,writable:true,configurable:true});
    }
  }
  ancestors.delete(v);
  return out;
}
function verifiedPriorPlan(raw){
  let prior;
  try { prior=inertSnapshot(raw); }
  catch { throw new Error('Valid inert prior scheduling plan is required.'); }
  if(!prior||prior.contractVersion!==CONTRACT_VERSION)
    throw new Error('Valid prior scheduling plan is required.');
  const rawIdentity=planIdentity(prior);
  const expectedIdentity=prior.authorityScope===undefined
    ?rawIdentity:jsonDigest([rawIdentity,prior.authorityScope]);
  if(typeof prior.planId!=='string'||!/^[a-f0-9]{64}$/.test(prior.planId)||
    expectedIdentity!==prior.planId)
    throw new Error('Prior scheduling plan identity verification failed.');
  return prior;
}
function text(v,max=200){ return String(v??'').trim().slice(0,max); }
function list(v,max=100,maxLen=160){
  if(!Array.isArray(v)||types.isProxy(v)) return [];
  const length=Math.min(v.length,max),out=[],seen=Object.create(null);
  for(let i=0;i<length;i++){
    const descriptor=Object.getOwnPropertyDescriptor(v,String(i));
    if(!descriptor||descriptor.enumerable!==true||
      !Object.prototype.hasOwnProperty.call(descriptor,'value')) return [];
    const value=text(descriptor.value,maxLen);
    if(value&&!Object.prototype.hasOwnProperty.call(seen,value)){
      seen[value]=true;
      out[out.length]=value;
    }
  }
  return out;
}
function mapDense(v,mapper,label='Array'){
  if(!Array.isArray(v)||types.isProxy(v)) throw new Error(label+' must be an inert array.');
  const out=[];
  for(let i=0;i<v.length;i++){
    const descriptor=Object.getOwnPropertyDescriptor(v,String(i));
    if(!descriptor||descriptor.enumerable!==true||
      !Object.prototype.hasOwnProperty.call(descriptor,'value'))
      throw new Error(label+' must contain dense inert values.');
    if(descriptor.value!==null&&typeof descriptor.value==='object'&&types.isProxy(descriptor.value))
      throw new Error(label+' must contain inert non-proxy values.');
    out[out.length]=mapper(descriptor.value,i);
  }
  return out;
}
function immutableLookup(values){
  const lookup=Object.create(null);
  for(let i=0;i<values.length;i++) lookup[values[i]]=true;
  const result={};
  Object.defineProperty(result,'has',{enumerable:false,value(value){
    return Object.prototype.hasOwnProperty.call(lookup,value);
  }});
  return Object.freeze(result);
}
function refLookup(refs){
  const lookup=Object.create(null);
  for(let i=0;i<refs.length;i++) lookup[refs[i]]=true;
  return lookup;
}
function refsContained(refs,lookup){
  for(let i=0;i<refs.length;i++) if(!Object.prototype.hasOwnProperty.call(lookup,refs[i])) return false;
  return true;
}
function ownDataValue(record,key){
  if(record===null||typeof record!=='object'||Array.isArray(record)||types.isProxy(record))
    return {valid:false,value:undefined};
  const descriptor=Object.getOwnPropertyDescriptor(record,key);
  return descriptor&&Object.prototype.hasOwnProperty.call(descriptor,'value')
    ?{valid:true,value:descriptor.value}:{valid:false,value:undefined};
}
function strictRefsResult(v,max=100,maxLen=220){
  if(!Array.isArray(v)||types.isProxy(v)) return {valid:false,refs:[]};
  const length=v.length,refs=[],seen=Object.create(null);
  if(length>max) return {valid:false,refs:[]};
  for(let i=0;i<length;i++){
    const descriptor=Object.getOwnPropertyDescriptor(v,String(i));
    if(!descriptor||descriptor.enumerable!==true||
      !Object.prototype.hasOwnProperty.call(descriptor,'value')) return {valid:false,refs:[]};
    const x=descriptor.value;
    if(typeof x!=='string') return {valid:false,refs:[]};
    const trimmed=x.trim();
    if(!trimmed||trimmed.length>maxLen) return {valid:false,refs:[]};
    if(!Object.prototype.hasOwnProperty.call(seen,trimmed)){
      seen[trimmed]=true;
      refs[refs.length]=trimmed;
    }
  }
  if(v.length!==length) return {valid:false,refs:[]};
  return {valid:true,refs};
}
function strictRefs(v,max=100,maxLen=220){
  const result=strictRefsResult(v,max,maxLen);
  return result.valid?result.refs:[];
}
function strictOptionalRefs(v,max,maxLen,label){
  if(v===undefined||v===null) return [];
  const result=strictRefsResult(v,max,maxLen);
  if(!result.valid) throw new Error(label+' must be a dense inert array within its declared limits.');
  return result.refs;
}
function n(v,f=0){ const x=Number(v); return Number.isFinite(x)?x:f; }
function clamp(v,min,max,f){ const x=Number(v); return Number.isFinite(x)?Math.max(min,Math.min(max,x)):f; }
function whole(v,min,max,f){ const x=Math.trunc(Number(v)); return Number.isFinite(x)?Math.max(min,Math.min(max,x)):f; }
function iso(v,name){
  // Absolute instants only: no host timezone, calendar rollover or precision loss.
  const match=typeof v==='string'&&/^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(v);
  const msv=match?Date.parse(v):NaN;
  if(!match||!Number.isFinite(msv)||match[6]==='-00:00'||
    new Date(Date.parse(match[1]+'T00:00:00Z')).toISOString().slice(0,10)!==match[1])
    throw new Error((name||'timestamp')+' must be a valid ISO timestamp with an explicit offset.');
  return new Date(msv).toISOString();
}
function ms(v){ const x=Date.parse(v); return Number.isFinite(x)?x:null; }
function hours(a,b){ return Math.max(0,(ms(b)-ms(a))/3600000); }
function overlaps(a0,a1,b0,b1){ return ms(a0)<ms(b1)&&ms(b0)<ms(a1); }
function contains(w,a,b){ return ms(w.start)<=ms(a)&&ms(w.end)>=ms(b); }
function normaliseAssignments(input=[]){
  if(!Array.isArray(input)||types.isProxy(input)) throw new Error('Assignments must be an inert array.');
  const seen=new Set(),out=[];
  for(let i=0;i<input.length;i++){
    const descriptor=Object.getOwnPropertyDescriptor(input,String(i));
    if(!descriptor||descriptor.enumerable!==true||
      !Object.prototype.hasOwnProperty.call(descriptor,'value'))
      throw new Error('Assignments must contain dense inert values.');
    const a=ownedCopy(descriptor.value);
    if(!a||typeof a.slotId!=='string'||!a.slotId.trim()||
      !(typeof a.workerId==='string'&&a.workerId.trim()||a.workerId===null&&a.shortfall===true))
      throw new Error('Assignment slotId and workerId are required (or explicit shortfall).');
    if(seen.has(a.slotId)) throw new Error('Assignment slot ids must be unique.');
    seen.add(a.slotId);
    const start=iso(a.start,'assignment start'),end=iso(a.end,'assignment end');
    if(ms(end)<=ms(start)) throw new Error('Assignment end must be after start.');
    out[out.length]={...a,start,end};
  }
  return out;
}

function normalisePolicy(input={},sourceEvidence=[]){
  const w=input.weights||{};
  const overtimeField=ownDataValue(input,'overtimeAuthorisation');
  const rawOvertime=overtimeField.valid?overtimeField.value:null;
  const authorisedField=ownDataValue(rawOvertime,'authorised');
  const maxHoursField=ownDataValue(rawOvertime,'maxHours');
  const evidenceField=ownDataValue(rawOvertime,'evidenceRefs');
  const overtimeEvidence=evidenceField.valid?strictRefs(evidenceField.value,100,220):[];
  const maxHours=maxHoursField.value;
  const authoritativeSources=refLookup(strictRefs(sourceEvidence,300,220));
  const overtimeAuthorised=authorisedField.value===true&&typeof maxHours==='number'&&
    Number.isFinite(maxHours)&&maxHours>=0&&maxHours<=100&&
    overtimeEvidence.length>0&&refsContained(overtimeEvidence,authoritativeSources);
  const overtimeAuthorisation=Object.freeze({
    authorised:overtimeAuthorised,
    maxHours:overtimeAuthorised?maxHours:0,
    evidenceRefs:Object.freeze(overtimeAuthorised?overtimeEvidence:[])
  });
  const requiredRuleRefs=strictOptionalRefs(input.requiredRuleRefs,100,180,'Required rule references');
  const blockedWorkers=strictOptionalRefs(input.blockedWorkers,1000,120,'Blocked workers');
  const blockedWorkerSitePairs=strictOptionalRefs(input.blockedWorkerSitePairs,2000,280,'Blocked worker-site pairs');
  return deepFreeze({
    minRestHours:clamp(input.minRestHours,0,72,11),
    maxWeeklyHours:clamp(input.maxWeeklyHours,1,168,48),
    maxOvertimeHours:overtimeAuthorisation.maxHours,
    overtimeAuthorisation,
    maxConsecutiveShifts:whole(input.maxConsecutiveShifts,1,30,6),
    maxConsecutiveNights:whole(input.maxConsecutiveNights,1,30,4),
    crossSiteAllowed:input.crossSiteAllowed!==false,
    agencyAllowed:input.agencyAllowed!==false,
    contingentAllowed:input.contingentAllowed!==false,
    exactSlotLimit:whole(input.exactSlotLimit,1,14,10),
    exactCandidateLimit:whole(input.exactCandidateLimit,1,100,45),
    maxSearchNodes:whole(input.maxSearchNodes,100,2000000,150000),
    ruleVersion:text(input.ruleVersion,120)||'unspecified',
    requiredRuleRefs,
    blockedWorkers:immutableLookup(blockedWorkers),
    blockedWorkerSitePairs:immutableLookup(blockedWorkerSitePairs),
    weights:{
      labourCost:clamp(w.labourCost,0,1000,1),
      overtime:clamp(w.overtime,0,1000,1.5),
      agency:clamp(w.agency,0,1000,1.4),
      crossSite:clamp(w.crossSite,0,1000,0.8),
      travel:clamp(w.travel,0,1000,0.6),
      preference:clamp(w.preference,0,1000,0.8),
      fairness:clamp(w.fairness,0,1000,0.7),
      fatigue:clamp(w.fatigue,0,1000,1.2),
      stability:clamp(w.stability,0,1000,2),
      shortfall:clamp(w.shortfall,1,1000000,10000)
    }
  });
}
function availability(v){
  if(types.isProxy(v)) throw new Error('Availability must be an inert array.');
  if(Array.isArray(v)&&v.length>200) throw new Error('Availability supports at most 200 windows.');
  const windows=[];
  if(Array.isArray(v)) for(let i=0;i<v.length;i++){
    const descriptor=Object.getOwnPropertyDescriptor(v,String(i));
    if(!descriptor||descriptor.enumerable!==true||
      !Object.prototype.hasOwnProperty.call(descriptor,'value'))
      throw new Error('Availability must contain dense inert values.');
    const x=ownedCopy(descriptor.value);
    const start=iso(x.start,'availability '+i+' start'),end=iso(x.end,'availability '+i+' end');
    if(ms(end)<=ms(start)) throw new Error('Availability end must be after start.');
    windows[windows.length]={start,end};
  }
  windows.sort((a,b)=>ms(a.start)-ms(b.start)||ms(a.end)-ms(b.end));
  const merged=[];
  for(const window of windows){
    const previous=merged[merged.length-1];
    if(previous&&ms(window.start)<=ms(previous.end)){
      if(ms(window.end)>ms(previous.end)) previous.end=window.end;
    }else merged.push(window);
  }
  // Freeze owned copies, not caller data. A normalized window cannot later
  // be widened in place to turn a genuine availability gap into coverage.
  for(let i=0;i<merged.length;i++) Object.freeze(merged[i]);
  return Object.freeze(merged);
}
function certs(v){
  if(!Array.isArray(v)||types.isProxy(v)) return [];
  const out=[];
  for(let i=0;i<Math.min(v.length,200);i++){
    const descriptor=Object.getOwnPropertyDescriptor(v,String(i));
    if(!descriptor||descriptor.enumerable!==true||
      !Object.prototype.hasOwnProperty.call(descriptor,'value')) return [];
    const x=ownedCopy(descriptor.value),name=text(x.name,120);
    if(name) out[out.length]={name,expiresAt:x.expiresAt?iso(x.expiresAt,'certification expiry'):null};
  }
  return out;
}
function normaliseWorker(input={}){
  const id=text(input.id,120);
  if(!id) throw new Error('Worker id is required.');
  const type=text(input.type||'EMPLOYEE',30).toUpperCase();
  if(!WORKER_TYPES.includes(type)) throw new Error('Unsupported worker type for '+id+'.');
  const homeSite=text(input.homeSite||input.site,160);
  const p=input.preferences||{},f=input.fairness||{};
  const ruleBlocks=strictOptionalRefs(input.ruleBlocks,100,180,'Worker rule blocks');
  const worker={
    id,type,status:text(input.status||'ACTIVE',30).toUpperCase(),homeSite,
    eligibleSites:list(input.eligibleSites?.length?input.eligibleSites:[homeSite],100,160),
    skills:list(input.skills,200,120),certifications:certs(input.certifications),
    availability:availability(input.availability),
    previousShiftEnd:input.previousShiftEnd?iso(input.previousShiftEnd,id+' previous shift end'):null,
    hoursWorkedWeek:Math.max(0,n(input.hoursWorkedWeek,0)),
    contractedHours:Math.max(0,n(input.contractedHours,40)),
    consecutiveShifts:Math.max(0,whole(input.consecutiveShifts,0,100,0)),
    consecutiveNights:Math.max(0,whole(input.consecutiveNights,0,100,0)),
    hourlyCost:Math.max(0,n(input.hourlyCost,0)),
    overtimeMultiplier:Math.max(1,n(input.overtimeMultiplier,1.5)),
    agencyPremiumPerHour:Math.max(0,n(input.agencyPremiumPerHour,0)),
    contingentPremiumPerHour:Math.max(0,n(input.contingentPremiumPerHour,0)),
    travelCostBySite:clone(input.travelCostBySite||{}),
    travelMinutesBySite:clone(input.travelMinutesBySite||{}),
    travelMinutesByRoute:clone(input.travelMinutesByRoute||{}),
    preferences:{
      preferredSites:list(p.preferredSites,100,160),preferredLines:list(p.preferredLines,100,160),
      avoidedTags:list(p.avoidedTags,100,80).map(x=>x.toUpperCase()),
      preferredTags:list(p.preferredTags,100,80).map(x=>x.toUpperCase())
    },
    fairness:{
      overtimeHours:Math.max(0,n(f.overtimeHours,0)),nightShifts:Math.max(0,n(f.nightShifts,0)),
      weekendShifts:Math.max(0,n(f.weekendShifts,0)),undesirableShifts:Math.max(0,n(f.undesirableShifts,0))
    },
    ruleBlocks:immutableLookup(ruleBlocks),
    evidenceRefs:list(input.evidenceRefs,100,220)
  };
  // The accepted availability snapshot cannot be swapped after validation.
  return Object.defineProperty(worker,'availability',{writable:false,configurable:false});
}
function normaliseRequirement(input={}){
  const id=text(input.id,140),site=text(input.site,160),role=text(input.role,120);
  if(!id||!site||!role) throw new Error('Requirement id, site and role are required.');
  const start=iso(input.start,id+' start'),end=iso(input.end,id+' end');
  if(ms(end)<=ms(start)) throw new Error('Requirement '+id+' end must be after start.');
  const fc=input.forecast||{};
  const p50=whole(fc.p50Headcount??input.headcount,0,100000,whole(input.headcount,0,100000,1));
  const p90=whole(fc.p90Headcount??p50,p50,100000,p50);
  const confidence=clamp(fc.confidence,0,1,1);
  const headcount=whole(input.planningHeadcount??(confidence<0.65?p90:p50),0,100000,p50);
  const types=list(input.allowedWorkerTypes?.length?input.allowedWorkerTypes:WORKER_TYPES,10,30)
    .map(x=>x.toUpperCase()).filter(x=>WORKER_TYPES.includes(x));
  const requiredSkills=strictOptionalRefs(input.requiredSkills,100,120,'Required skills');
  const requiredCertifications=strictOptionalRefs(input.requiredCertifications,100,120,'Required certifications');
  const lockedWorkerIds=strictOptionalRefs(input.lockedWorkerIds,1000,120,'Locked worker ids');
  const tags=strictOptionalRefs(input.tags,100,80,'Requirement tags');
  const evidenceRefs=strictOptionalRefs(input.evidenceRefs,100,220,'Requirement evidence references');
  return {
    id,site,line:text(input.line,120)||null,role,start,end,headcount,
    forecast:{p50Headcount:p50,p90Headcount:p90,confidence},
    requiredSkills,requiredCertifications,
    allowedWorkerTypes:types,tags:tags.map(x=>x.toUpperCase()),
    productionPriority:clamp(input.productionPriority,0,100,50),
    customerPriority:clamp(input.customerPriority,0,100,50),
    marginAtRisk:Math.max(0,n(input.marginAtRisk,0)),latePenalty:Math.max(0,n(input.latePenalty,0)),
    lockedWorkerIds,evidenceRefs
  };
}
function slots(reqs){
  const out=[];
  for(const r of reqs) for(let i=0;i<r.headcount;i++) out.push({
    slotId:r.id+'#'+(i+1),requirementId:r.id,site:r.site,line:r.line,role:r.role,start:r.start,end:r.end,
    requiredSkills:r.requiredSkills,requiredCertifications:r.requiredCertifications,
    allowedWorkerTypes:r.allowedWorkerTypes,tags:r.tags,productionPriority:r.productionPriority,
    customerPriority:r.customerPriority,marginAtRisk:r.marginAtRisk,latePenalty:r.latePenalty,
    lockedWorkerIds:r.lockedWorkerIds,evidenceRefs:r.evidenceRefs,forecast:r.forecast
  });
  return out;
}
function certValid(worker,name,end){
  const c=worker.certifications.find(x=>x.name===name);
  return !!c&&(!c.expiresAt||ms(c.expiresAt)>=ms(end));
}
function assignedHours(workerId,assignments){
  return assignments.filter(a=>a.workerId===workerId).reduce((s,a)=>s+hours(a.start,a.end),0);
}
// Supplied planning data, not independently authenticated route authority.
// Legacy destination durations are home-site outbound only. Other journeys
// require an explicit directed travelMinutesByRoute[fromSite][toSite] entry.
function transferMinutes(worker,fromSite,toSite){
  if(fromSite===toSite) return 0;
  const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const routes=worker.travelMinutesByRoute,legacy=worker.travelMinutesBySite;
  let value;
  if(record(routes)&&Object.hasOwn(routes,fromSite)){
    const destinations=routes[fromSite];
    if(!record(destinations)) return null;
    if(Object.hasOwn(destinations,toSite)){
      value=destinations[toSite];
      return typeof value==='number'&&Number.isFinite(value)&&value>=0&&
        value<=Number.MAX_SAFE_INTEGER/60000?value:null;
    }
  }
  if(fromSite===worker.homeSite&&record(legacy)&&Object.hasOwn(legacy,toSite)) value=legacy[toSite];
  return typeof value==='number'&&Number.isFinite(value)&&value>=0&&
    value<=Number.MAX_SAFE_INTEGER/60000?value:null;
}
function transferContext(worker,slot,assignments){
  const siteKnown=v=>typeof v==='string'&&v.length>0&&v.length<=160&&v===v.trim();
  const start=ms(slot.start),end=ms(slot.end),failures=[];
  let before=null,after=null,beforeTime=-Infinity,afterTime=Infinity,
    beforeAmbiguous=false,afterAmbiguous=false;
  for(let i=0;i<assignments.length;i++){
    const assignment=assignments[i];
    if(assignment.workerId!==worker.id) continue;
    if(!siteKnown(assignment.site))
      return {failures:['ASSIGNMENT_SITE_UNPROVEN'],minutes:0,hasJourney:false};
    const assignmentEnd=ms(assignment.end),assignmentStart=ms(assignment.start);
    if(assignmentEnd<=start){
      if(assignmentEnd>beforeTime){ before=assignment;beforeTime=assignmentEnd;beforeAmbiguous=false; }
      else if(assignmentEnd===beforeTime&&before&&assignment.site!==before.site) beforeAmbiguous=true;
    }
    if(assignmentStart>=end){
      if(assignmentStart<afterTime){ after=assignment;afterTime=assignmentStart;afterAmbiguous=false; }
      else if(assignmentStart===afterTime&&after&&assignment.site!==after.site) afterAmbiguous=true;
    }
  }
  // The optimiser inserts in constraint order, not time order. Check both
  // adjacent journeys; a distant assignment is not the transfer origin.
  if(beforeAmbiguous||afterAmbiguous)
    return {failures:['ASSIGNMENT_SITE_UNPROVEN'],minutes:0,hasJourney:false};
  const journeys=[];
  if(before) journeys[journeys.length]=[before.site,slot.site,start-beforeTime];
  if(after) journeys[journeys.length]=[slot.site,after.site,afterTime-end];
  let minutesTotal=0;
  for(let i=0;i<journeys.length;i++){
    const [fromSite,toSite,gap]=journeys[i];
    const requiredMinutes=transferMinutes(worker,fromSite,toSite);
    if(requiredMinutes===null) failures.push('CROSS_SITE_TRAVEL_UNPROVEN');
    else {
      if(gap<requiredMinutes*60000) failures.push('INSUFFICIENT_TRANSFER_TIME');
      if(fromSite!==toSite) minutesTotal+=requiredMinutes;
    }
  }
  return {failures,minutes:minutesTotal,hasJourney:journeys.length>0};
}
function evaluateWorkerForSlot(worker,slot,ctx={}){
  const policy=ctx.policy||normalisePolicy(),assignments=normaliseAssignments(ctx.assignments);
  const start=iso(slot.start,'slot start'),end=iso(slot.end,'slot end');
  if(ms(end)<=ms(start)) throw new Error('Slot end must be after start.');
  const failures=[],warnings=[],duration=hours(slot.start,slot.end),already=assignedHours(worker.id,assignments);
  const projectedWeek=worker.hoursWorkedWeek+already+duration;
  const projectedOT=Math.max(0,projectedWeek-worker.contractedHours);
  const night=slot.tags.includes('NIGHT');
  if(worker.status!=='ACTIVE') failures.push('WORKER_NOT_ACTIVE');
  if(policy.blockedWorkers.has(worker.id)) failures.push('WORKER_POLICY_BLOCKED');
  if(policy.blockedWorkerSitePairs.has(worker.id+'::'+slot.site)) failures.push('WORKER_SITE_POLICY_BLOCKED');
  if(!slot.allowedWorkerTypes.includes(worker.type)) failures.push('WORKER_TYPE_NOT_ALLOWED');
  if(worker.type==='AGENCY'&&!policy.agencyAllowed) failures.push('AGENCY_NOT_ALLOWED');
  if(worker.type==='CONTINGENT'&&!policy.contingentAllowed) failures.push('CONTINGENT_NOT_ALLOWED');
  const sameSite=worker.homeSite===slot.site;
  if(!(sameSite||(policy.crossSiteAllowed&&worker.eligibleSites.includes(slot.site)))) failures.push('SITE_NOT_ELIGIBLE');
  if(!worker.availability.length||!worker.availability.some(w=>contains(w,slot.start,slot.end))) failures.push('NOT_AVAILABLE');
  for(const s of slot.requiredSkills) if(!worker.skills.includes(s)) failures.push('MISSING_SKILL:'+s);
  for(const c of slot.requiredCertifications) if(!certValid(worker,c,slot.end)) failures.push('CERTIFICATION_INVALID:'+c);
  if(worker.previousShiftEnd&&((ms(slot.start)-ms(worker.previousShiftEnd))/3600000)<policy.minRestHours) failures.push('MINIMUM_REST_BREACH');
  if(projectedWeek>policy.maxWeeklyHours) failures.push('MAX_WEEKLY_HOURS_BREACH');
  if(projectedOT>0&&!policy.overtimeAuthorisation.authorised) failures.push('OVERTIME_AUTHORITY_UNPROVEN');
  if(projectedOT>policy.maxOvertimeHours) failures.push('MAX_OVERTIME_BREACH');
  if(worker.consecutiveShifts+1>policy.maxConsecutiveShifts) failures.push('MAX_CONSECUTIVE_SHIFTS_BREACH');
  if(night&&worker.consecutiveNights+1>policy.maxConsecutiveNights) failures.push('MAX_CONSECUTIVE_NIGHTS_BREACH');
  if(assignments.some(a=>a.workerId===worker.id&&overlaps(a.start,a.end,slot.start,slot.end))) failures.push('OVERLAPPING_ASSIGNMENT');
  // Search order is not chronological. Check rest on both sides of this slot.
  if(assignments.some(a=>a.workerId===worker.id&&
    !overlaps(a.start,a.end,start,end)&&
    (ms(a.end)<=ms(start)?ms(start)-ms(a.end):ms(a.start)-ms(end))<policy.minRestHours*3600000))
    failures.push('MINIMUM_REST_BREACH');
  const transfer=transferContext(worker,slot,assignments);
  failures.push(...transfer.failures);
  for(const ref of policy.requiredRuleRefs) if(worker.ruleBlocks.has(ref)) failures.push('RULE_BLOCK:'+ref);
  if(slot.lockedWorkerIds.length&&!slot.lockedWorkerIds.includes(worker.id)) failures.push('LOCKED_REQUIREMENT_OTHER_WORKER');

  const regularLeft=Math.max(0,worker.contractedHours-worker.hoursWorkedWeek-already);
  const regular=Math.min(duration,regularLeft),ot=Math.max(0,duration-regular);
  const base=regular*worker.hourlyCost+ot*worker.hourlyCost*worker.overtimeMultiplier;
  const agency=worker.type==='AGENCY'?duration*worker.agencyPremiumPerHour:0;
  const contingent=worker.type==='CONTINGENT'?duration*worker.contingentPremiumPerHour:0;
  const travelCost=sameSite?0:Math.max(0,n(worker.travelCostBySite?.[slot.site],0));
  const travelMinutes=transfer.hasJourney?transfer.minutes:
    (sameSite?0:Math.max(0,n(worker.travelMinutesBySite?.[slot.site],0)));
  let pref=0;
  if(worker.preferences.preferredSites.length&&!worker.preferences.preferredSites.includes(slot.site)) pref+=1;
  if(slot.line&&worker.preferences.preferredLines.length&&!worker.preferences.preferredLines.includes(slot.line)) pref+=0.5;
  for(const tag of slot.tags){ if(worker.preferences.avoidedTags.includes(tag)) pref+=2; if(worker.preferences.preferredTags.includes(tag)) pref-=0.25; }
  pref=Math.max(0,pref);
  const fairness=worker.fairness.overtimeHours*0.08+worker.fairness.undesirableShifts*0.1+(night?worker.fairness.nightShifts*0.12:0);
  const fatigue=worker.consecutiveShifts/Math.max(1,policy.maxConsecutiveShifts)+(night?worker.consecutiveNights/Math.max(1,policy.maxConsecutiveNights):0)+projectedOT*0.04;
  if(fatigue>1.5) warnings.push('ELEVATED_FATIGUE_RISK');
  const preferred=ctx.preferredAssignments instanceof Map?ctx.preferredAssignments.get(slot.slotId):null;
  const stability=preferred&&preferred!==worker.id?1:0,w=policy.weights;
  const score=base*w.labourCost+ot*worker.hourlyCost*Math.max(0,worker.overtimeMultiplier-1)*w.overtime+
    (agency+(worker.type==='AGENCY'?base*0.05:0))*w.agency+contingent*w.agency+
    (!sameSite?w.crossSite:0)+(travelCost+travelMinutes/60)*w.travel+pref*w.preference+
    fairness*w.fairness+fatigue*w.fatigue+stability*w.stability;
  return {
    workerId:worker.id,slotId:slot.slotId,eligible:failures.length===0,
    failures:[...new Set(failures)],warnings:[...new Set(warnings)],score:Number(score.toFixed(6)),
    cost:{baseCost:Number(base.toFixed(2)),overtimeHours:Number(ot.toFixed(2)),agencyPremium:Number(agency.toFixed(2)),
      contingentPremium:Number(contingent.toFixed(2)),travelCost:Number(travelCost.toFixed(2)),
      total:Number((base+agency+contingent+travelCost).toFixed(2))},
    experience:{preferencePenalty:Number(pref.toFixed(3)),fairnessPenalty:Number(fairness.toFixed(3)),
      fatiguePenalty:Number(fatigue.toFixed(3)),stabilityPenalty:stability}
  };
}
function shortfall(slot,policy){
  return policy.weights.shortfall*(1+(slot.productionPriority+slot.customerPriority)/100)+slot.marginAtRisk+slot.latePenalty;
}
function matrix(workers,allSlots,policy,preferred){
  const m=new Map(),all=new Map();
  for(const slot of allSlots){
    const checks=workers.map(w=>evaluateWorkerForSlot(w,slot,{policy,assignments:[],preferredAssignments:preferred}));
    m.set(slot.slotId,checks.filter(x=>x.eligible).sort((a,b)=>a.score-b.score||a.workerId.localeCompare(b.workerId)));
    all.set(slot.slotId,checks);
  }
  return {m,all};
}
function scoreSchedule(assignments,workersById,allSlots,policy,preferred){
  const slotsById=new Map(allSlots.map(slot=>[slot.slotId,slot]));
  const chronological=[...assignments].sort((a,b)=>ms(a.start)-ms(b.start)||ms(a.end)-ms(b.end)||
    a.slotId.localeCompare(b.slotId));
  const prior=[],rescored=[];
  let cost=0;
  for(const assignment of chronological){
    if(!assignment.workerId){
      cost+=assignment.score;
      rescored.push(assignment);
      continue;
    }
    const worker=workersById.get(assignment.workerId),slot=slotsById.get(assignment.slotId);
    const evaluation=evaluateWorkerForSlot(worker,slot,{policy,assignments:prior,preferredAssignments:preferred});
    if(!evaluation.eligible) return null;
    const row={...assignment,score:evaluation.score,cost:evaluation.cost,
      warnings:evaluation.warnings,experience:evaluation.experience};
    cost+=evaluation.score;
    rescored.push(row);
    prior.push(row);
  }
  return {cost,assignments:rescored};
}
function solveExact(workersById,allSlots,m,policy,preferred){
  const order=[...allSlots].sort((a,b)=>(m.get(a.slotId)?.length||0)-(m.get(b.slotId)?.length||0)||b.productionPriority-a.productionPriority||a.slotId.localeCompare(b.slotId));
  let best=null,nodes=0,aborted=false;
  function walk(i,assigned){
    nodes++;
    if(nodes>policy.maxSearchNodes){ aborted=true; return; }
    if(i===order.length){
      const scored=scoreSchedule(assigned,workersById,allSlots,policy,preferred);
      if(scored&&(!best||scored.cost<best.cost)) best={cost:scored.cost,assigned:clone(scored.assignments)};
      return;
    }
    const slot=order[i];
    for(const staticC of m.get(slot.slotId)||[]){
      const worker=workersById.get(staticC.workerId);
      const c=evaluateWorkerForSlot(worker,slot,{policy,assignments:assigned,preferredAssignments:preferred});
      if(!c.eligible) continue;
      assigned.push({slotId:slot.slotId,requirementId:slot.requirementId,workerId:worker.id,workerType:worker.type,
        site:slot.site,line:slot.line,role:slot.role,start:slot.start,end:slot.end,score:c.score,cost:c.cost,warnings:c.warnings,experience:c.experience});
      walk(i+1,assigned); assigned.pop();
    }
    const s=shortfall(slot,policy);
    assigned.push({slotId:slot.slotId,requirementId:slot.requirementId,workerId:null,site:slot.site,line:slot.line,role:slot.role,start:slot.start,end:slot.end,score:s,shortfall:true});
    walk(i+1,assigned); assigned.pop();
  }
  walk(0,[]);
  return {assignments:best?.assigned||[],objectiveScore:best?.cost??null,nodes,optimalityProven:!aborted};
}
function solveGreedy(workersById,allSlots,m,policy,preferred){
  const assigned=[]; let total=0;
  const order=[...allSlots].sort((a,b)=>(m.get(a.slotId)?.length||0)-(m.get(b.slotId)?.length||0)||b.productionPriority-a.productionPriority||a.slotId.localeCompare(b.slotId));
  for(const slot of order){
    let best=null;
    for(const x of m.get(slot.slotId)||[]){
      const w=workersById.get(x.workerId),c=evaluateWorkerForSlot(w,slot,{policy,assignments:assigned,preferredAssignments:preferred});
      if(c.eligible&&(!best||c.score<best.c.score||(c.score===best.c.score&&w.id<best.w.id))) best={w,c};
    }
    if(best){
      assigned.push({slotId:slot.slotId,requirementId:slot.requirementId,workerId:best.w.id,workerType:best.w.type,
        site:slot.site,line:slot.line,role:slot.role,start:slot.start,end:slot.end,score:best.c.score,cost:best.c.cost,warnings:best.c.warnings,experience:best.c.experience});
      total+=best.c.score;
    }else{
      const s=shortfall(slot,policy);
      assigned.push({slotId:slot.slotId,requirementId:slot.requirementId,workerId:null,site:slot.site,line:slot.line,role:slot.role,start:slot.start,end:slot.end,score:s,shortfall:true});
      total+=s;
    }
  }
  const rescored=scoreSchedule(assigned,workersById,allSlots,policy,preferred);
  return {assignments:rescored?.assignments||assigned,objectiveScore:rescored?.cost??total,
    nodes:order.length,optimalityProven:false};
}
function validateSchedule(assignments,workersById,slotsById,policy,preferred){
  const accepted=[],violations=[];
  try { assignments=normaliseAssignments(assignments); }
  catch { return {valid:false,violations:[{reasons:['INVALID_ASSIGNMENT']}]}; }
  for(const a of assignments){
    if(!a.workerId) continue;
    const w=workersById.get(a.workerId),slot=slotsById.get(a.slotId);
    if(!w||!slot){ violations.push({slotId:a.slotId,workerId:a.workerId,reasons:['UNKNOWN_WORKER_OR_SLOT']}); continue; }
    if(ms(a.start)!==ms(slot.start)||ms(a.end)!==ms(slot.end)||
      (Object.hasOwn(a,'site')&&a.site!==slot.site)){
      violations.push({slotId:a.slotId,workerId:a.workerId,reasons:['ASSIGNMENT_SLOT_MISMATCH']});
      continue;
    }
    const c=evaluateWorkerForSlot(w,slot,{policy,assignments:accepted,preferredAssignments:preferred});
    if(!c.eligible) violations.push({slotId:a.slotId,workerId:a.workerId,reasons:c.failures});
    // A legacy row may omit site, but its resolved slot supplies that fact.
    else accepted.push({...a,site:slot.site});
  }
  return {valid:violations.length===0,violations};
}
function quality(assignments,allSlots){
  const filled=assignments.filter(a=>a.workerId),unfilled=assignments.filter(a=>!a.workerId);
  const byWorker=new Map();
  for(const a of filled) byWorker.set(a.workerId,(byWorker.get(a.workerId)||0)+hours(a.start,a.end));
  const vals=[...byWorker.values()];
  const coverage=allSlots.length?filled.length/allSlots.length*100:100;
  return {
    slotCount:allSlots.length,filledSlots:filled.length,unfilledSlots:unfilled.length,
    coveragePct:Number(coverage.toFixed(2)),qualifiedCoveragePct:Number(coverage.toFixed(2)),
    scheduledHours:Number(filled.reduce((s,a)=>s+hours(a.start,a.end),0).toFixed(2)),
    overtimeHours:Number(filled.reduce((s,a)=>s+n(a.cost?.overtimeHours,0),0).toFixed(2)),
    agencyHours:Number(filled.filter(a=>a.workerType==='AGENCY').reduce((s,a)=>s+hours(a.start,a.end),0).toFixed(2)),
    contingentHours:Number(filled.filter(a=>a.workerType==='CONTINGENT').reduce((s,a)=>s+hours(a.start,a.end),0).toFixed(2)),
    labourCost:Number(filled.reduce((s,a)=>s+n(a.cost?.total,0),0).toFixed(2)),
    preferencePenalty:Number(filled.reduce((s,a)=>s+n(a.experience?.preferencePenalty,0),0).toFixed(2)),
    fairnessSpreadHours:Number((vals.length?Math.max(...vals)-Math.min(...vals):0).toFixed(2)),
    fatigueRiskAssignments:filled.filter(a=>(a.warnings||[]).includes('ELEVATED_FATIGUE_RISK')).length
  };
}
function createSchedulingPlan(input={}){
  const tenant=text(input.tenant,120),contextRevision=text(input.contextRevision,180),sourceEvidence=strictRefs(input.sourceEvidence,300,220);
  if(!tenant||!contextRevision||!sourceEvidence.length) throw new Error('tenant, contextRevision and sourceEvidence are required.');
  const policy=normalisePolicy(input.policy||{},sourceEvidence),
    workers=mapDense(input.workers||[],normaliseWorker,'Workers'),
    reqs=mapDense(input.requirements||[],normaliseRequirement,'Requirements');
  if(!workers.length||!reqs.length) throw new Error('Workers and requirements are required.');
  if(new Set(workers.map(x=>x.id)).size!==workers.length) throw new Error('Worker ids must be unique.');
  if(new Set(reqs.map(x=>x.id)).size!==reqs.length) throw new Error('Requirement ids must be unique.');
  const allSlots=slots(reqs),preferred=new Map(Object.entries(input.preferredAssignments||{}));
  const workersById=new Map(workers.map(x=>[x.id,x])),slotsById=new Map(allSlots.map(x=>[x.slotId,x]));
  const built=matrix(workers,allSlots,policy,preferred),maxCandidates=Math.max(0,...allSlots.map(x=>built.m.get(x.slotId)?.length||0));
  const exact=allSlots.length<=policy.exactSlotLimit&&maxCandidates<=policy.exactCandidateLimit;
  const solved=exact?solveExact(workersById,allSlots,built.m,policy,preferred):solveGreedy(workersById,allSlots,built.m,policy,preferred);
  const validation=validateSchedule(solved.assignments,workersById,slotsById,policy,preferred);
  if(!validation.valid) throw new Error('Independent schedule validation failed; plan refused.');
  const unfilled=solved.assignments.filter(a=>!a.workerId).map(a=>{
    const slot=slotsById.get(a.slotId),counts=new Map();
    const checks=workers.map(w=>evaluateWorkerForSlot(w,slot,{policy,
      assignments:solved.assignments.filter(x=>x.slotId!==a.slotId),preferredAssignments:preferred}));
    for(const c of checks) for(const r of c.failures) counts.set(r,(counts.get(r)||0)+1);
    return {slotId:a.slotId,requirementId:a.requirementId,eligibleCandidateCount:checks.filter(c=>c.eligible).length,
      topReasons:[...counts.entries()].sort((x,y)=>y[1]-x[1]||x[0].localeCompare(y[0])).slice(0,8).map(x=>({reason:x[0],workersBlocked:x[1]}))};
  });
  const payload={
    contractVersion:CONTRACT_VERSION,solverVersion:SOLVER_VERSION,tenant,contextRevision,
    createdAt:iso(input.createdAt||new Date().toISOString(),'createdAt'),mode:'SHADOW',executionPermitted:false,
    sourceEvidence,policy:{minRestHours:policy.minRestHours,maxWeeklyHours:policy.maxWeeklyHours,maxOvertimeHours:policy.maxOvertimeHours,
      overtimeAuthorisation:policy.overtimeAuthorisation,
      maxConsecutiveShifts:policy.maxConsecutiveShifts,maxConsecutiveNights:policy.maxConsecutiveNights,crossSiteAllowed:policy.crossSiteAllowed,
      agencyAllowed:policy.agencyAllowed,contingentAllowed:policy.contingentAllowed,ruleVersion:policy.ruleVersion,
      requiredRuleRefs:policy.requiredRuleRefs,weights:policy.weights},
    solve:{method:exact?'BOUNDED_EXACT_SEARCH':'DETERMINISTIC_GREEDY_REPAIR',optimalityProven:solved.optimalityProven,nodesEvaluated:solved.nodes,
      objectiveScore:solved.objectiveScore==null?null:Number(solved.objectiveScore.toFixed(6))},
    requirements:reqs,assignments:solved.assignments.sort((a,b)=>a.slotId.localeCompare(b.slotId)),
    quality:quality(solved.assignments,allSlots),unfilled,validation,claimBoundary:'SHADOW_ONLY_NO_PRODUCTION_MUTATION'
  };
  const owned=inertSnapshot(payload);
  return deepFreeze({...owned,planId:planIdentity(owned)});
}
function evaluateOpenShift(input={}){
  const sourceEvidence=strictRefs(input.sourceEvidence,300,220);
  const policy=normalisePolicy(input.policy||{},sourceEvidence),slot=slots([normaliseRequirement({...input.requirement,headcount:1,planningHeadcount:1})])[0];
  const assignments=normaliseAssignments(input.currentAssignments);
  const workers=mapDense(input.workers||[],normaliseWorker,'Workers');
  const ranked=workers.map(w=>evaluateWorkerForSlot(w,slot,{policy,assignments}))
    .sort((a,b)=>Number(b.eligible)-Number(a.eligible)||a.score-b.score||a.workerId.localeCompare(b.workerId));
  return {contractVersion:CONTRACT_VERSION,mode:'EVALUATE_ONLY',executionPermitted:false,slot,ranked};
}
function evaluateSwap(input={}){
  const sourceEvidence=strictRefs(input.sourceEvidence,300,220);
  const policy=normalisePolicy(input.policy||{},sourceEvidence),a=normaliseWorker(input.workerA||{}),b=normaliseWorker(input.workerB||{});
  const ra=normaliseRequirement(input.requirementA),rb=normaliseRequirement(input.requirementB);
  if(ra.headcount!==1||rb.headcount!==1) throw new Error('Swap requires single-slot requirements.');
  const sa=slots([ra])[0],sb=slots([rb])[0];
  if(a.id===b.id||sa.requirementId===sb.requirementId)
    return {contractVersion:CONTRACT_VERSION,mode:'EVALUATE_ONLY',executionPermitted:false,eligible:false,reasons:['INVALID_SWAP'],legs:{}};
  const current=normaliseAssignments(input.currentAssignments);
  // Omitted assignments retain the existing hypothetical eligibility contract.
  // A supplied schedule must identify both outgoing slots unambiguously.
  if(input.currentAssignments!==undefined){
    for(const [worker,slot] of [[a,sa],[b,sb]]){
      const outgoing=current.find(x=>x.slotId===slot.slotId);
      if(!outgoing||outgoing.workerId!==worker.id||outgoing.start!==slot.start||outgoing.end!==slot.end)
        throw new Error('Swap requires matching outgoing assignment ids, owners and times.');
    }
  }
  const base=current.filter(x=>x.slotId!==sa.slotId&&x.slotId!==sb.slotId);
  const bToA=evaluateWorkerForSlot(b,sa,{policy,assignments:base});
  const aToB=evaluateWorkerForSlot(a,sb,{policy,assignments:base.concat(bToA.eligible?[{workerId:b.id,slotId:sa.slotId,site:sa.site,start:sa.start,end:sa.end}]:[])});
  const eligible=bToA.eligible&&aToB.eligible;
  return {contractVersion:CONTRACT_VERSION,mode:'EVALUATE_ONLY',executionPermitted:false,eligible,
    reasons:eligible?[]:[...new Set([...bToA.failures,...aToB.failures])],legs:{workerBToRequirementA:bToA,workerAToRequirementB:aToB}};
}
function repairSchedulingPlan(input={}){
  let event;
  try { event=inertSnapshot(input.event); }
  catch { throw new Error('Repair event must be inert enumerable data.'); }
  const type=text(event?.type,40).toUpperCase();
  if(!REPAIR_EVENTS.includes(type)) throw new Error('Unsupported scheduling repair event.');
  const prior=verifiedPriorPlan(input.priorPlan);
  const unavailable=new Set(strictOptionalRefs(event?.unavailableWorkerIds,1000,120,
    'Unavailable worker ids'));
  const workers=mapDense(input.workers||[],w=>unavailable.has(text(w.id,120))?{...w,status:'UNAVAILABLE'}:w,'Workers');
  const preferred={}; for(const a of prior.assignments||[]) if(a.workerId) preferred[a.slotId]=a.workerId;
  const inputSources=input.sourceEvidence===undefined||input.sourceEvidence===null
    ?{valid:true,refs:[]}:strictRefsResult(input.sourceEvidence,300,220);
  const priorSources=strictRefsResult(prior.sourceEvidence,300,220);
  if(!inputSources.valid||!priorSources.valid)
    throw new Error('sourceEvidence must contain valid dense references.');
  const repairSources=[];
  for(let i=0;i<inputSources.refs.length;i++) repairSources[repairSources.length]=inputSources.refs[i];
  for(let i=0;i<priorSources.refs.length;i++) repairSources[repairSources.length]=priorSources.refs[i];
  if(event?.evidenceRef!==undefined&&event?.evidenceRef!==null)
    repairSources[repairSources.length]=event.evidenceRef;
  const repaired=createSchedulingPlan({
    tenant:prior.tenant,contextRevision:text(input.contextRevision||prior.contextRevision,180),
    createdAt:input.createdAt||new Date().toISOString(),
    sourceEvidence:repairSources,
    workers,requirements:(input.requirements&&input.requirements.length)?input.requirements:prior.requirements,
    policy:input.policy||prior.policy,preferredAssignments:preferred
  });
  const before=new Map((prior.assignments||[]).map(a=>[a.slotId,a.workerId||null]));
  const changes=repaired.assignments.filter(a=>before.get(a.slotId)!==(a.workerId||null)).map(a=>({slotId:a.slotId,fromWorkerId:before.get(a.slotId)||null,toWorkerId:a.workerId||null}));
  return deepFreeze({contractVersion:CONTRACT_VERSION,repairType:type,
    repairId:digest({priorPlanId:prior.planId,event,repairedPlanId:repaired.planId}),
    priorPlanId:prior.planId,event,changeCount:changes.length,changes,repairedPlan:repaired,executionPermitted:false,
    claimBoundary:'SHADOW_REPAIR_ONLY_NO_PRODUCTION_MUTATION'});
}
function capabilityContract(){
  return {
    contractVersion:CONTRACT_VERSION,
    tableStakes:{
      demandForecastConsumption:true,skillsAndCertification:true,availability:true,minimumRestAndHours:true,
      overtimeLimitsAndCost:true,agencyAndContingentLabour:true,multiSiteEligibility:true,employeePreferences:true,
      fairnessSignals:true,fatigueSignals:true,openShiftEligibility:true,shiftSwapValidation:true,
      realTimeShadowRepair:true,explainableInfeasibility:true,independentScheduleValidation:true,scheduleQualityKpis:true
    },
    differentiation:{
      productionPriority:true,customerPriority:true,marginAtRisk:true,latePenalty:true,
      stablePublishedSchedulePenalty:true,decisionEpisodeCompatible:true,realtimeEventCompatible:true,autopilotAuthorityCompatible:true
    },
    notClaimed:[
      'production-autonomous-scheduling','global-labour-law-completeness','mathematical-optimality-for-large-instances',
      'forecast-model-accuracy-without-customer-data','payroll-closure-without-authoritative-payroll-reconciliation'
    ]
  };
}

module.exports=Object.freeze({
  CONTRACT_VERSION,SOLVER_VERSION,WORKER_TYPES,REPAIR_EVENTS,normalisePolicy,normaliseWorker,normaliseRequirement,
  evaluateWorkerForSlot,validateSchedule,createSchedulingPlan,evaluateOpenShift,evaluateSwap,repairSchedulingPlan,
  capabilityContract,stable,digest
});

