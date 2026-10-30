'use strict';
// Independent preservation probes for the PR436 transplant, not production code.
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const root=process.env.V026_SOURCE_ROOT;
assert.ok(root,'V026_SOURCE_ROOT is required');
const graphModule=require(path.join(root,'policy/runtime/jurisdiction-policy-graph.cjs'));
const {createGlobalSitePolicyPreflight}=require(path.join(root,'policy/runtime/global-site-policy-preflight.cjs'));
const when={legalAt:'2026-06-01T00:00:00Z',knownAt:'2026-06-01T00:00:00Z'};
const baseInput={...when,tenant:'tenant-a',site:{id:'plant-1',country:'GB',legalEntityId:'entity-1'}};
function publicNode(){return {id:'public',layer:'COUNTRY',effectiveFrom:'2026-01-01T00:00:00Z',recordedAt:'2025-12-01T00:00:00Z',verified:true,sourceRefs:['synthetic:independent'],scope:{country:'GB'},rules:[{id:'requirement',domain:'payroll',key:'terms',legalCharacter:'MANDATORY_REQUIREMENT',operator:'REQUIRE',value:{currency:'JPY',amounts:[100,200]},sourceRefs:['synthetic:independent-rule']}]};}
function deeplyFrozen(value){if(value&&typeof value==='object'){assert.equal(Object.isFrozen(value),true);for(const child of Object.values(value))deeplyFrozen(child);}}
function counterPreflight(){let reads=0;return {preflight:createGlobalSitePolicyPreflight({graph:{resolve(){reads++;return {verifiedCoverage:true,review:[],contextDigest:'synthetic'};}}}),reads:()=>reads};}

test('population omission and malformed containers are rejected before graph reads',()=>{
 for(const workers of [undefined,null,{},'workers',5]){
  const subject=counterPreflight();
  assert.throws(()=>subject.preflight.assess({...baseInput,workers}));
  assert.equal(subject.reads(),0);
 }
});

test('all workforce identities validate before any worker can acquire coverage',()=>{
 for(const bad of [null,undefined,{},[],{id:''},{id:'   '}]){
  const subject=counterPreflight();
  assert.throws(()=>subject.preflight.assess({...baseInput,workers:[{id:'valid',employmentCategory:'employee'},bad]}));
  assert.equal(subject.reads(),0);
 }
});

test('duplicate normalized worker identities are rejected before graph reads',()=>{
 const subject=counterPreflight();
 assert.throws(()=>subject.preflight.assess({...baseInput,workers:[{id:'worker-1',employmentCategory:'employee'},{id:' worker-1 ',employmentCategory:'employee'}]}));
 assert.equal(subject.reads(),0);
});

test('explicit empty population remains supported and nonempty population is not dropped',()=>{
 const empty=counterPreflight(),emptyResult=empty.preflight.assess({...baseInput,workers:[]});
 assert.equal(emptyResult.coverage.workerCount,0);assert.equal(empty.reads(),0);assert.equal(emptyResult.status,'READY_ADVISORY');
 const filled=counterPreflight(),workers=['one','two','three'].map(id=>({id,employmentCategory:'employee'}));
 const result=filled.preflight.assess({...baseInput,workers});
 assert.equal(filled.reads(),3);assert.equal(result.coverage.workerCount,3);assert.equal(result.coverage.covered,3);
 assert.deepEqual(result.workers.map(w=>w.workerId),['one','two','three']);
});

test('graph admission recursively freezes scope, nested rule values and provenance',()=>{
 const supplied=publicNode();supplied.scope.tenant=['tenant-a','tenant-b'];
 const graph=graphModule.createJurisdictionPolicyGraph([supplied]);
 const admitted=graph.all()[0];deeplyFrozen(admitted);
 const before=JSON.stringify(admitted);
 assert.throws(()=>{admitted.scope.tenant[0]='tenant-z';},TypeError);
 assert.throws(()=>{admitted.rules[0].value.amounts.push(999);},TypeError);
 assert.throws(()=>{admitted.sourceRefs[0]='invented';},TypeError);
 supplied.scope.tenant[0]='caller-mutated';supplied.rules[0].value.amounts[0]=999;supplied.sourceRefs.push('caller-only');
 assert.equal(JSON.stringify(graph.all()[0]),before);
});

test('register return and detached all list preserve graph ownership',()=>{
 const graph=graphModule.createJurisdictionPolicyGraph();
 const admitted=graph.register(publicNode());deeplyFrozen(admitted);
 const rows=graph.all();rows.pop();assert.equal(graph.all().length,1);
 assert.throws(()=>{admitted.scope.country='DE';},TypeError);
 const de=graph.resolve({...when,context:{country:'DE',tenant:'tenant-a'}});
 assert.equal(de.verifiedCoverage,false);
});

test('resolved policy context is recursively immutable and detached from caller input',()=>{
 const graph=graphModule.createJurisdictionPolicyGraph([publicNode()]);
 const context={country:'GB',tenant:'tenant-a',extra:{labels:['original']}};
 const result=graph.resolve({...when,context});deeplyFrozen(result);
 const before=JSON.stringify(result);
 assert.throws(()=>{result.constraints[0].value.amounts[0]=999;},TypeError);
 assert.throws(()=>{result.applicableNodes[0].sourceRefs.push('invented');},TypeError);
 assert.throws(()=>{result.context.extra.labels[0]='changed';},TypeError);
 context.extra.labels[0]='caller-only';assert.equal(JSON.stringify(result),before);
 const {contextDigest,...payload}=result;assert.equal(graphModule.digest(payload),contextDigest);
 assert.deepEqual(JSON.parse(JSON.stringify(result)),result);
});

test('uncovered context is also recursively immutable and grants no authority',()=>{
 const graph=graphModule.createJurisdictionPolicyGraph([publicNode()]);
 const result=graph.resolve({...when,context:{country:'DE',tenant:'tenant-a',extra:{labels:['uncovered']}}});
 deeplyFrozen(result);assert.equal(result.verifiedCoverage,false);assert.equal(result.executionAuthority,false);
 assert.deepEqual(result.applicableNodes,[]);assert.deepEqual(result.constraints,[]);
});

if(process.env.V026_BASE_ROOT){
 const baseline=require(path.join(process.env.V026_BASE_ROOT,'policy/runtime/jurisdiction-policy-graph.cjs'));
 test('unscoped donor graph behavior, digests and exported API remain byte-for-byte JSON compatible',()=>{
  assert.deepEqual(Object.keys(graphModule),Object.keys(baseline));
  const supplied=publicNode();
  const candidate=graphModule.createJurisdictionPolicyGraph([supplied]);
  const original=baseline.createJurisdictionPolicyGraph([supplied]);
  assert.equal(JSON.stringify(candidate.all()),JSON.stringify(original.all()));
  for(const context of [{country:'GB'},{country:'GB',tenant:'tenant-a'},{country:'DE',tenant:'tenant-b'}]){
   assert.equal(JSON.stringify(candidate.resolve({...when,context})),JSON.stringify(original.resolve({...when,context})));
  }
 });
}
