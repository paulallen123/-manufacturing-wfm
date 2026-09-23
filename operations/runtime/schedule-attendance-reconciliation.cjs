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
  const byEmployee=new Map((payrollProjection.attendanceInputs||[]).map(x=>[String(x.employee),x]));const used=new Set(),rows=[];
  for(const a of (plan.assignments||[]).filter(x=>x.workerId)){
    const p=byEmployee.get(String(a.workerId));
    if(!p){rows.push({slotId:a.slotId,workerId:a.workerId,status:'MISSING_VERIFIED_ATTENDANCE',scheduledHours:Number(hours(a.start,a.end).toFixed(3)),actualHours:null,varianceHours:null,lateMinutes:null,earlyLeaveMinutes:null,overtimeCandidateHours:null});continue;}
    used.add(String(a.workerId));const scheduled=hours(a.start,a.end),actual=hours(p.inAt,p.outAt),late=Math.max(0,mins(a.start,p.inAt)),early=Math.max(0,mins(p.outAt,a.end)),variance=actual-scheduled;
    rows.push({slotId:a.slotId,workerId:a.workerId,status:'RECONCILED',scheduledHours:Number(scheduled.toFixed(3)),actualHours:Number(actual.toFixed(3)),varianceHours:Number(variance.toFixed(3)),lateMinutes:Number(late.toFixed(1)),earlyLeaveMinutes:Number(early.toFixed(1)),overtimeCandidateHours:Number(Math.max(0,variance).toFixed(3)),attendanceProvenance:p.provenance||null});
  }
  const unexpected=(payrollProjection.attendanceInputs||[]).filter(x=>!used.has(String(x.employee))).map(x=>({workerId:String(x.employee),inAt:x.inAt,outAt:x.outAt,provenance:x.provenance||null}));
  const scheduled=rows.length,reconciled=rows.filter(r=>r.status==='RECONCILED').length,coverage=scheduled?reconciled/scheduled*100:100;
  const blockers=[];if(rows.some(r=>r.status!=='RECONCILED'))blockers.push('SCHEDULE_ASSIGNMENT_WITHOUT_VERIFIED_ATTENDANCE');if(unexpected.length)blockers.push('UNEXPECTED_VERIFIED_ATTENDANCE');
  const out={...base,ready:blockers.length===0,blockers,rows,unexpectedAttendance:unexpected,quality:{scheduledAssignments:scheduled,reconciledAssignments:reconciled,coveragePct:Number(coverage.toFixed(2)),totalScheduledHours:Number(rows.reduce((s,r)=>s+(r.scheduledHours||0),0).toFixed(3)),totalActualHours:Number(rows.reduce((s,r)=>s+(r.actualHours||0),0).toFixed(3)),overtimeCandidateHours:Number(rows.reduce((s,r)=>s+(r.overtimeCandidateHours||0),0).toFixed(3))}};
  return Object.freeze({...out,reconciliationId:digest(out)});
}
module.exports={VERSION,reconcileScheduleToAttendance};
