import crypto from 'node:crypto';
import { evaluateAgencyCandidate } from './agency-labour-exchange.mjs';
import { profileAgencyPerformance } from './agency-labour-performance.mjs';

export const AGENCY_OPERATIONS_INTELLIGENCE_VERSION='agency-operations-intelligence-v0.1.0';

const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const c=v=>Math.max(0,Math.min(1,n(v)));
const stable=value=>Array.isArray(value)
  ? value.map(stable)
  : value&&typeof value==='object'
    ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]))
    : value;
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
function lcg(seed){
  let s=(typeof seed==='number'?seed:parseInt(hash(String(seed??'vector')).slice(0,8),16))>>>0;
  return ()=>((s=(Math.imul(1664525,s)+1013904223)>>>0)/2**32);
}
const percentile=(values,p)=>{
  if(!values.length)return 0;
  const sorted=[...values].sort((a,b)=>a-b);
  const i=Math.max(0,Math.min(sorted.length-1,Math.floor((sorted.length-1)*p)));
  return sorted[i];
};

export function rankAgencyWorkersContextually({workers=[],agencies=[],request={},policy={},now=null,passports=[]}={}){
  const agencyById=new Map(agencies.map(a=>[a.agencyId,a]));
  const passportByWorker=new Map(passports.map(p=>[p.workerId,p]));
  const rows=[];
  for(const worker of workers){
    const evaluation=evaluateAgencyCandidate(worker,request,agencyById.get(worker.agencyId),{...policy,now,tenantId:policy.tenantId});
    if(!evaluation.eligible){
      rows.push({workerId:worker.workerId,agencyId:worker.agencyId,eligible:false,failures:evaluation.failures,warnings:evaluation.warnings,contextualSuccessProbability:0,evidenceConfidence:0});
      continue;
    }
    const passport=passportByWorker.get(worker.workerId);
    const base=c(evaluation.score?.score??.5);
    const siteContinuity=c((passport?.capabilityGraph?.siteFamiliarity?.completed??worker.performance?.completedSiteShifts??0)/12);
    const roleContinuity=c((passport?.capabilityGraph?.roleFamiliarity?.completed??worker.performance?.completedRoleShifts??0)/12);
    const lineContinuity=c((passport?.capabilityGraph?.lineFamiliarity?.completed??0)/8);
    const preferenceFit=(()=>{
      let score=.5,parts=0,total=0;
      const prefs=passport?.preferences??worker.preferences??{};
      if(request.siteId){parts++;total+=(prefs.preferredSiteIds||[]).includes(request.siteId)?1:.5;}
      if(request.roleId){parts++;total+=(prefs.preferredRoleIds||[]).includes(request.roleId)?1:.5;}
      if(request.shiftType){parts++;total+=(prefs.preferredShiftTypes||[]).includes(request.shiftType)?1:.5;}
      if(parts)score=total/parts;
      return c(score);
    })();
    const evidenceConfidence=c(Math.max(evaluation.score?.evidenceConfidence??0,passport?.evidenceConfidence??0));
    const newWorkerExploration=evidenceConfidence<.25?Math.min(.03,n(policy.newWorkerExplorationBonus,.02)) : 0;
    const contextualSuccessProbability=c(
      base*.58+
      siteContinuity*.14+
      roleContinuity*.11+
      lineContinuity*.07+
      preferenceFit*.10+
      newWorkerExploration
    );
    rows.push({
      workerId:worker.workerId,
      agencyId:worker.agencyId,
      eligible:true,
      failures:[],
      warnings:evaluation.warnings,
      contextualSuccessProbability,
      evidenceConfidence,
      components:{base,siteContinuity,roleContinuity,lineContinuity,preferenceFit,newWorkerExploration},
      explainability:{
        strongestDrivers:Object.entries({base,siteContinuity,roleContinuity,lineContinuity,preferenceFit})
          .sort((a,b)=>b[1]-a[1]).slice(0,3).map(([key,value])=>({key,value})),
        uncertainty:evidenceConfidence<.4?'limited_comparable_history':'normal',
        fairnessBoundary:'protected_attributes_are_not_ranking_inputs_and_new_workers_are_not_locked_out_by_missing_history',
      },
    });
  }
  return rows.sort((a,b)=>
    Number(b.eligible)-Number(a.eligible) ||
    b.contextualSuccessProbability-a.contextualSuccessProbability ||
    b.evidenceConfidence-a.evidenceConfidence ||
    String(a.workerId).localeCompare(String(b.workerId))
  );
}

function realisedOutcomeMetrics(events,agencyId){
  const rows=(Array.isArray(events)?events:[]).filter(e=>e&&e.agencyId===agencyId);
  let goodUnits=0,totalUnits=0,labourCost=0,failures=0,completed=0,firstShiftSuccess=0,firstShiftCount=0,continuity=0,continuityCount=0;
  for(const e of rows){
    if(e.type==='production_outcome'){
      goodUnits+=Math.max(0,n(e.goodUnits));
      totalUnits+=Math.max(0,n(e.totalUnits,n(e.goodUnits)));
      labourCost+=Math.max(0,n(e.labourCost));
      if(e.productionFailure===true)failures++;
      completed++;
    }
    if(e.type==='first_shift_outcome'){
      firstShiftCount++;
      if(e.success===true)firstShiftSuccess++;
    }
    if(e.type==='repeat_worker_outcome'){
      continuityCount++;
      if(e.success===true)continuity++;
    }
  }
  const qualityRate=totalUnits?goodUnits/totalUnits:.5;
  const costPerGoodUnit=goodUnits?labourCost/goodUnits:null;
  return {
    completed,
    qualityRate:c(qualityRate),
    productionFailureRate:completed?failures/completed:.05,
    firstShiftSuccessRate:firstShiftCount?firstShiftSuccess/firstShiftCount:.5,
    continuitySuccessRate:continuityCount?continuity/continuityCount:.5,
    costPerGoodUnit,
    evidenceCount:Math.max(completed,firstShiftCount,continuityCount)
  };
}

export function rankAgencySuppliersByRealisedOutcome({agencies=[],events=[],request={},now=null}={}){
  return agencies.map(agency=>{
    const baseline=profileAgencyPerformance({
      agencyId:agency.agencyId,
      events,
      request,
      now,
      responseTargetMinutes:agency.responseSlaMinutes??request.responseTargetMinutes??15,
      maxChargePerHour:request.maxChargePerHour??null
    });
    const realised=realisedOutcomeMetrics(events,agency.agencyId);
    const costScore=realised.costPerGoodUnit===null||!Number.isFinite(n(request.targetCostPerGoodUnit,NaN))
      ? .5
      : c(1-realised.costPerGoodUnit/Math.max(.0001,n(request.targetCostPerGoodUnit)));
    const outcomeScore=
      baseline.score*.45+
      realised.qualityRate*.16+
      (1-realised.productionFailureRate)*.12+
      realised.firstShiftSuccessRate*.10+
      realised.continuitySuccessRate*.07+
      costScore*.10;
    const evidenceConfidence=c(Math.max(baseline.evidenceConfidence,realised.evidenceCount/40));
    return {
      agencyId:agency.agencyId,
      outcomeScore:c(outcomeScore),
      evidenceConfidence,
      baseline,
      realised,
      totalCostOfFailureSignal:c(realised.productionFailureRate*.6+(1-realised.qualityRate)*.4),
      explanation:'supplier_order_uses_realised_operational_outcomes_not_rate_or_fill_alone'
    };
  }).sort((a,b)=>
    b.outcomeScore-a.outcomeScore ||
    b.evidenceConfidence-a.evidenceConfidence ||
    a.agencyId.localeCompare(b.agencyId)
  );
}

export function simulateFlexibleLabourOptions({options=[],seed='vector-agency',runs=1000,riskPenalty=.25}={}){
  if(!Array.isArray(options)||!options.length) throw new TypeError('options are required');
  const count=Math.max(100,Math.min(5000,Math.floor(n(runs,1000))));
  const results=[];
  for(const option of options){
    if(typeof option.id!=='string'||!option.id) throw new TypeError('every option requires id');
    const rnd=lcg(hash(seed+':'+option.id));
    const values=[];
    let success=0;
    for(let i=0;i<count;i++){
      const fill=rnd()<c(option.fillProbability??1);
      const quality=rnd()<c(option.qualityPassProbability??1);
      const productivityBase=Math.max(0,n(option.productivityFactor,1));
      const productivityVariance=Math.max(0,n(option.productivityVariance,.05));
      const productivity=Math.max(0,productivityBase+((rnd()-.5)*2*productivityVariance));
      const productionValue=Math.max(0,n(option.productionValue))*productivity*(fill?1:0)*(quality?1:n(option.qualityFailureValueFactor,.6));
      const labourCost=Math.max(0,n(option.labourCost));
      const disruptionCost=fill?0:Math.max(0,n(option.shortageCost));
      const qualityCost=quality?0:Math.max(0,n(option.qualityFailureCost));
      const net=productionValue-labourCost-disruptionCost-qualityCost;
      values.push(net);
      if(fill&&quality)success++;
    }
    const expectedNetValue=values.reduce((a,b)=>a+b,0)/values.length;
    const p10=percentile(values,.10);
    const p90=percentile(values,.90);
    const riskAdjustedValue=expectedNetValue-Math.max(0,expectedNetValue-p10)*Math.max(0,n(riskPenalty,.25));
    results.push({
      id:option.id,
      expectedNetValue,
      riskAdjustedValue,
      p10,
      p90,
      serviceSuccessProbability:success/count,
      runs:count,
      assumptions:{
        fillProbability:c(option.fillProbability??1),
        qualityPassProbability:c(option.qualityPassProbability??1),
        productivityFactor:Math.max(0,n(option.productivityFactor,1)),
        labourCost:Math.max(0,n(option.labourCost)),
        productionValue:Math.max(0,n(option.productionValue))
      }
    });
  }
  return results.sort((a,b)=>
    b.riskAdjustedValue-a.riskAdjustedValue ||
    b.serviceSuccessProbability-a.serviceSuccessProbability ||
    b.expectedNetValue-a.expectedNetValue ||
    a.id.localeCompare(b.id)
  );
}

export function assessAgencyAutonomyAuthority(input={}){
  const reasons=[];
  if(input.compliancePass!==true) reasons.push('compliance_not_confirmed');
  if(input.withinPolicy!==true) reasons.push('outside_customer_policy');
  if(c(input.confidence)<c(input.minimumConfidence??.9)) reasons.push('confidence_below_threshold');
  if(input.reversible!==true) reasons.push('action_not_safely_reversible');
  if(input.highRisk===true) reasons.push('high_risk_decision');
  if(input.adverseEmploymentImpact===true) reasons.push('adverse_employment_impact_requires_human_review');
  if(c(input.dataQuality)<c(input.minimumDataQuality??.85)) reasons.push('data_quality_below_threshold');

  const executeAutomatically=reasons.length===0;
  return {
    executeAutomatically,
    authorityLevel:executeAutomatically?'bounded_decide_and_execute':'prepare_or_recommend_only',
    reasons,
    boundary:'ai_never_overrides_compliance_safety_worker_rights_or_customer_authority',
  };
}
