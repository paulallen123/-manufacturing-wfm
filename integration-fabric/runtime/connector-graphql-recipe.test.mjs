import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';
import {compileUniversalConnectorContract} from './universal-connector-contract.mjs';
import {buildSafeConnectionTest} from './connection-test-plan.mjs';
import {defineGraphqlReadRecipe,compileGraphqlReadRecipe} from './connector-graphql-recipe.mjs';
import {executeProviderRead} from './provider-read-executor.mjs';
import {extractJsonRecords} from './safe-json-records.mjs';
import {defineCanonicalMappingSpec,mapCanonicalRecord} from './connector-mapping-spec.mjs';

const NOW=Date.parse('2026-10-04T17:20:00.000Z');

function setup(){
  const contract=compileUniversalConnectorContract(connectorById('workday'),{
    tenantId:'northstar-demo',connectionId:'workday-graphql-sandbox'
  });
  const credentialRef='secret://tenant/northstar/workday-graphql';
  const connectionPlan=buildSafeConnectionTest({
    providerKey:'workday',sourceInstanceId:'workday-graphql-source',
    wfmTenantId:'northstar-demo',connectionId:'workday-graphql-sandbox',
    endpointHost:'wd2-impl-services1.workday.com',environment:'sandbox',
    adapter:'graphql',authMethod:'oauth2',credentialRef,
    capabilities:['metadata','read'],requestedSemanticScopes:['worker.read']
  });
  const connectionEvidence={
    configurationFingerprint:connectionPlan.configurationFingerprint,
    providerKey:'workday',sourceInstanceId:'workday-graphql-source',
    wfmTenantId:'northstar-demo',connectionId:'workday-graphql-sandbox',
    endpointHost:'wd2-impl-services1.workday.com',environment:'sandbox',
    readOnly:true,rawCredentialObserved:false,employeeOrPayrollDataObserved:false,
    latencyMs:15,observedAt:'2026-10-04T17:19:30.000Z',
    steps:connectionPlan.steps.map(step=>({id:step.id,status:'PASS'}))
  };
  return {contract,connectionPlan,connectionEvidence,credentialRef};
}
function recipe(){
  return defineGraphqlReadRecipe({
    schemaVersion:1,id:'workday-workers-graphql-v1',providerId:'workday',target:'worker',
    mappingProfile:'workday-worker-graphql-v1',authMode:'oauth2-bearer',
    pathSegments:['graphql'],operationName:'Workers',
    query:`query Workers($limit: Int!, $active: Boolean!) {
      workers(limit: $limit, active: $active) {
        nodes { id firstName lastName email active }
      }
    }`,
    variables:[
      {name:'limit',kind:'integer',min:1,max:500},
      {name:'active',kind:'boolean'}
    ]
  });
}
function mapping(){
  return defineCanonicalMappingSpec({
    schemaVersion:1,id:'workday-worker-graphql-map-v1',providerId:'workday',
    sourceObjectType:'Worker',canonicalType:'worker',
    fields:{
      externalId:{path:'id',kind:'id'},
      displayName:{concat:[{path:'firstName',kind:'string'},{path:'lastName',kind:'string'}],separator:' '},
      active:{path:'active',kind:'boolean'}
    },
    attributes:{email:{path:'email',kind:'string',optional:true}}
  });
}

test('fixed GraphQL query compiles to exact verified host with typed variables only',()=>{
  const ctx=setup();
  const plan=compileGraphqlReadRecipe({
    recipe:recipe(),...ctx,variables:{limit:100,active:true},nowMs:NOW
  });
  const url=new URL(plan.request.url);
  assert.equal(url.host,'wd2-impl-services1.workday.com');
  assert.equal(url.pathname,'/graphql');
  assert.equal(plan.request.method,'POST');
  assert.equal(plan.request.readViaPostProven,true);
  assert.equal(plan.request.responseFormat,'json');
  assert.equal(plan.writeAuthority,false);
  const body=JSON.parse(plan.request.body);
  assert.equal(body.operationName,'Workers');
  assert.deepEqual(body.variables,{limit:100,active:true});
  assert.match(body.query,/query Workers/);
  assert.match(plan.request.immutableQueryId,/^sha256:[a-f0-9]{64}$/);
});

test('GraphQL read executes through common bounded executor, extracts records and maps to VECTOR Worker',async()=>{
  const ctx=setup();
  const plan=compileGraphqlReadRecipe({
    recipe:recipe(),...ctx,variables:{limit:2,active:true},nowMs:NOW
  });
  const execution=await executeProviderRead({
    plan,contract:ctx.contract,
    credentialAuthorizer:async()=>({authorization:'Bearer fixture'}),
    fetchImpl:async()=>new Response(JSON.stringify({
      data:{workers:{nodes:[
        {id:'EMP-1',firstName:'Ada',lastName:'Lovelace',email:'ada@example.test',active:true},
        {id:'EMP-2',firstName:'Grace',lastName:'Hopper',email:'grace@example.test',active:true}
      ]}}
    }),{status:200,headers:{'content-type':'application/json'}}),
    clock:()=>NOW
  });
  const rows=extractJsonRecords({
    data:execution.data,recordPath:['data','workers','nodes'],maxRecords:500
  });
  const spec=mapping();
  const workers=rows.map(sourceRecord=>mapCanonicalRecord({
    spec,providerId:'workday',sourceRecord,receipt:execution.receipt
  }));
  assert.equal(workers.length,2);
  assert.equal(workers[0].externalId,'EMP-1');
  assert.equal(workers[0].displayName,'Ada Lovelace');
  assert.equal(workers[0].active,true);
  assert.equal(workers[0].attributes.email,'ada@example.test');
  assert.equal(execution.receipt.readOnly,true);
  assert.equal(execution.receipt.checkpointAdvanceAllowed,false);
});

test('mutation and subscription operations are rejected at recipe definition',()=>{
  for(const query of [
    'mutation UpdateWorker { updateWorker(id:"1") { id } }',
    'subscription WorkerChanged { workerChanged { id } }'
  ]){
    assert.throws(()=>defineGraphqlReadRecipe({
      schemaVersion:1,id:'bad-op',providerId:'workday',target:'worker',
      mappingProfile:'x',authMode:'oauth2',pathSegments:['graphql'],query
    }),error=>error.code==='WFM_GRAPHQL_MUTATION_FORBIDDEN');
  }
});

test('mutation words inside strings and comments do not turn a safe query into a mutation',()=>{
  const safe=defineGraphqlReadRecipe({
    schemaVersion:1,id:'safe-text',providerId:'workday',target:'worker',
    mappingProfile:'x',authMode:'oauth2',pathSegments:['graphql'],
    query:`query Workers {
      workers(note: "mutation is text") { nodes { id } }
      # subscription is a comment
    }`
  });
  assert.match(safe.query,/query Workers/);
});

test('typed variables fail closed and query text cannot be supplied at compile time',()=>{
  const ctx=setup(),r=recipe();
  assert.throws(()=>compileGraphqlReadRecipe({
    recipe:r,...ctx,variables:{limit:'1 OR 1=1',active:true},nowMs:NOW
  }),error=>error.code==='WFM_GRAPHQL_VARIABLE_INVALID');
  assert.throws(()=>compileGraphqlReadRecipe({
    recipe:r,...ctx,variables:{limit:501,active:true},nowMs:NOW
  }),error=>error.code==='WFM_GRAPHQL_VARIABLE_INVALID');
  assert.throws(()=>compileGraphqlReadRecipe({
    recipe:r,...ctx,variables:{limit:100,active:'true'},nowMs:NOW
  }),error=>error.code==='WFM_GRAPHQL_VARIABLE_INVALID');

  const plan=compileGraphqlReadRecipe({
    recipe:r,...ctx,variables:{limit:100,active:true,query:'mutation Attack { x }'},nowMs:NOW
  });
  const body=JSON.parse(plan.request.body);
  assert.equal('query' in body.variables,false);
  assert.equal(body.query,r.query);
});

test('credential-like GraphQL variable names are rejected',()=>{
  for(const name of ['access_token','password','client_secret','authorization']){
    assert.throws(()=>defineGraphqlReadRecipe({
      schemaVersion:1,id:'bad-var-'+name,providerId:'workday',target:'worker',
      mappingProfile:'x',authMode:'oauth2',pathSegments:['graphql'],
      query:'query Workers { workers { nodes { id } } }',
      variables:[{name,kind:'text'}]
    }),/unsafe/);
  }
});

test('compile cannot choose another endpoint host through variables or path parameters',()=>{
  const ctx=setup();
  const pathRecipe=defineGraphqlReadRecipe({
    schemaVersion:1,id:'workday-tenant-graphql',providerId:'workday',target:'worker',
    mappingProfile:'x',authMode:'oauth2',
    pathSegments:['api',{param:{name:'tenantAlias',kind:'id'}},'graphql'],
    query:'query Workers { workers { nodes { id } } }'
  });
  const plan=compileGraphqlReadRecipe({
    recipe:pathRecipe,...ctx,
    variables:{tenantAlias:'acme_demo',endpointHost:'attacker.example'},nowMs:NOW
  });
  const url=new URL(plan.request.url);
  assert.equal(url.host,'wd2-impl-services1.workday.com');
  assert.equal(url.pathname,'/api/acme_demo/graphql');
});

test('connector must actually declare GraphQL and requested target',()=>{
  const ctx=setup();
  const noGraphql=compileUniversalConnectorContract(connectorById('oracle-netsuite'),{
    tenantId:'northstar-demo',connectionId:'netsuite-sandbox'
  });
  const nsPlan=buildSafeConnectionTest({
    providerKey:'oracle-netsuite',sourceInstanceId:'ns',
    wfmTenantId:'northstar-demo',connectionId:'netsuite-sandbox',
    endpointHost:'1234567.suitetalk.api.netsuite.com',environment:'sandbox',
    adapter:'http-json',authMethod:'oauth2',credentialRef:'secret://tenant/northstar/netsuite',
    capabilities:['read'],requestedSemanticScopes:['worker.read']
  });
  const nsEvidence={
    configurationFingerprint:nsPlan.configurationFingerprint,providerKey:'oracle-netsuite',sourceInstanceId:'ns',
    wfmTenantId:'northstar-demo',connectionId:'netsuite-sandbox',
    endpointHost:'1234567.suitetalk.api.netsuite.com',environment:'sandbox',
    readOnly:true,rawCredentialObserved:false,employeeOrPayrollDataObserved:false,latencyMs:1,
    observedAt:'2026-10-04T17:19:30.000Z',steps:nsPlan.steps.map(step=>({id:step.id,status:'PASS'}))
  };
  const nsRecipe=defineGraphqlReadRecipe({
    schemaVersion:1,id:'netsuite-gql',providerId:'oracle-netsuite',target:'worker',
    mappingProfile:'x',authMode:'oauth2',pathSegments:['graphql'],
    query:'query Workers { workers { nodes { id } } }'
  });
  assert.throws(()=>compileGraphqlReadRecipe({
    recipe:nsRecipe,contract:noGraphql,connectionPlan:nsPlan,connectionEvidence:nsEvidence,
    credentialRef:'secret://tenant/northstar/netsuite',nowMs:NOW
  }),error=>error.code==='WFM_GRAPHQL_TRANSPORT_UNAVAILABLE');
});
