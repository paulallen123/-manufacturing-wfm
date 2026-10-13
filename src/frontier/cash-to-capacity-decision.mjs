export const CASH_TO_CAPACITY_PRESENTATION_VERSION='cash-to-capacity-presentation-v0.2.0';

const REQUIRED_EVIDENCE=['productionPlan','workforceEligibility','customerCommitment','financialMilestone'];
const MANAGER_VIEW_ROLES=new Set(['manager','director','operations','supervisor','company-admin','payroll_admin','admin','superuser']);

function finite(value){return typeof value==='number'&&Number.isFinite(value);}
function clean(value){return typeof value==='string'?value.trim():'';}
function money(value,currency='GBP'){
  if(!finite(value))return null;
  try{return new Intl.NumberFormat('en-GB',{style:'currency',currency,maximumFractionDigits:0}).format(value);}
  catch{return String(Math.round(value));}
}

export function buildCashToCapacityPresentation(input={}){
  const evidence=input.evidence&&typeof input.evidence==='object'?input.evidence:{};
  const missing=REQUIRED_EVIDENCE.filter(key=>evidence[key]?.authoritative!==true);
  const safety=input.safety&&typeof input.safety==='object'?input.safety:{};
  const service=input.service&&typeof input.service==='object'?input.service:{};
  const financial=input.financial&&typeof input.financial==='object'?input.financial:{};
  const action=input.action&&typeof input.action==='object'?input.action:{};
  const currency=clean(input.currency)||'GBP';

  if(missing.length)return {status:'evidence_incomplete',missing,card:null};
  if(safety.skillsCovered!==true||safety.complianceCovered!==true||safety.fatigueSafe!==true||safety.qualityProtected!==true||safety.safetyProtected!==true){
    return {status:'blocked',reason:'safety_or_eligibility_constraint',card:null};
  }
  if(service.deliveryCommitmentsProtected!==true){
    return {status:'blocked',reason:'customer_commitment_risk',card:null};
  }
  if(
    !clean(action.summary)||
    !finite(financial.invoiceMilestoneAmountAdvanced)||
    !finite(financial.additionalLabourCost)||
    !finite(financial.daysEarlier)||
    !finite(financial.estimatedEconomicValue)
  ){
    return {status:'evidence_incomplete',missing:['decision_values'],card:null};
  }

  const evidenceAgeMinutes=Math.max(...REQUIRED_EVIDENCE.map(key=>Number(evidence[key]?.ageMinutes??Infinity)));
  const freshness=evidenceAgeMinutes<=15?'current':evidenceAgeMinutes<=60?'aging':'stale';
  if(freshness==='stale')return {status:'evidence_incomplete',missing:['freshness'],card:null};

  return {
    status:'presentable',
    card:{
      label:'Cash & production opportunity',
      actionSummary:clean(action.summary),
      currency,
      invoiceMilestoneAmountAdvanced:financial.invoiceMilestoneAmountAdvanced,
      daysEarlier:financial.daysEarlier,
      financingValue:finite(financial.financingValue)?financial.financingValue:null,
      liquidityProtectionValue:finite(financial.liquidityProtectionValue)?financial.liquidityProtectionValue:0,
      additionalLabourCost:financial.additionalLabourCost,
      disruptionCost:finite(financial.disruptionCost)?financial.disruptionCost:0,
      estimatedEconomicValue:financial.estimatedEconomicValue,
      deliveryProtected:true,
      skillsProtected:true,
      freshness,
      confidence:clean(input.confidence)||'Evidence-backed',
      route:'costs',
      evidenceRefs:REQUIRED_EVIDENCE.map(key=>({type:key,ref:clean(evidence[key]?.ref),revision:clean(evidence[key]?.revision)})),
      claimBoundary:'Invoice timing and estimated economic value are predictions based on current authoritative evidence. They are not realised cash or realised savings until production, invoicing and payment outcomes are confirmed.'
    }
  };
}

export function roleView(card,role){
  if(!card)return null;
  if(!MANAGER_VIEW_ROLES.has(role)&&role!=='finance'&&role!=='operations-director')return null;
  const milestone=money(card.invoiceMilestoneAmountAdvanced,card.currency);
  const economic=money(card.estimatedEconomicValue,card.currency);
  const labour=money(card.additionalLabourCost,card.currency);
  if(role==='finance')return {
    headline:milestone+' invoice milestone could move '+card.daysEarlier+' days earlier',
    primary:'Estimated economic value '+economic,
    secondary:'Additional labour '+labour+' · predicted, not realised',
    detailLevel:'financial'
  };
  if(role==='operations-director')return {
    headline:card.actionSummary,
    primary:'Invoice timing: '+milestone+' · '+card.daysEarlier+' days earlier',
    secondary:'Estimated economic value '+economic+' · delivery and eligibility protected',
    detailLevel:'cross-site'
  };
  return {
    headline:card.actionSummary,
    primary:'Could bring a '+milestone+' invoice milestone forward '+card.daysEarlier+' days',
    secondary:'Estimated economic value '+economic+' · extra labour '+labour+' · no committed-order impact detected',
    detailLevel:'manager'
  };
}

