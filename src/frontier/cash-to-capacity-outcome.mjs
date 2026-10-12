export const CASH_TO_CAPACITY_OUTCOME_VERSION='cash-to-capacity-outcome-v0.2.0';

const SCOPE_KEYS=['decisionId','tenantId','siteId','legalEntityId','currency'];
const MEASUREMENT_KEYS=['measurementId','windowStart','windowEnd'];
function finite(v){return typeof v==='number'&&Number.isFinite(v);}
function identifier(v){return typeof v==='string'&&v.length>0&&v===v.trim();}
function pick(value,keys){return Object.fromEntries(keys.map(key=>[key,value?.[key]]));}
function same(a,b,keys){return keys.every(key=>a?.[key]===b?.[key]);}
// Explicit UTC instants only; round-trip rejects Date.parse's calendar rollover.
function time(v){
  if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(v))return NaN;
  const t=Date.parse(v);
  return Number.isFinite(t)&&new Date(t).toISOString()===(v.length===20?v.slice(0,-1)+'.000Z':v)?t:NaN;
}
function freeze(value){
  for(const child of Object.values(value))if(child&&typeof child==='object')freeze(child);
  return Object.freeze(value);
}
function stable(value){
  if(value&&typeof value==='object')return JSON.stringify(Array.isArray(value)?value.map(v=>JSON.parse(stable(v))):
    Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(stable(value[key]))])));
  return JSON.stringify(value);
}

/**
 * Trusted input boundary: the owner must authenticate source adapters, authorise
 * the decision scope, and verify that predictions and measured records refer to
 * the same approved measurement and source revisions before calling this pure
 * function. `authoritative: true` is a caller assertion, NOT authentication.
 * This validates structure and consistency, not causality, source truth, payment
 * settlement, or permission to execute. `now` must be an owner-controlled clock.
 * No writes, execution capability, or decision-rule changes are performed here.
 */
export function reconcileCashToCapacityOutcome(input={}){
  const {decision,prediction,operationalOutcome,financialOutcome,now=new Date().toISOString()}=input??{};
  if(!decision||!prediction||!operationalOutcome||!financialOutcome){
    return {status:'incomplete',reason:'missing_outcome_components'};
  }
  const scope=pick(decision,SCOPE_KEYS);
  if(!SCOPE_KEYS.every(key=>identifier(scope[key]))||!/^[A-Z]{3}$/.test(scope.currency)){
    return {status:'rejected',reason:'invalid_decision_scope'};
  }
  const measurement=pick(decision.measurement,MEASUREMENT_KEYS);
  const start=time(measurement.windowStart),end=time(measurement.windowEnd),clock=time(now);
  if(!identifier(measurement.measurementId)||!finite(start)||!finite(end)||start>=end||!finite(clock)||end>clock){
    return {status:'incomplete',reason:'invalid_measurement_window'};
  }
  for(const [type,record] of Object.entries({prediction,operationalOutcome,financialOutcome})){
    if(!same(scope,record,SCOPE_KEYS))return {status:'rejected',reason:'outcome_scope_mismatch',type};
    if(!same(measurement,record.measurement,MEASUREMENT_KEYS))return {status:'rejected',reason:'measurement_mismatch',type};
  }
  for(const [type,record] of [['operational',operationalOutcome],['financial',financialOutcome]]){
    if(record.authoritative!==true)return {status:'incomplete',reason:`${type}_outcome_not_authoritative`};
    if(!['provider','revision','ref'].every(key=>identifier(record[key]))){
      return {status:'incomplete',reason:'missing_source_provenance',type};
    }
    const observed=time(record.observedAt);
    if(!finite(observed)||observed<end||observed>clock)return {status:'incomplete',reason:'invalid_source_time',type};
  }
  if(!finite(prediction.estimatedEconomicValue)||!finite(financialOutcome.realisedEconomicValue)){
    return {status:'incomplete',reason:'invalid_financial_values'};
  }
  if(!finite(prediction.daysEarlier)||!finite(financialOutcome.actualDaysEarlier)){
    return {status:'incomplete',reason:'invalid_timing_values'};
  }
  if(!['productionCompleted','customerCommitmentMet'].every(key=>typeof operationalOutcome[key]==='boolean')){
    return {status:'incomplete',reason:'missing_operational_observations'};
  }
  const valueError=financialOutcome.realisedEconomicValue-prediction.estimatedEconomicValue;
  const timingError=financialOutcome.actualDaysEarlier-prediction.daysEarlier;
  if(!finite(valueError)||!finite(timingError))return {status:'rejected',reason:'calibration_overflow'};
  return freeze({
    status:'reconciled',
    decisionId:scope.decisionId,
    scope,
    measurement,
    outcomeClass:'realised',
    prediction:{economicValue:prediction.estimatedEconomicValue,daysEarlier:prediction.daysEarlier},
    realised:{
      economicValue:financialOutcome.realisedEconomicValue,
      daysEarlier:financialOutcome.actualDaysEarlier,
      productionCompleted:operationalOutcome.productionCompleted,
      customerCommitmentMet:operationalOutcome.customerCommitmentMet
    },
    calibration:{valueError,absoluteValueError:Math.abs(valueError),timingError,absoluteTimingError:Math.abs(timingError)},
    evidence:{
      operationalRef:operationalOutcome.ref,
      financialRef:financialOutcome.ref,
      operational:pick(operationalOutcome,['authoritative','provider','ref','revision','observedAt']),
      financial:pick(financialOutcome,['authoritative','provider','ref','revision','observedAt'])
    },
    executionAuthority:false,
    authorityBoundary:'This record updates calibration evidence only. It does not automatically change workforce, finance or production decision rules.'
  });
}

// Revalidate serialized evidence instead of trusting a status label or supplied
// calibration. This is still inside the owner's trusted input boundary above.
function validateRecord(record){
  const binding={...record.scope,measurement:record.measurement};
  const rebuilt=reconcileCashToCapacityOutcome({
    decision:binding,
    prediction:{...binding,estimatedEconomicValue:record.prediction?.economicValue,daysEarlier:record.prediction?.daysEarlier},
    operationalOutcome:{...binding,...record.evidence?.operational,
      productionCompleted:record.realised?.productionCompleted,customerCommitmentMet:record.realised?.customerCommitmentMet},
    financialOutcome:{...binding,...record.evidence?.financial,
      realisedEconomicValue:record.realised?.economicValue,actualDaysEarlier:record.realised?.daysEarlier}
  });
  return rebuilt.status==='reconciled'&&stable(rebuilt)===stable(record);
}

export function learningSummary(records=[]){
  if(!Array.isArray(records))return {count:0,status:'rejected',reason:'invalid_learning_records'};
  const unique=new Map();
  let learningScope;
  for(const record of records){
    if(record?.status!=='reconciled')continue;
    try{
      if(!validateRecord(record))return {count:0,status:'rejected',reason:'invalid_reconciled_record'};
      const scope=JSON.stringify(SCOPE_KEYS.slice(1).map(key=>record.scope[key]));
      if(learningScope!==undefined&&learningScope!==scope)return {count:0,status:'rejected',reason:'mixed_learning_scope'};
      learningScope=scope;
      // Revisions/window are content, not identity: a correction must not become
      // a second learning sample or silently supersede the original observation.
      const identity=JSON.stringify([...SCOPE_KEYS.map(key=>record.scope[key]),record.measurement.measurementId]);
      const previous=unique.get(identity);
      if(previous&&stable(previous)!==stable(record))return {count:0,status:'rejected',reason:'conflicting_outcome_identity'};
      unique.set(identity,record);
    }catch{
      return {count:0,status:'rejected',reason:'invalid_reconciled_record'};
    }
  }
  if(!unique.size)return {count:0,status:'insufficient_evidence'};
  let maeValue=0,maeTiming=0,count=0;
  for(const record of unique.values()){
    // Online means avoid overflowing a sum of otherwise finite nonnegative errors.
    count++;
    maeValue+=(record.calibration.absoluteValueError-maeValue)/count;
    maeTiming+=(record.calibration.absoluteTimingError-maeTiming)/count;
  }
  return {count,status:'evidence_only',meanAbsoluteValueError:maeValue,meanAbsoluteTimingErrorDays:maeTiming};
}
