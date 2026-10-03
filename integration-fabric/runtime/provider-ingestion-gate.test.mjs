import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';
import {compileUniversalConnectorContract} from './universal-connector-contract.mjs';
import {buildSafeConnectionTest} from './connection-test-plan.mjs';
import {acquireNetSuiteWorkers,acquireSapS4ProductionDemand} from './provider-acquisition.mjs';
import {buildCanonicalStagingCommand,stageCanonicalBatch} from './provider-ingestion-gate.mjs';

const NOW=Date.parse('2026-10-03T22:30:00.000Z');
const auth=async()=>({authorization:'Bearer fixture-only'});
const clock=()=>NOW;

function setup(providerId,connectionId,{sourceInstanceId,endpointHost,authMethod,credentialRef,adapter='http-json'}){
  const contract=compileUniversalConnectorContract(connectorById(providerId),{tenantId:'northstar-demo',connectionId});
  const connectionPlan=buildSafeConnectionTest({
    providerKey:providerId,sourceInstanceId,wfmTenantId:'northstar-demo',connectionId,endpointHost,
    environment:'sandbox',adapter,authMethod,credentialRef,capabilities:['metadata','read'],requestedSemanticScopes:['vector.read']
  });
  const connectionEvidence={
    configurationFingerprint:connectionPlan.configurationFingerprint,providerKey:providerId,sourceInstanceId,
    wfmTenantId:'northstar-demo',connectionId,endpointHost,environment:'sandbox',readOnly:true,
    rawCredentialObserved:false,employeeOrPayrollDataObserved:false,latencyMs:20,
    observedAt:'2026-10-03T22:29:30.000Z',steps:connectionPlan.steps.map(step=>({id:step.id,status:'PASS'}))
  };
  return {contract,connectionPlan,connectionEvidence,credentialRef};
}
async function safeNetSuite(){
  const ctx=setup('oracle-netsuite','netsuite-sandbox',{
    sourceInstanceId:'acct-sandbox-1',endpointHost:'1234567.suitetalk.api.netsuite.com',
    authMethod:'oauth2',credentialRef:'secret://tenant/northstar/netsuite'
  });
  const acquisition=await acquireNetSuiteWorkers({
    ...ctx,credentialAuthorizer:auth,runId:'ns-ingest-1',pageSize:2,nowMs:NOW,clock,
    fetchImpl:async()=>new Response(JSON.stringify({
      count:2,offset:0,totalResults:2,hasMore:false,
      items:[
        {id:'1',entityid:'EMP1',firstname:'Ada',lastname:'One',email:'one@example.test',isinactive:'F'},
        {id:'2',entityid:'EMP2',firstname:'Ada',lastname:'Two',email:'two@example.test',isinactive:'F'}
      ]
    }),{status:200})
  });
  return {...ctx,acquisition};
}
async function safeSap(){
  const ctx=setup('sap-s4hana','sap-sandbox',{
    sourceInstanceId:'sap-s4-sandbox-1',endpointHost:'acme-api.s4hana.cloud.example',
    authMethod:'oauth2',credentialRef:'secret://tenant/northstar/sap',adapter:'odata'
  });
  const acquisition=await acquireSapS4ProductionDemand({
    ...ctx,credentialAuthorizer:auth,runId:'sap-ingest-1',pageSize:2,nowMs:NOW,clock,
    fetchImpl:async()=>new Response(JSON.stringify({d:{results:[{
      ManufacturingOrder:'1001',Product:'WIDGET-A',ProductionPlant:'PLANT-01',
      LastChangeDateTime:'2026-10-03T22:25:00Z'
    }]}}),{status:200})
  });
  return {...ctx,acquisition};
}
function exactReceipt(command,overrides={}){
  return {
    stagingId:'stage-123',
    acceptedAt:'2026-10-03T22:31:00.000Z',
    batchDigest:command.batchDigest,
    tenantId:command.binding.tenantId,
    connectionId:command.binding.connectionId,
    providerId:command.binding.providerId,
    target:command.binding.target,
    runId:command.binding.runId,
    rowCount:command.rowCount,
    complete:true,
    ...overrides
  };
}

test('safe worker acquisition produces deterministic /workers staging command',async()=>{
  const {contract,acquisition}=await safeNetSuite();
  const a=buildCanonicalStagingCommand(acquisition,contract);
  const b=buildCanonicalStagingCommand(acquisition,contract);
  assert.equal(a.route,'/workers');
  assert.equal(a.method,'POST');
  assert.equal(a.rowCount,2);
  assert.equal(a.idempotencyKey,b.idempotencyKey);
  assert.equal(a.batchDigest,b.batchDigest);
  assert.equal(a.deletionAuthority,false);
  assert.equal(a.customerProofClaimAllowed,false);
});

test('verified staging is the only path that releases checkpoint for commit',async()=>{
  const {contract,acquisition}=await safeNetSuite();
  let verified;
  const result=await stageCanonicalBatch({
    acquisition,contract,
    stageWriter:async command=>exactReceipt(command),
    verifyStagedBatch:async request=>{verified=request;return true;}
  });
  assert.equal(result.status,'STAGED_VERIFIED');
  assert.equal(result.route,'/workers');
  assert.ok(result.checkpointToCommit);
  assert.equal(result.checkpointToCommit.watermark,acquisition.sourceWatermark);
  assert.equal(verified.rowCount,2);
  assert.equal(verified.binding.connectionId,'netsuite-sandbox');
  assert.equal(result.customerProofClaimAllowed,false);
});

test('quarantined partial acquisition cannot reach the staging writer',async()=>{
  const ctx=setup('oracle-netsuite','netsuite-partial',{
    sourceInstanceId:'acct-sandbox-2',endpointHost:'7654321.suitetalk.api.netsuite.com',
    authMethod:'oauth2',credentialRef:'secret://tenant/northstar/netsuite-2'
  });
  const acquisition=await acquireNetSuiteWorkers({
    ...ctx,credentialAuthorizer:auth,runId:'ns-partial',pageSize:1,maxPages:1,nowMs:NOW,clock,
    fetchImpl:async()=>new Response(JSON.stringify({
      count:1,offset:0,totalResults:2,hasMore:true,
      items:[{id:'1',entityid:'EMP1',firstname:'Ada',lastname:'One',email:'one@example.test',isinactive:'F'}]
    }),{status:200})
  });
  assert.equal(acquisition.status,'QUARANTINED');
  let called=false;
  await assert.rejects(
    ()=>stageCanonicalBatch({
      acquisition,contract:ctx.contract,
      stageWriter:async()=>{called=true;throw new Error('must not run');},
      verifyStagedBatch:async()=>true
    }),
    error=>error.code==='WFM_INGESTION_NOT_RECONCILED'
  );
  assert.equal(called,false);
});

test('content changed after reconciliation is rejected before staging',async()=>{
  const {contract,acquisition}=await safeNetSuite();
  const tampered=structuredClone(acquisition);
  tampered.records[0].displayName='Tampered Name';
  assert.throws(
    ()=>buildCanonicalStagingCommand(tampered,contract),
    error=>error.code==='WFM_INGESTION_CONTENT_MISMATCH'
  );
});

test('stage receipt must prove the entire exact bound batch',async()=>{
  const {contract,acquisition}=await safeNetSuite();
  let verified=false;
  await assert.rejects(
    ()=>stageCanonicalBatch({
      acquisition,contract,
      stageWriter:async command=>exactReceipt(command,{rowCount:1}),
      verifyStagedBatch:async()=>{verified=true;return true;}
    }),
    error=>error.code==='WFM_INGESTION_RECEIPT_MISMATCH'
  );
  assert.equal(verified,false);
});

test('independent read-back verification failure withholds checkpoint',async()=>{
  const {contract,acquisition}=await safeNetSuite();
  await assert.rejects(
    ()=>stageCanonicalBatch({
      acquisition,contract,
      stageWriter:async command=>exactReceipt(command),
      verifyStagedBatch:async()=>false
    }),
    error=>error.code==='WFM_INGESTION_STAGE_VERIFICATION_FAILED'
  );
});

test('production demand stages through existing canonical /events route',async()=>{
  const {contract,acquisition}=await safeSap();
  const command=buildCanonicalStagingCommand(acquisition,contract);
  assert.equal(command.route,'/events');
  assert.equal(command.rowCount,1);
  assert.equal(command.records[0].eventType,'production_demand_snapshot');
});

test('a reconciled acquisition cannot be staged under another connection contract',async()=>{
  const {acquisition}=await safeNetSuite();
  const other=compileUniversalConnectorContract(connectorById('oracle-netsuite'),{
    tenantId:'northstar-demo',connectionId:'different-connection'
  });
  assert.throws(
    ()=>buildCanonicalStagingCommand(acquisition,other),
    error=>error.code==='WFM_INGESTION_BINDING_MISMATCH'
  );
});
