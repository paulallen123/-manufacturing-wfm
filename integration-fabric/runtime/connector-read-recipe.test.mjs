import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';
import {compileUniversalConnectorContract} from './universal-connector-contract.mjs';
import {buildSafeConnectionTest} from './connection-test-plan.mjs';
import {defineConnectorReadRecipe,compileConnectorReadRecipe} from './connector-read-recipe.mjs';
import {executeProviderRead} from './provider-read-executor.mjs';

const NOW=Date.parse('2026-10-04T10:15:00.000Z');

function connection(providerId,connectionId,endpointHost,credentialRef,adapter='http-json'){
  const contract=compileUniversalConnectorContract(connectorById(providerId),{
    tenantId:'northstar-demo',connectionId
  });
  const plan=buildSafeConnectionTest({
    providerKey:providerId,sourceInstanceId:connectionId+'-source',
    wfmTenantId:'northstar-demo',connectionId,endpointHost,environment:'sandbox',
    adapter,authMethod:'oauth2',credentialRef,capabilities:['metadata','read'],requestedSemanticScopes:['vector.read']
  });
  const evidence={
    configurationFingerprint:plan.configurationFingerprint,providerKey:providerId,
    sourceInstanceId:plan.configuration.sourceInstanceId,wfmTenantId:'northstar-demo',connectionId,endpointHost,
    environment:'sandbox',readOnly:true,rawCredentialObserved:false,employeeOrPayrollDataObserved:false,
    latencyMs:12,observedAt:'2026-10-04T10:14:30.000Z',
    steps:plan.steps.map(step=>({id:step.id,status:'PASS'}))
  };
  return {contract,connectionPlan:plan,connectionEvidence:evidence,credentialRef};
}
function netsuiteRecipe(){
  return defineConnectorReadRecipe({
    schemaVersion:1,id:'netsuite-worker-suiteql-v1',providerId:'oracle-netsuite',target:'worker',
    mappingProfile:'netsuite-worker-v1',adapter:'http-json',method:'POST',authMode:'oauth2-bearer',
    readViaPostProven:true,
    pathSegments:['services','rest','query','v1','suiteql'],
    query:[
      {name:'limit',param:{name:'limit',kind:'integer',min:1,max:1000}},
      {name:'offset',param:{name:'offset',kind:'integer',min:0,max:100000}}
    ],
    headers:{accept:'application/json','content-type':'application/json',prefer:'transient'},
    fixedJsonBody:{q:'SELECT id, entityid, firstname, lastname, email, isinactive FROM employee ORDER BY id'},
    pagination:{style:'limit-offset',uniqueOrder:'id'},
    route:{routeId:'netsuite-account',region:'provider',dataLocation:'provider'}
  });
}

test('reviewed recipe compiles to same safe provider-read contract without choosing its own host',()=>{
  const ctx=connection('oracle-netsuite','netsuite-sandbox','1234567.suitetalk.api.netsuite.com','secret://tenant/northstar/netsuite');
  const recipe=netsuiteRecipe();
  const plan=compileConnectorReadRecipe({
    recipe,...ctx,parameters:{limit:250,offset:500},nowMs:NOW
  });
  const url=new URL(plan.request.url);
  assert.equal(url.host,'1234567.suitetalk.api.netsuite.com');
  assert.equal(url.pathname,'/services/rest/query/v1/suiteql');
  assert.equal(url.searchParams.get('limit'),'250');
  assert.equal(url.searchParams.get('offset'),'500');
  assert.equal(plan.request.method,'POST');
  assert.equal(plan.request.readViaPostProven,true);
  assert.equal(JSON.parse(plan.request.body).q,'SELECT id, entityid, firstname, lastname, email, isinactive FROM employee ORDER BY id');
  assert.equal(plan.mappingProfile,'netsuite-worker-v1');
  assert.equal(plan.writeAuthority,false);
  assert.match(plan.request.immutableQueryId,/^sha256:[a-f0-9]{64}$/);
});

test('compiled recipe is executable by the same bounded provider executor',async()=>{
  const ctx=connection('oracle-netsuite','netsuite-sandbox','1234567.suitetalk.api.netsuite.com','secret://tenant/northstar/netsuite');
  const plan=compileConnectorReadRecipe({recipe:netsuiteRecipe(),...ctx,parameters:{limit:1,offset:0},nowMs:NOW});
  const result=await executeProviderRead({
    plan,contract:ctx.contract,
    credentialAuthorizer:async()=>({authorization:'Bearer fixture'}),
    fetchImpl:async()=>new Response(JSON.stringify({count:1,offset:0,totalResults:1,hasMore:false,items:[{id:'1'}]}),{status:200}),
    clock:()=>NOW
  });
  assert.equal(result.receipt.readOnly,true);
  assert.equal(result.receipt.providerId,'oracle-netsuite');
  assert.equal(result.data.items[0].id,'1');
});

test('new GET connector can use typed path and paging parameters without new networking code',()=>{
  const ctx=connection('workday','workday-sandbox','wd2-impl-services1.workday.com','secret://tenant/northstar/workday');
  const recipe=defineConnectorReadRecipe({
    schemaVersion:1,id:'workday-workers-v1',providerId:'workday',target:'worker',
    mappingProfile:'workday-worker-v1',adapter:'http-json',method:'GET',authMode:'oauth2-bearer',
    pathSegments:['ccx','api','v1',{param:{name:'tenantAlias',kind:'id'}},'workers'],
    query:[
      {name:'limit',param:{name:'limit',kind:'integer',min:1,max:500}},
      {name:'active',param:{name:'active',kind:'boolean',required:false}}
    ],
    headers:{accept:'application/json'},pagination:{style:'limit-cursor'}
  });
  const plan=compileConnectorReadRecipe({
    recipe,...ctx,parameters:{tenantAlias:'acme_demo',limit:200,active:true},nowMs:NOW
  });
  const url=new URL(plan.request.url);
  assert.equal(url.pathname,'/ccx/api/v1/acme_demo/workers');
  assert.equal(url.searchParams.get('limit'),'200');
  assert.equal(url.searchParams.get('active'),'true');
  assert.equal(plan.request.method,'GET');
  assert.equal(plan.request.body,null);
});

test('recipe cannot define host auth transport headers or path traversal',()=>{
  assert.throws(()=>defineConnectorReadRecipe({
    schemaVersion:1,id:'bad',providerId:'workday',target:'worker',mappingProfile:'x',adapter:'http-json',
    method:'GET',authMode:'oauth2',pathSegments:['..','workers'],headers:{accept:'application/json'}
  }),/exact path segment/);

  assert.throws(()=>defineConnectorReadRecipe({
    schemaVersion:1,id:'bad2',providerId:'workday',target:'worker',mappingProfile:'x',adapter:'http-json',
    method:'GET',authMode:'oauth2',pathSegments:['workers'],headers:{authorization:'Bearer attacker'}
  }),/cannot define transport\/auth header/);

  const ctx=connection('workday','workday-sandbox','wd2-impl-services1.workday.com','secret://tenant/northstar/workday');
  const recipe=defineConnectorReadRecipe({
    schemaVersion:1,id:'safe',providerId:'workday',target:'worker',mappingProfile:'x',adapter:'http-json',
    method:'GET',authMode:'oauth2',pathSegments:['workers'],headers:{accept:'application/json'}
  });
  const plan=compileConnectorReadRecipe({...ctx,recipe,parameters:{endpointHost:'attacker.example'},nowMs:NOW});
  assert.equal(new URL(plan.request.url).host,'wd2-impl-services1.workday.com');
});

test('semantic query expressions are fixed reviewed content, never dynamic agent input',()=>{
  assert.throws(()=>defineConnectorReadRecipe({
    schemaVersion:1,id:'odata-bad',providerId:'sap-s4hana',target:'production-demand',
    mappingProfile:'sap-prod-v1',adapter:'odata',method:'GET',authMode:'oauth2',
    pathSegments:['sap','odata','orders'],
    query:[{name:'$filter',param:{name:'filter',kind:'text'}}],
    headers:{accept:'application/json'}
  }),/semantic query expression must be fixed/);

  const recipe=defineConnectorReadRecipe({
    schemaVersion:1,id:'odata-safe',providerId:'sap-s4hana',target:'production-demand',
    mappingProfile:'sap-prod-v1',adapter:'odata',method:'GET',authMode:'oauth2',
    pathSegments:['sap','odata','orders'],
    query:[
      {name:'$filter',fixed:"Status eq 'OPEN'"},
      {name:'$top',param:{name:'top',kind:'integer',min:1,max:1000}}
    ],
    headers:{accept:'application/json'}
  });
  assert.equal(recipe.query[0].fixed,"Status eq 'OPEN'");
});

test('read-via-POST body is fixed inert reviewed JSON and cannot contain credential material',()=>{
  assert.throws(()=>defineConnectorReadRecipe({
    schemaVersion:1,id:'post-no-proof',providerId:'oracle-netsuite',target:'worker',mappingProfile:'x',
    adapter:'http-json',method:'POST',authMode:'oauth2',pathSegments:['query'],fixedJsonBody:{q:'SELECT 1'}
  }),/readViaPostProven/);

  assert.throws(()=>defineConnectorReadRecipe({
    schemaVersion:1,id:'post-secret',providerId:'oracle-netsuite',target:'worker',mappingProfile:'x',
    adapter:'http-json',method:'POST',authMode:'oauth2',readViaPostProven:true,
    pathSegments:['query'],fixedJsonBody:{access_token:'do-not-store'}
  }),/credential-like field/);
});

test('typed parameters fail closed before URL creation',()=>{
  const ctx=connection('workday','workday-sandbox','wd2-impl-services1.workday.com','secret://tenant/northstar/workday');
  const recipe=defineConnectorReadRecipe({
    schemaVersion:1,id:'workday-workers-v2',providerId:'workday',target:'worker',
    mappingProfile:'workday-worker-v1',adapter:'http-json',method:'GET',authMode:'oauth2',
    pathSegments:['workers'],query:[{name:'limit',param:{name:'limit',kind:'integer',min:1,max:500}}],
    headers:{accept:'application/json'}
  });
  assert.throws(()=>compileConnectorReadRecipe({...ctx,recipe,parameters:{limit:'1 OR 1=1'},nowMs:NOW}),/outside bounds/);
  assert.throws(()=>compileConnectorReadRecipe({...ctx,recipe,parameters:{limit:501},nowMs:NOW}),/outside bounds/);
});

test('recipe cannot use transport or target the connector does not actually declare',()=>{
  const ctx=connection('workday','workday-sandbox','wd2-impl-services1.workday.com','secret://tenant/northstar/workday');
  const odata=defineConnectorReadRecipe({
    schemaVersion:1,id:'wrong-transport',providerId:'workday',target:'worker',mappingProfile:'x',
    adapter:'odata',method:'GET',authMode:'oauth2',pathSegments:['workers'],headers:{accept:'application/json'}
  });
  assert.throws(()=>compileConnectorReadRecipe({...ctx,recipe:odata,nowMs:NOW}),error=>error.code==='WFM_CONNECTOR_RECIPE_TRANSPORT_UNAVAILABLE');

  const badTarget=defineConnectorReadRecipe({
    schemaVersion:1,id:'wrong-target',providerId:'workday',target:'machine-state',mappingProfile:'x',
    adapter:'http-json',method:'GET',authMode:'oauth2',pathSegments:['machines'],headers:{accept:'application/json'}
  });
  assert.throws(()=>compileConnectorReadRecipe({...ctx,recipe:badTarget,nowMs:NOW}),error=>error.code==='WFM_CONNECTOR_RECIPE_TARGET_UNAVAILABLE');
});
