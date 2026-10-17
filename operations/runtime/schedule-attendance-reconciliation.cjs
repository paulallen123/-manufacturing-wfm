'use strict';
const {createHash}=require('node:crypto');
const {types:{isProxy}}=require('node:util');
const VERSION='VECTOR_SCHEDULE_ATTENDANCE_RECONCILIATION_V1';
const MAX_ITEMS=100000;
function writeIndex(array,index,value){Object.defineProperty(array,String(index),{value,writable:true,enumerable:true,configurable:true});}
function append(array,value){writeIndex(array,array.length,value);}
function sorted(values,compare){
  let source=[];
  for(let i=0;i<values.length;i++)writeIndex(source,i,values[i]);
  for(let width=1;width<source.length;width*=2){
    const target=new Array(source.length);
    for(let start=0;start<source.length;start+=2*width){
      let left=start,right=Math.min(start+width,source.length),at=start;
      const leftEnd=right,rightEnd=Math.min(start+2*width,source.length);
      while(left<leftEnd&&right<rightEnd)writeIndex(target,at++,compare(source[left],source[right])<=0?source[left++]:source[right++]);
      while(left<leftEnd)writeIndex(target,at++,source[left++]);
      while(right<rightEnd)writeIndex(target,at++,source[right++]);
    }
    source=target;
  }
  return source;
}
function snapshot(value,label,seen=new WeakSet(),depth=0){
  if(value===null||typeof value==='string'||typeof value==='number'||typeof value==='boolean'||value===undefined)return value;
  if(typeof value!=='object'||isProxy(value)||depth>24||seen.has(value))throw new Error('Invalid '+label+' value.');
  seen.add(value);
  let copy;
  if(Array.isArray(value)){
    if(Object.getPrototypeOf(value)!==Array.prototype||value.length>MAX_ITEMS)throw new Error('Invalid '+label+' array.');
    const keys=Reflect.ownKeys(value);
    if(keys.length!==value.length+1)throw new Error('Invalid '+label+' array properties.');
    copy=new Array(value.length);
    for(let i=0;i<value.length;i++){
      const property=Object.getOwnPropertyDescriptor(value,String(i));
      if(!property||!Object.hasOwn(property,'value'))throw new Error('Invalid '+label+' array index.');
      writeIndex(copy,i,snapshot(property.value,label,seen,depth+1));
    }
  }else{
    const prototype=Object.getPrototypeOf(value);
    if(prototype!==Object.prototype&&prototype!==null)throw new Error('Invalid '+label+' object.');
    const keys=Reflect.ownKeys(value);
    if(keys.length>MAX_ITEMS)throw new Error('Invalid '+label+' object size.');
    copy=Object.create(null);
    for(let i=0;i<keys.length;i++){
      const key=keys[i],property=Object.getOwnPropertyDescriptor(value,key);
      if(typeof key!=='string'||!property||!Object.hasOwn(property,'value'))throw new Error('Invalid '+label+' object property.');
      copy[key]=snapshot(property.value,label,seen,depth+1);
    }
  }
  seen.delete(value);
  return copy;
}
function ownValue(value,key,label){
  if(isProxy(value))throw new Error('Invalid '+label+' proxy.');
  const property=value&&Object.getOwnPropertyDescriptor(value,key);
  if(property&&!Object.hasOwn(property,'value'))throw new Error('Invalid '+label+' property.');
  return property?.value;
}
function stable(value){
  if(Array.isArray(value)){
    let result='[';
    for(let i=0;i<value.length;i++)result+=(i?',':'')+stable(value[i]);
    return result+']';
  }
  if(value&&typeof value==='object'){
    const keys=sorted(Reflect.ownKeys(value),(a,b)=>a<b?-1:a>b?1:0);
    let result='{';
    for(let i=0;i<keys.length;i++)result+=(i?',':'')+JSON.stringify(keys[i])+':'+stable(value[keys[i]]);
    return result+'}';
  }
  return JSON.stringify(value);
}
function digest(v){return createHash('sha256').update(stable(v)).digest('hex');}
function deepFreeze(value){
  if(value&&typeof value==='object'){
    const keys=Reflect.ownKeys(value);
    for(let i=0;i<keys.length;i++)deepFreeze(Object.getOwnPropertyDescriptor(value,keys[i]).value);
    Object.freeze(value);
  }
  return value;
}
function receipt(out){deepFreeze(out);return Object.freeze({...out,reconciliationId:digest(out)});}
function ms(v){const n=Date.parse(v);return Number.isFinite(n)?n:null;}
function hours(a,b){return Math.max(0,(ms(b)-ms(a))/3600000);}
function mins(a,b){return (ms(b)-ms(a))/60000;}
function reconcileScheduleToAttendance({plan,payrollProjection}={}){
  if(!plan||ownValue(plan,'contractVersion','plan')!=='VECTOR_MANUFACTURING_SCHEDULER_V1')throw new Error('Valid VECTOR scheduling plan required.');
  if(!payrollProjection||typeof payrollProjection!=='object')throw new Error('Attendance payroll projection required.');
  const rawAssignments=ownValue(plan,'assignments','plan');
  const allAssignments=snapshot(rawAssignments,'assignments');
  if(!Array.isArray(allAssignments))throw new Error('Valid assignments array required.');
  const assignments=[];
  for(let i=0;i<allAssignments.length;i++){
    const assignment=allAssignments[i];
    if(!assignment||typeof assignment!=='object'||Array.isArray(assignment))throw new Error('Valid assignment required.');
    if(assignment.workerId)append(assignments,assignment);
  }
  const base={version:VERSION,tenant:snapshot(ownValue(plan,'tenant','plan'),'tenant'),planId:snapshot(ownValue(plan,'planId','plan'),'planId'),payrollAuthority:false,payCalculationPerformed:false,claimBoundary:'RECONCILIATION_ONLY_PAY_RULES_REMAIN_DOWNSTREAM'};
  if(ownValue(payrollProjection,'payrollReady','payroll projection')!==true){const out={...base,ready:false,blockers:['ATTENDANCE_PAYROLL_GATE_NOT_READY'],rows:[],unexpectedAttendance:[],quality:{scheduledAssignments:assignments.length,reconciledAssignments:0,coveragePct:0}};return receipt(out);}
  const rawAttendance=ownValue(payrollProjection,'attendanceInputs','payroll projection');
  const attendance=snapshot(rawAttendance,'attendance');
  if(!Array.isArray(attendance))throw new Error('Valid attendance array required.');
  const orderedAssignments=sorted(assignments,(a,b)=>ms(a.start)-ms(b.start)||ms(a.end)-ms(b.end)||String(a.slotId).localeCompare(String(b.slotId)));
  const byEmployee=Object.create(null),uniqueByIdentity=Object.create(null),uniqueEvidence=[];
  for(let index=0;index<attendance.length;index++){
    const entry=attendance[index];
    if(!entry||typeof entry!=='object'||Array.isArray(entry))throw new Error('Valid attendance entry required.');
    const identity=stable([String(entry.employee),ms(entry.inAt)??entry.inAt,ms(entry.outAt)??entry.outAt]);
    const position=uniqueByIdentity[identity];
    if(position!==undefined){
      if(stable(uniqueEvidence[position].entry)>stable(entry))writeIndex(uniqueEvidence,position,{entry,index,identity});
      continue;
    }
    uniqueByIdentity[identity]=uniqueEvidence.length;
    append(uniqueEvidence,{entry,index,identity});
  }
  for(let i=0;i<uniqueEvidence.length;i++){
    const {entry,index,identity}=uniqueEvidence[i];
    const worker=String(entry.employee);
    if(byEmployee[worker]===undefined)byEmployee[worker]=[];
    append(byEmployee[worker],{entry,index,identity});
  }
  const candidates=[];
  for(let i=0;i<orderedAssignments.length;i++){
    const a=orderedAssignments[i],pool=byEmployee[String(a.workerId)]||[],matches=[];
    for(let j=0;j<pool.length;j++){
      const entry=pool[j].entry;
      if(Number.isFinite(ms(entry.inAt))&&Number.isFinite(ms(entry.outAt))&&ms(entry.outAt)>ms(entry.inAt)&&ms(a.start)<ms(entry.outAt)&&ms(entry.inAt)<ms(a.end))append(matches,pool[j]);
    }
    append(candidates,sorted(matches,(x,y)=>Math.abs(ms(a.start)-ms(x.entry.inAt))+Math.abs(ms(a.end)-ms(x.entry.outAt))-
      Math.abs(ms(a.start)-ms(y.entry.inAt))-Math.abs(ms(a.end)-ms(y.entry.outAt))||x.identity.localeCompare(y.identity)));
  }
  const ownerByEvidence=[];
  for(let i=0;i<attendance.length;i++)writeIndex(ownerByEvidence,i,-1);
  function assign(assignmentIndex,visited){
    const options=candidates[assignmentIndex];
    for(let i=0;i<options.length;i++){
      const evidence=options[i];
      if(visited[evidence.index])continue;
      visited[evidence.index]=true;
      const current=ownerByEvidence[evidence.index];
      if(current<0||assign(current,visited)){
        writeIndex(ownerByEvidence,evidence.index,assignmentIndex);
        return true;
      }
    }
    return false;
  }
  for(let i=0;i<orderedAssignments.length;i++){
    assign(i,Object.create(null));
  }
  const matchByAssignment=[],rows=[];
  for(let i=0;i<orderedAssignments.length;i++)writeIndex(matchByAssignment,i,null);
  for(let evidenceIndex=0;evidenceIndex<ownerByEvidence.length;evidenceIndex++){
    const assignmentIndex=ownerByEvidence[evidenceIndex];
    if(assignmentIndex>=0)writeIndex(matchByAssignment,assignmentIndex,attendance[evidenceIndex]);
  }
  let reconciled=0,totalScheduled=0,totalActual=0,totalOvertime=0;
  for(let i=0;i<orderedAssignments.length;i++){
    const a=orderedAssignments[i],p=matchByAssignment[i],scheduled=hours(a.start,a.end);
    totalScheduled+=Number(scheduled.toFixed(3));
    if(!p){append(rows,{slotId:a.slotId,workerId:a.workerId,status:'MISSING_VERIFIED_ATTENDANCE',scheduledHours:Number(scheduled.toFixed(3)),actualHours:null,varianceHours:null,lateMinutes:null,earlyLeaveMinutes:null,overtimeCandidateHours:null});continue;}
    const actual=hours(p.inAt,p.outAt),late=Math.max(0,mins(a.start,p.inAt)),early=Math.max(0,mins(p.outAt,a.end)),variance=actual-scheduled,overtime=Number(Math.max(0,variance).toFixed(3));
    append(rows,{slotId:a.slotId,workerId:a.workerId,status:'RECONCILED',scheduledHours:Number(scheduled.toFixed(3)),actualHours:Number(actual.toFixed(3)),varianceHours:Number(variance.toFixed(3)),lateMinutes:Number(late.toFixed(1)),earlyLeaveMinutes:Number(early.toFixed(1)),overtimeCandidateHours:overtime,attendanceProvenance:p.provenance||null});
    reconciled++;totalActual+=Number(actual.toFixed(3));totalOvertime+=overtime;
  }
  const unexpected=[];
  for(let i=0;i<attendance.length;i++)if(ownerByEvidence[i]<0){
    const entry=attendance[i];
    append(unexpected,{workerId:String(entry.employee),inAt:entry.inAt,outAt:entry.outAt,provenance:entry.provenance||null});
  }
  const orderedUnexpected=sorted(unexpected,(a,b)=>stable(a).localeCompare(stable(b)));
  const scheduled=rows.length,coverage=scheduled?reconciled/scheduled*100:100,blockers=[];
  if(reconciled!==scheduled)append(blockers,'SCHEDULE_ASSIGNMENT_WITHOUT_VERIFIED_ATTENDANCE');
  if(orderedUnexpected.length)append(blockers,'UNEXPECTED_VERIFIED_ATTENDANCE');
  const out={...base,ready:blockers.length===0,blockers,rows,unexpectedAttendance:orderedUnexpected,quality:{scheduledAssignments:scheduled,reconciledAssignments:reconciled,coveragePct:Number(coverage.toFixed(2)),totalScheduledHours:Number(totalScheduled.toFixed(3)),totalActualHours:Number(totalActual.toFixed(3)),overtimeCandidateHours:Number(totalOvertime.toFixed(3))}};
  return receipt(out);
}
module.exports={VERSION,reconcileScheduleToAttendance};
