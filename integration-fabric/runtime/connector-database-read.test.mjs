import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';
import {compileUniversalConnectorContract} from './universal-connector-contract.mjs';
import {buildSafeConnectionTest} from './connection-test-plan.mjs';
import {defineCanonicalMappingSpec} from './connector-mapping-spec.mjs';
import {defineDatabaseReadRecipe,acquireDatabaseRead} from './connector-database-read.mjs';
import {buildCanonicalStagingCommand} from './provider-ingestion-gate.mjs';

const NOW=Date.parse('2026-10-04T17:00:00.000Z');

function setup(){
  const contract=compileUniversalConnectorContract(connectorById('delmiaworks-iqms'),{
    tenantId:'northstar-demo',connectionId:'iqms-db-sandbox'
  });
  const credentialRef='secret://tenant/northstar/iqms-db';
  const connectionPlan=buildSafeConnectionTest({
    providerKey:'delmiaworks-iqms',sourceInstanceId:'iqms-read-replica-1',
    wfmTenantId:'northstar-demo',connectionId:'iqms-db-sandbox',
    endpointHost:'iqms-db.example',environment:'sandbox',
    adapter:'database-readmodel',authMethod:'managed-db-readonly',credentialRef,
    capabilities:['read-view','read-only'],requestedSemanticScopes:['production-demand.read']
  });
  const connectionEvidence={
    configurationFingerprint:connectionPlan.configurationFingerprint,
    providerKey:'delmiaworks-iqms',sourceInstanceId:'iqms-read-replica-1',
    wfmTenantId:'northstar-demo',connectionId:'iqms-db-sandbox',
    endpointHost:'iqms-db.example',environment:'sandbox',
    readOnly:true,rawCredentialObserved:false,employeeOrPayrollDataObserved:false,
    latencyMs:8,observedAt:'2026-10-04T16:59:30.000Z',
    steps:connectionPlan.steps.map(step=>({id:step.id,status:'PASS'}))
  };
  const mappingSpec=defineCanonicalMappingSpec({
    schemaVersion:1,id:'iqms-production-view-map-v1',providerId:'delmiaworks-iqms',
    sourceObjectType:'vector_integration.production_demand_v1',canonicalType:'canonical-event',
    eventType:'production_demand_snapshot',
    fields:{
      sourceRecordId:{path:'work_order_id',kind:'id'},
      occurredAt:{path:'updated_at',kind:'date'},
      siteExternalId:{path:'plant_id',kind:'string',optional:true}
    },
    payload:{
      product:{path:'product',kind:'string'},
      plannedQty:{path:'qty',kind:'number'},
      rowVersion:{path:'row_version',kind:'raw-scalar'}
    }
  });
  const recipe=defineDatabaseReadRecipe({
    schemaVersion:1,id:'iqms-production-view-v1',providerId:'delmiaworks-iqms',
    target:'production-demand',dataset:'production-demand',mappingProfile:'iqms-production-view-map-v1',
    dialect:'mssql',sourceView:'vector_integration.production_demand_v1',
    columns:['work_order_id','updated_at','plant_id','product','qty','row_version'],
    orderBy:['row_version','work_order_id'],
    checkpoint:{column:'row_version',kind:'integer'},
    datasetMode:'delta',pageSize:500,maxRows:50000
  });
  return {contract,connectionPlan,connectionEvidence,credentialRef,mappingSpec,recipe};
}

function resultFor(ctx,authority,rows,overrides={}){
  return {
    providerId:'delmiaworks-iqms',tenantId:'northstar-demo',connectionId:'iqms-db-sandbox',
    configurationFingerprint:ctx.connectionPlan.configurationFingerprint,
    queryFingerprint:authority.queryFingerprint,readOnlyTransaction:true,complete:true,
    observedAt:'2026-10-04T16:59:45.000Z',rows,rowCount:rows.length,
    schemaFingerprint:ctx.recipe.schemaFingerprint,latencyMs:12,
    ...overrides
  };
}

test('generated database read is SELECT-only, read-only and stages through existing production event path',async()=>{
  const ctx=setup();
  let observedAuthority;
  const acquisition=await acquireDatabaseRead({
    ...ctx,runId:'iqms-db-run-1',checkpointValue:'100',nowMs:NOW,
    databaseExecutor:async authority=>{
      observedAuthority=authority;
      return resultFor(ctx,authority,[
        {work_order_id:'WO-101',updated_at:'2026-10-04T16:58:00Z',plant_id:'PLANT-01',product:'WIDGET-A',qty:'500',row_version:'101'},
        {work_order_id:'WO-102',updated_at:'2026-10-04T16:58:30Z',plant_id:'PLANT-01',product:'WIDGET-B',qty:'250',row_version:'102'}
      ]);
    }
  });
  assert.equal(observedAuthority.readOnly,true);
  assert.equal(observedAuthority.writeAllowed,false);
  assert.equal(observedAuthority.ddlAllowed,false);
  assert.equal(observedAuthority.procedureCallAllowed,false);
  assert.equal(observedAuthority.transactionMode,'read-only');
  assert.equal(observedAuthority.query,'SELECT TOP 500 work_order_id, updated_at, plant_id, product, qty, row_version FROM vector_integration.production_demand_v1 WHERE row_version > ? ORDER BY row_version, work_order_id');
  assert.deepEqual(observedAuthority.bindings,['100']);
  assert.equal(acquisition.status,'SAFE_TO_STAGE');
  assert.equal(acquisition.records.length,2);
  assert.equal(acquisition.records[0].sourceRecordId,'WO-101');
  assert.equal(acquisition.records[0].eventType,'production_demand_snapshot');
  assert.equal(acquisition.records[0].payload.plannedQty,500);
  const staging=buildCanonicalStagingCommand(acquisition,ctx.contract);
  assert.equal(staging.route,'/events');
  assert.equal(staging.rowCount,2);
});

test('recipe surface cannot express arbitrary SQL or credential-like columns',()=>{
  assert.throws(()=>defineDatabaseReadRecipe({
    schemaVersion:1,id:'bad',providerId:'delmiaworks-iqms',target:'production-demand',dataset:'x',
    mappingProfile:'x',dialect:'mssql',sourceView:'view;DROP TABLE users',
    columns:['work_order_id'],orderBy:['work_order_id']
  }),/identifier/);

  assert.throws(()=>defineDatabaseReadRecipe({
    schemaVersion:1,id:'bad-secret',providerId:'delmiaworks-iqms',target:'production-demand',dataset:'x',
    mappingProfile:'x',dialect:'mssql',sourceView:'vector.safe_view',
    columns:['work_order_id','api_token'],orderBy:['work_order_id']
  }),/safe database identifier/);
});

test('unexpected columns are rejected before canonical mapping',async()=>{
  const ctx=setup();
  await assert.rejects(()=>acquireDatabaseRead({
    ...ctx,runId:'extra-column',checkpointValue:'100',nowMs:NOW,
    databaseExecutor:async authority=>resultFor(ctx,authority,[{
      work_order_id:'WO-101',updated_at:'2026-10-04T16:58:00Z',plant_id:'PLANT-01',
      product:'WIDGET-A',qty:'500',row_version:'101',salary_secret:'999'
    }])
  }),error=>error.code==='WFM_DATABASE_SCHEMA_MISMATCH');
});

test('schema fingerprint query fingerprint and read-only transaction must match exact authority',async()=>{
  const cases=[
    {schemaFingerprint:'sha256:'+'0'.repeat(64),code:'WFM_DATABASE_SCHEMA_MISMATCH'},
    {queryFingerprint:'sha256:'+'1'.repeat(64),code:'WFM_DATABASE_RESULT_MISMATCH'},
    {readOnlyTransaction:false,code:'WFM_DATABASE_RESULT_NOT_VERIFIED'},
    {complete:false,code:'WFM_DATABASE_RESULT_NOT_VERIFIED'}
  ];
  for(const override of cases){
    const ctx=setup();
    await assert.rejects(()=>acquireDatabaseRead({
      ...ctx,runId:'bad-receipt',checkpointValue:'100',nowMs:NOW,
      databaseExecutor:async authority=>resultFor(ctx,authority,[{
        work_order_id:'WO-101',updated_at:'2026-10-04T16:58:00Z',plant_id:'PLANT-01',
        product:'WIDGET-A',qty:'500',row_version:'101'
      }],override)
    }),error=>error.code===override.code);
  }
});

test('duplicate business identity quarantines database acquisition',async()=>{
  const ctx=setup();
  const acquisition=await acquireDatabaseRead({
    ...ctx,runId:'duplicate-db',checkpointValue:'100',nowMs:NOW,
    databaseExecutor:async authority=>resultFor(ctx,authority,[
      {work_order_id:'WO-101',updated_at:'2026-10-04T16:58:00Z',plant_id:'PLANT-01',product:'A',qty:'1',row_version:'101'},
      {work_order_id:'WO-101',updated_at:'2026-10-04T16:59:00Z',plant_id:'PLANT-01',product:'A',qty:'2',row_version:'102'}
    ])
  });
  assert.equal(acquisition.status,'QUARANTINED');
  assert.ok(acquisition.reconciliation.reasons.includes('duplicate-row-keys'));
  assert.equal(acquisition.checkpointCandidate,null);
});

test('checkpoint values are typed and never interpolated into SQL',async()=>{
  const ctx=setup();
  await assert.rejects(()=>acquireDatabaseRead({
    ...ctx,runId:'bad-checkpoint',checkpointValue:'100 OR 1=1',nowMs:NOW,
    databaseExecutor:async()=>{throw new Error('must not execute');}
  }),error=>error.code==='WFM_DATABASE_CHECKPOINT_INVALID');

  let authority;
  await acquireDatabaseRead({
    ...ctx,runId:'good-checkpoint',checkpointValue:'123',nowMs:NOW,
    databaseExecutor:async a=>{
      authority=a;
      return resultFor(ctx,a,[]);
    }
  });
  assert.equal(authority.query.includes('123'),false);
  assert.deepEqual(authority.bindings,['123']);
});

test('database executor cannot substitute another tenant connection provider or query',async()=>{
  const ctx=setup();
  for(const override of [
    {tenantId:'other'},
    {connectionId:'other'},
    {providerId:'other-provider'},
    {queryFingerprint:'sha256:'+'f'.repeat(64)}
  ]){
    await assert.rejects(()=>acquireDatabaseRead({
      ...ctx,runId:'wrong-binding',checkpointValue:'100',nowMs:NOW,
      databaseExecutor:async authority=>resultFor(ctx,authority,[],override)
    }),error=>error.code==='WFM_DATABASE_RESULT_MISMATCH');
  }
});
