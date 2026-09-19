import crypto from 'node:crypto';

const ID=/^[A-Za-z0-9_.:-]{1,160}$/;
const REVIEWABLE=new Set(['complete','missing_in','missing_out','evidence_pending','stale_open_session']);

function clone(x){ return JSON.parse(JSON.stringify(x)); }
function asId(v,name){ if(!ID.test(String(v||''))) throw Object.assign(new Error(`Invalid ${name}.`),{status:400}); return String(v); }
function asMs(v,name){ const n=typeof v==='number'?v:Date.parse(String(v||'')); if(!Number.isSafeInteger(n)||n<0) throw Object.assign(new Error(`Invalid ${name}.`),{status:400}); return n; }
function stable(value){
  if(value===null||typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
}
function digest(value){ return crypto.createHash('sha256').update(stable(value)).digest('hex'); }
function rowKey({tenant,site,shiftId,employee}){ return `${tenant}:${site}:${shiftId}:${employee}`; }

/**
 * AttendancePayrollGate
 *
 * Payroll safety boundary for invisible attendance. It never calculates pay or
 * mutates source evidence. It only emits verified attendance intervals as input
 * to downstream contractual payroll rules. Ambiguous/unverified attendance is
 * excluded until an explicit, auditable manager correction resolves it.
 */
export class AttendancePayrollGate {
  constructor({coverage,certifier}={}){
    if(!coverage?.evaluateShift) throw new Error('AttendanceCoverageAssurance required.');
    if(!certifier?.certifyShift) throw new Error('AttendanceClaimCertifier required.');
    this.coverage=coverage;
    this.certifier=certifier;
    this.reviews=[];
    this.reviewById=new Map();
    this.latestByWorkerShift=new Map();
  }

  recordCorrection({tenant,site,shiftId,employee,reviewId,actorId,reasonCode,correctedInAt,correctedOutAt,reviewedAt=Date.now(),supersedesReviewId=null}={}){
    tenant=asId(tenant,'tenant'); site=asId(site,'site'); shiftId=asId(shiftId,'shift'); employee=asId(employee,'employee');
    reviewId=asId(reviewId,'review ID'); actorId=asId(actorId,'actor'); reasonCode=asId(reasonCode,'reason code'); reviewedAt=asMs(reviewedAt,'review time');
    const inMs=asMs(correctedInAt,'corrected IN'); const outMs=asMs(correctedOutAt,'corrected OUT');
    if(outMs<=inMs) throw Object.assign(new Error('Corrected OUT must be after corrected IN.'),{status:400});

    const reviewScopeKey=`${tenant}:${reviewId}`;
    const priorById=this.reviewById.get(reviewScopeKey);
    const proposed={tenant,site,shiftId,employee,reviewId,actorId,reasonCode,inMs,outMs,reviewedAt,supersedesReviewId:supersedesReviewId?asId(supersedesReviewId,'superseded review ID'):null};
    const proposedDigest=digest(proposed);
    if(priorById){
      if(priorById.contentDigest!==proposedDigest) throw Object.assign(new Error('Review ID reused for different correction content.'),{status:409});
      return {...clone(priorById),replayed:true};
    }

    const evaluation=this.coverage.evaluateShift({tenant,site,shiftId,nowMs:reviewedAt});
    const current=evaluation.rows.find(r=>r.employee===employee);
    if(!current) throw Object.assign(new Error('Employee is not assigned to this shift.'),{status:403});
    if(!REVIEWABLE.has(current.status)) throw Object.assign(new Error(`Attendance status ${current.status} cannot be corrected through the payroll attendance review path.`),{status:409});

    const k=rowKey({tenant,site,shiftId,employee});
    const latest=this.latestByWorkerShift.get(k)||null;
    if(latest && proposed.supersedesReviewId!==latest.reviewId) throw Object.assign(new Error('Correction must explicitly supersede the latest review.'),{status:409});
    if(!latest && proposed.supersedesReviewId) throw Object.assign(new Error('Superseded review does not exist for this worker shift.'),{status:409});

    const previousAuditHash=this.reviews.length?this.reviews.at(-1).auditHash:null;
    const body={...proposed,originalStatus:current.status,previousAuditHash};
    const entry={...body,contentDigest:proposedDigest,auditHash:digest(body)};
    this.reviews.push(entry);
    this.reviewById.set(reviewScopeKey,entry);
    this.latestByWorkerShift.set(k,entry);
    return {...clone(entry),replayed:false};
  }

  projectShift({tenant,site,shiftId,nowMs=Date.now(),expectedSourceIds=[],sourceHealth=[],shiftWindowClosed=false}={}){
    tenant=asId(tenant,'tenant'); site=asId(site,'site'); shiftId=asId(shiftId,'shift');
    if(!Number.isSafeInteger(nowMs)||nowMs<0) throw new Error('Valid nowMs required.');
    const evaluation=this.coverage.evaluateShift({tenant,site,shiftId,nowMs});
    const certification=this.certifier.certifyShift({tenant,site,shiftId,nowMs,expectedSourceIds,sourceHealth});
    const sourcePeriodVerified=certification?.certification?.sourceContinuityPeriod===true;
    const afterClose=evaluation.payrollReady===true || shiftWindowClosed===true;

    const rows=evaluation.rows.map(row=>{
      const latest=this.latestByWorkerShift.get(rowKey({tenant,site,shiftId,employee:row.employee}))||null;
      if(latest){
        return {
          employee:row.employee,workerType:row.workerType,status:'reviewed_correction',eligibleForPayrollInput:true,
          interval:{inAt:new Date(latest.inMs).toISOString(),outAt:new Date(latest.outMs).toISOString()},
          provenance:{basis:'manager_correction',reviewId:latest.reviewId,actorId:latest.actorId,reasonCode:latest.reasonCode,auditHash:latest.auditHash},
          originalAttendanceStatus:latest.originalStatus
        };
      }
      if(row.status==='complete'&&sourcePeriodVerified){
        return {
          employee:row.employee,workerType:row.workerType,status:'verified_attendance',eligibleForPayrollInput:true,
          interval:{inAt:row.openAt,outAt:row.closeAt},provenance:{basis:'automatic_evidence'},originalAttendanceStatus:row.status
        };
      }
      if(row.status==='excused'){
        return {employee:row.employee,workerType:row.workerType,status:'policy_input_only',eligibleForPayrollInput:false,interval:null,provenance:{basis:'approved_absence',reasonCode:row.reasonCode},originalAttendanceStatus:row.status};
      }
      return {employee:row.employee,workerType:row.workerType,status:'review_required',eligibleForPayrollInput:false,interval:null,provenance:{basis:sourcePeriodVerified?'unverified_attendance':'source_continuity_not_verified'},originalAttendanceStatus:row.status};
    });

    const unresolved=rows.filter(r=>r.status==='review_required');
    const externalExceptions=(evaluation.unexpectedCount||0)+(evaluation.unmappedSignalCount||0);
    const payrollReady=afterClose&&unresolved.length===0&&externalExceptions===0;
    const candidateAttendanceInputs=rows.filter(r=>r.eligibleForPayrollInput).map(r=>({
      tenant,site,shiftId,employee:r.employee,workerType:r.workerType,inAt:r.interval.inAt,outAt:r.interval.outAt,
      provenance:clone(r.provenance)
    }));
    // Fail closed at the export boundary. Row-level verified/corrected intervals remain
    // reviewable above, but no downstream attendance input is emitted until the entire
    // shift-level payroll gate is ready. This prevents a caller from accidentally
    // consuming a partial or pre-close export while ignoring payrollReady=false.
    const attendanceInputs=payrollReady?candidateAttendanceInputs:[];

    return clone({
      tenant,site,shiftId,payrollReady,afterClose,
      attendanceInputs,
      policyInputs:rows.filter(r=>r.status==='policy_input_only'),
      reviewRequired:unresolved,
      unexpectedCount:evaluation.unexpectedCount||0,unmappedSignalCount:evaluation.unmappedSignalCount||0,
      manualReviewCount:rows.filter(r=>r.status==='reviewed_correction').length,
      certification:{claimLevel:certification.claimLevel,claim:certification.claim,verifiedPeriodCertified:certification?.certification?.verifiedPeriodCertified===true,sourceContinuityPeriod:sourcePeriodVerified},
      rows
    });
  }

  auditTrail({tenant,site,shiftId,employee}={}){
    const filters={tenant,site,shiftId,employee};
    for(const [k,v] of Object.entries(filters)) if(v!==undefined) filters[k]=asId(v,k);
    return clone(this.reviews.filter(r=>Object.entries(filters).every(([k,v])=>v===undefined||r[k]===v)));
  }

  verifyAuditChain(){
    let previous=null;
    for(const r of this.reviews){
      if(r.previousAuditHash!==previous) return false;
      const {auditHash,contentDigest,...body}=r;
      if(digest(body)!==auditHash) return false;
      previous=auditHash;
    }
    return true;
  }
}
