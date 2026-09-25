import crypto from 'node:crypto';
import { planAgencyLabourFulfilment } from './agency-labour-exchange.mjs';
import { buildAgencyWorkerCapabilityPassport } from './agency-worker-passport.mjs';
import {
  rankAgencyWorkersContextually,
  rankAgencySuppliersByRealisedOutcome,
  simulateFlexibleLabourOptions,
  assessAgencyAutonomyAuthority
} from './agency-operations-intelligence.mjs';
import { createAgencyDecisionRecord } from './agency-decision-ledger.mjs';

export const AGENCY_OPERATING_SYSTEM_VERSION='agency-operating-system-v0.1.0';

const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const stable=value=>Array.isArray(value)
  ? value.map(stable)
  : value&&typeof value==='object'
    ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]))
    : value;
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');

function workerPacket(worker,passport,request){
  return {
    workerId:worker.workerId,
    agencyId:worker.agencyId,
    shift:{
      siteId:request.siteId??null,
      location:request.location??null,
      roleId:request.roleId??null,
      roleName:request.roleName??null,
      startAt:request.startAt??null,
      endAt:request.endAt??null,
      shiftType:request.shiftType??null,
      payDisplay:request.workerPayDisplay??null,
    },
    readiness:{
      siteReady:passport?.siteReadiness?.siteReady===true,
      inductionReady:passport?.siteReadiness?.inductionReady===true,
      restConfirmed:passport?.siteReadiness?.restConfirmed===true,
      rightToWorkStatus:passport?.siteReadiness?.rightToWorkStatus??'unknown',
    },
    preparation:{
      improvementOpportunities:passport?.improvementOpportunities??[],
      verifiedSkills:passport?.capabilityGraph?.verifiedSkills??[],
      qualifications:passport?.capabilityGraph?.qualifications??[],
    },
    workerChoice:{
      preferences:passport?.preferences??{},
      declineOptionalShiftPenalty:false,
    },
    experienceBoundary:'one_clear_shift_view_preparation_transparency_timesheet_visibility_and_rebooking_continuity'
  };
}

function agencyDemandPacket(request,rankedWorkers,supplierRanking){
  return {
    requestId:request.requestId??null,
    machineReadableDemand:{
      siteId:request.siteId??null,
      roleId:request.roleId??null,
      roleName:request.roleName??null,
      count:Number(request.count||0),
      startAt:request.startAt??null,
      endAt:request.endAt??null,
      requiredSkills:structuredClone(request.requiredSkills??[]),
      requiredQualifications:structuredClone(request.requiredQualifications??[]),
      healthSafetyRisks:structuredClone(request.healthSafetyRisks??[]),
      maxChargePerHour:request.maxChargePerHour??null,
    },
    candidateFeedback:rankedWorkers.map(row=>({
      workerId:row.workerId,
      agencyId:row.agencyId,
      eligible:row.eligible,
      contextualSuccessProbability:row.contextualSuccessProbability,
      failures:row.failures,
      uncertainty:row.explainability?.uncertainty??null,
    })),
    supplierFeedback:supplierRanking.map(row=>({
      agencyId:row.agencyId,
      outcomeScore:row.outcomeScore,
      evidenceConfidence:row.evidenceConfidence,
      totalCostOfFailureSignal:row.totalCostOfFailureSignal,
    })),
    experienceBoundary:'precise_demand_fast_submission_rejection_reasons_live_fill_visibility_and_dispute_prevention'
  };
}

function defaultOperationalOptions(input,fulfilment,workerRanking){
  const request=input.request||{};
  const count=Math.max(1,Number(request.count||1));
  const best=workerRanking.filter(x=>x.eligible).slice(0,count);
  const avgSuccess=best.length?best.reduce((s,x)=>s+x.contextualSuccessProbability,0)/best.length:.5;
  const agencyCost=best.reduce((s,row)=>{
    const worker=(input.candidates||[]).find(w=>w.workerId===row.workerId);
    return s+Math.max(0,n(worker?.chargeRatePerHour))*Math.max(0,n(request.durationHours,8));
  },0);
  const protectedValue=Math.max(0,n(input.productionEconomics?.productionValueAtRisk,0));
  return [{
    id:'agency_fulfilment',
    fillProbability:Math.min(1,avgSuccess),
    qualityPassProbability:Math.max(.5,avgSuccess),
    productivityFactor:Math.max(.5,avgSuccess),
    productivityVariance:.08,
    labourCost:agencyCost,
    productionValue:protectedValue,
    shortageCost:Math.max(0,n(input.productionEconomics?.shortageCost,protectedValue*.7)),
    qualityFailureCost:Math.max(0,n(input.productionEconomics?.qualityFailureCost,protectedValue*.1)),
  }];
}

export function runAgencyOperatingSystem(input={}){
  if(!input.tenantId||!input.siteId) throw new TypeError('tenantId and siteId are required');
  const request={...(input.request||{}),siteId:input.siteId};
  const fulfilment=planAgencyLabourFulfilment({...input,request});
  const passports=(Array.isArray(input.candidates)?input.candidates:[]).map(worker=>buildAgencyWorkerCapabilityPassport({
    worker,
    assignments:(input.assignmentHistory||[]).filter(x=>x.workerId===worker.workerId),
    training:(input.trainingHistory||[]).filter(x=>x.workerId===worker.workerId),
    outcomes:(input.workerOutcomes||[]).filter(x=>x.workerId===worker.workerId),
    preferences:worker.preferences,
    context:{siteId:input.siteId,roleId:request.roleId,lineId:request.lineId},
    now:input.now??null,
  }));

  const workerRanking=rankAgencyWorkersContextually({
    workers:input.candidates||[],
    agencies:input.agencies||[],
    request,
    policy:{...(input.policy||{}),tenantId:input.tenantId},
    now:input.now??null,
    passports,
  });
  const supplierRanking=rankAgencySuppliersByRealisedOutcome({
    agencies:input.agencies||[],
    events:input.agencyEvents||[],
    request,
    now:input.now??null,
  });

  const options=Array.isArray(input.operationalOptions)&&input.operationalOptions.length
    ? input.operationalOptions
    : defaultOperationalOptions(input,fulfilment,workerRanking);
  const simulation=simulateFlexibleLabourOptions({
    options,
    seed:input.simulationSeed??request.requestId??'vector-agency',
    runs:input.simulationRuns??1000,
    riskPenalty:input.riskPenalty??.25,
  });
  const recommended=simulation[0];

  const autonomy=assessAgencyAutonomyAuthority({
    compliancePass:fulfilment.status!=='request_blocked' && fulfilment.rejectedWorkers?.every(x=>!x.eligible) !== false,
    withinPolicy:input.policy?.withinAuthority===true,
    confidence:Math.min(1,Math.max(0,recommended?.serviceSuccessProbability??0)),
    minimumConfidence:input.policy?.minimumAutoConfidence??.92,
    reversible:input.policy?.reversibleAgencyDispatch===true,
    highRisk:request.highRisk===true || (request.healthSafetyRisks||[]).some(x=>x?.severity==='high'),
    adverseEmploymentImpact:false,
    dataQuality:input.dataQuality??1,
    minimumDataQuality:input.policy?.minimumDataQuality??.9,
  });

  const selectedAlternativeId=recommended?.id??options[0]?.id;
  const decisionRecord=createAgencyDecisionRecord({
    tenantId:input.tenantId,
    decisionId:input.decisionId??('agency:'+String(request.requestId??hash({request,now:input.now})).slice(0,24)),
    decidedAt:input.now??null,
    context:{
      siteId:input.siteId,
      requestId:request.requestId??null,
      roleId:request.roleId??null,
      productionEconomics:structuredClone(input.productionEconomics??{}),
    },
    alternatives:simulation,
    selectedAlternativeId,
    evidence:{
      fulfilmentHash:fulfilment.reproducibilityHash??null,
      workerPassportHashes:passports.map(p=>p.passportHash),
      rankedWorkers:workerRanking.map(x=>({workerId:x.workerId,eligible:x.eligible,probability:x.contextualSuccessProbability,evidenceConfidence:x.evidenceConfidence})),
      supplierRanking:supplierRanking.map(x=>({agencyId:x.agencyId,outcomeScore:x.outcomeScore,evidenceConfidence:x.evidenceConfidence})),
    },
    policy:{
      autonomy,
      agencyPolicy:structuredClone(input.policy??{}),
    },
    modelVersions:{
      operatingSystem:AGENCY_OPERATING_SYSTEM_VERSION,
      fulfilment:fulfilment.engineVersion??null,
    },
    approval:{
      required:!autonomy.executeAutomatically,
      status:autonomy.executeAutomatically?'pre_authorised_policy':'pending_human_approval',
    },
  });

  const workerExperience=(input.candidates||[]).map(worker=>workerPacket(
    worker,
    passports.find(p=>p.workerId===worker.workerId),
    request
  ));
  const agencyExperience=agencyDemandPacket(request,workerRanking,supplierRanking);

  const output={
    version:AGENCY_OPERATING_SYSTEM_VERSION,
    operatingModel:'production_to_flexible_labour_closed_loop',
    status:fulfilment.status==='request_blocked'?'blocked':'decision_ready',
    fulfilment,
    workerPassports:passports,
    workerRanking,
    supplierRanking,
    simulation,
    recommendation:recommended,
    autonomy,
    decisionRecord,
    experiences:{
      operations:{
        sees:['demand_gap','internal_and_external_options','cost','risk','confidence','supplier_and_worker_outcomes'],
        decides:['recommended_labour_mix','supplier_order','worker_preference_order','approval_or_bounded_execution'],
        learns:['attendance','production','quality','safety','cost','invoice','manager_intervention'],
      },
      agency:agencyExperience,
      workers:workerExperience,
    },
    hardBoundaries:[
      'compliance_and_safety_are_hard_gates',
      'protected_attributes_are_not_ranking_inputs',
      'optional_shift_declines_do_not_reduce_worker_reliability',
      'no_direct_payroll_or_worker_pay_mutation_from_ai_ranking',
      'high_impact_or_non_reversible_actions_require_human_authority'
    ],
  };
  output.reproducibilityHash=hash(output);
  return output;
}
