'use strict';

const { createHash } = require('node:crypto');

function text(v,max=240){ return String(v??'').trim().slice(0,max); }
function num(v,name,{nullable=false}={}){
  if(v==null&&nullable) return null;
  const n=Number(v);
  if(!Number.isFinite(n)) throw new Error(name+' must be numeric.');
  return n;
}
function list(v,max=50,maxLen=220){ return Array.isArray(v)?[...new Set(v.map(x=>text(x,maxLen)).filter(Boolean))].slice(0,max):[]; }
function stable(value){
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  if(value&&typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function digest(v){ return createHash('sha256').update(stable(v)).digest('hex'); }

function metricPack(input={}){
  return {
    throughputUnits:num(input.throughputUnits??0,'throughputUnits'),
    planAttainmentPct:num(input.planAttainmentPct??0,'planAttainmentPct'),
    labourCost:num(input.labourCost??0,'labourCost'),
    delayMinutes:num(input.delayMinutes??0,'delayMinutes'),
    riskScore:num(input.riskScore??0,'riskScore'),
    energyCost:num(input.energyCost??0,'energyCost'),
    qualityRisk:num(input.qualityRisk??0,'qualityRisk')
  };
}
function economics(input={}){
  const x={
    recoveredContribution:num(input.recoveredContribution??0,'recoveredContribution'),
    avoidedDowntime:num(input.avoidedDowntime??0,'avoidedDowntime'),
    avoidedExpedite:num(input.avoidedExpedite??0,'avoidedExpedite'),
    avoidedLabourPremium:num(input.avoidedLabourPremium??0,'avoidedLabourPremium'),
    avoidedScrap:num(input.avoidedScrap??0,'avoidedScrap'),
    interventionCost:num(input.interventionCost??0,'interventionCost'),
    inducedDownstreamCost:num(input.inducedDownstreamCost??0,'inducedDownstreamCost')
  };
  x.netRecoveredValue=Number((x.recoveredContribution+x.avoidedDowntime+x.avoidedExpedite+x.avoidedLabourPremium+x.avoidedScrap-x.interventionCost-x.inducedDownstreamCost).toFixed(2));
  return x;
}

function evaluateCapacityRescueOutcome(input={}){
  const tenant=text(input.tenant,120),caseId=text(input.caseId,180),planId=text(input.planId,120);
  if(!tenant||!caseId||!planId) throw new Error('tenant, caseId and planId are required.');
  const evidenceRefs=list(input.evidenceRefs,60,220);
  if(!evidenceRefs.length) throw new Error('Outcome evidence is required.');
  if(!input.predicted||typeof input.predicted!=='object') throw new Error('Predicted outcome is required.');
  if(!input.actual||typeof input.actual!=='object') throw new Error('Actual outcome is required.');
  if(!input.counterfactualWithoutAction||typeof input.counterfactualWithoutAction!=='object') throw new Error('Counterfactual without action is required.');
  const predicted=metricPack(input.predicted);
  const actual=metricPack(input.actual);
  const counterfactual=metricPack(input.counterfactualWithoutAction);
  const observed={
    throughputVsCounterfactual:Number((actual.throughputUnits-counterfactual.throughputUnits).toFixed(3)),
    planAttainmentVsCounterfactual:Number((actual.planAttainmentPct-counterfactual.planAttainmentPct).toFixed(3)),
    labourCostVsCounterfactual:Number((actual.labourCost-counterfactual.labourCost).toFixed(2)),
    delayMinutesVsCounterfactual:Number((actual.delayMinutes-counterfactual.delayMinutes).toFixed(2)),
    riskVsCounterfactual:Number((actual.riskScore-counterfactual.riskScore).toFixed(3)),
    qualityRiskVsCounterfactual:Number((actual.qualityRisk-counterfactual.qualityRisk).toFixed(3)),
    energyCostVsCounterfactual:Number((actual.energyCost-counterfactual.energyCost).toFixed(2))
  };

  let causalStatus='ASSOCIATION_ONLY',causalEffect=null;
  const control=input.matchedControl&&typeof input.matchedControl==='object'?input.matchedControl:null;
  if(input.experimental===true){
    causalStatus='EXPERIMENTAL_ESTIMATE';
    causalEffect=observed.throughputVsCounterfactual;
  }else if(control){
    const preTreatment=num(input.preTreatmentThroughput??0,'preTreatmentThroughput');
    const controlPre=num(control.preThroughput??0,'control.preThroughput');
    const controlPost=num(control.postThroughput??0,'control.postThroughput');
    causalEffect=Number(((actual.throughputUnits-preTreatment)-(controlPost-controlPre)).toFixed(3));
    causalStatus='DIFFERENCE_IN_DIFFERENCES_ESTIMATE';
  }

  const economic=economics(input.economic||{});
  const predictionError={
    throughputUnits:Number((actual.throughputUnits-predicted.throughputUnits).toFixed(3)),
    planAttainmentPct:Number((actual.planAttainmentPct-predicted.planAttainmentPct).toFixed(3)),
    labourCost:Number((actual.labourCost-predicted.labourCost).toFixed(2)),
    delayMinutes:Number((actual.delayMinutes-predicted.delayMinutes).toFixed(2))
  };
  const actionTypes=list(input.actionTypes,20,80).map(x=>x.toUpperCase()).sort();
  const primaryConstraintDomain=text(input.primaryConstraintDomain,60).toLowerCase()||'unknown';
  const learningFingerprint='capacity-rescue:'+primaryConstraintDomain+':'+actionTypes.join('+');
  const payload={
    contractVersion:'VECTOR_CAPACITY_RESCUE_OUTCOME_V1',
    tenant,caseId,planId,observedAt:text(input.observedAt,80)||new Date().toISOString(),
    evidenceRefs,predicted,actual,counterfactualWithoutAction:counterfactual,
    observedDelta:observed,causalStatus,causalEffect,economic,predictionError,
    confounders:list(input.confounders,30,180),
    learningFingerprint,
    learnable:causalStatus!=='ASSOCIATION_ONLY'||evidenceRefs.length>=2
  };
  return Object.freeze({...payload,outcomeId:'cro-'+digest(payload).slice(0,40)});
}

module.exports=Object.freeze({evaluateCapacityRescueOutcome});
