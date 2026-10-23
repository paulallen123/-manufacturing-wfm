'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createJurisdictionPolicyGraph}=require('./jurisdiction-policy-graph.cjs');
const {createGlobalSitePolicyPreflight}=require('./global-site-policy-preflight.cjs');
function graph(){return createJurisdictionPolicyGraph([{id:'gb',layer:'COUNTRY',effectiveFrom:'2026-01-01T00:00:00Z',recordedAt:'2025-12-01T00:00:00Z',sourceRefs:['official:gb'],verified:true,scope:{country:'GB'},rules:[{id:'max',domain:'working-time',key:'weekly-hours',legalCharacter:'MANDATORY_CEILING',operator:'MAX',value:48,unit:'hours',sourceRefs:['official:gb']}]}]);}
test('complete known site becomes advisory-ready with zero routine customer rule entry',()=>{const p=createGlobalSitePolicyPreflight({graph:graph()}).assess({tenant:'t1',legalAt:'2026-09-01T00:00:00Z',knownAt:'2026-09-01T00:00:00Z',site:{id:'s1',country:'GB',legalEntityId:'le1'},workers:[{id:'w1',employmentCategory:'employee',workerClass:'standard'}]});assert.equal(p.status,'READY_ADVISORY');assert.equal(p.customerQuestions.length,0);assert.equal(p.coverage.covered,1);assert.equal(p.automation.executionAuthority,false);});
test('unknown organisational facts create only targeted exception questions',()=>{const p=createGlobalSitePolicyPreflight({graph:graph()}).assess({tenant:'t1',site:{id:'s1',country:'GB'},workers:[{id:'w1',workerClass:'standard'}]});assert.equal(p.status,'REQUIRES_CUSTOMER_INPUT');assert.deepEqual(new Set(p.customerQuestions.map(x=>x.code)),new Set(['LEGAL_ENTITY_REQUIRED','EMPLOYMENT_CATEGORY_REQUIRED']));});
test('worker temporarily located in unsupported country blocks only that worker policy coverage',()=>{const p=createGlobalSitePolicyPreflight({graph:graph()}).assess({tenant:'t1',site:{id:'s1',country:'GB',legalEntityId:'le1'},workers:[{id:'w1',employmentCategory:'employee',workLocationCountry:'GB'},{id:'w2',employmentCategory:'employee',workLocationCountry:'DE'}]});assert.equal(p.status,'BLOCKED_POLICY_COVERAGE');assert.deepEqual(p.coverage.missing,['w2']);assert.equal(p.coverage.covered,1);});
test('preflight never grants execution or customer mutation authority',()=>{const p=createGlobalSitePolicyPreflight({graph:graph()}).assess({tenant:'t1',site:{id:'s1',country:'GB',legalEntityId:'le1'},workers:[{id:'w1',employmentCategory:'employee'}]});assert.equal(p.automation.executionAuthority,false);assert.equal(p.automation.customerMutation,false);});
test('malformed site and worker country cannot inherit verified GB coverage',()=>{
  const preflight=createGlobalSitePolicyPreflight({graph:graph()});
  const site=preflight.assess({tenant:'t1',legalAt:'2026-09-01T00:00:00Z',knownAt:'2026-09-01T00:00:00Z',site:{id:'s1',country:'GBX',legalEntityId:'le1'},workers:[{id:'w1',employmentCategory:'employee'}]});
  assert.equal(site.status,'REQUIRES_CUSTOMER_INPUT');
  assert.ok(site.customerQuestions.some(q=>q.code==='SITE_COUNTRY_REQUIRED'));
  assert.equal(site.coverage.covered,0);
  const worker=preflight.assess({tenant:'t1',legalAt:'2026-09-01T00:00:00Z',knownAt:'2026-09-01T00:00:00Z',site:{id:'s1',country:'GB',legalEntityId:'le1'},workers:[{id:'w1',employmentCategory:'employee',workLocationCountry:'GBX'}]});
  assert.equal(worker.status,'REQUIRES_CUSTOMER_INPUT');
  assert.deepEqual(worker.customerQuestions,[{code:'WORK_LOCATION_COUNTRY_REQUIRED',scope:'worker',workerId:'w1'}]);
  assert.deepEqual(worker.coverage.missing,['w1']);
  for(const invalid of [['GB'],0]){
    const malformedSite=preflight.assess({tenant:'t1',site:{id:'s1',country:invalid,legalEntityId:'le1'},workers:[{id:'w1',employmentCategory:'employee'}]});
    assert.equal(malformedSite.status,'REQUIRES_CUSTOMER_INPUT');
    assert.equal(malformedSite.coverage.covered,0);
    const malformedWorker=preflight.assess({tenant:'t1',site:{id:'s1',country:'GB',legalEntityId:'le1'},workers:[{id:'w1',employmentCategory:'employee',workLocationCountry:invalid}]});
    assert.equal(malformedWorker.status,'REQUIRES_CUSTOMER_INPUT');
    assert.deepEqual(malformedWorker.customerQuestions,[{code:'WORK_LOCATION_COUNTRY_REQUIRED',scope:'worker',workerId:'w1'}]);
  }
});

