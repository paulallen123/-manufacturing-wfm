export const LOSS_PREVENTION_WORKFORCE_VERSION='loss-prevention-workforce-v0.1.0';

const REQUIRED_EVIDENCE=['impairment','policy','workforce','restorationPlan'];
function clean(v){return typeof v==='string'?v.trim():'';}
function finite(v){return typeof v==='number'&&Number.isFinite(v);}
function clampNonNegative(v){return finite(v)&&v>=0?v:null;}
function nonNegativeInteger(v){return clampNonNegative(v)!=null&&Number.isInteger(v)?v:null;}
function evidenceAge(v){
  if(typeof v!=='number'&&(typeof v!=='string'||!v.trim()))return null;
  const age=Number(v);
  return finite(age)&&age>=0?age:null;
}

function evidenceCheck(evidence,maxAgeMinutes){
  for(const key of REQUIRED_EVIDENCE){
    const item=evidence?.[key];
    if(item?.authoritative!==true)return {ok:false,reason:'missing_authoritative_evidence',type:key};
    if(!clean(item.ref)||!clean(item.revision))return {ok:false,reason:'missing_provenance',type:key};
    const age=evidenceAge(item.ageMinutes);
    if(age==null||age>maxAgeMinutes)return {ok:false,reason:'stale_evidence',type:key};
  }
  return {ok:true};
}

function eligibleAtSite(workers,siteId,role){
  const scoped=(Array.isArray(workers)?workers:[]).filter(worker=>clean(worker?.siteId)===siteId);
  const identityCount=new Map();
  for(const worker of scoped){
    const id=clean(worker?.id);
    if(id)identityCount.set(id,(identityCount.get(id)??0)+1);
  }
  return scoped.filter(worker=>
    identityCount.get(clean(worker?.id))===1 &&
    clean(worker?.siteId)===siteId &&
    worker?.available===true &&
    Array.isArray(worker?.competencies) &&
    worker.competencies.includes(role) &&
    worker?.competencyCurrent===true
  );
}

export function evaluateImpairmentRecoveryPlan(input={}){
  const siteId=clean(input.siteId);
  if(!siteId)return {status:'blocked',reason:'missing_site_scope'};
  const maxAgeMinutes=input.maxEvidenceAgeMinutes===undefined?15:clampNonNegative(input.maxEvidenceAgeMinutes);
  if(maxAgeMinutes==null)return {status:'blocked',reason:'invalid_evidence_age_limit'};
  const checked=evidenceCheck(input.evidence,maxAgeMinutes);
  if(!checked.ok)return {status:'blocked',...checked};

  const impairment=input.impairment??{};
  if(clean(impairment.siteId)!==siteId)return {status:'blocked',reason:'impairment_site_mismatch'};
  if(!['impaired','normal'].includes(impairment.state))return {status:'blocked',reason:'invalid_impairment_state'};
  if(impairment.state==='normal')return {status:'clear',reason:'protection_normal'};

  const policy=input.policy??{};
  if(clean(policy.siteId)!==siteId)return {status:'blocked',reason:'policy_site_mismatch'};
  const controlRole=clean(policy.controlRole);
  const requiredControlHeadcount=nonNegativeInteger(policy.requiredControlHeadcount);
  const baselineRestoreMinutes=clampNonNegative(input.baseline?.restoreMinutes);
  if(!controlRole||requiredControlHeadcount==null||baselineRestoreMinutes==null){
    return {status:'blocked',reason:'invalid_control_policy'};
  }

  const controlWorkers=eligibleAtSite(input.workers,siteId,controlRole);
  if(controlWorkers.length<requiredControlHeadcount){
    return {
      status:'restricted',reason:'mandatory_control_coverage_gap',
      requiredControlHeadcount,availableControlHeadcount:controlWorkers.length,
      actionBoundary:'Do not treat this engine as permit or operating authority. Follow the site safety/loss-prevention authority.'
    };
  }

  const option=input.restorationOption??{};
  if(option.preApproved!==true)return {status:'blocked',reason:'restoration_not_preapproved'};
  if(clean(option.siteId)!==siteId)return {status:'blocked',reason:'restoration_site_mismatch'};
  const candidateRestoreMinutes=clampNonNegative(option.restoreMinutes);
  const extraRestorationPersonMinutes=clampNonNegative(option.additionalPersonMinutes);
  const displacedProductionPersonMinutes=clampNonNegative(option.displacedProductionPersonMinutes);
  if(candidateRestoreMinutes==null||extraRestorationPersonMinutes==null||displacedProductionPersonMinutes==null){
    return {status:'blocked',reason:'invalid_restoration_option'};
  }

  const requiredRestorationCompetencies=Array.isArray(option.requiredCompetencies)?option.requiredCompetencies.map(clean).filter(Boolean):[];
  for(const role of requiredRestorationCompetencies){
    if(!eligibleAtSite(input.workers,siteId,role).length){
      return {status:'blocked',reason:'restoration_competence_gap',role};
    }
  }

  const exposureMinutesReduced=Math.max(0,baselineRestoreMinutes-candidateRestoreMinutes);
  const controlPersonMinutesReleased=exposureMinutesReduced*requiredControlHeadcount;
  const netProductivePersonMinutes=controlPersonMinutesReleased-extraRestorationPersonMinutes-displacedProductionPersonMinutes;
  if(!finite(controlPersonMinutesReleased)||!finite(netProductivePersonMinutes)){
    return {status:'blocked',reason:'invalid_restoration_calculation'};
  }

  const customerCommitmentsProtected=input.guardrails?.customerCommitmentsProtected===true;
  const processSafetyProtected=input.guardrails?.processSafetyProtected===true;
  const qualityProtected=input.guardrails?.qualityProtected===true;
  if(!customerCommitmentsProtected||!processSafetyProtected||!qualityProtected){
    return {status:'blocked',reason:'operational_guardrail_failed'};
  }

  const qualifies=exposureMinutesReduced>0 && netProductivePersonMinutes>=0;
  return {
    status:qualifies?'qualified':'rejected',
    reason:qualifies?'earlier_safe_restoration':'no_net_operational_gain',
    siteId,
    requiredControlHeadcount,
    availableControlHeadcount:controlWorkers.length,
    exposureMinutesReduced,
    controlPersonMinutesReleased,
    netProductivePersonMinutes,
    evidenceRefs:REQUIRED_EVIDENCE.map(type=>({type,ref:clean(input.evidence[type].ref),revision:clean(input.evidence[type].revision)})),
    claimBoundary:'Exposure and capacity figures are deterministic planning outputs, not insurance savings or proof of reduced loss probability.',
    authorityBoundary:'Advisory only. Permit-to-work, fire protection, process safety and insurer/site-engineering authorities remain authoritative.'
  };
}

export function assessHotWorkCoverage({siteId,policy,workers,task}={}){
  const scope=clean(siteId);
  if(!scope||clean(task?.siteId)!==scope||clean(policy?.siteId)!==scope)return {status:'blocked',reason:'site_scope_mismatch'};
  if(task?.hotWork!==true)return {status:'not_applicable'};
  const role=clean(policy?.fireWatchRole);
  const required=nonNegativeInteger(policy?.fireWatchHeadcount);
  if(!role||required==null)return {status:'blocked',reason:'invalid_fire_watch_policy'};
  const hotWorkerId=clean(task?.assignedWorkerId);
  let eligible=eligibleAtSite(workers,scope,role);
  if(policy?.dualRoleProhibited===true)eligible=eligible.filter(w=>clean(w.id)!==hotWorkerId);
  if(eligible.length<required)return {status:'blocked',reason:'fire_watch_gap',required,available:eligible.length};
  return {status:'covered',required,available:eligible.length,workerIds:eligible.slice(0,required).map(w=>w.id)};
}
