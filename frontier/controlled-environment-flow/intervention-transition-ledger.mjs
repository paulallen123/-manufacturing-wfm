export const INTERVENTION_TRANSITION_LEDGER_VERSION='intervention-transition-ledger-v0.1.1';

const clean=v=>typeof v==='string'?v.trim():'';
const canonicalId=v=>typeof v==='string'&&v.length>0&&v===v.trim();
const pairKey=(a,b)=>JSON.stringify([a,b]);
const knownZone=(policy,zone)=>Object.hasOwn(policy.zones??{},zone)&&policy.zones[zone]!=null&&typeof policy.zones[zone]==='object'&&!Array.isArray(policy.zones[zone]);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const ts=v=>{const n=Date.parse(String(v??''));return Number.isFinite(n)?n:null;};

function policyGate(policy,now){
  if(!policy||policy.authoritative!==true)return {ok:false,reason:'policy_not_authoritative'};
  if(!clean(policy.siteId)||!clean(policy.version)||!clean(policy.ref))return {ok:false,reason:'policy_provenance_missing'};
  const observed=ts(policy.observedAt),current=ts(now),maxAge=Number(policy.maxAgeMinutes??1440);
  if(observed==null||current==null||!finite(maxAge)||maxAge<0||current<observed)return {ok:false,reason:'policy_time_invalid'};
  if((current-observed)/60000>maxAge)return {ok:false,reason:'policy_stale'};
  return {ok:true};
}

function normalizeTask(task,siteId){
  if(clean(task?.siteId)!==siteId)return {ok:false,reason:'task_site_mismatch'};
  const start=ts(task?.startAt),end=ts(task?.endAt);
  if(!canonicalId(task?.id)||!canonicalId(task?.workerId)||!canonicalId(task?.zone)||start==null||end==null||end<=start){
    return {ok:false,reason:'task_invalid'};
  }
  if(task.authoritative!==true)return {ok:false,reason:'task_not_authoritative'};
  if(!clean(task?.ref)||!clean(task?.revision))return {ok:false,reason:'task_provenance_missing'};
  return {ok:true,value:{...task,startMs:start,endMs:end}};
}

function normalizeEvent(event,siteId){
  if(clean(event?.siteId)!==siteId)return {ok:false,reason:'event_site_mismatch'};
  if(event.authoritative!==true)return {ok:false,reason:'event_not_authoritative'};
  const at=ts(event?.observedAt),direction=clean(event?.direction).toLowerCase();
  if(!canonicalId(event?.id)||!canonicalId(event?.workerId)||!canonicalId(event?.zone)||at==null||!['enter','exit'].includes(direction)){
    return {ok:false,reason:'event_invalid'};
  }
  if(!clean(event?.ref))return {ok:false,reason:'event_provenance_missing'};
  return {ok:true,value:{...event,atMs:at,direction}};
}

function pairSessions(events){
  // At a shared boundary, close existing presence before opening the next session.
  const sorted=events.slice().sort((a,b)=>a.atMs-b.atMs||(a.direction==='exit'?0:1)-(b.direction==='exit'?0:1)||a.id.localeCompare(b.id));
  const open=new Map(),sessions=[],issues=[];
  for(const e of sorted){
    const key=pairKey(e.workerId,e.zone);
    if(e.direction==='enter'){
      if(open.has(key)){
        issues.push({code:'duplicate_enter_without_exit',workerId:e.workerId,zone:e.zone,eventId:e.id});
        continue;
      }
      open.set(key,e);
      continue;
    }
    const start=open.get(key);
    if(!start){
      issues.push({code:'exit_without_enter',workerId:e.workerId,zone:e.zone,eventId:e.id});
      continue;
    }
    if(e.atMs<=start.atMs){
      issues.push({code:'non_positive_session',workerId:e.workerId,zone:e.zone,eventId:e.id});
      open.delete(key);
      continue;
    }
    sessions.push({
      workerId:String(e.workerId),zone:String(e.zone),enterAt:start.observedAt,exitAt:e.observedAt,
      enterMs:start.atMs,exitMs:e.atMs,enterRef:start.ref,exitRef:e.ref
    });
    open.delete(key);
  }
  for(const e of open.values())issues.push({code:'open_session_missing_exit',workerId:e.workerId,zone:e.zone,eventId:e.id});
  const lastByWorker=new Map();
  for(const s of sessions.slice().sort((a,b)=>a.enterMs-b.enterMs)){
    const previous=lastByWorker.get(s.workerId);
    if(previous&&s.enterMs<previous.exitMs)issues.push({code:'overlapping_worker_sessions',workerId:s.workerId,zone:s.zone});
    if(!previous||s.exitMs>previous.exitMs)lastByWorker.set(s.workerId,s);
  }
  return {sessions,issues};
}

function overlap(aStart,aEnd,bStart,bEnd){return aStart<bEnd&&bStart<aEnd;}

function transitionIndex(policy){
  if(!Array.isArray(policy.transitions))return {ok:false,reason:'transition_rules_invalid'};
  if(policy.defaultOutsideZone!=null&&!canonicalId(policy.defaultOutsideZone))return {ok:false,reason:'outside_zone_invalid'};
  const outside=policy.defaultOutsideZone??'OUT',map=new Map();
  if(knownZone(policy,outside))return {ok:false,reason:'outside_zone_invalid'};
  for(const row of policy.transitions){
    if(!canonicalId(row?.from)||!canonicalId(row?.to)||typeof row.allowed!=='boolean')return {ok:false,reason:'transition_rule_invalid'};
    const key=pairKey(row.from,row.to);
    // Even identical duplicates need source reconciliation; order is not authority.
    if(map.has(key))return {ok:false,reason:'duplicate_transition_rule'};
    if([row.from,row.to].some(zone=>zone!==outside&&!knownZone(policy,zone)))return {ok:false,reason:'transition_zone_unknown'};
    map.set(key,row);
  }
  return {ok:true,map};
}

function buildMovement(sessions,policy,transitions){
  const byWorker=new Map();
  for(const s of sessions){
    if(!byWorker.has(s.workerId))byWorker.set(s.workerId,[]);
    byWorker.get(s.workerId).push(s);
  }
  const movement=[];
  for(const [workerId,rows] of byWorker){
    rows.sort((a,b)=>a.enterMs-b.enterMs);
    let from=clean(policy.defaultOutsideZone)||'OUT';
    for(const row of rows){
      const rule=transitions.get(pairKey(from,row.zone));
      movement.push({
        workerId,from,to:row.zone,at:row.enterAt,
        approved:rule?.allowed===true,
        gowningCycle:rule?.gowningCycle===true,
        controlMinutes:finite(Number(rule?.controlMinutes))?Number(rule.controlMinutes):null,
        controlCost:finite(Number(rule?.controlCost))?Number(rule.controlCost):null
      });
      from=row.zone;
      const exitRule=transitions.get(pairKey(from,clean(policy.defaultOutsideZone)||'OUT'));
      movement.push({
        workerId,from,to:clean(policy.defaultOutsideZone)||'OUT',at:row.exitAt,
        approved:exitRule?.allowed===true,gowningCycle:exitRule?.gowningCycle===true,
        controlMinutes:finite(Number(exitRule?.controlMinutes))?Number(exitRule.controlMinutes):null,
        controlCost:finite(Number(exitRule?.controlCost))?Number(exitRule.controlCost):null
      });
      from=clean(policy.defaultOutsideZone)||'OUT';
    }
  }
  return movement;
}

function zoneRule(policy,zone){return policy?.zones?.[zone]??{};}

function candidateBundles(tasks,sessions,policy,transitions){
  const byWorkerZone=new Map();
  for(const task of tasks){
    const key=pairKey(task.workerId,task.zone);
    if(!byWorkerZone.has(key))byWorkerZone.set(key,[]);
    byWorkerZone.get(key).push(task);
  }
  const opportunities=[];
  for(const [key,rows] of byWorkerZone){
    rows.sort((a,b)=>a.startMs-b.startMs);
    const [workerId,zone]=JSON.parse(key);
    const z=zoneRule(policy,zone);
    const gapLimit=Number(z.maxBundleGapMinutes??0);
    const maxContinuous=Number(z.maxContinuousMinutes??Infinity);
    if(!finite(gapLimit)||gapLimit<0)continue;
    if(Object.hasOwn(z,'maxContinuousMinutes')&&(!finite(maxContinuous)||maxContinuous<=0))continue;
    for(let i=0;i<rows.length-1;i++){
      const a=rows[i],b=rows[i+1];
      const gap=(b.startMs-a.endMs)/60000;
      if(gap<0||gap>gapLimit)continue;
      if(a.mandatoryExitAfter===true||b.requiresIndependentEntry===true)continue;
      const span=(b.endMs-a.startMs)/60000;
      if(finite(maxContinuous)&&span>maxContinuous)continue;
      const sessionA=sessions.find(s=>s.workerId===workerId&&s.zone===zone&&overlap(s.enterMs,s.exitMs,a.startMs,a.endMs));
      const sessionB=sessions.find(s=>s.workerId===workerId&&s.zone===zone&&overlap(s.enterMs,s.exitMs,b.startMs,b.endMs));
      if(!sessionA||!sessionB||sessionA===sessionB)continue;
      // A continuous stay cannot erase another required or observed zone visit.
      if(tasks.some(t=>t.workerId===workerId&&t.zone!==zone&&overlap(t.startMs,t.endMs,a.startMs,b.endMs)))continue;
      if(sessions.some(s=>s.workerId===workerId&&s.zone!==zone&&overlap(s.enterMs,s.exitMs,sessionA.enterMs,sessionB.exitMs)))continue;
      const entryRule=transitions.get(pairKey(clean(policy.defaultOutsideZone)||'OUT',zone));
      opportunities.push({
        workerId,zone,firstTaskId:a.id,secondTaskId:b.id,gapMinutes:gap,
        observedSeparateEntries:true,
        potentialEntryReduction:1,
        potentialGowningReduction:entryRule?.gowningCycle===true?1:0,
        potentialControlMinutesAvoided:finite(Number(entryRule?.controlMinutes))?Number(entryRule.controlMinutes):null,
        potentialControlCostAvoided:finite(Number(entryRule?.controlCost))?Number(entryRule.controlCost):null,
        status:'candidate_only',
        claimBoundary:'This is a deterministic consolidation candidate, not proof that an observed entry was unnecessary or that contamination risk would fall.'
      });
    }
  }
  return opportunities;
}

export function buildInterventionTransitionLedger({policy,tasks=[],presenceEvents=[],now=new Date().toISOString()}={}){
  const gate=policyGate(policy,now);
  if(!gate.ok)return {status:'blocked',reason:gate.reason};
  const siteId=clean(policy.siteId);
  const transitions=transitionIndex(policy);
  if(!transitions.ok)return {status:'blocked',reason:transitions.reason};
  if(!Array.isArray(tasks))return {status:'rejected',reason:'tasks_invalid'};
  if(!Array.isArray(presenceEvents))return {status:'rejected',reason:'presence_events_invalid'};

  const normalizedTasks=[],taskIds=new Set();
  for(const task of tasks){
    const r=normalizeTask(task,siteId);
    if(!r.ok)return {status:'rejected',reason:r.reason,taskId:task?.id??null};
    if(taskIds.has(task.id))return {status:'rejected',reason:'duplicate_task_id',taskId:task.id};
    if(!knownZone(policy,task.zone))return {status:'rejected',reason:'task_zone_unknown',taskId:task.id};
    taskIds.add(task.id);
    normalizedTasks.push(r.value);
  }
  const normalizedEvents=[],eventIds=new Set();
  for(const event of presenceEvents){
    const r=normalizeEvent(event,siteId);
    if(!r.ok)return {status:'rejected',reason:r.reason,eventId:event?.id??null};
    if(eventIds.has(event.id))return {status:'rejected',reason:'duplicate_event_id',eventId:event.id};
    if(!knownZone(policy,event.zone))return {status:'rejected',reason:'event_zone_unknown',eventId:event.id};
    eventIds.add(event.id);
    normalizedEvents.push(r.value);
  }

  const paired=pairSessions(normalizedEvents);
  const sessions=paired.sessions;
  const movement=buildMovement(sessions,policy,transitions.map);
  const unapprovedMovement=movement.filter(x=>x.approved!==true);

  const sessionRows=sessions.map(session=>{
    const matched=normalizedTasks.filter(t=>
      String(t.workerId)===session.workerId&&String(t.zone)===session.zone&&
      overlap(session.enterMs,session.exitMs,t.startMs,t.endMs)
    );
    return {
      workerId:session.workerId,zone:session.zone,enterAt:session.enterAt,exitAt:session.exitAt,
      durationMinutes:(session.exitMs-session.enterMs)/60000,
      matchedTaskIds:matched.map(t=>t.id),
      attribution:matched.length?'task_window_overlap':'needs_review',
      claimBoundary:'Access evidence shows presence only. It does not prove the person performed a manufacturing task.'
    };
  });

  const opportunities=paired.issues.length||unapprovedMovement.length?[]:candidateBundles(normalizedTasks,sessions,policy,transitions.map);
  const gowningCycles=movement.filter(x=>x.gowningCycle===true&&x.to!==(clean(policy.defaultOutsideZone)||'OUT')).length;
  const controlMinutes=movement.filter(x=>x.to!==(clean(policy.defaultOutsideZone)||'OUT')).reduce((sum,x)=>x.controlMinutes==null?sum:sum+x.controlMinutes,0);
  const controlCostKnown=movement.filter(x=>x.to!==(clean(policy.defaultOutsideZone)||'OUT')).every(x=>x.controlCost!=null);
  const controlCost=controlCostKnown?movement.filter(x=>x.to!==(clean(policy.defaultOutsideZone)||'OUT')).reduce((sum,x)=>sum+x.controlCost,0):null;

  return {
    status:paired.issues.length||unapprovedMovement.length?'needs_review':'ledger_ready',
    siteId,
    metrics:{
      observedSessions:sessions.length,
      observedEntries:sessions.length,
      observedGowningCycles:gowningCycles,
      observedControlMinutes:controlMinutes,
      observedControlCost:controlCost,
      sessionsWithoutTaskOverlap:sessionRows.filter(x=>x.attribution==='needs_review').length,
      consolidationCandidates:opportunities.length,
      potentialReductionBasis:'largest_single_candidate',
      potentialEntryReduction:opportunities.reduce((s,x)=>Math.max(s,x.potentialEntryReduction),0),
      potentialGowningReduction:opportunities.reduce((s,x)=>Math.max(s,x.potentialGowningReduction),0)
    },
    sessions:sessionRows,
    movement,
    dataQualityIssues:paired.issues,
    unapprovedMovement,
    consolidationCandidates:opportunities,
    consolidationBoundary:'Candidate counts describe alternatives that may share tasks or sessions and are not jointly validated. Reported reductions cover at most one candidate and confer no safety approval.',
    authorityBoundary:'The ledger observes and explains workforce movement. It never changes access, cleanroom policy, task authority or schedules.',
    privacyBoundary:'Use pseudonymous workforce identifiers for optimisation and retain identifiable history only where authorised and necessary.'
  };
}

export function reconcileSensitiveZoneOutcome({recommendation,decision,observed,operations,quality,financial}={}){
  if(!clean(recommendation?.id)||!['accepted','rejected'].includes(clean(decision?.status)))return {status:'incomplete',reason:'decision_missing'};
  if(decision.status==='rejected')return {status:'recorded',outcomeClass:'rejected_by_human',recommendationId:recommendation.id};
  if(observed?.authoritative!==true||operations?.authoritative!==true)return {status:'incomplete',reason:'operational_evidence_missing'};
  if(quality?.authoritative!==true)return {status:'incomplete',reason:'quality_evidence_missing'};
  const predictedEntries=Number(recommendation.predictedEntries),actualEntries=Number(observed.actualEntries);
  if(!finite(predictedEntries)||!finite(actualEntries))return {status:'incomplete',reason:'entry_values_invalid'};
  const realisedCost=financial?.authoritative===true&&finite(Number(financial.realisedControlCost))?Number(financial.realisedControlCost):null;
  return {
    status:'reconciled',
    recommendationId:recommendation.id,
    predicted:{entries:predictedEntries},
    realised:{
      entries:actualEntries,
      productionCompleted:operations.productionCompleted===true,
      qualityEventCount:Number.isInteger(quality.eventCount)?quality.eventCount:null,
      realisedControlCost:realisedCost
    },
    calibration:{entryError:actualEntries-predictedEntries,absoluteEntryError:Math.abs(actualEntries-predictedEntries)},
    authorityBoundary:'Outcome evidence can calibrate future advice but cannot alter site policy, qualifications, access authority or process rules automatically.'
  };
}
