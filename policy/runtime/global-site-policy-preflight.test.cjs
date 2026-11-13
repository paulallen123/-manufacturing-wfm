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

const populationInput=(workers)=>({tenant:'t1',legalAt:'2026-09-01T00:00:00Z',knownAt:'2026-09-01T00:00:00Z',site:{id:'s1',country:'GB',legalEntityId:'le1'},workers});
for(const [label,workers] of [['omitted',undefined],['null',null],['object',{}],['string','w1']]){
  test(`unknown workforce population ${label} cannot become advisory-ready`,()=>{
    let reads=0;
    const p=createGlobalSitePolicyPreflight({graph:{resolve(){reads++;throw Error('unexpected read');}}});
    assert.throws(()=>p.assess(populationInput(workers)),/Explicit workforce array required/);
    assert.equal(reads,0);
  });
}
for(const [label,worker] of [['missing id',{employmentCategory:'employee'}],['blank id',{id:' ',employmentCategory:'employee'}],['null row',null]]){
  test(`workforce ${label} cannot be silently omitted from policy coverage`,()=>{
    let reads=0;
    const p=createGlobalSitePolicyPreflight({graph:{resolve(){reads++;throw Error('unexpected read');}}});
    const workers=[{id:'w1',employmentCategory:'employee'},worker];
    assert.throws(()=>p.assess(populationInput(workers)),/Every workforce row requires a worker id/);
    assert.equal(reads,0);
  });
}
test('duplicate normalized worker identities cannot inflate covered population',()=>{
  let reads=0;
  const p=createGlobalSitePolicyPreflight({graph:{resolve(){reads++;throw Error('unexpected read');}}});
  assert.throws(()=>p.assess(populationInput([{id:'w1',employmentCategory:'employee'},{id:' w1 ',employmentCategory:'employee'}])),/Worker ids must be unique/);
  assert.equal(reads,0);
});
test('explicitly empty workforce remains a zero-worker advisory result without authority',()=>{
  const result=createGlobalSitePolicyPreflight({graph:graph()}).assess(populationInput([]));
  assert.equal(result.status,'READY_ADVISORY');
  assert.equal(result.coverage.workerCount,0);
  assert.equal(result.coverage.covered,0);
  assert.equal(result.automation.executionAuthority,false);
  assert.equal(result.automation.customerMutation,false);
});
test('distinct supplied workers retain complete policy coverage and input state',()=>{
  const input=populationInput([{id:'w1',employmentCategory:'employee'},{id:'w2',employmentCategory:'employee'}]);
  const before=JSON.stringify(input);
  const result=createGlobalSitePolicyPreflight({graph:graph()}).assess(input);
  assert.equal(result.coverage.workerCount,2);
  assert.equal(result.coverage.covered,2);
  assert.deepEqual(result.workers.map(x=>x.workerId),['w1','w2']);
  assert.equal(JSON.stringify(input),before);
});
