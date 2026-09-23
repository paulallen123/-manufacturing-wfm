'use strict';

const CONTRACT_VERSION='VECTOR_SKILLS_DEMAND_INTELLIGENCE_V1';
const TRAINING_TWIN_VERSION='VECTOR_TRAINING_TWIN_V1';

function text(v,max=240){return String(v??'').trim().slice(0,max);}
function iso(v,name){const raw=text(v,80),ms=Date.parse(raw);if(!raw||!Number.isFinite(ms)) throw new Error(name+' must be a valid ISO timestamp.');return new Date(ms).toISOString();}
function list(v,max=30,maxLen=220){return Array.isArray(v)?[...new Set(v.map(x=>text(x,maxLen)).filter(Boolean))].slice(0,max):[];}

function competency(profile,key){return (profile?.competencies||[]).find(item=>String(item.competencyKey)===key)||null;}
function isCurrentMastery(item,at,minScore){
  if(!item||String(item.status)!=='MASTERED'||Number(item.score)<minScore) return false;
  const due=Date.parse(String(item.dueAt||''));
  return Number.isFinite(due)&&due>Date.parse(at);
}
function trainingPriority(item){
  if(!item) return 9999;
  const mode=String(item.recommendedMode||'');
  const modeRank={TEST_ME:1,PRACTISE:2,GUIDE_ME:3,SHOW_ME:4,NONE:5}[mode]||6;
  return modeRank*1000-(Number(item.score)||0)*5+(Number(item.recentHelp)||0)*20;
}

function evaluateSkillsDemand(input={}){
  const tenant=text(input.tenant,120),site=text(input.site,160),requirement=input.requirement||{};
  if(!tenant||!site) throw new Error('tenant and site are required.');
  if(requirement.verified!==true||!text(requirement.sourceRef,220)) throw new Error('Skills demand requires verified authoritative source evidence.');
  const competencyKey=text(requirement.competencyKey,160),requiredCount=Number(requirement.requiredCount),at=iso(requirement.at,'requirement.at');
  if(!competencyKey||!Number.isSafeInteger(requiredCount)||requiredCount<0) throw new Error('requirement competencyKey and non-negative integer requiredCount are required.');
  const minScore=Number.isFinite(Number(requirement.minMasteryScore))?Math.max(0,Math.min(100,Number(requirement.minMasteryScore))):80;

  const people=(Array.isArray(input.people)?input.people:[]).map(person=>{
    const personRef=text(person.personRef,180);
    if(!personRef) throw new Error('Each person requires personRef.');
    const profile=person.trainingProfile;
    if(!profile||profile.contractVersion!==TRAINING_TWIN_VERSION) throw new Error('Each person requires a valid Training Twin profile.');
    if(person.tenant&&text(person.tenant,120)!==tenant) throw new Error('Cross-tenant person data denied.');
    if(person.site&&text(person.site,160)!==site) throw new Error('Cross-site person data denied.');
    const item=competency(profile,competencyKey);
    return {personRef,available:person.available===true,item,qualified:person.available===true&&isCurrentMastery(item,at,minScore)};
  });

  const qualified=people.filter(p=>p.qualified).map(p=>p.personRef).sort();
  const gapCount=Math.max(0,requiredCount-qualified.length);
  const trainingCandidates=people.filter(p=>p.available&&!p.qualified&&p.item)
    .sort((a,b)=>trainingPriority(a.item)-trainingPriority(b.item)||a.personRef.localeCompare(b.personRef))
    .slice(0,Math.max(gapCount*3,10))
    .map(p=>({personRef:p.personRef,status:text(p.item.status,40),score:Number(p.item.score||0),recommendedMode:text(p.item.recommendedMode,40),dueAt:text(p.item.dueAt,80)}));

  return Object.freeze({
    contractVersion:CONTRACT_VERSION,tenant,site,
    requirement:{
      competencyKey,requiredCount,at,minMasteryScore:minScore,
      lineRef:requirement.lineRef?text(requirement.lineRef,180):null,
      workOrderRef:requirement.workOrderRef?text(requirement.workOrderRef,180):null,
      sourceRef:text(requirement.sourceRef,220),
      evidenceRefs:list(requirement.evidenceRefs,20,220)
    },
    qualifiedNow:qualified,
    qualifiedCount:qualified.length,
    gapCount,
    gapState:gapCount>0?'GAP':'COVERED',
    trainingCandidates,
    recommendation:gapCount>0?'PRIORITISE_VERIFIED_SKILL_GAP':'NO_GAP_ACTION_REQUIRED',
    authority:'RECOMMENDATION_ONLY',
    executionPermitted:false,
    claimBoundary:'This projection identifies verified skill coverage gaps from Training Twin evidence and authoritative demand. It does not assign shifts, certify competence or grant work authority.'
  });
}

module.exports=Object.freeze({CONTRACT_VERSION,evaluateSkillsDemand,isCurrentMastery,trainingPriority});
