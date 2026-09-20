export const SKILL_CHAIN_RESILIENCE_VERSION='skill-chain-resilience-v0.1.0';

function clean(v){return typeof v==='string'?v.trim():'';}
function finite(v){return typeof v==='number'&&Number.isFinite(v);}
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}

function validateSource(source,label){
  if(!source||source.authoritative!==true) return {ok:false,reason:'missing_authoritative_'+label};
  if(!clean(source.ref)||!clean(source.revision)) return {ok:false,reason:'missing_provenance_'+label};
  return {ok:true};
}

function workerHasSkill(worker,skillId){
  return Array.isArray(worker?.skills)&&worker.skills.some(s=>{
    if(typeof s==='string') return s===skillId;
    return clean(s?.skillId)===skillId&&s?.current===true;
  });
}

function siteWorkers(input,siteId){
  return (Array.isArray(input.workers)?input.workers:[]).filter(w=>clean(w?.siteId)===siteId);
}

function qualifiedCount(input,siteId,skillId,extraCandidate){
  const ids=new Set();
  for(const worker of siteWorkers(input,siteId)) if(workerHasSkill(worker,skillId)) ids.add(clean(worker.workerId));
  if(extraCandidate&&extraCandidate.siteId===siteId&&extraCandidate.skillId===skillId&&extraCandidate.eligible===true) ids.add(clean(extraCandidate.workerId));
  return ids.size;
}

function flowExposure(flow){
  const value=Number(flow?.valueAtRisk);
  const dependency=Number(flow?.supplyDependencyWeight??1);
  const urgency=Number(flow?.inventoryUrgencyWeight??1);
  if(!finite(value)||value<0||!finite(dependency)||dependency<0||!finite(urgency)||urgency<0) return null;
  return value*dependency*urgency;
}

function evaluateState(input,extraCandidate=null){
  const flows=Array.isArray(input.flows)?input.flows:[];
  const exposed=[];
  for(const flow of flows){
    const siteId=clean(flow?.siteId),flowId=clean(flow?.flowId),skillId=clean(flow?.skillId);
    const minimum=Number(flow?.minimumQualified??1),loss=Number(input.stress?.qualifiedWorkerLoss??1);
    const exposure=flowExposure(flow);
    if(!siteId||!flowId||!skillId||!Number.isInteger(minimum)||minimum<1||!Number.isInteger(loss)||loss<0||exposure==null){
      return {status:'blocked',reason:'invalid_flow_contract',flowId:flowId||null};
    }
    const count=qualifiedCount(input,siteId,skillId,extraCandidate);
    const survives=Math.max(0,count-loss)>=minimum;
    if(!survives) exposed.push({siteId,flowId,skillId,qualifiedCount:count,minimumQualified:minimum,stressLoss:loss,exposure});
  }
  return {status:'evaluated',totalExposure:exposed.reduce((s,x)=>s+x.exposure,0),exposed};
}

function candidateKey(c){return clean(c?.siteId)+'|'+clean(c?.workerId)+'|'+clean(c?.skillId);}

export function evaluateSkillChainResilience(input={}){
  for(const [label,source] of Object.entries({processMap:input.evidence?.processMap,skills:input.evidence?.skills,supplyCriticality:input.evidence?.supplyCriticality})){
    const check=validateSource(source,label);
    if(!check.ok) return {status:'blocked',reason:check.reason};
  }
  const baseline=evaluateState(input);
  if(baseline.status!=='evaluated') return baseline;

  const candidates=[];
  const seen=new Set();
  for(const raw of Array.isArray(input.trainingCandidates)?input.trainingCandidates:[]){
    const candidate={siteId:clean(raw?.siteId),workerId:clean(raw?.workerId),skillId:clean(raw?.skillId),eligible:raw?.eligible===true,trainingHours:Number(raw?.trainingHours??0),trainingCost:Number(raw?.trainingCost??0)};
    const key=candidateKey(candidate);
    if(seen.has(key)||!candidate.siteId||!candidate.workerId||!candidate.skillId) continue;
    seen.add(key);
    if(candidate.eligible!==true||!finite(candidate.trainingHours)||candidate.trainingHours<0||!finite(candidate.trainingCost)||candidate.trainingCost<0) continue;
    const worker=siteWorkers(input,candidate.siteId).find(w=>clean(w?.workerId)===candidate.workerId);
    if(!worker||workerHasSkill(worker,candidate.skillId)) continue;
    const after=evaluateState(input,candidate);
    if(after.status!=='evaluated') continue;
    const exposureReduction=baseline.totalExposure-after.totalExposure;
    candidates.push({...candidate,exposureReduction,residualExposure:after.totalExposure,exposureReductionPerHour:candidate.trainingHours>0?exposureReduction/candidate.trainingHours:exposureReduction});
  }
  candidates.sort((a,b)=>b.exposureReduction-a.exposureReduction||b.exposureReductionPerHour-a.exposureReductionPerHour||a.trainingCost-b.trainingCost);

  const bySkill=new Map();
  for(const row of baseline.exposed){
    const key=row.siteId+'|'+row.skillId;
    const current=bySkill.get(key)||{siteId:row.siteId,skillId:row.skillId,exposure:0,flows:0,qualifiedCount:row.qualifiedCount};
    current.exposure+=row.exposure;current.flows+=1;current.qualifiedCount=Math.min(current.qualifiedCount,row.qualifiedCount);bySkill.set(key,current);
  }
  const exposures=[...bySkill.values()].sort((a,b)=>b.exposure-a.exposure||a.qualifiedCount-b.qualifiedCount);
  const recommendation=candidates.find(c=>c.exposureReduction>0)||null;

  return {
    status:'evaluated',
    baseline:{totalExposure:baseline.totalExposure,exposedFlowCount:baseline.exposed.length,exposures},
    recommendation,
    candidates,
    fallback:recommendation?null:(baseline.totalExposure>0?{type:'backup_required',message:'No eligible internal cross-training candidate removes the current stressed dependency. Consider external cover, process redesign, automation or an approved training pathway.'}:null),
    claimBoundary:'This is a deterministic stress test of operational dependency, not a forecast of disruption probability or a certification decision. Training completion and worker competence remain authoritative elsewhere.'
  };
}

export function compareWithRarestSkillAlternative(result,input={}){
  if(result?.status!=='evaluated') return {status:'unavailable'};
  const workers=Array.isArray(input.workers)?input.workers:[];
  const counts=new Map();
  for(const worker of workers) for(const skill of Array.isArray(worker?.skills)?worker.skills:[]){
    const skillId=typeof skill==='string'?skill:clean(skill?.skillId);
    if(skillId&&(typeof skill==='string'||skill?.current===true)) counts.set(clean(worker.siteId)+'|'+skillId,(counts.get(clean(worker.siteId)+'|'+skillId)||0)+1);
  }
  const candidates=result.candidates.slice();
  if(!candidates.length) return {status:'unavailable'};
  candidates.sort((a,b)=>{
    const ca=counts.get(a.siteId+'|'+a.skillId)??0,cb=counts.get(b.siteId+'|'+b.skillId)??0;
    return ca-cb||b.exposureReduction-a.exposureReduction;
  });
  const rarest=candidates[0];
  return {status:'compared',valueAware:result.recommendation,rarestSkill:rarest,incrementalExposureReduction:(result.recommendation?.exposureReduction??0)-rarest.exposureReduction};
}
