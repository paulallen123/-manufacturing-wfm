function clone(x){ return JSON.parse(JSON.stringify(x)); }
function key(...parts){ return JSON.stringify(parts.map(part=>String(part))); }
function asMs(v,name){ const n=typeof v==='number'?v:Date.parse(String(v||'')); if(!Number.isFinite(n)) throw new Error(`Invalid ${name}.`); return n; }
function id(v,name){ if(!/^[A-Za-z0-9_.:-]{1,160}$/.test(String(v||''))) throw new Error(`Invalid ${name}.`); return String(v); }

const ROUTE_ROLES=new Set(['authoritative','anchor_in','departure_anchor','corroborator']);
const FALLBACKS=new Set(['manager_exception','payroll_review',null]);

/**
 * AttendanceCoverageAssurance
 *
 * Guarantees accountability for every scheduled worker without fabricating
 * attendance. It reconciles the roster against authoritative attendance state,
 * partial evidence, excused absence, unscheduled mapped presence and unmapped
 * person-bound signals. Missing evidence is an explicit exception, never silence.
 */
export class AttendanceCoverageAssurance {
  constructor({engine,startGraceMs=5*60_000,endGraceMs=5*60_000,earlyEvidenceWindowMs=2*60*60_000}={}){
    if(!engine) throw new Error('Attendance engine required.');
    for(const [name,value] of Object.entries({startGraceMs,endGraceMs,earlyEvidenceWindowMs})){
      if(typeof value!=='number'||!Number.isFinite(value)||value<0) throw new Error(`Invalid ${name}: finite non-negative milliseconds required.`);
    }
    this.engine=engine;
    this.startGraceMs=startGraceMs;
    this.endGraceMs=endGraceMs;
    this.earlyEvidenceWindowMs=earlyEvidenceWindowMs;
    this.shifts=new Map();
    this.plans=new Map();
    this.excuses=new Map();
    this.observations=[];
    this.unmapped=[];
  }

  registerShift({tenant,site,shiftId,startAt,endAt,assignments=[]}){
    tenant=id(tenant,'tenant'); site=id(site,'site'); shiftId=id(shiftId,'shift');
    const startMs=asMs(startAt,'shift start'), endMs=asMs(endAt,'shift end');
    if(endMs<=startMs) throw new Error('Shift end must be after start.');
    if(!Array.isArray(assignments)||!assignments.length) throw new Error('Shift assignments required.');
    const seen=new Set();
    const clean=assignments.map(a=>{
      const employee=id(a?.employee,'employee');
      if(seen.has(employee)) throw new Error(`Duplicate shift assignment for ${employee}.`);
      seen.add(employee);
      return {employee,workerType:id(a?.workerType||'employee','worker type')};
    });
    const row={tenant,site,shiftId,startMs,endMs,assignments:clean};
    this.shifts.set(key(tenant,site,shiftId),row);
    return clone({...row,startAt:new Date(startMs).toISOString(),endAt:new Date(endMs).toISOString()});
  }

  setCoveragePlan({tenant,site,employee,routes=[],fallback=null}){
    tenant=id(tenant,'tenant'); site=id(site,'site'); employee=id(employee,'employee');
    if(!Array.isArray(routes)) throw new Error('Coverage routes must be an array.');
    if(!FALLBACKS.has(fallback)) throw new Error('Unsupported coverage fallback.');
    const clean=routes.map(r=>{
      const domain=id(r?.domain,'coverage domain');
      const sourceId=id(r?.sourceId,'coverage source');
      const role=String(r?.role||'corroborator');
      if(!ROUTE_ROLES.has(role)) throw new Error('Unsupported coverage route role.');
      return {domain,sourceId,role,active:r?.active!==false};
    });
    this.plans.set(key(tenant,site,employee),{tenant,site,employee,routes:clean,fallback});
  }

  recordExcuse({tenant,site,shiftId,employee,kind='approved_absence',reasonCode='APPROVED'}){
    const sk=key(id(tenant,'tenant'),id(site,'site'),id(shiftId,'shift'));
    const shift=this.shifts.get(sk); if(!shift) throw new Error('Shift not found.');
    employee=id(employee,'employee');
    if(!shift.assignments.some(a=>a.employee===employee)) throw new Error('Employee is not assigned to this shift.');
    this.excuses.set(key(sk,employee),{kind:id(kind,'excuse kind'),reasonCode:id(reasonCode,'reason code')});
  }

  observeMapped({tenant,site,employee,at,sourceId}){
    this.observations.push({tenant:id(tenant,'tenant'),site:id(site,'site'),employee:id(employee,'employee'),sourceId:id(sourceId,'source'),at:asMs(at,'observation time')});
  }

  observeUnmapped({tenant,site,sourceId,eventId,at}){
    this.unmapped.push({tenant:id(tenant,'tenant'),site:id(site,'site'),sourceId:id(sourceId,'source'),eventId:id(eventId,'event'),at:asMs(at,'observation time')});
  }

  preflight({tenant,site,shiftId}){
    const shift=this.#shift(tenant,site,shiftId);
    const rows=shift.assignments.map(a=>{
      const plan=this.plans.get(key(shift.tenant,shift.site,a.employee)) ?? {routes:[],fallback:null};
      const routes=plan.routes.filter(r=>r.active);
      const domains=new Set(routes.map(r=>r.domain));
      const sourceIds=[...new Set(routes.map(r=>r.sourceId))].sort();
      const authoritative=routes.some(r=>r.role==='authoritative');
      const independent=domains.size>=2&&sourceIds.length>=2;
      const inReady=authoritative || (routes.some(r=>r.role==='anchor_in') && independent);
      const outReady=authoritative || (routes.some(r=>r.role==='departure_anchor') && independent);
      const automaticReady=inReady&&outReady;
      return {employee:a.employee,workerType:a.workerType,automaticReady,inReady,outReady,fallback:plan.fallback,accountabilityReady:automaticReady||Boolean(plan.fallback),domains:[...domains].sort(),sourceIds};
    });
    const automatic=rows.filter(r=>r.automaticReady).length;
    const accountable=rows.filter(r=>r.accountabilityReady).length;
    return {
      shiftId:shift.shiftId,total:rows.length,
      automaticReady:automatic,automaticCoveragePct:(automatic/rows.length)*100,
      accountabilityReady:accountable,accountabilityCoveragePct:(accountable/rows.length)*100,
      releaseTargetMet:automatic===rows.length,
      operationalAccountabilityReady:accountable===rows.length,
      uncovered:rows.filter(r=>!r.accountabilityReady).map(r=>r.employee),
      partial:rows.filter(r=>r.accountabilityReady&&!r.automaticReady).map(r=>r.employee),
      rows
    };
  }

  evaluateShift({tenant,site,shiftId,nowMs=Date.now()}){
    const shift=this.#shift(tenant,site,shiftId);
    const scheduled=new Set(shift.assignments.map(a=>a.employee));
    const rows=shift.assignments.map(a=>this.#evaluatePerson(shift,a,nowMs));
    const unexpected=this.observations
      .filter(o=>o.tenant===shift.tenant&&o.site===shift.site&&o.at>=shift.startMs-this.earlyEvidenceWindowMs&&o.at<=shift.endMs+this.endGraceMs&&!scheduled.has(o.employee))
      .map(o=>({employee:o.employee,sourceId:o.sourceId,observedAt:new Date(o.at).toISOString(),status:'unscheduled_presence'}));
    const unmapped=this.unmapped
      .filter(o=>o.tenant===shift.tenant&&o.site===shift.site&&o.at>=shift.startMs-this.earlyEvidenceWindowMs&&o.at<=shift.endMs+this.endGraceMs)
      .map(o=>({sourceId:o.sourceId,eventId:o.eventId,observedAt:new Date(o.at).toISOString(),status:'unmapped_person_signal'}));
    const unresolvedRows=rows.filter(r=>['missing_in','missing_out','evidence_pending','stale_open_session'].includes(r.status));
    const afterClose=nowMs>shift.endMs+this.endGraceMs;
    const payrollReady=afterClose && unresolvedRows.length===0 && unexpected.length===0 && unmapped.length===0 && rows.every(r=>['complete','excused'].includes(r.status));
    return {
      shiftId:shift.shiftId,site:shift.site,totalScheduled:rows.length,
      accounted:rows.filter(r=>!['missing_in','missing_out','evidence_pending','stale_open_session'].includes(r.status)).length,
      unresolved:unresolvedRows.length,
      unexpectedCount:unexpected.length,unmappedSignalCount:unmapped.length,
      afterClose,payrollReady,rows,unexpected,unmapped
    };
  }

  #evaluatePerson(shift,assignment,nowMs){
    const employee=assignment.employee;
    const excuse=this.excuses.get(key(key(shift.tenant,shift.site,shift.shiftId),employee));
    if(excuse) return {employee,workerType:assignment.workerType,status:'excused',reasonCode:excuse.reasonCode};

    const state=this.engine.getState({tenant:shift.tenant,employee,site:shift.site});
    const evidence=(this.engine.getEvidence({tenant:shift.tenant,employee,site:shift.site})||[])
      .filter(e=>{
        const at=Date.parse(e.observedAt);
        return Number.isFinite(at)&&at>=shift.startMs-this.earlyEvidenceWindowMs&&at<=Math.min(nowMs,shift.endMs+this.endGraceMs);
      });
    const openAt=Number.isFinite(state.openAt)?state.openAt:(state.openAt?Date.parse(state.openAt):null);
    const closeAt=Number.isFinite(state.closeAt)?state.closeAt:(state.closeAt?Date.parse(state.closeAt):null);
    const overlaps=Number.isFinite(openAt) && openAt<=shift.endMs+this.endGraceMs && (!Number.isFinite(closeAt)||closeAt>=shift.startMs-this.earlyEvidenceWindowMs);

    if(state.status==='present'&&overlaps){
      if(openAt<shift.startMs-this.earlyEvidenceWindowMs) return {employee,workerType:assignment.workerType,status:'stale_open_session',openAt:new Date(openAt).toISOString(),evidenceCount:evidence.length};
      if(nowMs>shift.endMs+this.endGraceMs) return {employee,workerType:assignment.workerType,status:'missing_out',openAt:new Date(openAt).toISOString(),evidenceCount:evidence.length};
      return {employee,workerType:assignment.workerType,status:'confirmed_present',openAt:new Date(openAt).toISOString(),evidenceCount:evidence.length};
    }
    if(state.status==='outside'&&overlaps&&Number.isFinite(closeAt)){
      return {employee,workerType:assignment.workerType,status:'complete',openAt:new Date(openAt).toISOString(),closeAt:new Date(closeAt).toISOString(),evidenceCount:evidence.length};
    }
    if(nowMs<=shift.startMs+this.startGraceMs){
      return {employee,workerType:assignment.workerType,status:evidence.length?'evidence_seen':'awaiting_start',evidenceCount:evidence.length};
    }
    if(evidence.length){
      return {employee,workerType:assignment.workerType,status:'evidence_pending',evidenceCount:evidence.length};
    }
    return {employee,workerType:assignment.workerType,status:'missing_in',evidenceCount:0};
  }

  #shift(tenant,site,shiftId){
    const k=key(id(tenant,'tenant'),id(site,'site'),id(shiftId,'shift'));
    const shift=this.shifts.get(k); if(!shift) throw new Error('Shift not found.'); return shift;
  }
}
