function pct(n,d){ return d===0?100:(n/d)*100; }
function clone(x){ return JSON.parse(JSON.stringify(x)); }

/**
 * AttendanceClaimCertifier
 *
 * Prevents an unsupported "100%" claim. Passive automatic coverage and final
 * verified clock completeness are measured separately. A period is certifiable
 * only when every working shift has a verified IN/OUT, no person is unresolved,
 * and every required source proves complete continuity/reconciliation.
 */
export class AttendanceClaimCertifier {
  constructor({coverage}={}){
    if(!coverage?.preflight || !coverage?.evaluateShift) throw new Error('AttendanceCoverageAssurance required.');
    this.coverage=coverage;
  }

  certifyShift({tenant,site,shiftId,nowMs=Date.now(),expectedSourceIds=[],sourceHealth=[]}={}){
    const preflight=this.coverage.preflight({tenant,site,shiftId});
    const evaluation=this.coverage.evaluateShift({tenant,site,shiftId,nowMs});
    const declared=[...new Set((expectedSourceIds||[]).map(String))].sort();
    // The coverage plan is the canonical source inventory. A caller may require
    // additional sources, but it cannot omit a planned attendance source to make
    // a degraded provider disappear from the continuity quorum.
    const planned=[...new Set((preflight.rows||[]).flatMap(row=>Array.isArray(row.sourceIds)?row.sourceIds.map(String):[]))].sort();
    const underdeclared=planned.filter(id=>!declared.includes(id));
    const expected=[...new Set([...planned,...declared])].sort();
    const healthRows=(sourceHealth||[]).map(x=>({sourceId:String(x?.sourceId),health:x}));
    const healthCounts=new Map();
    for(const row of healthRows) healthCounts.set(row.sourceId,(healthCounts.get(row.sourceId)||0)+1);
    const duplicateHealth=[...healthCounts.entries()]
      .filter(([sourceId,count])=>count>1&&expected.includes(sourceId))
      .map(([sourceId])=>sourceId)
      .sort();
    // A source must have exactly one authoritative health statement for the period.
    // Map last-write-wins semantics are unsafe here because a stale/forged healthy
    // duplicate could otherwise overwrite a degraded/pending-recovery row.
    const healthById=new Map(healthRows.map(({sourceId,health})=>[sourceId,health]));
    const missingHealth=expected.filter(id=>!healthById.has(id));
    // Continuity evidence is meaningful only for the exact tenant/site/window being
    // certified. Source IDs can legitimately repeat across tenants and deployments,
    // so a healthy row from another scope must never satisfy this shift's quorum.
    const scopeMismatch=expected.filter(id=>{
      const h=healthById.get(id); if(!h) return false;
      return String(h.tenant||'')!==String(tenant||'') || String(h.site||'')!==String(site||'') || String(h.certificationWindowId||'')!==String(shiftId||'');
    });
    const unhealthy=expected.filter(id=>{
      const h=healthById.get(id); if(!h) return false;
      return !['healthy','reconciled'].includes(String(h.state||'')) || h.pendingRecovery===true;
    });
    const incompletePeriod=expected.filter(id=>{
      const h=healthById.get(id); return h && h.periodCoverageComplete!==true;
    });
    const sourceContinuityLive=duplicateHealth.length===0&&missingHealth.length===0&&scopeMismatch.length===0&&unhealthy.length===0;
    const sourceContinuityPeriod=sourceContinuityLive&&incompletePeriod.length===0;

    const workingRows=evaluation.rows.filter(r=>r.status!=='excused');
    const completedRows=workingRows.filter(r=>r.status==='complete');
    const verifiedCompletenessPct=pct(completedRows.length,workingRows.length);
    const automaticCapturePct=preflight.automaticCoveragePct;
    const noUnresolved=evaluation.unresolved===0&&evaluation.unexpectedCount===0&&evaluation.unmappedSignalCount===0;

    const passiveLiveCertified=preflight.releaseTargetMet===true&&sourceContinuityLive&&noUnresolved;
    const verifiedPeriodCertified=evaluation.payrollReady===true&&verifiedCompletenessPct===100&&sourceContinuityPeriod;
    const passivePeriodCertified=verifiedPeriodCertified&&preflight.releaseTargetMet===true;

    const claimLevel=passivePeriodCertified?'PASSIVE_AND_VERIFIED_100':verifiedPeriodCertified?'VERIFIED_100_ONLY':passiveLiveCertified?'PASSIVE_LIVE_100':'NOT_CERTIFIED';
    const blockers=[];
    if(!preflight.releaseTargetMet) blockers.push({code:'AUTOMATIC_COVERAGE_BELOW_100',employees:preflight.partial.length+preflight.uncovered.length});
    if(underdeclared.length) blockers.push({code:'SOURCE_EXPECTATION_UNDERDECLARED',sourceIds:underdeclared});
    if(duplicateHealth.length) blockers.push({code:'SOURCE_HEALTH_DUPLICATE',sourceIds:duplicateHealth});
    if(missingHealth.length) blockers.push({code:'SOURCE_HEALTH_MISSING',sourceIds:missingHealth});
    if(scopeMismatch.length) blockers.push({code:'SOURCE_HEALTH_SCOPE_MISMATCH',sourceIds:scopeMismatch});
    if(unhealthy.length) blockers.push({code:'SOURCE_NOT_HEALTHY',sourceIds:unhealthy});
    if(incompletePeriod.length) blockers.push({code:'SOURCE_PERIOD_NOT_RECONCILED',sourceIds:incompletePeriod});
    if(evaluation.unresolved) blockers.push({code:'UNRESOLVED_WORKERS',count:evaluation.unresolved});
    if(evaluation.unexpectedCount) blockers.push({code:'UNSCHEDULED_PRESENCE',count:evaluation.unexpectedCount});
    if(evaluation.unmappedSignalCount) blockers.push({code:'UNMAPPED_PERSON_SIGNALS',count:evaluation.unmappedSignalCount});
    if(verifiedCompletenessPct<100) blockers.push({code:'VERIFIED_IN_OUT_BELOW_100',pct:verifiedCompletenessPct});

    return clone({
      shiftId,site,claimLevel,
      metrics:{automaticCapturePct,verifiedCompletenessPct,totalScheduled:evaluation.totalScheduled,workingScheduled:workingRows.length,verifiedComplete:completedRows.length},
      certification:{passiveLiveCertified,verifiedPeriodCertified,passivePeriodCertified,sourceContinuityLive,sourceContinuityPeriod},
      blockers,
      claim:passivePeriodCertified
        ?'100% of scheduled working shifts had a verified IN and OUT and the site was certified for 100% passive automatic coverage.'
        :verifiedPeriodCertified
          ?'100% of scheduled working shifts had a verified IN and OUT. Automatic capture rate must be stated separately.'
          :null
    });
  }
}