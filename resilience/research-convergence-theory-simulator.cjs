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

function list(v){return Array.isArray(v)?v.filter(Boolean):[];}
function strings(v){return list(v).map(String);}
function hasText(v){return typeof v==='string' && v.trim().length>0;}
function allText(v){return strings(v).length>0 && strings(v).every(hasText);}

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
    result=[];
    for(let i=0;i<length;i++){
      const field=descriptors[i];
      if(!field || !Object.hasOwn(field,'value')) throw new TypeError('Research evidence arrays must be dense data.');
      result.push(inertSnapshot(field.value,seen,depth+1));
    }
    if(Object.keys(descriptors).some(key=>key!=='length' && !/^(0|[1-9]\d*)$/.test(key))) throw new TypeError('Research evidence arrays cannot carry extra fields.');
  }else{
    result=Object.create(null);
    for(const [key,field] of Object.entries(descriptors)){
      if(!field.enumerable) continue;
      if(!Object.hasOwn(field,'value')) throw new TypeError('Research evidence cannot use accessors.');
      result[key]=inertSnapshot(field.value,seen,depth+1);
    }
  }
  seen.delete(value);
  return result;
}

function routeResearchToEngines(item={}){
  const tags=new Set(strings(item.tags).map(x=>x.toLowerCase()));
  const engines=new Set(['orchestrator','product-evolution','frontier-cross-domain-innovation','trust-proof-release']);
  if([...tags].some(x=>['integration','provider','data','country-policy','regional','localisation','compliance','payroll','erp','mes','hcm'].includes(x))) engines.add('integration-data-fabric');
  if([...tags].some(x=>['implementation','support','migration','recovery','training','country-policy','rollout'].includes(x))) engines.add('autonomous-implementation-support');
  return ENGINE_IDS.filter(id=>engines.has(id));
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
  const kinds=new Set(scenarios.map(x=>String(x.kind||'').toLowerCase()));
  const ids=scenarios.map(x=>x.id);
  return hasText(theory.baseline) && hasText(theory.falsificationCriteria) &&
    hasText(theory.counterfactual) && scenarios.length>=3 &&
    kinds.has('normal') && kinds.has('edge') && kinds.has('adversarial') &&
    ids.every(hasText) && new Set(ids).size===ids.length &&
    scenarios.every(x=>hasText(x.evidenceRef) && list(x.observations).length>0 &&
      x.observations.every(o=>hasText(o?.id) &&
        Object.hasOwn(o,'expected') && Object.hasOwn(o,'actual')));
}

function scenarioPassed(scenario){
  return String(scenario.result||'').toUpperCase()==='PASS' &&
    scenario.observations.every(o=>isDeepStrictEqual(o.expected,o.actual));
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
  const scenarioFailures=theoryReady?list(theory.scenarios).filter(x=>!scenarioPassed(x)):[];
  const theoryPass=theoryReady && scenarioFailures.length===0 && theory.noCustomerMutation===true;
  const tags=new Set(strings(item.tags).map(x=>x.toLowerCase()));
  const highImpact=[...tags].some(x=>HIGH_IMPACT_DOMAINS.has(x));
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

  return Object.freeze({
    contract:'VECTOR_RESEARCH_DESIGN_TEST_IMPLEMENT_V1',
    itemId:item.id||null,
    engines:Object.freeze(engines),
    designPass,theoryReady,theoryPass,implementationAdmitted,convergenceProven,
    scenarioFailures:Object.freeze(scenarioFailures.map(x=>x.id||'unnamed')),
    highImpact,state,next,
    mayDrop:false,
    mayDisplaceGoldenJourney:false,
    productionAuthorityGranted:false
  });
}

module.exports=Object.freeze({ENGINE_IDS,routeResearchToEngines,assessResearchCandidate});
