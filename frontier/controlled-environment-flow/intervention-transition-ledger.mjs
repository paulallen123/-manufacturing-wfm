import {types as utilTypes} from 'node:util';

export const INTERVENTION_TRANSITION_LEDGER_VERSION='intervention-transition-ledger-v0.2.0';

const reflectApply=Reflect.apply;
const reflectOwnKeys=Reflect.ownKeys;
const objectGetOwnPropertyDescriptors=Object.getOwnPropertyDescriptors;
const objectGetPrototypeOf=Object.getPrototypeOf;
const objectCreate=Object.create;
const objectKeys=Object.keys;
const objectFreeze=Object.freeze;
const objectIsFrozen=Object.isFrozen;
const objectHasOwnProperty=Object.prototype.hasOwnProperty;
const objectPrototype=Object.prototype;
const arrayIsArray=Array.isArray;
const arrayIncludes=Array.prototype.includes;
const numberIsFinite=Number.isFinite;
const numberIsInteger=Number.isInteger;
const stringTrim=String.prototype.trim;
const stringIncludes=String.prototype.includes;
const stringReplace=String.prototype.replace;
const regexpTest=RegExp.prototype.test;
const canonicalUtcPattern=/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/;
const dateParse=Date.parse;
const dateToISOString=Date.prototype.toISOString;
const DateConstructor=Date;
const mathAbs=Math.abs;
const isProxy=utilTypes.isProxy;
const clean=v=>typeof v==='string'?reflectApply(stringTrim,v,[]):'';
const canonicalId=v=>typeof v==='string'&&v.length>0&&v===reflectApply(stringTrim,v,[]);
const pairKey=(a,b)=>JSON.stringify([a,b]);
const knownZone=(policy,zone)=>Object.hasOwn(policy.zones??{},zone)&&policy.zones[zone]!=null&&typeof policy.zones[zone]==='object'&&!Array.isArray(policy.zones[zone]);
const finite=v=>typeof v==='number'&&numberIsFinite(v);
const ts=v=>{const n=dateParse(String(v??''));return numberIsFinite(n)?n:null;};
const has=(value,key)=>reflectApply(objectHasOwnProperty,value,[key]);

function freeze(value){
  if(value&&typeof value==='object'&&!reflectApply(objectIsFrozen,Object,[value])){
    const keys=reflectApply(objectKeys,Object,[value]);
    for(let index=0;index<keys.length;index++)freeze(value[keys[index]]);
    reflectApply(objectFreeze,Object,[value]);
  }
  return value;
}

function dataRecord(value,allowed,required=[]){
  try{
    if(!value||typeof value!=='object'||reflectApply(arrayIsArray,Array,[value])||reflectApply(isProxy,utilTypes,[value]))return null;
    const prototype=reflectApply(objectGetPrototypeOf,Object,[value]);
    if(prototype!==objectPrototype&&prototype!==null)return null;
    const descriptors=reflectApply(objectGetOwnPropertyDescriptors,Object,[value]);
    const keys=reflectApply(reflectOwnKeys,Reflect,[descriptors]);
    for(let index=0;index<keys.length;index++){
      const key=keys[index];let admitted=false;
      if(typeof key!=='string')return null;
      for(let allowedIndex=0;allowedIndex<allowed.length;allowedIndex++)if(key===allowed[allowedIndex]){admitted=true;break;}
      if(!admitted)return null;
    }
    const copy=reflectApply(objectCreate,Object,[null]);
    for(let index=0;index<keys.length;index++){
      const key=keys[index];
      const descriptor=descriptors[key];
      if(!descriptor.enumerable||!has(descriptor,'value'))return null;
      copy[key]=descriptor.value;
    }
    for(let index=0;index<required.length;index++)if(!has(copy,required[index]))return null;
    return copy;
  }catch{return null;}
}

function instant(value){
  if(typeof value!=='string'||!reflectApply(regexpTest,canonicalUtcPattern,[value]))return null;
  const milliseconds=reflectApply(dateParse,DateConstructor,[value]);
  if(!numberIsFinite(milliseconds))return null;
  const expected=reflectApply(stringIncludes,value,['.'])?value:reflectApply(stringReplace,value,[/Z$/,'.000Z']);
  return reflectApply(dateToISOString,new DateConstructor(milliseconds),[])===expected?milliseconds:null;
}

function outcomeIntrinsicsIntact(){
  try{
    return Reflect.apply===reflectApply&&Reflect.ownKeys===reflectOwnKeys&&
      Object.getOwnPropertyDescriptors===objectGetOwnPropertyDescriptors&&Object.getPrototypeOf===objectGetPrototypeOf&&
      Object.create===objectCreate&&Object.keys===objectKeys&&Object.freeze===objectFreeze&&Object.isFrozen===objectIsFrozen&&
      Object.prototype===objectPrototype&&Object.prototype.hasOwnProperty===objectHasOwnProperty&&
      Array.isArray===arrayIsArray&&Array.prototype.includes===arrayIncludes&&
      Number.isFinite===numberIsFinite&&Number.isInteger===numberIsInteger&&
      String.prototype.trim===stringTrim&&String.prototype.includes===stringIncludes&&String.prototype.replace===stringReplace&&
      RegExp.prototype.test===regexpTest&&Date.parse===dateParse&&Date.prototype.toISOString===dateToISOString&&Date===DateConstructor&&
      Math.abs===mathAbs&&utilTypes.isProxy===isProxy;
  }catch{return false;}
}

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

const OUTCOME_ROOT_FIELDS=['recommendation','decision','observed','operations','quality','financial','now'];
const RECOMMENDATION_FIELDS=['id','siteId','tenantId','predictedEntries','authoritative','ref','observedAt','maxAgeMinutes'];
const DECISION_FIELDS=['status','recommendationId','siteId','tenantId','authoritative','ref','observedAt'];
const OBSERVED_FIELDS=['authoritative','recommendationId','siteId','tenantId','actualEntries','ref','observedAt'];
const OPERATIONS_FIELDS=['authoritative','recommendationId','siteId','tenantId','productionCompleted','ref','observedAt'];
const QUALITY_FIELDS=['authoritative','recommendationId','siteId','tenantId','eventCount','ref','observedAt'];
const FINANCIAL_FIELDS=['authoritative','recommendationId','siteId','tenantId','realisedControlCost','ref','observedAt'];
const outcomeResult=(status,reason)=>freeze(reason?{status,reason}:{status});
const nonNegativeNumber=value=>finite(value)&&value>=0;
const nonNegativeInteger=value=>numberIsInteger(value)&&value>=0;
const SOURCE_ROLE_PREFIX=freeze({recommendation:'recommendation:',decision:'decision:',observed:'access:',operations:'mes:',quality:'qms:',financial:'finance:'});

function sourceRoleBound(role,ref,recommendationId){
  return canonicalId(ref)&&ref===SOURCE_ROLE_PREFIX[role]+recommendationId;
}

function scopeAndSourceBound(recommendation,evidence,role){
  return evidence.recommendationId===recommendation.id&&
    evidence.siteId===recommendation.siteId&&
    evidence.tenantId===recommendation.tenantId&&
    sourceRoleBound(role,evidence.ref,recommendation.id);
}

function evidenceTime(evidence,notBefore,now,maxAgeMinutes){
  const observed=instant(evidence.observedAt);
  if(observed===null||observed<notBefore||observed>now)return {error:'outcome_time_invalid'};
  if((now-observed)/60000>maxAgeMinutes)return {error:'outcome_evidence_stale'};
  return {value:observed};
}

export function reconcileSensitiveZoneOutcome(input={}){
  try{
    if(!outcomeIntrinsicsIntact())return outcomeResult('incomplete','outcome_runtime_invalid');
    const root=dataRecord(input??{},OUTCOME_ROOT_FIELDS);
    if(!root)return outcomeResult('incomplete','outcome_evidence_invalid');
    const recommendation=dataRecord(root.recommendation,RECOMMENDATION_FIELDS,['id','siteId','tenantId','predictedEntries','authoritative','ref','observedAt']);
    const decision=dataRecord(root.decision,DECISION_FIELDS,DECISION_FIELDS);
    if(!recommendation||!decision||recommendation.authoritative!==true||
       !canonicalId(recommendation.id)||!canonicalId(recommendation.siteId)||!canonicalId(recommendation.tenantId)||
       !sourceRoleBound('recommendation',recommendation.ref,recommendation.id)||
       (decision.status!=='accepted'&&decision.status!=='rejected'))return outcomeResult('incomplete','decision_missing');

    const current=instant(has(root,'now')?root.now:reflectApply(dateToISOString,new DateConstructor(),[]));
    const generated=instant(recommendation.observedAt);
    const maxAgeMinutes=has(recommendation,'maxAgeMinutes')?recommendation.maxAgeMinutes:43200;
    if(current===null||generated===null||generated>current||!nonNegativeNumber(maxAgeMinutes))return outcomeResult('incomplete','outcome_time_invalid');
    if((current-generated)/60000>maxAgeMinutes)return outcomeResult('incomplete','outcome_evidence_stale');
    if(decision.authoritative!==true||!scopeAndSourceBound(recommendation,decision,'decision'))return outcomeResult('incomplete','decision_scope_mismatch');
    const decisionTime=evidenceTime(decision,generated,current,maxAgeMinutes);
    if(decisionTime.error)return outcomeResult('incomplete',decisionTime.error);

    if(decision.status==='rejected')return freeze({
      status:'recorded',outcomeClass:'rejected_by_human',recommendationId:recommendation.id,
      evidenceRefs:{recommendation:recommendation.ref,decision:decision.ref}
    });

    const observed=dataRecord(root.observed,OBSERVED_FIELDS,OBSERVED_FIELDS);
    const operations=dataRecord(root.operations,OPERATIONS_FIELDS,OPERATIONS_FIELDS);
    const quality=dataRecord(root.quality,QUALITY_FIELDS,QUALITY_FIELDS);
    const financial=has(root,'financial')?dataRecord(root.financial,FINANCIAL_FIELDS,FINANCIAL_FIELDS):null;
    if(!observed||!operations||!quality||(has(root,'financial')&&!financial))return outcomeResult('incomplete','operational_evidence_missing');
    if(!scopeAndSourceBound(recommendation,observed,'observed')||!scopeAndSourceBound(recommendation,operations,'operations')||
       !scopeAndSourceBound(recommendation,quality,'quality')||(financial&&!scopeAndSourceBound(recommendation,financial,'financial')))return outcomeResult('incomplete','outcome_scope_mismatch');
    if(observed.authoritative!==true||operations.authoritative!==true)return outcomeResult('incomplete','operational_evidence_missing');
    if(quality.authoritative!==true)return outcomeResult('incomplete','quality_evidence_missing');
    if(financial&&financial.authoritative!==true)return outcomeResult('incomplete','financial_evidence_missing');
    for(let index=0;index<(financial?4:3);index++){
      const evidence=index===0?observed:index===1?operations:index===2?quality:financial;
      const timing=evidenceTime(evidence,decisionTime.value,current,maxAgeMinutes);
      if(timing.error)return outcomeResult('incomplete',timing.error);
    }
    if(!nonNegativeNumber(recommendation.predictedEntries)||!nonNegativeNumber(observed.actualEntries))return outcomeResult('incomplete','entry_values_invalid');
    if(typeof operations.productionCompleted!=='boolean')return outcomeResult('incomplete','operational_evidence_invalid');
    if(!nonNegativeInteger(quality.eventCount))return outcomeResult('incomplete','quality_values_invalid');
    if(financial&&!nonNegativeNumber(financial.realisedControlCost))return outcomeResult('incomplete','financial_values_invalid');

    const predictedEntries=recommendation.predictedEntries,actualEntries=observed.actualEntries;
    return freeze({
      status:'reconciled',
      recommendationId:recommendation.id,
      predicted:{entries:predictedEntries},
      realised:{
        entries:actualEntries,
        productionCompleted:operations.productionCompleted,
        qualityEventCount:quality.eventCount,
        realisedControlCost:financial?.realisedControlCost??null
      },
      calibration:{entryError:actualEntries-predictedEntries,absoluteEntryError:reflectApply(mathAbs,Math,[actualEntries-predictedEntries])},
      evidenceRefs:{
        recommendation:recommendation.ref,decision:decision.ref,observed:observed.ref,
        operations:operations.ref,quality:quality.ref,financial:financial?.ref??null
      },
      authorityBoundary:'Outcome evidence can calibrate future advice but cannot alter site policy, qualifications, access authority or process rules automatically.'
    });
  }catch{return outcomeResult('incomplete','outcome_evidence_invalid');}
}
