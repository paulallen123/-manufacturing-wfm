'use strict';
// Independent V026 heldouts. The environment selects an unmodified source root.
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const root=process.env.V026_SOURCE_ROOT;
assert.ok(root,'V026_SOURCE_ROOT is required');
const {createJurisdictionPolicyGraph}=require(path.join(root,'policy/runtime/jurisdiction-policy-graph.cjs'));
const {createGlobalSitePolicyPreflight}=require(path.join(root,'policy/runtime/global-site-policy-preflight.cjs'));
const when={legalAt:'2026-06-01T00:00:00Z',knownAt:'2026-06-01T00:00:00Z'};
function node(id,scope={},rules){return {id,layer:'SITE',effectiveFrom:'2026-01-01T00:00:00Z',recordedAt:'2025-12-01T00:00:00Z',verified:true,sourceRefs:['synthetic:test-only'],scope,rules:rules||[{id:id+'-weekly-max',domain:'working-time',key:'weekly-hours',legalCharacter:'MANDATORY_CEILING',operator:'MAX',value:44,unit:'hours'}]};}
function resolve(graph,context){return graph.resolve({...when,context:{country:'GB',...context}});}
function tenantNode(){return node('tenant-a-site-policy',{country:'GB',tenant:'tenant-a',siteId:'plant-1'});}

test('tenant-bound policy applies only to its exact tenant, including same site identifier',()=>{
 const graph=createJurisdictionPolicyGraph([tenantNode()]);
 const permitted=resolve(graph,{tenant:'tenant-a',siteId:'plant-1'});
 assert.equal(permitted.verifiedCoverage,true);
 assert.equal(permitted.constraints[0].value,44);
 const denied=resolve(graph,{tenant:'tenant-b',siteId:'plant-1'});
 assert.equal(denied.verifiedCoverage,false);
 assert.deepEqual(denied.applicableNodes,[]);
 assert.deepEqual(denied.constraints,[]);
});

test('tenant-bound policy does not match missing tenant context',()=>{
 const result=resolve(createJurisdictionPolicyGraph([tenantNode()]),{siteId:'plant-1'});
 assert.equal(result.verifiedCoverage,false);
 assert.deepEqual(result.constraints,[]);
});

test('tenant-bound policy does not coerce non-string tenant context into authority',()=>{
 const graph=createJurisdictionPolicyGraph([tenantNode()]);
 for(const tenant of [null,undefined,['tenant-a'],{tenant:'tenant-a'},42,false]){
  const result=resolve(graph,{tenant,siteId:'plant-1'});
  assert.equal(result.verifiedCoverage,false,'non-string tenant must fail closed: '+JSON.stringify(tenant));
 }
});

test('explicit malformed tenant scopes fail closed rather than turning into global policy',()=>{
 for(const tenant of [null,'','   ',[],['tenant-a',''],['tenant-a',null],42,{},true]){
  let graph;
  try{graph=createJurisdictionPolicyGraph([node('malformed-tenant',{country:'GB',tenant,siteId:'plant-1'})]);}
  catch(error){assert.ok(error instanceof Error);continue;}
  assert.equal(resolve(graph,{tenant:'unrelated',siteId:'plant-1'}).verifiedCoverage,false,'malformed explicit tenant scope must fail closed: '+JSON.stringify(tenant));
 }
});

test('an explicit undefined tenant scope cannot disappear during JSON normalization and become global',()=>{
 const supplied=node('undefined-tenant',{country:'GB',tenant:undefined,siteId:'plant-1'});
 assert.equal(Object.hasOwn(supplied.scope,'tenant'),true);
 let graph;
 try{graph=createJurisdictionPolicyGraph([supplied]);}
 catch(error){assert.ok(error instanceof Error);return;}
 assert.equal(resolve(graph,{tenant:'unrelated',siteId:'plant-1'}).verifiedCoverage,false);
});

test('scope serialization cannot remove or wildcard an explicitly named tenant',()=>{
 const scopes=[
  Object.assign([],{country:'GB',tenant:'tenant-a',siteId:'plant-1'}),
  {country:'GB',tenant:'tenant-a',toJSON(){return {country:'GB'};}},
  {country:'GB',tenant:'tenant-a',toJSON(){return {country:'GB',tenant:null};}},
  {country:'GB',tenant:'tenant-a',toJSON(){return {country:'GB',tenant:[]};}}
 ];
 for(const scope of scopes){
  let graph;
  try{graph=createJurisdictionPolicyGraph([node('serialized-tenant',scope)]);}
  catch(error){assert.ok(error instanceof Error);continue;}
  assert.equal(resolve(graph,{tenant:'unrelated',siteId:'plant-1'}).verifiedCoverage,false);
 }
});

test('tenant scope preserves existing exact-or-list match semantics',()=>{
 const graph=createJurisdictionPolicyGraph([node('shared-test-policy',{country:'GB',tenant:['tenant-a','tenant-c'],siteId:'plant-1'})]);
 for(const tenant of ['tenant-a','tenant-c'])assert.equal(resolve(graph,{tenant,siteId:'plant-1'}).verifiedCoverage,true);
 for(const tenant of ['tenant-b','tenant-A','tenant-a-extra'])assert.equal(resolve(graph,{tenant,siteId:'plant-1'}).verifiedCoverage,false);
});

test('same tenant cannot inherit a different site policy',()=>{
 const graph=createJurisdictionPolicyGraph([tenantNode()]);
 const denied=resolve(graph,{tenant:'tenant-a',siteId:'plant-2'});
 assert.equal(denied.verifiedCoverage,false);
 assert.deepEqual(denied.constraints,[]);
});

test('unscoped public policy stays applicable while a foreign tenant policy is excluded',()=>{
 const publicNode=node('public-country',{country:'GB'});publicNode.layer='COUNTRY';publicNode.rules[0].value=48;
 const result=resolve(createJurisdictionPolicyGraph([publicNode,tenantNode()]),{tenant:'tenant-b',siteId:'plant-1'});
 assert.equal(result.verifiedCoverage,true);
 assert.deepEqual(result.applicableNodes.map(x=>x.id),['public-country']);
 assert.equal(result.constraints[0].value,48);
 assert.equal(result.executionAuthority,false);
});

test('preflight forwards tenant so bound policy covers only the intended tenant population',()=>{
 const graph=createJurisdictionPolicyGraph([tenantNode()]);
 const preflight=createGlobalSitePolicyPreflight({graph});
 const input={...when,site:{id:'plant-1',country:'GB',legalEntityId:'entity-1'},workers:[{id:'worker-1',employmentCategory:'employee'}]};
 const permitted=preflight.assess({...input,tenant:'tenant-a'});
 const denied=preflight.assess({...input,tenant:'tenant-b'});
 assert.equal(permitted.status,'READY_ADVISORY');
 assert.equal(permitted.coverage.covered,1);
 assert.equal(denied.status,'BLOCKED_POLICY_COVERAGE');
 assert.deepEqual(denied.coverage.missing,['worker-1']);
 assert.equal(denied.automation.executionAuthority,false);
 assert.equal(denied.automation.customerMutation,false);
});

test('preflight does not coerce malformed tenant identity into an authorized tenant',()=>{
 const preflight=createGlobalSitePolicyPreflight({graph:createJurisdictionPolicyGraph([tenantNode()])});
 for(const tenant of [['tenant-a'],{toString:()=> 'tenant-a'}]){
  let result;
  try{result=preflight.assess({...when,tenant,site:{id:'plant-1',country:'GB',legalEntityId:'entity-1'},workers:[{id:'worker-1',employmentCategory:'employee'}]});}
  catch(error){assert.ok(error instanceof Error);continue;}
  assert.equal(result.coverage.covered,0,'malformed tenant identity must not be authorized by coercion');
 }
});

test('preflight does not truncate a distinct overlength tenant into an authorized tenant',()=>{
 const legitimate='tenant-'+ 'a'.repeat(113);
 assert.equal(legitimate.length,120);
 const preflight=createGlobalSitePolicyPreflight({graph:createJurisdictionPolicyGraph([node('long-tenant',{country:'GB',tenant:legitimate,siteId:'plant-1'})])});
 let result;
 try{result=preflight.assess({...when,tenant:legitimate+'-different',site:{id:'plant-1',country:'GB',legalEntityId:'entity-1'},workers:[{id:'worker-1',employmentCategory:'employee'}]});}
 catch(error){assert.ok(error instanceof Error);return;}
 assert.equal(result.coverage.covered,0,'a distinct tenant must not alias by truncation');
});

test('tenant scope cannot bypass legal effective and knowledge boundaries',()=>{
 const bounded=tenantNode();bounded.effectiveTo='2026-06-01T00:00:00Z';bounded.supersededAt='2026-06-01T00:00:00Z';
 const graph=createJurisdictionPolicyGraph([bounded]);
 const context={country:'GB',tenant:'tenant-a',siteId:'plant-1'};
 assert.equal(graph.resolve({legalAt:'2026-05-31T23:59:59.999Z',knownAt:'2026-05-31T23:59:59.999Z',context}).verifiedCoverage,true);
 assert.equal(graph.resolve({legalAt:'2026-06-01T00:00:00Z',knownAt:'2026-05-31T23:59:59.999Z',context}).verifiedCoverage,false);
 assert.equal(graph.resolve({legalAt:'2026-05-31T23:59:59.999Z',knownAt:'2026-06-01T00:00:00Z',context}).verifiedCoverage,false);
});

test('currency-bearing synthetic policy values preserve JSON and do not cross tenant or site boundaries',()=>{
 const payment=(id,tenant,siteId,currency,amount)=>node(id,{country:'GB',tenant,siteId},[{id:id+'-payment',domain:'payroll',key:'payment',legalCharacter:'MANDATORY_REQUIREMENT',operator:'REQUIRE',value:{amount,currency},unit:'minor-units'}]);
 const graph=createJurisdictionPolicyGraph([payment('jpy','tenant-a','plant-1','JPY',2500),payment('kwd','tenant-b','plant-1','KWD',1250),payment('eur','tenant-a','plant-2','EUR',4200)]);
 for(const [tenant,siteId,currency,amount]of [['tenant-a','plant-1','JPY',2500],['tenant-b','plant-1','KWD',1250],['tenant-a','plant-2','EUR',4200]]){
  const result=resolve(graph,{tenant,siteId});
  assert.equal(result.constraints.length,1);
  assert.deepEqual(result.constraints[0].value,{amount,currency});
  assert.deepEqual(JSON.parse(JSON.stringify(result)),result);
  assert.equal(result.executionAuthority,false);
 }
});

test('missing policy fails closed for every worker while output remains JSON compatible',()=>{
 const input={...when,tenant:'tenant-z',site:{id:'plant-9',country:'GB',legalEntityId:'entity-9'},workers:[{id:'one',employmentCategory:'employee'},{id:'two',employmentCategory:'contractor'}]};
 const before=JSON.stringify(input);
 const result=createGlobalSitePolicyPreflight({graph:createJurisdictionPolicyGraph([])}).assess(input);
 assert.equal(result.status,'BLOCKED_POLICY_COVERAGE');
 assert.equal(result.coverage.workerCount,2);
 assert.equal(result.coverage.covered,0);
 assert.deepEqual(result.coverage.missing,['one','two']);
 assert.deepEqual(JSON.parse(JSON.stringify(result)),result);
 assert.equal(JSON.stringify(input),before);
});
