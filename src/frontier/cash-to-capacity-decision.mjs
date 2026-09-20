export const CASH_TO_CAPACITY_PRESENTATION_VERSION='cash-to-capacity-presentation-v0.1.0';

const REQUIRED_EVIDENCE=['productionPlan','workforceEligibility','customerCommitment','financialMilestone'];

function finite(value){return typeof value==='number'&&Number.isFinite(value);}
function clean(value){return typeof value==='string'?value.trim():'';}

export function buildCashToCapacityPresentation(input={}){
  const evidence=input.evidence&&typeof input.evidence==='object'?input.evidence:{};
  const missing=REQUIRED_EVIDENCE.filter(key=>evidence[key]?.authoritative!==true);
  const safety=input.safety&&typeof input.safety==='object'?input.safety:{};
  const service=input.service&&typeof input.service==='object'?input.service:{};
  const financial=input.financial&&typeof input.financial==='object'?input.financial:{};
  const action=input.action&&typeof input.action==='object'?input.action:{};

  if(missing.length){
    return {status:'evidence_incomplete',missing,card:null};
  }
  if(safety.skillsCovered!==true||safety.complianceCovered!==true||safety.fatigueSafe!==true){
    return {status:'blocked',reason:'safety_or_eligibility_constraint',card:null};
  }
  if(service.deliveryCommitmentsProtected!==true){
    return {status:'blocked',reason:'customer_commitment_risk',card:null};
  }
  if(!clean(action.summary)||!finite(financial.cashReleasedEarlier)||!finite(financial.additionalLabourCost)||!finite(financial.daysEarlier)){
    return {status:'evidence_incomplete',missing:['decision_values'],card:null};
  }

  const netImmediate=financial.cashReleasedEarlier-financial.additionalLabourCost;
  const evidenceAgeMinutes=Math.max(...REQUIRED_EVIDENCE.map(key=>Number(evidence[key]?.ageMinutes??Infinity)));
  const freshness=evidenceAgeMinutes<=15?'current':evidenceAgeMinutes<=60?'aging':'stale';
  if(freshness==='stale') return {status:'evidence_incomplete',missing:['freshness'],card:null};

  return {
    status:'presentable',
    card:{
      label:'Cash & production opportunity',
      actionSummary:clean(action.summary),
      cashReleasedEarlier:financial.cashReleasedEarlier,
      daysEarlier:financial.daysEarlier,
      additionalLabourCost:financial.additionalLabourCost,
      netImmediate,
      deliveryProtected:true,
      skillsProtected:true,
      freshness,
      confidence:clean(input.confidence)||'Evidence-backed',
      route:'costs',
      evidenceRefs:REQUIRED_EVIDENCE.map(key=>({type:key,ref:clean(evidence[key]?.ref)})),
      claimBoundary:'Potential cash timing benefit based on current authoritative evidence. Not realised cash until the operational and payment outcomes are confirmed.'
    }
  };
}

export function roleView(card,role){
  if(!card)return null;
  if(role==='employee') return null;
  if(role==='finance') return {
    headline:`£${Math.round(card.cashReleasedEarlier).toLocaleString('en-GB')} potentially released ${card.daysEarlier} days earlier`,
    primary:card.actionSummary,
    secondary:`Additional labour £${Math.round(card.additionalLabourCost).toLocaleString('en-GB')}`,
    detailLevel:'financial'
  };
  if(role==='operations-director') return {
    headline:card.actionSummary,
    primary:`Cash timing +£${Math.round(card.cashReleasedEarlier).toLocaleString('en-GB')}`,
    secondary:'Delivery, skills and compliance protected',
    detailLevel:'cross-site'
  };
  return {
    headline:card.actionSummary,
    primary:`Potentially releases £${Math.round(card.cashReleasedEarlier).toLocaleString('en-GB')} ${card.daysEarlier} days earlier`,
    secondary:`Extra labour £${Math.round(card.additionalLabourCost).toLocaleString('en-GB')} · no committed-order impact detected`,
    detailLevel:'manager'
  };
}
