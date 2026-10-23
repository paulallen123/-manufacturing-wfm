'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createJurisdictionPolicyGraph}=require('./jurisdiction-policy-graph.cjs');
function baseNode(overrides={}){return {id:'gb-base',layer:'COUNTRY',effectiveFrom:'2026-01-01T00:00:00Z',recordedAt:'2025-12-01T00:00:00Z',sourceRefs:['official:gb'],verified:true,scope:{country:'GB'},rules:[{id:'weekly-max',domain:'working-time',key:'weekly-hours',legalCharacter:'MANDATORY_CEILING',operator:'MAX',value:48,unit:'hours',sourceRefs:['official:gb']}],...overrides};}
test('bitemporal resolution distinguishes legal validity from what VECTOR knew',()=>{const graph=createJurisdictionPolicyGraph([baseNode({recordedAt:'2026-02-01T00:00:00Z'})]);assert.equal(graph.resolve({legalAt:'2026-03-01T00:00:00Z',knownAt:'2026-01-15T00:00:00Z',context:{country:'GB'}}).verifiedCoverage,false);const r=graph.resolve({legalAt:'2026-03-01T00:00:00Z',knownAt:'2026-03-02T00:00:00Z',context:{country:'GB'}});assert.equal(r.verifiedCoverage,true);assert.equal(r.constraints[0].value,48);});
test('mandatory ceilings compose to the strictest applicable rule across layers',()=>{const graph=createJurisdictionPolicyGraph([baseNode(),baseNode({id:'site-stricter',layer:'SITE',scope:{country:'GB',siteId:'site-1'},sourceRefs:['customer:policy'],rules:[{id:'site-max',domain:'working-time',key:'weekly-hours',legalCharacter:'MANDATORY_CEILING',operator:'MAX',value:44,unit:'hours',sourceRefs:['customer:policy']}]})]);const r=graph.resolve({legalAt:'2026-06-01T00:00:00Z',knownAt:'2026-06-01T00:00:00Z',context:{country:'GB',siteId:'site-1'}});assert.equal(r.constraints.find(x=>x.key==='weekly-hours'&&x.result==='MAX').value,44);});
test('customer policy cannot weaken a mandatory ceiling',()=>{const graph=createJurisdictionPolicyGraph([baseNode(),baseNode({id:'customer-looser',layer:'CUSTOMER_POLICY',scope:{country:'GB'},sourceRefs:['customer:policy'],rules:[{id:'customer-max',domain:'working-time',key:'weekly-hours',legalCharacter:'CUSTOMER_POLICY',operator:'MAX',value:60,unit:'hours',sourceRefs:['customer:policy']}]})]);const r=graph.resolve({legalAt:'2026-06-01T00:00:00Z',knownAt:'2026-06-01T00:00:00Z',context:{country:'GB'}});assert.equal(r.constraints.find(x=>x.key==='weekly-hours'&&x.result==='MAX').value,48);assert.ok(r.review.some(x=>x.reason==='CUSTOMER_POLICY_CANNOT_WEAKEN_MANDATORY_CEILING'));});
test('collective agreement scope does not leak to workers outside that agreement',()=>{const graph=createJurisdictionPolicyGraph([baseNode(),baseNode({id:'cba',layer:'COLLECTIVE_AGREEMENT',scope:{country:'GB',collectiveAgreements:['CBA-A']},sourceRefs:['cba:a'],rules:[{id:'cba-rest',domain:'rest',key:'rest-hours',legalCharacter:'MANDATORY_FLOOR',operator:'MIN',value:14,unit:'hours',sourceRefs:['cba:a']}]})]);const a=graph.resolve({legalAt:'2026-06-01T00:00:00Z',knownAt:'2026-06-01T00:00:00Z',context:{country:'GB',collectiveAgreements:['CBA-A']}});const b=graph.resolve({legalAt:'2026-06-01T00:00:00Z',knownAt:'2026-06-01T00:00:00Z',context:{country:'GB',collectiveAgreements:['CBA-B']}});assert.ok(a.constraints.some(x=>x.key==='rest-hours'&&x.value===14));assert.ok(!b.constraints.some(x=>x.key==='rest-hours'));});
test('verified exceptions never silently weaken the base rule',()=>{const graph=createJurisdictionPolicyGraph([baseNode(),baseNode({id:'exception',layer:'EMPLOYMENT',scope:{country:'GB',employmentCategory:'SPECIAL'},sourceRefs:['official:exception'],rules:[{id:'special-exception',domain:'working-time',key:'weekly-hours',legalCharacter:'EXCEPTION',operator:'ALLOW',value:true,exceptionTo:'weekly-max',verifiedException:true,sourceRefs:['official:exception']}]})]);const r=graph.resolve({legalAt:'2026-06-01T00:00:00Z',knownAt:'2026-06-01T00:00:00Z',context:{country:'GB',employmentCategory:'SPECIAL'}});assert.equal(r.constraints.find(x=>x.key==='weekly-hours'&&x.result==='MAX').value,48);assert.ok(r.review.some(x=>x.ruleId==='special-exception'));assert.equal(r.executionAuthority,false);});
test('direct graph resolution rejects malformed country even for unscoped verified nodes',()=>{
  const graph=createJurisdictionPolicyGraph([baseNode({id:'global',layer:'GLOBAL',scope:{}})]);
  for(const country of ['GBX',['GB'],0])assert.throws(()=>graph.resolve({legalAt:'2026-06-01T00:00:00Z',knownAt:'2026-06-01T00:00:00Z',context:{country}}),/country/);
  for(const workLocationCountry of ['GBX',['GB'],0])assert.throws(()=>graph.resolve({legalAt:'2026-06-01T00:00:00Z',knownAt:'2026-06-01T00:00:00Z',context:{country:'GB',workLocationCountry}}),/country/);
  assert.equal(graph.resolve({legalAt:'2026-06-01T00:00:00Z',knownAt:'2026-06-01T00:00:00Z',context:{country:'gb'}}).verifiedCoverage,true);
});
test('country scopes are normalised at registration and empty optional work location remains absent',()=>{
  const graph=createJurisdictionPolicyGraph([baseNode({scope:{country:['gb','de'],workLocationCountry:['gb','de']}})]);
  assert.deepEqual(graph.all()[0].scope.country,['GB','DE']);
  assert.deepEqual(graph.all()[0].scope.workLocationCountry,['GB','DE']);
  assert.equal(graph.resolve({legalAt:'2026-06-01T00:00:00Z',knownAt:'2026-06-01T00:00:00Z',context:{country:'gb',workLocationCountry:'gb'}}).verifiedCoverage,true);
  assert.equal(createJurisdictionPolicyGraph([baseNode()]).resolve({legalAt:'2026-06-01T00:00:00Z',knownAt:'2026-06-01T00:00:00Z',context:{country:'GB',workLocationCountry:''}}).verifiedCoverage,true);
  assert.throws(()=>createJurisdictionPolicyGraph([baseNode({scope:{country:'GBX'}})]),/ISO alpha-2/);
});
test('country normalization does not add absent scope keys',()=>{
  const node=createJurisdictionPolicyGraph([baseNode({scope:{siteId:'site-1'}})]).all()[0];
  assert.deepEqual(node.scope,{siteId:'site-1'});
});

