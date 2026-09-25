'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {routeResearchToEngines,assessResearchCandidate}=require('./research-convergence-theory-simulator.cjs');

function design(){return {
  customerProblem:'Global manufacturers need one product that respects local country rules.',
  hypothesis:'Versioned effective-dated country packs can provide policy context without creating execution authority.',
  canonicalOwners:['existing-policy-context','scheduling','payroll'],
  evidenceInputs:['authoritative-country-source','customer-policy'],
  failureModes:['missing-pack','stale-pack','conflicting-rule'],
  securityAuthorityBoundaries:['pack-is-evidence-not-authority','tenant-isolation'],
  rollbackOrSafeAbstention:'Fail closed to authoritative review and revert pack version.',
  nonGoals:['legal-advice','direct-payroll-authority','second-policy-engine'],
  valueMetric:'implementation-hours-and-policy-error-rate'
};}
function theory(results=['PASS','PASS','PASS']){return {
  baseline:'manual country configuration and policy review',
  falsificationCriteria:'Any stale/missing/unverified pack silently authorises a consequential action.',
  counterfactual:'Same scheduling/payroll decision without the country pack.',
  noCustomerMutation:true,
  scenarios:[
    {id:'verified-effective-pack',kind:'normal',result:results[0]},
    {id:'missing-country-pack',kind:'edge',result:results[1]},
    {id:'tampered-or-stale-pack',kind:'adversarial',result:results[2]}
  ]
};}
function impl(extra={}){return {attempted:true,reusesCanonicalOwner:true,createsDuplicateLoop:false,createsSecondSourceOfTruth:false,rollbackReady:true,tenantIsolationPreserved:true,advisoryFirst:true,...extra};}

test('country policy research routes into existing engines and creates no seventh loop',()=>{
  const engines=routeResearchToEngines({id:'country-policy-packs',tags:['country-policy','payroll','scheduling','implementation']});
  assert.deepEqual(engines,['orchestrator','product-evolution','frontier-cross-domain-innovation','integration-data-fabric','autonomous-implementation-support','trust-proof-release']);
  assert.equal(new Set(engines).size,6);
});
test('implementation cannot start before design and theory pass',()=>{
  const r=assessResearchCandidate({item:{id:'water',tags:['resilience']},design:{},theory:theory(),implementation:impl()});
  assert.equal(r.designPass,false); assert.equal(r.implementationAdmitted,false); assert.equal(r.next,'DESIGN'); assert.equal(r.mayDrop,false);
});
test('a falsified theory is retained and routed to redesign rather than dropped',()=>{
  const r=assessResearchCandidate({item:{id:'country-policy',tags:['country-policy']},design:design(),theory:theory(['PASS','FAIL','PASS']),implementation:impl()});
  assert.equal(r.theoryPass,false); assert.equal(r.state,'THEORY_REJECTED_RETAIN_WITH_ROUTE'); assert.equal(r.next,'REDESIGN_OR_MORE_EVIDENCE'); assert.equal(r.mayDrop,false);
});
test('high-impact country policy implementation must remain advisory or use independent authority',()=>{
  const blocked=assessResearchCandidate({item:{id:'country-policy',tags:['country-policy','payroll']},design:design(),theory:theory(),implementation:impl({advisoryFirst:false,independentAuthorityGate:false})});
  assert.equal(blocked.theoryPass,true); assert.equal(blocked.implementationAdmitted,false);
  const safe=assessResearchCandidate({item:{id:'country-policy',tags:['country-policy','payroll']},design:design(),theory:theory(),implementation:impl({advisoryFirst:true})});
  assert.equal(safe.implementationAdmitted,true);
});
test('implementation does not equal convergence until exact hosted Golden Journey and value proof pass',()=>{
  const partial=assessResearchCandidate({item:{id:'country-policy',tags:['country-policy']},design:design(),theory:theory(),implementation:impl({implemented:true,unitPass:true,adversarialPass:true,exactImagePass:true,hostedPass:true,goldenJourneyPass:false,valueEvidencePass:false})});
  assert.equal(partial.implementationAdmitted,true); assert.equal(partial.convergenceProven,false);
  const complete=assessResearchCandidate({item:{id:'country-policy',tags:['country-policy']},design:design(),theory:theory(),implementation:impl({implemented:true,unitPass:true,adversarialPass:true,exactImagePass:true,hostedPass:true,goldenJourneyPass:true,valueEvidencePass:true})});
  assert.equal(complete.convergenceProven,true); assert.equal(complete.next,'CONVERGE_INTO_FORGE');
});
