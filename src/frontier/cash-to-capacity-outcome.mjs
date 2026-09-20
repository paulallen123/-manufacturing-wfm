export const CASH_TO_CAPACITY_OUTCOME_VERSION='cash-to-capacity-outcome-v0.1.0';

function finite(v){return typeof v==='number'&&Number.isFinite(v);}
function clean(v){return typeof v==='string'?v.trim():'';}

export function reconcileCashToCapacityOutcome({decision,prediction,operationalOutcome,financialOutcome}={}){
  if(!clean(decision?.decisionId)||!prediction||!operationalOutcome||!financialOutcome){
    return {status:'incomplete',reason:'missing_outcome_components'};
  }
  if(operationalOutcome.authoritative!==true){
    return {status:'incomplete',reason:'operational_outcome_not_authoritative'};
  }
  if(financialOutcome.authoritative!==true){
    return {status:'incomplete',reason:'financial_outcome_not_authoritative'};
  }
  if(!finite(prediction?.estimatedEconomicValue)||!finite(financialOutcome?.realisedEconomicValue)){
    return {status:'incomplete',reason:'invalid_financial_values'};
  }
  if(!finite(prediction?.daysEarlier)||!finite(financialOutcome?.actualDaysEarlier)){
    return {status:'incomplete',reason:'invalid_timing_values'};
  }

  const valueError=financialOutcome.realisedEconomicValue-prediction.estimatedEconomicValue;
  const timingError=financialOutcome.actualDaysEarlier-prediction.daysEarlier;
  return {
    status:'reconciled',
    decisionId:decision.decisionId,
    outcomeClass:'realised',
    prediction:{
      economicValue:prediction.estimatedEconomicValue,
      daysEarlier:prediction.daysEarlier
    },
    realised:{
      economicValue:financialOutcome.realisedEconomicValue,
      daysEarlier:financialOutcome.actualDaysEarlier,
      productionCompleted:operationalOutcome.productionCompleted===true,
      customerCommitmentMet:operationalOutcome.customerCommitmentMet===true
    },
    calibration:{
      valueError,
      absoluteValueError:Math.abs(valueError),
      timingError,
      absoluteTimingError:Math.abs(timingError)
    },
    evidence:{
      operationalRef:clean(operationalOutcome.ref),
      financialRef:clean(financialOutcome.ref)
    },
    authorityBoundary:'This record updates calibration evidence only. It does not automatically change workforce, finance or production decision rules.'
  };
}

export function learningSummary(records=[]){
  const reconciled=records.filter(r=>r?.status==='reconciled');
  if(!reconciled.length)return {count:0,status:'insufficient_evidence'};
  const maeValue=reconciled.reduce((s,r)=>s+r.calibration.absoluteValueError,0)/reconciled.length;
  const maeTiming=reconciled.reduce((s,r)=>s+r.calibration.absoluteTimingError,0)/reconciled.length;
  return {count:reconciled.length,status:'evidence_only',meanAbsoluteValueError:maeValue,meanAbsoluteTimingErrorDays:maeTiming};
}
