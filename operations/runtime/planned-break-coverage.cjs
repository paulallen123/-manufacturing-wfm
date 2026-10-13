'use strict';
const {isProxy}=require('node:util/types');
const {CONTRACT_VERSION,digest}=require('./manufacturing-scheduling-engine.cjs');
const VERSION='VECTOR_DECLARED_BREAK_COVERAGE_V1';
const id=v=>typeof v==='string'&&v.length>0&&v===v.trim();
function instant(v){
  if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v))throw Error('INVALID_TIME');
  const n=Date.parse(v),normal=v.length===20?v.slice(0,-1)+'.000Z':v;
  if(!Number.isFinite(n)||new Date(n).toISOString()!==normal)throw Error('INVALID_TIME');return n;
}
function snapshot(v,seen=new Set()){
  if(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))return v;
  if(typeof v!=='object'||isProxy(v)||seen.has(v))throw Error('INVALID_DATA');
  const array=Array.isArray(v),proto=Object.getPrototypeOf(v);
  if(array?proto!==Array.prototype:proto!==Object.prototype&&proto!==null)throw Error('INVALID_DATA');
  const ds=Object.getOwnPropertyDescriptors(v),out=array?[]:Object.create(null);seen.add(v);
  try{
    for(const key of Reflect.ownKeys(ds)){
      if(array&&key==='length')continue;
      const d=ds[key];
      if(typeof key!=='string'||!d.enumerable||!Object.hasOwn(d,'value')||
        array&&(!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=ds.length.value))throw Error('INVALID_DATA');
      Object.defineProperty(out,key,{value:snapshot(d.value,seen),enumerable:true});
    }
    if(array&&Object.keys(out).length!==ds.length.value)throw Error('INVALID_DATA');return Object.freeze(out);
  }finally{seen.delete(v);}
}
function result(status,details={}){
  const out={contractVersion:VERSION,status,executionPermitted:false,customerReady:false,
    claimBoundary:'DECLARED_STAFFING_ONLY_NOT_ASSIGNMENT_AUTHORITY',...details};
  function freeze(v){if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;}
  return freeze(out);
}
/** Pure advisory for an owner-authenticated canonical shadow plan plus declared
 * break receipts. Digests validate consistency, never source authentication.
 * Empty breaks means explicitly declared none; absence means unknown. This does
 * not validate break entitlement, skill truth, attendance, relief eligibility or
 * payroll, and cannot publish/change an assignment. */
function assessPlannedBreakCoverage(input={}){
  try{
    input=snapshot(input);
    if(!Object.hasOwn(input,'breaks'))return result('INCOMPLETE',{reason:'BREAK_DECLARATION_MISSING'});
    const {plan,breaks}=input;
    if(!plan||plan.contractVersion!==CONTRACT_VERSION||!id(plan.tenant)||!id(plan.contextRevision)||!id(plan.planId)||
      plan.mode!=='SHADOW'||plan.executionPermitted!==false||!Array.isArray(plan.requirements)||!plan.requirements.length||
      !Array.isArray(plan.assignments)||!Array.isArray(breaks)||!Array.isArray(plan.sourceEvidence)||!plan.sourceEvidence.length||
      !plan.sourceEvidence.every(id)||plan.validation?.valid!==true||!Array.isArray(plan.validation.violations)||plan.validation.violations.length)throw Error('INVALID_PLAN_OR_BREAKS');
    const identity={...plan};delete identity.planId;delete identity.createdAt;
    if(digest(identity)!==plan.planId)throw Error('PLAN_DIGEST_MISMATCH');
    const requirements=new Map(),assignments=new Map();
    for(const r of plan.requirements){
      if(!id(r.id)||!id(r.site)||!id(r.role)||requirements.has(r.id)||!Number.isSafeInteger(r.headcount)||r.headcount<0||r.headcount>100000||
        instant(r.start)>=instant(r.end))throw Error('INVALID_REQUIREMENT');
      requirements.set(r.id,r);
    }
    for(const a of plan.assignments){
      const r=requirements.get(a.requirementId);
      if(!r||!id(a.slotId)||assignments.has(a.slotId)||!(id(a.workerId)||a.workerId===null&&a.shortfall===true)||
        a.start!==r.start||a.end!==r.end||a.site!==r.site||a.role!==r.role||a.line!==r.line||a.workerId&&a.shortfall===true)throw Error('INVALID_ASSIGNMENT');
      assignments.set(a.slotId,a);
    }
    for(const r of requirements.values()){
      if([...assignments.values()].filter(a=>a.requirementId===r.id).length!==r.headcount)throw Error('INCOMPLETE_ASSIGNMENTS');
      for(let i=1;i<=r.headcount;i++)if(assignments.get(r.id+'#'+i)?.requirementId!==r.id)throw Error('INVALID_ASSIGNMENT');
    }
    const shifts=new Map();
    for(const a of assignments.values())if(a.workerId){
      if(!shifts.has(a.workerId))shifts.set(a.workerId,[]);shifts.get(a.workerId).push(a);
    }
    for(const workerShifts of shifts.values()){
      workerShifts.sort((a,b)=>instant(a.start)-instant(b.start));
      for(let i=1;i<workerShifts.length;i++)if(instant(workerShifts[i].start)<instant(workerShifts[i-1].end))throw Error('INVALID_ASSIGNMENT');
    }
    const byWorker=new Map(),receipts=new Map();
    for(const b of breaks){
      const a=assignments.get(b.slotId);
      if(!a||!id(b.workerId)||b.workerId!==a.workerId||b.tenant!==plan.tenant||b.contextRevision!==plan.contextRevision||
        b.planId!==plan.planId||b.site!==requirements.get(a.requirementId).site||!id(b.evidenceRef)||!id(b.revision)||instant(b.start)>=instant(b.end)||
        instant(b.start)<instant(a.start)||instant(b.end)>instant(a.end))throw Error('INVALID_BREAK_BINDING');
      const key=JSON.stringify([b.workerId,b.evidenceRef]),prior=receipts.get(key);
      if(prior&&digest(prior)!==digest(b))throw Error('CONFLICTING_BREAK_RECEIPT');
      if(prior)continue;receipts.set(key,b);
      if(!byWorker.has(b.workerId))byWorker.set(b.workerId,[]);byWorker.get(b.workerId).push(b);
    }
    const gaps=[];
    for(const r of requirements.values()){
      const assigned=[...assignments.values()].filter(a=>a.requirementId===r.id),edges=new Set([instant(r.start),instant(r.end)]);
      for(const a of assigned)for(const b of byWorker.get(a.workerId)||[]){
        if(instant(b.start)<instant(r.end)&&instant(b.end)>instant(r.start)){
          edges.add(Math.max(instant(b.start),instant(r.start)));edges.add(Math.min(instant(b.end),instant(r.end)));
        }
      }
      const points=[...edges].sort((a,b)=>a-b);
      for(let i=0;i<points.length-1;i++){
        const start=points[i],end=points[i+1],available=new Set();
        for(const a of assigned)if(a.workerId&&!(byWorker.get(a.workerId)||[]).some(b=>instant(b.start)<end&&instant(b.end)>start))available.add(a.workerId);
        if(available.size<r.headcount)gaps.push({requirementId:r.id,site:r.site,start:new Date(start).toISOString(),end:new Date(end).toISOString(),
          required:r.headcount,available:available.size,shortfall:r.headcount-available.size});
      }
    }
    return result(gaps.length?'DECLARED_COVERAGE_GAPS':'DECLARED_COVERAGE_COMPLETE_UNVERIFIED',{
      tenant:plan.tenant,contextRevision:plan.contextRevision,planId:plan.planId,breakReceiptCount:receipts.size,gaps});
  }catch(error){return result('REJECTED',{reason:['PLAN_DIGEST_MISMATCH','CONFLICTING_BREAK_RECEIPT','INCOMPLETE_ASSIGNMENTS','INVALID_REQUIREMENT','INVALID_ASSIGNMENT','INVALID_BREAK_BINDING','INVALID_TIME'].includes(error?.message)?error.message:'INVALID_PLAN_OR_BREAKS'});}
}
module.exports=Object.freeze({VERSION,assessPlannedBreakCoverage});
