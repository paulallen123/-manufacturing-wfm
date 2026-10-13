'use strict';
const {isDeepStrictEqual,types}=require('node:util');

const ENGINE_IDS = Object.freeze([
  'orchestrator',
  'product-evolution',
  'frontier-cross-domain-innovation',
  'integration-data-fabric',
  'autonomous-implementation-support',
  'trust-proof-release'
]);

const HIGH_IMPACT_DOMAINS = new Set(['payroll','scheduling','compliance','identity','security','machine-control','country-policy']);

function list(v){
  const out=[];
  if(Array.isArray(v)) for(let i=0;i<v.length;i++) if(v[i]) out[out.length]=v[i];
  return out;
}
function strings(v){
  const values=list(v), out=new Array(values.length);
  for(let i=0;i<values.length;i++) out[i]=String(values[i]);
  return out;
}
function hasText(v){return typeof v==='string' && v.trim().length>0;}
function allText(v){
  const values=strings(v);
  if(!values.length) return false;
  for(let i=0;i<values.length;i++) if(!hasText(values[i])) return false;
  return true;
}

function inertSnapshot(value, seen=new Set(), depth=0){
  if(value===null || typeof value==='string' || typeof value==='number' || typeof value==='boolean') return value;
  if(typeof value!=='object' || types.isProxy(value) || depth>24 || seen.has(value)) throw new TypeError('Research evidence must be inert data.');
  const prototype=Object.getPrototypeOf(value);
  if(!Array.isArray(value) && prototype!==Object.prototype && prototype!==null) throw new TypeError('Research evidence must be plain data.');
  seen.add(value);
  const descriptors=Object.getOwnPropertyDescriptors(value);
  let result;
  if(Array.isArray(value)){
    const length=descriptors.length.value;
    if(length>1000) throw new TypeError('Research evidence array too large.');
    result=new Array(length);
    for(let i=0;i<length;i++){
      const field=descriptors[i];
      if(!field || !Object.hasOwn(field,'value')) throw new TypeError('Research evidence arrays must be dense data.');
      result[i]=inertSnapshot(field.value,seen,depth+1);
    }
    const keys=Reflect.ownKeys(descriptors);
    for(let i=0;i<keys.length;i++){
      const key=keys[i];
      if(typeof key!=='string' || key!=='length' && !/^(0|[1-9]\d*)$/.test(key)) throw new TypeError('Research evidence arrays cannot carry extra fields.');
    }
  }else{
    result=Object.create(null);
    const keys=Reflect.ownKeys(descriptors);
    for(let i=0;i<keys.length;i++){
      const key=keys[i], field=descriptors[key];
      if(typeof key!=='string') throw new TypeError('Research evidence cannot use symbol fields.');
      if(!field.enumerable) continue;
      if(!Object.hasOwn(field,'value')) throw new TypeError('Research evidence cannot use accessors.');
      result[key]=inertSnapshot(field.value,seen,depth+1);
    }
  }
  seen.delete(value);
  return result;
}

function routeResearchToEngines(item={}){
  const tags=strings(item.tags);
  const engines=new Set(['orchestrator','product-evolution','frontier-cross-domain-innovation','trust-proof-release']);
  const integrationTags=new Set(['integration','provider','data','country-policy','regional','localisation','compliance','payroll','erp','mes','hcm']);
  const implementationTags=new Set(['implementation','support','migration','recovery','training','country-policy','rollout']);
  for(let i=0;i<tags.length;i++){
    const tag=tags[i].toLowerCase();
    if(integrationTags.has(tag)) engines.add('integration-data-fabric');
    if(implementationTags.has(tag)) engines.add('autonomous-implementation-support');
  }
  const routed=[];
  for(let i=0;i<ENGINE_IDS.length;i++) if(engines.has(ENGINE_IDS[i])) routed[routed.length]=ENGINE_IDS[i];
  return routed;
}

function designComplete(design={}){
  return hasText(design.customerProblem) && hasText(design.hypothesis) &&
    allText(design.canonicalOwners) && allText(design.evidenceInputs) &&
    allText(design.failureModes) && allText(design.securityAuthorityBoundaries) &&
    hasText(design.rollbackOrSafeAbstention) && allText(design.nonGoals) &&
    hasText(design.valueMetric);
}

function theoryComplete(theory={}){
  const scenarios=list(theory.scenarios);
  if(!hasText(theory.baseline) || !hasText(theory.falsificationCriteria) ||
    !hasText(theory.counterfactual) || scenarios.length<3) return false;
  const kinds=new Set(), ids=new Set();
  for(let i=0;i<scenarios.length;i++){
    const scenario=scenarios[i], kind=String(scenario.kind||'').toLowerCase();
    kinds.add(kind);
    if(!hasText(scenario.id) || ids.has(scenario.id) || !hasText(scenario.evidenceRef)) return false;
    ids.add(scenario.id);
    const observations=list(scenario.observations);
    if(!observations.length) return false;
    for(let j=0;j<observations.length;j++){
      const observation=observations[j];
      if(!hasText(observation?.id) || !Object.hasOwn(observation,'expected') || !Object.hasOwn(observation,'actual')) return false;
    }
  }
  return kinds.has('normal') && kinds.has('edge') && kinds.has('adversarial');
}

function scenarioPassed(scenario){
  if(String(scenario.result||'').toUpperCase()!=='PASS') return false;
  for(let i=0;i<scenario.observations.length;i++){
    const o=scenario.observations[i];
    if(!isDeepStrictEqual(o.expected,o.actual)) return false;
  }
  return true;
}

function assessResearchCandidate(input={}){
  let candidate;
  try{candidate=inertSnapshot(input);}catch{candidate={};}
  const item=candidate.item||{};
  const design=candidate.design||{};
  const theory=candidate.theory||{};
  const implementation=candidate.implementation||{};
  const engines=routeResearchToEngines(item);
  const designPass=designComplete(design);
  const theoryReady=designPass && theoryComplete(theory);
  const scenarioFailures=[];
  if(theoryReady) for(let i=0;i<theory.scenarios.length;i++){
    const scenario=theory.scenarios[i];
    if(!scenarioPassed(scenario)) scenarioFailures[scenarioFailures.length]=scenario;
  }
  const theoryPass=theoryReady && scenarioFailures.length===0 && theory.noCustomerMutation===true;
  const tags=strings(item.tags);
  let highImpact=false;
  for(let i=0;i<tags.length;i++) if(HIGH_IMPACT_DOMAINS.has(tags[i].toLowerCase())) highImpact=true;
  const implementationAdmitted=theoryPass && implementation.reusesCanonicalOwner===true &&
    implementation.createsDuplicateLoop!==true && implementation.createsSecondSourceOfTruth!==true &&
    implementation.rollbackReady===true && implementation.tenantIsolationPreserved===true &&
    (!highImpact || implementation.advisoryFirst===true || implementation.independentAuthorityGate===true);
  const convergenceProven=implementationAdmitted && implementation.implemented===true &&
    implementation.unitPass===true && implementation.adversarialPass===true &&
    implementation.exactImagePass===true && implementation.hostedPass===true &&
    implementation.goldenJourneyPass===true && implementation.valueEvidencePass===true;

  let next='DESIGN';
  let state='REGISTERED';
  if(designPass){state='DESIGN_COMPLETE';next='THEORY_TEST';}
  if(theoryReady && !theoryPass){state='THEORY_REJECTED_RETAIN_WITH_ROUTE';next='REDESIGN_OR_MORE_EVIDENCE';}
  if(theoryPass){state='THEORY_TESTED';next='IMPLEMENTATION';}
  if(theoryPass && !implementationAdmitted && implementation.attempted===true){state='IMPLEMENTATION_BLOCKED_RETAIN_WITH_ROUTE';next='REPAIR_IMPLEMENTATION_BOUNDARY';}
  if(implementationAdmitted){state='IMPLEMENTATION_ADMITTED';next='IMPLEMENT_AND_PROVE';}
  if(convergenceProven){state='CONVERGENCE_PROVEN';next='CONVERGE_INTO_FORGE';}

  const failureIds=new Array(scenarioFailures.length);
  for(let i=0;i<scenarioFailures.length;i++) failureIds[i]=scenarioFailures[i].id||'unnamed';
  return Object.freeze({
    contract:'VECTOR_RESEARCH_DESIGN_TEST_IMPLEMENT_V1',
    itemId:item.id||null,
    engines:Object.freeze(engines),
    designPass,theoryReady,theoryPass,implementationAdmitted,convergenceProven,
    scenarioFailures:Object.freeze(failureIds),
    highImpact,state,next,
    mayDrop:false,
    mayDisplaceGoldenJourney:false,
    productionAuthorityGranted:false
  });
}

module.exports=Object.freeze({ENGINE_IDS,routeResearchToEngines,assessResearchCandidate});
