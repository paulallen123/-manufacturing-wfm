export const CASH_TO_CAPACITY_ENGINE_VERSION='cash-to-capacity-engine-v0.1.0';

const REQUIRED_EVIDENCE=['productionPlan','workforceEligibility','customerCommitment','financialMilestone'];
const DAY_MS=86400000;

function finite(v){return typeof v==='number'&&Number.isFinite(v);}
function clean(v){return typeof v==='string'?v.trim():'';}
function time(v){const t=Date.parse(String(v??''));return Number.isFinite(t)?t:null;}
function daysBetween(later,earlier){return (later-earlier)/DAY_MS;}

function evidenceState(evidence={},maxAgeMinutes=15){
  if(!finite(maxAgeMinutes)||maxAgeMinutes<0)return {ok:false,reason:'invalid_evidence_age_limit'};
  const missing=REQUIRED_EVIDENCE.filter(k=>evidence[k]?.authoritative!==true);
  if(missing.length)return {ok:false,reason:'missing_authoritative_evidence',missing};
  const stale=REQUIRED_EVIDENCE.filter(k=>!finite(evidence[k]?.ageMinutes)||evidence[k].ageMinutes<0||evidence[k].ageMinutes>maxAgeMinutes);
  if(stale.length)return {ok:false,reason:'stale_evidence',missing:stale};
  const revisions=REQUIRED_EVIDENCE.map(k=>clean(evidence[k]?.revision));
  if(revisions.some(v=>!v))return {ok:false,reason:'missing_source_revision',missing:REQUIRED_EVIDENCE.filter((k,i)=>!revisions[i])};
  return {ok:true};
}

function validateOrder(order){
  const baseline=time(order?.baselineCompletionAt),candidate=time(order?.candidateCompletionAt),committed=time(order?.committedAt);
  if(!clean(order?.orderId)||baseline==null||candidate==null||committed==null)return {ok:false,reason:'invalid_order_timing'};
  if(!finite(order?.invoiceMilestoneAmount)||order.invoiceMilestoneAmount<0)return {ok:false,reason:'invalid_invoice_milestone'};
  return {ok:true,baseline,candidate,committed};
}

export function evaluateCashToCapacityCandidate(input={}){
  const evidence=evidenceState(input.evidence,input.maxEvidenceAgeMinutes===undefined?15:input.maxEvidenceAgeMinutes);
  if(!evidence.ok)return {status:'blocked',reason:evidence.reason,missing:evidence.missing??[]};

  const guard=input.guardrails??{};
  if(guard.skillsCovered!==true||guard.complianceCovered!==true||guard.fatigueSafe!==true){
    return {status:'blocked',reason:'workforce_guardrail_failed'};
  }
  if(guard.qualityProtected!==true||guard.safetyProtected!==true){
    return {status:'blocked',reason:'production_guardrail_failed'};
  }

  const orders=Array.isArray(input.orders)?input.orders:[];
  if(!orders.length)return {status:'blocked',reason:'no_orders'};
  let amountAdvanced=0,cashDaysAdvanced=0,deliveryDelayCount=0,lateOrderCount=0,maxDaysEarlier=0;
  const effects=[];

  for(const order of orders){
    const valid=validateOrder(order);
    if(!valid.ok)return {status:'blocked',reason:valid.reason,orderId:order?.orderId??null};
    const {baseline,candidate,committed}=valid;
    const daysEarlier=Math.max(0,daysBetween(baseline,candidate));
    const daysLater=Math.max(0,daysBetween(candidate,baseline));
    const baselineLate=baseline>committed;
    const candidateLate=candidate>committed;
    if(daysLater>0)deliveryDelayCount+=1;
    if(candidateLate&&!baselineLate)lateOrderCount+=1;
    if(daysEarlier>0){
      amountAdvanced+=order.invoiceMilestoneAmount;
      cashDaysAdvanced+=order.invoiceMilestoneAmount*daysEarlier;
      maxDaysEarlier=Math.max(maxDaysEarlier,daysEarlier);
    }
    effects.push({orderId:order.orderId,daysEarlier,daysLater,invoiceMilestoneAmount:order.invoiceMilestoneAmount,candidateLate,baselineLate});
  }

  if(lateOrderCount>0||guard.deliveryCommitmentsProtected!==true){
    return {status:'blocked',reason:'customer_commitment_risk',effects};
  }
  if(amountAdvanced<=0)return {status:'rejected',reason:'no_cash_timing_improvement',effects};

  const finance=input.finance??{};
  const annualFundingRate=Number(finance.annualFundingRate);
  const labourCost=Number(finance.additionalLabourCost??0);
  const disruptionCost=Number(finance.disruptionCost??0);
  const liquidityProtectionValue=Number(finance.liquidityProtectionValue??0);
  if(!finite(annualFundingRate)||annualFundingRate<0||annualFundingRate>2)return {status:'blocked',reason:'invalid_funding_rate'};
  if(![labourCost,disruptionCost,liquidityProtectionValue].every(v=>finite(v)&&v>=0))return {status:'blocked',reason:'invalid_cost_input'};

  const financingValue=(cashDaysAdvanced*annualFundingRate)/365;
  const estimatedEconomicValue=financingValue+liquidityProtectionValue-labourCost-disruptionCost;
  const minimumNetValue=Number(input.minimumNetValue??0);
  if(!finite(minimumNetValue))return {status:'blocked',reason:'invalid_minimum_net_value'};

  const result={
    status:estimatedEconomicValue>minimumNetValue?'qualified':'rejected',
    reason:estimatedEconomicValue>minimumNetValue?'positive_economic_case':'economic_case_below_threshold',
    actionId:clean(input.action?.actionId),
    actionSummary:clean(input.action?.summary),
    cashTiming:{
      invoiceMilestoneAmountAdvanced:amountAdvanced,
      weightedCashDaysAdvanced:cashDaysAdvanced,
      maxDaysEarlier,
      affectedOrderCount:effects.filter(x=>x.daysEarlier>0).length
    },
    economics:{
      annualFundingRate,
      financingValue,
      liquidityProtectionValue,
      additionalLabourCost:labourCost,
      disruptionCost,
      estimatedEconomicValue
    },
    service:{deliveryDelayCount,lateOrderCount,deliveryCommitmentsProtected:lateOrderCount===0},
    guardrails:{
      skillsCovered:true,complianceCovered:true,fatigueSafe:true,qualityProtected:true,safetyProtected:true
    },
    evidenceRefs:REQUIRED_EVIDENCE.map(k=>({type:k,ref:clean(input.evidence[k]?.ref),revision:clean(input.evidence[k]?.revision)})),
    effects,
    claimBoundary:'Predicted economic value only. Cash is not realised until production, invoicing and payment outcomes are independently confirmed.'
  };
  return result;
}

export function rankCashToCapacityCandidates(candidates=[]){
  return candidates
    .filter(x=>x?.status==='qualified')
    .slice()
    .sort((a,b)=>b.economics.estimatedEconomicValue-a.economics.estimatedEconomicValue||b.cashTiming.weightedCashDaysAdvanced-a.cashTiming.weightedCashDaysAdvanced);
}

