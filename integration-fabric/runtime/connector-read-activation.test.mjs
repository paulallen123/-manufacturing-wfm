import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';
import {compileUniversalConnectorContract} from './universal-connector-contract.mjs';
import {buildSafeConnectionTest} from './connection-test-plan.mjs';
import {acquireNetSuiteWorkers} from './provider-acquisition.mjs';
import {stageCanonicalBatch} from './provider-ingestion-gate.mjs';
import {createConnectorHealthState,recordConnectorSuccess,recordConnectorFailure} from './connector-health-supervisor.mjs';
import {createReadActivation,authorizeActivatedRead,assessReadRecertification} from './connector-read-activation.mjs';

const NOW=Date.parse('2026-10-04T10:00:00.000Z');
const auth=async()=>({authorization:'Bearer fixture-only'});
const clock=()=>NOW;

function setup(){
  const contract=compileUniversalConnectorContract(connectorById('oracle-netsuite'),{
    tenantId:'northstar-demo',connectionId:'netsuite-sandbox'
  });
  const credentialRef='secret://tenant/northstar/netsuite';
  const connectionPlan=buildSafeConnectionTest({
    providerKey:'oracle-netsuite',sourceInstanceId:'acct-sandbox-1',
    wfmTenantId:'northstar-demo',connectionId:'netsuite-sandbox',
    endpointHost:'1234567.suitetalk.api.netsuite.com',
    environment:'sandbox',adapter:'http-json',authMethod:'oauth2',credentialRef,
    capabilities:['metadata','read'],requestedSemanticScopes:['vector.read']
  });
  const connectionEvidence={
    configurationFingerprint:connectionPlan.configurationFingerprint,
    providerKey:'oracle-netsuite',sourceInstanceId:'acct-sandbox-1',
    wfmTenantId:'northstar-demo',connectionId:'netsuite-sandbox',
    endpointHost:'1234567.suitetalk.api.netsuite.com',
    environment:'sandbox',readOnly:true,rawCredentialObserved:false,
    employeeOrPayrollDataObserved:false,latencyMs:22,
    observedAt:'2026-10-04T09:59:30.000Z',
    steps:connectionPlan.steps.map(step=>({id:step.id,status:'PASS'}))
  };
  return {contract,credentialRef,connectionPlan,connectionEvidence};
}
async function stagedContext(){
  const ctx=setup();
  const acquisition=await acquireNetSuiteWorkers({
    ...ctx,credentialAuthorizer:auth,runId:'activation-read-1',pageSize:2,nowMs:NOW,clock,
    fetchImpl:async()=>new Response(JSON.stringify({
      count:2,offset:0,totalResults:2,hasMore:false,
      items:[
        {id:'1',entityid:'EMP1',firstname:'Ada',lastname:'One',email:'one@example.test',isinactive:'F'},
        {id:'2',entityid:'EMP2',firstname:'Ada',lastname:'Two',email:'two@example.test',isinactive:'F'}
      ]
    }),{status:200})
  });
  let stagedCommand;
  const staged=await stageCanonicalBatch({
    acquisition,contract:ctx.contract,
    stageWriter:async command=>{
      stagedCommand=command;
      return {
        stagingId:'stage-read-1',acceptedAt:'2026-10-04T10:00:00.000Z',
        batchDigest:command.batchDigest,tenantId:command.binding.tenantId,
        connectionId:command.binding.connectionId,providerId:command.binding.providerId,
        target:command.binding.target,runId:command.binding.runId,rowCount:command.rowCount,complete:true
      };
    },
    verifyStagedBatch:async request=>request.batchDigest===stagedCommand.batchDigest&&request.rowCount===2
  });
  let health=createConnectorHealthState({
    providerId:'oracle-netsuite',tenantId:'northstar-demo',connectionId:'netsuite-sandbox',nowMs:NOW
  });
  health=recordConnectorSuccess(health,{latencyMs:25,nowMs:NOW});
  return {...ctx,acquisition,staged,health};
}

test('read activation requires exact connection, staged reconciliation and fresh healthy state',async()=>{
  const ctx=await stagedContext();
  const activation=createReadActivation({
    contract:ctx.contract,connectionPlan:ctx.connectionPlan,connectionEvidence:ctx.connectionEvidence,
    acquisition:ctx.acquisition,staged:ctx.staged,healthState:ctx.health,nowMs:NOW
  });
  assert.equal(activation.state,'READ_ACTIVE');
  assert.equal(activation.readEnabled,true);
  assert.equal(activation.writeEnabled,false);
  assert.equal(activation.customerProofClaimAllowed,false);
  assert.equal(activation.mappingFingerprint,ctx.acquisition.mappingFingerprint);
  assert.deepEqual(activation.schemaFingerprints,ctx.acquisition.schemaFingerprints);
  assert.match(activation.activationFingerprint,/^sha256:[a-f0-9]{64}$/);
});

test('active read lease is exact tenant connection provider and target bound',async()=>{
  const ctx=await stagedContext();
  const activation=createReadActivation({
    contract:ctx.contract,connectionPlan:ctx.connectionPlan,connectionEvidence:ctx.connectionEvidence,
    acquisition:ctx.acquisition,staged:ctx.staged,healthState:ctx.health,nowMs:NOW
  });
  assert.equal(authorizeActivatedRead(activation,{
    providerId:'oracle-netsuite',tenantId:'northstar-demo',connectionId:'netsuite-sandbox',target:'worker',nowMs:NOW+1
  }),true);
  assert.throws(()=>authorizeActivatedRead(activation,{
    providerId:'oracle-netsuite',tenantId:'other',connectionId:'netsuite-sandbox',target:'worker',nowMs:NOW+1
  }),error=>error.code==='WFM_READ_ACTIVATION_BINDING_MISMATCH');
});

test('schema or mapping drift automatically requires reproof',async()=>{
  const ctx=await stagedContext();
  const activation=createReadActivation({
    contract:ctx.contract,connectionPlan:ctx.connectionPlan,connectionEvidence:ctx.connectionEvidence,
    acquisition:ctx.acquisition,staged:ctx.staged,healthState:ctx.health,nowMs:NOW
  });
  const schemaDrift=assessReadRecertification(activation,{
    healthState:ctx.health,
    configurationFingerprint:ctx.connectionPlan.configurationFingerprint,
    mappingFingerprint:ctx.acquisition.mappingFingerprint,
    schemaFingerprints:[...ctx.acquisition.schemaFingerprints,'0'.repeat(64)],
    nowMs:NOW+1
  });
  assert.equal(schemaDrift.status,'REPROOF_REQUIRED');
  assert.ok(schemaDrift.reasons.includes('schema-changed'));
  assert.equal(schemaDrift.readEnabled,false);

  const mappingDrift=assessReadRecertification(activation,{
    healthState:ctx.health,
    configurationFingerprint:ctx.connectionPlan.configurationFingerprint,
    mappingFingerprint:'sha256:'+'1'.repeat(64),
    schemaFingerprints:ctx.acquisition.schemaFingerprints,
    nowMs:NOW+1
  });
  assert.ok(mappingDrift.reasons.includes('mapping-changed'));
});

test('unhealthy or stale health revokes active-read status',async()=>{
  const ctx=await stagedContext();
  const activation=createReadActivation({
    contract:ctx.contract,connectionPlan:ctx.connectionPlan,connectionEvidence:ctx.connectionEvidence,
    acquisition:ctx.acquisition,staged:ctx.staged,healthState:ctx.health,nowMs:NOW
  });
  const unhealthy=recordConnectorFailure(ctx.health,{code:'WFM_PROVIDER_TRANSPORT_ERROR',retryable:true},{nowMs:NOW+10_000});
  const result=assessReadRecertification(activation,{
    healthState:unhealthy,
    configurationFingerprint:ctx.connectionPlan.configurationFingerprint,
    mappingFingerprint:ctx.acquisition.mappingFingerprint,
    schemaFingerprints:ctx.acquisition.schemaFingerprints,
    nowMs:NOW+10_000
  });
  assert.equal(result.status,'REPROOF_REQUIRED');
  assert.ok(result.reasons.some(reason=>reason.startsWith('health-')));
  assert.equal(result.readEnabled,false);
});

test('expired activation lease denies reads even if old proof was once green',async()=>{
  const ctx=await stagedContext();
  const activation=createReadActivation({
    contract:ctx.contract,connectionPlan:ctx.connectionPlan,connectionEvidence:ctx.connectionEvidence,
    acquisition:ctx.acquisition,staged:ctx.staged,healthState:ctx.health,nowMs:NOW,leaseMs:60_000
  });
  assert.throws(()=>authorizeActivatedRead(activation,{
    providerId:'oracle-netsuite',tenantId:'northstar-demo',connectionId:'netsuite-sandbox',target:'worker',nowMs:NOW+60_001
  }),error=>error.code==='WFM_READ_ACTIVATION_EXPIRED');
});

test('staging result from another batch cannot activate this acquisition',async()=>{
  const ctx=await stagedContext();
  const altered={...ctx.staged,batchDigest:'0'.repeat(64)};
  assert.throws(()=>createReadActivation({
    contract:ctx.contract,connectionPlan:ctx.connectionPlan,connectionEvidence:ctx.connectionEvidence,
    acquisition:ctx.acquisition,staged:altered,healthState:ctx.health,nowMs:NOW
  }),error=>error.code==='WFM_ACTIVATION_STAGE_MISMATCH');
});
