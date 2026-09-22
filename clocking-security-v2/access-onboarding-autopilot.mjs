function norm(v){ return String(v??'').trim().toLowerCase(); }
function uniq(xs){ return [...new Set(xs)]; }

/**
 * Exact-only cardholder matching. Names are never used as automatic identity
 * proof because a false merge can attach door evidence to the wrong worker.
 */
export function matchAccessIdentities({employees=[],cardholders=[]}={}){
  const byExternal=new Map(), byEmployeeNo=new Map(), byEmail=new Map();
  const add=(m,k,id)=>{ if(!k) return; const a=m.get(k)||[]; a.push(id); m.set(k,a); };
  for(const c of cardholders){
    const id=String(c.cardholderId||c.id||''); if(!id) continue;
    add(byExternal,norm(c.externalId),id);
    add(byEmployeeNo,norm(c.employeeNumber),id);
    add(byEmail,norm(c.email),id);
  }
  const mapped=[],review=[],unmatched=[];
  for(const e of employees){
    const employeeId=String(e.employeeId||e.id||''); if(!employeeId) continue;
    const evidence=[];
    if(e.accessExternalId) evidence.push(...(byExternal.get(norm(e.accessExternalId))||[]));
    if(e.employeeNumber) evidence.push(...(byEmployeeNo.get(norm(e.employeeNumber))||[]));
    if(e.email) evidence.push(...(byEmail.get(norm(e.email))||[]));
    const ids=uniq(evidence);
    if(ids.length===1) mapped.push({employeeId,cardholderId:ids[0],method:e.accessExternalId?'explicit_external_id':(e.employeeNumber?'employee_number':'email_exact')});
    else if(ids.length>1) review.push({employeeId,candidateCardholderIds:ids,reason:'AMBIGUOUS_EXACT_IDENTIFIERS'});
    else unmatched.push({employeeId,reason:'NO_EXACT_STABLE_ID_MATCH'});
  }
  return {mapped,review,unmatched};
}

/**
 * Auto-accept provider-declared directional/perimeter metadata. Text/name
 * heuristics can suggest a choice but never silently enable attendance use.
 */
export function planAccessPoints({accessPoints=[]}={}){
  const ready=[],review=[];
  for(const p of accessPoints){
    const id=String(p.accessPointId||p.id||''); if(!id) continue;
    const d=norm(p.direction);
    if((d==='entry'||d==='exit') && p.isPerimeter===true){
      ready.push({accessPointId:id,direction:d,attendanceEligible:true,zoneId:p.zoneId||undefined,source:'provider_metadata'});
      continue;
    }
    const n=norm(p.name);
    let suggestedDirection=null;
    if(/\b(entry|entrance|inbound|arrivals?)\b/.test(n)) suggestedDirection='entry';
    else if(/\b(exit|egress|outbound|departures?)\b/.test(n)) suggestedDirection='exit';
    review.push({accessPointId:id,name:p.name||id,suggestedDirection,attendanceEligibleSuggestion:p.isPerimeter===true,reason:'CONFIRM_DIRECTION_AND_ATTENDANCE_ELIGIBILITY'});
  }
  return {ready,review};
}

export function buildAccessOnboardingPlan({employees=[],cardholders=[],accessPoints=[]}={}){
  const identities=matchAccessIdentities({employees,cardholders});
  const doors=planAccessPoints({accessPoints});
  const totalEmployees=employees.length;
  const totalDoors=accessPoints.length;
  const identityCoverage=totalEmployees?identities.mapped.length/totalEmployees:1;
  const doorCoverage=totalDoors?doors.ready.length/totalDoors:1;
  return {
    mode:'evidence_only_until_verified',
    summary:{
      employees:totalEmployees,autoMappedEmployees:identities.mapped.length,identityCoverage,
      accessPoints:totalDoors,autoConfiguredAccessPoints:doors.ready.length,doorCoverage,
      reviewItems:identities.review.length+identities.unmatched.length+doors.review.length,
    },
    identities,
    accessPoints:doors,
    customerTasks:[
      ...identities.review.map(x=>({type:'resolve_identity',...x})),
      ...identities.unmatched.map(x=>({type:'link_identity',...x})),
      ...doors.review.map(x=>({type:'confirm_access_point',...x})),
    ],
    canEnableAutomaticAttendance:identities.review.length===0&&identities.unmatched.length===0&&doors.review.length===0,
  };
}
