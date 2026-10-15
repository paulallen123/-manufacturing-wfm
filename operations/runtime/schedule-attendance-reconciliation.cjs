'use strict';
const {createHash}=require('node:crypto');
const VERSION='VECTOR_SCHEDULE_ATTENDANCE_RECONCILIATION_V1';
function stable(v){if(Array.isArray(v))return '['+v.map(stable).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';return JSON.stringify(v);}
function digest(v){return createHash('sha256').update(stable(v)).digest('hex');}
function ms(v){const n=Date.parse(v);return Number.isFinite(n)?n:null;}
function hours(a,b){return Math.max(0,(ms(b)-ms(a))/3600000);}
function mins(a,b){return (ms(b)-ms(a))/60000;}
function reconcileScheduleToAttendance({plan,payrollProjection}={}){
  if(!plan||plan.contractVersion!=='VECTOR_MANUFACTURING_SCHEDULER_V1')throw new Error('Valid VECTOR scheduling plan required.');
  if(!payrollProjection||typeof payrollProjection!=='object')throw new Error('Attendance payroll projection required.');
  const base={version:VERSION,tenant:plan.tenant,planId:plan.planId,payrollAuthority:false,payCalculationPerformed:false,claimBoundary:'RECONCILIATION_ONLY_PAY_RULES_REMAIN_DOWNSTREAM'};
  if(payrollProjection.payrollReady!==true){const out={...base,ready:false,blockers:['ATTENDANCE_PAYROLL_GATE_NOT_READY'],rows:[],unexpectedAttendance:[],quality:{scheduledAssignments:(plan.assignments||[]).filter(a=>a.workerId).length,reconciledAssignments:0,coveragePct:0}};return Object.freeze({...out,reconciliationId:digest(out)});}
  const attendance=payrollProjection.attendanceInputs||[];
  const assignments=(plan.assignments||[]).filter(x=>x.workerId).sort((a,b)=>
    ms(a.start)-ms(b.start)||ms(a.end)-ms(b.end)||String(a.slotId).localeCompare(String(b.slotId)));
  const byEmployee=new Map(),uniqueEvidence=new Map();
  attendance.forEach((entry,index)=>{
    const identity=stable([String(entry.employee),ms(entry.inAt)??entry.inAt,ms(entry.outAt)??entry.outAt]);
    const previous=uniqueEvidence.get(identity);
    if(previous&&stable(previous.entry)<=stable(entry))return;
    uniqueEvidence.set(identity,{entry,index,identity});
  });
  for(const {entry,index,identity} of uniqueEvidence.values()){
    const worker=String(entry.employee);
    if(!byEmployee.has(worker))byEmployee.set(worker,[]);
    byEmployee.get(worker).push({entry,index,identity});
  }
  const candidates=assignments.map(a=>(byEmployee.get(String(a.workerId))||[]).filter(({entry})=>
    Number.isFinite(ms(entry.inAt))&&Number.isFinite(ms(entry.outAt))&&
    ms(entry.outAt)>ms(entry.inAt)&&ms(a.start)<ms(entry.outAt)&&ms(entry.inAt)<ms(a.end))
    .sort((x,y)=>Math.abs(ms(a.start)-ms(x.entry.inAt))+Math.abs(ms(a.end)-ms(x.entry.outAt))-
      Math.abs(ms(a.start)-ms(y.entry.inAt))-Math.abs(ms(a.end)-ms(y.entry.outAt))||x.identity.localeCompare(y.identity)));
  const ownerByEvidence=new Map();
  function assign(assignmentIndex,visited){
    for(const evidence of candidates[assignmentIndex]){
      if(visited.has(evidence.index))continue;
      visited.add(evidence.index);
      const current=ownerByEvidence.get(evidence.index);
      if(current===undefined||assign(current,visited)){
        ownerByEvidence.set(evidence.index,assignmentIndex);
        return true;
      }
    }
    return false;
  }
  assignments.forEach((_,index)=>assign(index,new Set()));
  const matchByAssignment=new Map(),used=new Set(),rows=[];
  for(const [evidenceIndex,assignmentIndex] of ownerByEvidence){
    used.add(evidenceIndex);
    matchByAssignment.set(assignmentIndex,attendance[evidenceIndex]);
  }
  for(const [assignmentIndex,a] of assignments.entries()){
    const p=matchByAssignment.get(assignmentIndex);
    if(!p){rows.push({slotId:a.slotId,workerId:a.workerId,status:'MISSING_VERIFIED_ATTENDANCE',scheduledHours:Number(hours(a.start,a.end).toFixed(3)),actualHours:null,varianceHours:null,lateMinutes:null,earlyLeaveMinutes:null,overtimeCandidateHours:null});continue;}
    const scheduled=hours(a.start,a.end),actual=hours(p.inAt,p.outAt),late=Math.max(0,mins(a.start,p.inAt)),early=Math.max(0,mins(p.outAt,a.end)),variance=actual-scheduled;
    rows.push({slotId:a.slotId,workerId:a.workerId,status:'RECONCILED',scheduledHours:Number(scheduled.toFixed(3)),actualHours:Number(actual.toFixed(3)),varianceHours:Number(variance.toFixed(3)),lateMinutes:Number(late.toFixed(1)),earlyLeaveMinutes:Number(early.toFixed(1)),overtimeCandidateHours:Number(Math.max(0,variance).toFixed(3)),attendanceProvenance:p.provenance||null});
  }
  const unexpected=attendance.filter((x,index)=>!used.has(index)).map(x=>({workerId:String(x.employee),inAt:x.inAt,outAt:x.outAt,provenance:x.provenance||null})).sort((a,b)=>stable(a).localeCompare(stable(b)));
  const scheduled=rows.length,reconciled=rows.filter(r=>r.status==='RECONCILED').length,coverage=scheduled?reconciled/scheduled*100:100;
  const blockers=[];if(rows.some(r=>r.status!=='RECONCILED'))blockers.push('SCHEDULE_ASSIGNMENT_WITHOUT_VERIFIED_ATTENDANCE');if(unexpected.length)blockers.push('UNEXPECTED_VERIFIED_ATTENDANCE');
  const out={...base,ready:blockers.length===0,blockers,rows,unexpectedAttendance:unexpected,quality:{scheduledAssignments:scheduled,reconciledAssignments:reconciled,coveragePct:Number(coverage.toFixed(2)),totalScheduledHours:Number(rows.reduce((s,r)=>s+(r.scheduledHours||0),0).toFixed(3)),totalActualHours:Number(rows.reduce((s,r)=>s+(r.actualHours||0),0).toFixed(3)),overtimeCandidateHours:Number(rows.reduce((s,r)=>s+(r.overtimeCandidateHours||0),0).toFixed(3))}};
  return Object.freeze({...out,reconciliationId:digest(out)});
}
module.exports={VERSION,reconcileScheduleToAttendance};
