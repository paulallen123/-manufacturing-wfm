'use strict';
const {inertJsonCopy}=require('../../implementation/runtime/inert-finite-json.cjs');
const CONTRACT_VERSION='VECTOR_SKILLS_DEMAND_INTELLIGENCE_V1';
const TRAINING_TWIN_VERSION='VECTOR_TRAINING_TWIN_V1';
const FROZEN_PRODUCER_SHA='f32ca1a2672d47dcff8ef6cd1c3d71c77cf60560';
function object(value,label){if(!value||typeof value!=='object'||Array.isArray(value))throw Error(label+' must be an object');return value;}
function text(value,label,max=240){if(typeof value!=='string'||!value||value.length>max||value!==value.trim()||/[\u0000-\u001f\u007f]/.test(value))throw Error(label+' must be an exact nonblank bounded string');return value;}
function keys(value,allowed,label){object(value,label);for(const key of Object.keys(value))if(!allowed.includes(key))throw Error(label+' contains unsupported field '+key);}
function finite(value,label,min,max){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw Error(label+' requires a finite number in range');return value;}
function integer(value,label,min,max){finite(value,label,min,max);if(!Number.isSafeInteger(value))throw Error(label+' requires a safe integer');return value;}
function timestamp(value,label){text(value,label,24);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))throw Error(label+' requires canonical UTC ISO time');const ms=Date.parse(value);if(!Number.isFinite(ms)||new Date(ms).toISOString()!==value)throw Error(label+' has an invalid calendar time');return ms;}
function array(value,label,max){if(!Array.isArray(value)||value.length>max)throw Error(label+' requires a bounded array');return value;}
function freeze(value){if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}
function provenance(value,scope,asOf,label){
  keys(value,['verified','tenant','site','contextRevision','sourceRef','sourceRevision','producerSourceSha','observedAt','validUntil'],label);
  if(value.verified!==true)throw Error(label+' requires an explicit supplied verification assertion');
  for(const key of ['tenant','site','contextRevision'])if(value[key]!==scope[key])throw Error(label+' has a mismatched '+key);
  text(value.sourceRef,label+'.sourceRef');text(value.sourceRevision,label+'.sourceRevision');
  if(value.producerSourceSha!==FROZEN_PRODUCER_SHA)throw Error(label+' has a mismatched claimed producer SHA');
  const observedAt=timestamp(value.observedAt,label+'.observedAt'),validUntil=timestamp(value.validUntil,label+'.validUntil');
  if(observedAt>asOf||validUntil<=asOf||validUntil<=observedAt)throw Error(label+' is outside the supplied current interval');
  return{observedAt,assertion:{sourceRef:value.sourceRef,sourceRevision:value.sourceRevision,producerSourceSha:value.producerSourceSha,observedAt:value.observedAt,validUntil:value.validUntil}};
}
function competencyProfile(profile,competencyKey,observedAt,label){
  keys(profile,['contractVersion','role','preferences','competencies','due'],label);
  if(profile.contractVersion!==TRAINING_TWIN_VERSION)throw Error(label+' requires a compatible Training Twin V1 profile');
  text(profile.role,label+'.role',80);object(profile.preferences,label+'.preferences');array(profile.due,label+'.due',256);
  const competencies=array(profile.competencies,label+'.competencies',256),seen=new Set();let target=null;
  for(const item of competencies){
    keys(item,['competencyKey','title','status','score','dueAt','masteredAt','recentHelp','recommendedMode'],label+'.competency');
    const key=text(item.competencyKey,label+'.competencyKey',160);if(seen.has(key))throw Error(label+' has duplicate competency facts');seen.add(key);
    text(item.title,label+'.title',240);
    if(!['DUE','MASTERED','REFRESH_DUE'].includes(item.status))throw Error(label+' has unsupported canonical assignment status');
    finite(item.score,label+'.score',0,100);integer(item.recentHelp,label+'.recentHelp',0,1000000);
    if(!['SHOW_ME','GUIDE_ME','PRACTISE','TEST_ME','NONE'].includes(item.recommendedMode))throw Error(label+' has an unsupported recommendation mode');
    timestamp(item.dueAt,label+'.dueAt');
    const masteredAt=item.masteredAt===null?null:timestamp(item.masteredAt,label+'.masteredAt');
    if(masteredAt!==null&&masteredAt>observedAt)throw Error(label+' declares performance after its supplied source observation');
    if(item.status==='MASTERED'&&(item.score<80||masteredAt===null))throw Error(label+' contradicts the canonical MASTERED floor/performance timestamp');
    if(key===competencyKey)target=item;
  }
  return target;
}
function priority(item){const modeRank={TEST_ME:1,PRACTISE:2,GUIDE_ME:3,SHOW_ME:4,NONE:5}[item.recommendedMode];return modeRank*1000-item.score*5+item.recentHelp*20;}
function evaluateSkillsDemand(input){
  // This is the Lane01-owned inert boundary. Matching metadata below does not
  // authenticate the actual producer, source revision, scope or competence.
  const value=inertJsonCopy(input,'skills demand');
  keys(value,['tenant','site','contextRevision','asOf','requirement','people'],'skills demand');
  const tenant=text(value.tenant,'tenant',120),site=text(value.site,'site',160),contextRevision=text(value.contextRevision,'contextRevision'),asOf=timestamp(value.asOf,'asOf'),scope={tenant,site,contextRevision};
  const requirement=value.requirement;keys(requirement,['competencyKey','requiredCount','at','minMasteryScore','provenance'],'requirement');
  const competencyKey=text(requirement.competencyKey,'requirement.competencyKey',160),requiredCount=integer(requirement.requiredCount,'requirement.requiredCount',0,1000);
  if(timestamp(requirement.at,'requirement.at')!==asOf)throw Error('requirement.at must match the explicit asOf');
  const requestedThreshold=Object.hasOwn(requirement,'minMasteryScore')?finite(requirement.minMasteryScore,'requirement.minMasteryScore',0,100):80,minMasteryScore=Math.max(80,requestedThreshold);
  const demandSource=provenance(requirement.provenance,scope,asOf,'demand provenance'),seenPeople=new Set(),profileAssertions=[];
  const people=array(value.people,'people',1000).map(person=>{
    keys(person,['personRef','tenant','site','available','trainingProfile','profileProvenance'],'person');
    const personRef=text(person.personRef,'person.personRef',180);if(seenPeople.has(personRef))throw Error('Duplicate exact personRef');seenPeople.add(personRef);
    if(person.tenant!==tenant||person.site!==site)throw Error('Person wrapper crosses tenant/site scope');
    if(typeof person.available!=='boolean')throw Error('Person availability must be an explicit supplied boolean');
    const source=provenance(person.profileProvenance,scope,asOf,'profile provenance'),item=competencyProfile(person.trainingProfile,competencyKey,source.observedAt,'trainingProfile');
    profileAssertions.push({personRef,...source.assertion});
    const qualified=person.available&&item!==null&&item.status==='MASTERED'&&item.score>=minMasteryScore&&timestamp(item.dueAt,'dueAt')>asOf;
    return{personRef,available:person.available,item,qualified};
  });
  const qualifiedNow=people.filter(x=>x.qualified).map(x=>x.personRef).sort(),gapCount=Math.max(0,requiredCount-qualifiedNow.length);
  const trainingCandidates=people.filter(x=>x.available&&!x.qualified&&x.item!==null).sort((a,b)=>priority(a.item)-priority(b.item)||(a.personRef<b.personRef?-1:a.personRef>b.personRef?1:0)).slice(0,Math.max(gapCount*3,10)).map(x=>({personRef:x.personRef,status:x.item.status,score:x.item.score,recommendedMode:x.item.recommendedMode,dueAt:x.item.dueAt}));
  return freeze({contractVersion:CONTRACT_VERSION,tenant,site,contextRevision,asOf:value.asOf,requirement:{competencyKey,requiredCount,at:requirement.at,minMasteryScore},qualifiedNow,qualifiedCount:qualifiedNow.length,gapCount,gapState:gapCount?'GAP':'COVERED',trainingCandidates,recommendation:gapCount?'REVIEW_SUPPLIED_SKILL_GAP':'NO_SUPPLIED_GAP_ACTION',authority:'RECOMMENDATION_ONLY',executionPermitted:false,schedulingAuthority:'NONE',hrAuthority:'NONE',learningAuthority:'NONE',masteryAwarded:false,sourceAuthentication:'NOT_ESTABLISHED',qualificationBasis:'SUPPLIED_CURRENT_MASTERED_PROFILE_ONLY',sourceAssertions:{demand:demandSource.assertion,profiles:profileAssertions},claimBoundary:'Profile status, availability, verification, producer SHA and source revisions are unauthenticated caller assertions. This advisory comparison does not demonstrate independent mastery, certify work eligibility, authenticate current tenant sources or authorize scheduling/HR actions. Canonical role reconciliation and active competency filtering remain upstream prerequisites.'});
}
module.exports=Object.freeze({CONTRACT_VERSION,evaluateSkillsDemand});
