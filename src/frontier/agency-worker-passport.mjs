import crypto from 'node:crypto';

export const AGENCY_WORKER_PASSPORT_VERSION = 'agency-worker-passport-v0.1.0';

const SENSITIVE = new Set([
  'age','dateOfBirth','sex','gender','genderIdentity','race','ethnicity','religion',
  'disability','maritalStatus','pregnancy','sexualOrientation','nationality','politicalOpinion'
]);
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const c=v=>Math.max(0,Math.min(1,n(v)));
const ms=value=>{
  const parsed=typeof value==='number'?value:Date.parse(value);
  return Number.isFinite(parsed)?parsed:null;
};
const stable=value=>Array.isArray(value)
  ? value.map(stable)
  : value&&typeof value==='object'
    ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]))
    : value;
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');

const completedAssignment = row => row && ['completed','worked','closed'].includes(row.status);
const verifiedSkill = skill => !!skill && (
  skill.verified === true ||
  skill.verification?.status === 'verified' ||
  skill.source === 'observed_competence'
);
const validQualification = (qualification,now) => {
  if(!qualification || qualification.status==='invalid' || qualification.status==='expired') return false;
  if(qualification.noExpiry===true) return true;
  if(!qualification.validUntil) return qualification.status==='valid';
  const end=ms(qualification.validUntil), nowMs=ms(now);
  return end!==null && (nowMs===null || end>=nowMs);
};

function familiarity(assignments,key,value){
  if(!value) return {completed:0,lastCompletedAt:null};
  const rows=assignments.filter(row=>completedAssignment(row)&&row[key]===value);
  const latest=rows.map(row=>ms(row.endAt||row.completedAt)).filter(x=>x!==null).sort((a,b)=>b-a)[0]??null;
  return {completed:rows.length,lastCompletedAt:latest===null?null:new Date(latest).toISOString()};
}

function reliability(outcomes=[]){
  let accepted=0,attended=0,onTime=0,quality=0,qualityCount=0,productive=0,productiveCount=0,optionalDeclines=0;
  for(const row of outcomes){
    if(!row) continue;
    if(row.type==='optional_shift_declined'){optionalDeclines++;continue;}
    if(row.type==='shift_accepted') accepted++;
    if(row.type==='shift_attended'){attended++;accepted=Math.max(accepted,attended);}
    if(row.type==='shift_on_time') onTime++;
    if(row.type==='quality_score' && Number.isFinite(Number(row.value))){quality+=c(row.value);qualityCount++;}
    if(row.type==='productivity_score' && Number.isFinite(Number(row.value))){productive+=c(row.value);productiveCount++;}
  }
  const attendanceRate=accepted?attended/accepted:.5;
  const punctualityRate=attended?onTime/attended:.5;
  return {
    acceptedAssignments:accepted,
    attendedAssignments:attended,
    attendanceRate:c(attendanceRate),
    punctualityRate:c(punctualityRate),
    qualityScore:qualityCount?quality/qualityCount:.5,
    productivityScore:productiveCount?productive/productiveCount:.5,
    optionalShiftDeclines:optionalDeclines,
    note:'optional_shift_declines_do_not_reduce_reliability'
  };
}

function trainingState(training=[]){
  const completed=training.filter(row=>row&&row.status==='completed');
  const verified=completed.filter(row=>row.verified===true||row.assessmentPassed===true||row.observedCompetence===true);
  const skills=new Map();
  for(const row of verified){
    if(!row.skillId) continue;
    const existing=skills.get(row.skillId);
    const level=Math.max(1,n(row.level,1));
    if(!existing||level>existing.level) skills.set(row.skillId,{id:row.skillId,level,source:'verified_training',verified:true,completedAt:row.completedAt??null});
  }
  return {completedCount:completed.length,verifiedCount:verified.length,verifiedSkills:[...skills.values()].sort((a,b)=>a.id.localeCompare(b.id))};
}

export function buildAgencyWorkerCapabilityPassport(input={}){
  const worker=input.worker||{};
  if(typeof worker.workerId!=='string'||!worker.workerId) throw new TypeError('worker.workerId is required');
  if(typeof worker.agencyId!=='string'||!worker.agencyId) throw new TypeError('worker.agencyId is required');

  const assignments=Array.isArray(input.assignments)?input.assignments:[];
  const training=Array.isArray(input.training)?input.training:[];
  const outcomes=Array.isArray(input.outcomes)?input.outcomes:[];
  const now=input.now??null;
  const ignoredSensitiveFields=Object.keys(worker).filter(key=>SENSITIVE.has(key)).sort();

  const trainingSummary=trainingState(training);
  const skillMap=new Map();
  for(const skill of [...(Array.isArray(worker.skills)?worker.skills:[]),...trainingSummary.verifiedSkills]){
    if(!skill?.id || !verifiedSkill(skill)) continue;
    const existing=skillMap.get(skill.id);
    const level=Math.max(1,n(skill.level,1));
    if(!existing||level>existing.level) skillMap.set(skill.id,{id:skill.id,level,verified:true,source:skill.source??skill.verification?.source??'verified_evidence'});
  }

  const qualifications=(Array.isArray(worker.qualifications)?worker.qualifications:[])
    .filter(q=>validQualification(q,now))
    .map(q=>({id:q.id??null,level:n(q.level,1),validUntil:q.noExpiry===true?null:(q.validUntil??null),noExpiry:q.noExpiry===true,status:'valid'}))
    .filter(q=>q.id)
    .sort((a,b)=>a.id.localeCompare(b.id));

  const site=familiarity(assignments,'siteId',input.context?.siteId);
  const role=familiarity(assignments,'roleId',input.context?.roleId);
  const line=familiarity(assignments,'lineId',input.context?.lineId);
  const rel=reliability(outcomes);

  const preferences={
    preferredSiteIds:[...(input.preferences?.preferredSiteIds??worker.preferences?.preferredSiteIds??[])],
    preferredRoleIds:[...(input.preferences?.preferredRoleIds??worker.preferences?.preferredRoleIds??[])],
    preferredShiftTypes:[...(input.preferences?.preferredShiftTypes??worker.preferences?.preferredShiftTypes??[])],
    travelRadiusKm:n(input.preferences?.travelRadiusKm??worker.preferences?.travelRadiusKm,0),
    minimumNoticeMinutes:n(input.preferences?.minimumNoticeMinutes??worker.preferences?.minimumNoticeMinutes,0),
    repeatAssignmentsPreferred:(input.preferences?.repeatAssignmentsPreferred??worker.preferences?.repeatAssignmentsPreferred)===true,
  };

  const siteReadiness={
    rightToWorkStatus:worker.rightToWork?.status??'unknown',
    siteReady:worker.siteReady===true,
    inductionReady:worker.inductionNoExpiry===true || (ms(worker.inductionValidUntil)!==null && (ms(now)===null || ms(worker.inductionValidUntil)>=ms(now))),
    restConfirmed:worker.restCompliant===true,
    suitabilityStatus:worker.suitabilityStatus??'unknown',
  };

  const evidenceUnits=
    rel.attendedAssignments+
    site.completed+
    role.completed+
    line.completed+
    skillMap.size*2+
    qualifications.length*2+
    trainingSummary.verifiedCount*2;
  const evidenceConfidence=c(evidenceUnits/40);

  const capabilityGraph={
    verifiedSkills:[...skillMap.values()].sort((a,b)=>a.id.localeCompare(b.id)),
    qualifications,
    siteFamiliarity:site,
    roleFamiliarity:role,
    lineFamiliarity:line,
    training:trainingSummary,
    reliability:rel,
  };

  const improvementOpportunities=[];
  if(!site.completed && input.context?.siteId) improvementOpportunities.push('first_site_shift_support');
  if(!line.completed && input.context?.lineId) improvementOpportunities.push('line_specific_conversion_or_buddy');
  if(trainingSummary.verifiedCount===0) improvementOpportunities.push('verified_training_pathway');
  if(evidenceConfidence<.4) improvementOpportunities.push('build_evidence_without_locking_out_new_worker');

  const passport={
    version:AGENCY_WORKER_PASSPORT_VERSION,
    workerId:worker.workerId,
    agencyId:worker.agencyId,
    context:structuredClone(input.context??{}),
    capabilityGraph,
    siteReadiness,
    preferences,
    evidenceConfidence,
    ignoredSensitiveFields,
    fairnessBoundary:'protected_or_sensitive_attributes_not_used_to_rank_or_reduce_opportunity',
    workerChoiceBoundary:'declining_an_optional_offer_is_not_a_reliability_failure',
    improvementOpportunities,
    generatedAt:now,
  };
  passport.passportHash=hash(passport);
  return passport;
}

export function applyVerifiedCapabilityProgression(passport,progress={}){
  if(!passport?.workerId) throw new TypeError('valid passport is required');
  if(progress.verified!==true && progress.assessmentPassed!==true && progress.observedCompetence!==true) {
    return {...structuredClone(passport),progressionApplied:false,progressionReason:'unverified_progression_not_applied'};
  }
  if(typeof progress.skillId!=='string'||!progress.skillId) throw new TypeError('progress.skillId is required');

  const next=structuredClone(passport);
  const skills=Array.isArray(next.capabilityGraph?.verifiedSkills)?next.capabilityGraph.verifiedSkills:[];
  const existing=skills.find(skill=>skill.id===progress.skillId);
  const level=Math.max(1,n(progress.level,1));
  if(existing) existing.level=Math.max(existing.level,level);
  else skills.push({id:progress.skillId,level,verified:true,source:'verified_progression'});
  skills.sort((a,b)=>a.id.localeCompare(b.id));
  next.capabilityGraph.verifiedSkills=skills;
  next.capabilityGraph.training.verifiedCount=n(next.capabilityGraph.training.verifiedCount)+1;
  next.progressionApplied=true;
  next.progressionReason='verified_capability_added';
  next.progressionEvidence={skillId:progress.skillId,level,completedAt:progress.completedAt??null,evidenceRef:progress.evidenceRef??null};
  next.evidenceConfidence=c(n(next.evidenceConfidence)+.05);
  delete next.passportHash;
  next.passportHash=hash(next);
  return next;
}
