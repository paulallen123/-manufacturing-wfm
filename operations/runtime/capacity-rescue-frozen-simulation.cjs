'use strict';

const {snapshotData,deepFreeze,digest,stable}=require('./decision-episode.cjs');
const {buildCapacityRescueShadow}=require('./capacity-rescue-shadow.cjs');

const CONTRACT_VERSION='VECTOR_FROZEN_CAPACITY_RESCUE_SIMULATION_V1';
const ECONOMIC_KEYS=Object.freeze(['recoveredContribution','avoidedDowntime','avoidedExpedite','avoidedLabourPremium','avoidedScrap','interventionCost','inducedDownstreamCost']);
const METRICS=Object.freeze(['throughputUnits','planAttainmentPct','labourCost','delayMinutes','riskScore','energyCost','qualityRisk']);

// This leaf evaluates supplied scenario predictions. Source timestamps, policy/model
// revisions and content digests are declarations, not authenticated provenance. The
// caller must enforce actor/role/site access and retain the complete returned record.
// Checksums detect content changes relative to a retained record; they are not signatures.
function compareId(a,b){return a<b?-1:a>b?1:0;}
function shape(value,keys,label){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error(label+' must be a data object.');
 for(const key of Object.keys(value))if(!keys.includes(key))throw Error('Unsupported '+label+' field: '+key);
 return value;
}
function finiteData(value){
 if(value===null||typeof value==='string'||typeof value==='boolean')return;
 if(typeof value==='number'&&Number.isFinite(value))return;
 if(value&&typeof value==='object'){Object.values(value).forEach(finiteData);return;}
 throw Error('Frozen simulation requires finite JSON data.');
}
function string(value,label,max=180){
 if(typeof value!=='string'||!value||value!==value.trim()||value.length>max)throw Error(label+' is invalid.');
 return value;
}
function instant(value,label){
 string(value,label,24);
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))throw Error(label+' must be a valid UTC ISO timestamp.');
 const ms=Date.parse(value),canonical=value.length===20?value.slice(0,-1)+'.000Z':value;
 if(!Number.isFinite(ms)||new Date(ms).toISOString()!==canonical)throw Error(label+' must be a valid UTC ISO timestamp.');
 return canonical;
}
function array(value,label,max=100){
 if(!Array.isArray(value)||value.length>max)throw Error(label+' must be a bounded array.');
 return value;
}
function refs(value,label,used,{required=false}={}){
 if(value===undefined&&!required)return;
 const entries=array(value,label,50);
 if(required&&!entries.length)throw Error(label+' evidence is required.');
 const seen=new Set();
 for(const ref of entries){string(ref,label+' evidence ref',220);if(seen.has(ref))throw Error(label+' evidence refs must be unique.');seen.add(ref);used.add(ref);}
 value.sort();
}
function scopeFor(raw){
 const scope=snapshotData(raw,'expected scope');
 shape(scope,['tenant','site'],'expected scope');
 string(scope.tenant,'expected scope tenant',120);string(scope.site,'expected scope site',160);
 return scope;
}
function normaliseDeclaration(raw,expectedScope){
 const input=snapshotData(raw,'frozen simulation input');finiteData(input);
 shape(input,['asKnownAt','simulatorRevision','policyRevision','economics','sources','input'],'frozen simulation');
 const scope=scopeFor(expectedScope);
 input.asKnownAt=instant(input.asKnownAt,'asKnownAt');
 string(input.simulatorRevision,'simulatorRevision');string(input.policyRevision,'policyRevision');
 const economics=shape(input.economics,['basis','currency','window'],'economics');
 if(economics.basis!=='INCREMENTAL_TO_DO_NOTHING')throw Error('Economic basis must be INCREMENTAL_TO_DO_NOTHING.');
 if(typeof economics.currency!=='string'||!/^[A-Z]{3}$/.test(economics.currency))throw Error('Economic currency must be a three-letter code.');
 const window=shape(economics.window,['start','end'],'economic window');
 window.start=instant(window.start,'window.start');window.end=instant(window.end,'window.end');
 if(window.start<input.asKnownAt||window.end<=window.start)throw Error('Economic window must start at or after asKnownAt and end after its start.');
 const scenario=shape(input.input,['tenant','site','triggerKind','triggerId','triggeredAt','contextRevision','sourceEvidence','state','constraints','objective','plans'],'scenario input');
 if(scenario.tenant!==scope.tenant||scenario.site!==scope.site)throw Error('Frozen simulation scope differs from expected scope.');
 scenario.triggeredAt=instant(scenario.triggeredAt,'triggeredAt');
 if(scenario.triggeredAt!==input.asKnownAt)throw Error('Decision trigger must equal asKnownAt.');
 const sources=array(input.sources,'sources',500),sourceRefs=new Set();
 if(!sources.length)throw Error('Frozen simulation source declarations are required.');
 for(const row of sources){
  shape(row,['ref','revision','digest','observedAt','knownAt'],'source');
  string(row.ref,'source ref',220);string(row.revision,'source revision');
  if(sourceRefs.has(row.ref))throw Error('Frozen simulation source refs must be unique.');sourceRefs.add(row.ref);
  if(typeof row.digest!=='string'||!/^[a-f0-9]{64}$/.test(row.digest))throw Error('Source digest must be a SHA-256 hex declaration.');
  row.observedAt=instant(row.observedAt,'source observedAt');row.knownAt=instant(row.knownAt,'source knownAt');
  if(row.observedAt>row.knownAt||row.knownAt>input.asKnownAt)throw Error('Source observedAt must be <= knownAt <= asKnownAt.');
 }
 sources.sort((a,b)=>compareId(a.ref,b.ref));
 const used=new Set();
 refs(scenario.sourceEvidence,'scenario source',used,{required:true});
 shape(scenario.state,['lineId','targetUnits','demandUnits','projectedUnits','currentUnits','plannedHeadcount','staffedHeadcount'],'scenario state');
 shape(scenario.objective,[...METRICS,'uncertaintyPenalty'],'scenario objective');
 const constraints=array(scenario.constraints,'constraints',100),constraintIds=new Set();
 for(const row of constraints){
  shape(row,['id','domain','label','confidence','severity','limitingImpactPct','evidenceRefs','reasonCodes'],'constraint');
  string(row.id,'constraint id',120);
  if(constraintIds.has(row.id))throw Error('Constraint ids must be unique.');constraintIds.add(row.id);
  refs(row.evidenceRefs,'constraint',used,{required:true});
  if(row.reasonCodes!==undefined)refs(row.reasonCodes,'constraint reasonCodes',new Set());
 }
 constraints.sort((a,b)=>compareId(a.id,b.id));
 const plans=array(scenario.plans,'plans',100);
 for(const plan of plans){
  shape(plan,['id','label','feasible','policyAllowed','hardConstraintsPassed','uncertainty','prediction','evidenceRefs','reasonCodes','actions','economic','causalEvidence'],'plan');
  string(plan.id,'plan id',120);
  shape(plan.prediction,METRICS,'prediction');shape(plan.economic,ECONOMIC_KEYS,'economic');
  refs(plan.evidenceRefs,'plan',used,{required:true});
  if(plan.reasonCodes!==undefined)refs(plan.reasonCodes,'plan reasonCodes',new Set());
  if(plan.causalEvidence!==undefined)shape(plan.causalEvidence,['comparableInterventions','matchedControl','experimental','sourceDiversity','dataCompleteness','simulatorCalibration'],'causalEvidence');
  if(plan.actions!==undefined){
   for(const action of array(plan.actions,'actions',100)){
    shape(action,['id','type','target','reversible','requiresApproval','dependsOn','preconditions','evidenceRefs'],'action');
    string(action.id,'action id',120);refs(action.evidenceRefs,'action',used,{required:true});
    if(action.dependsOn!==undefined)refs(action.dependsOn,'action dependencies',new Set());
    if(action.preconditions!==undefined)refs(action.preconditions,'action preconditions',new Set());
   }
   plan.actions.sort((a,b)=>compareId(a.id,b.id));
  }
 }
 plans.sort((a,b)=>compareId(a.id,b.id));
 const baseline=plans.find(plan=>plan.id==='do-nothing');
 if(!baseline||baseline.feasible!==true||baseline.policyAllowed!==true||baseline.hardConstraintsPassed!==true||ECONOMIC_KEYS.some(key=>baseline.economic[key]!==0))
  throw Error('An eligible do-nothing plan with all seven incremental economic components exactly zero is required.');
 if(baseline.actions?.some(action=>action.type!=='DO_NOTHING'))throw Error('The do-nothing plan must contain only DO_NOTHING actions.');
 for(const metric of METRICS)if(scenario.objective[metric]>0&&
   (typeof baseline.prediction[metric]!=='number'||!Number.isFinite(baseline.prediction[metric])))
  throw Error('The do-nothing plan must provide every positively weighted prediction metric.');
 for(const ref of used)if(!sourceRefs.has(ref))throw Error('Unbound evidence source ref: '+ref);
 for(const ref of sourceRefs)if(!used.has(ref))throw Error('Unused source ref: '+ref);
 return input;
}
function createFrozenCapacityRescueSimulation(declaration,expectedScope){
 const snapshot=normaliseDeclaration(declaration,expectedScope);
 const core={
  contractVersion:CONTRACT_VERSION,snapshot,snapshotDigest:digest(snapshot),
  result:buildCapacityRescueShadow(snapshot.input,{deterministicOrder:true}),
  classification:'SIMULATED',evaluationMethod:'SUPPLIED_SCENARIO_PREDICTIONS',
  sourceAuthority:'CALLER_DECLARED',sourceAuthenticated:false,asKnownAtVerified:false,
  executionPermitted:false,verifiedOperationalOutcome:false,realisedFinancialOutcome:false,learningEligible:false
 };
 return deepFreeze({...core,simulationDigest:digest(core)});
}
function replayFrozenCapacityRescueSimulation(record,expectedScope){
 record=snapshotData(record,'frozen simulation record');finiteData(record);
 if(!record||record.contractVersion!==CONTRACT_VERSION)throw Error('Frozen simulation replay contract is invalid.');
 const {simulationDigest,...core}=record;
 if(typeof simulationDigest!=='string'||!/^[a-f0-9]{64}$/.test(simulationDigest)||digest(core)!==simulationDigest)
  throw Error('Frozen simulation integrity check failed.');
 const replayed=createFrozenCapacityRescueSimulation(record.snapshot,expectedScope);
 if(stable(replayed)!==stable(record))throw Error('Frozen simulation replay differs from retained record.');
 return replayed;
}
module.exports=Object.freeze({CONTRACT_VERSION,createFrozenCapacityRescueSimulation,replayFrozenCapacityRescueSimulation});
