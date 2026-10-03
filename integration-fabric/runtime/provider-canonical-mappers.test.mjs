import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';
import {compileUniversalConnectorContract} from './universal-connector-contract.mjs';
import {buildSafeConnectionTest} from './connection-test-plan.mjs';
import {
  buildStaffologyWorkerDetailRead,
  buildNetSuiteWorkerSuiteQLRead,
  buildSapS4ProductionOrderRead
} from './provider-read-requests.mjs';
import {executeProviderRead} from './provider-read-executor.mjs';
import {
  mapStaffologyWorkerDetail,
  mapNetSuiteWorkerPage,
  mapSapS4ProductionDemandPage
} from './provider-canonical-mappers.mjs';

const NOW=Date.parse('2026-10-03T21:30:00.000Z');

function setup(providerId,connectionId,{sourceInstanceId,endpointHost,authMethod,credentialRef,adapter='http-json'}){
  const contract=compileUniversalConnectorContract(connectorById(providerId),{tenantId:'northstar-demo',connectionId});
  const connectionPlan=buildSafeConnectionTest({
    providerKey:providerId,
    sourceInstanceId,
    wfmTenantId:'northstar-demo',
    connectionId,
    endpointHost,
    environment:'sandbox',
    adapter,
    authMethod,
    credentialRef,
    capabilities:['metadata','read'],
    requestedSemanticScopes:['vector.read']
  });
  const connectionEvidence={
    configurationFingerprint:connectionPlan.configurationFingerprint,
    providerKey:providerId,
    sourceInstanceId,
    wfmTenantId:'northstar-demo',
    connectionId,
    endpointHost,
    environment:'sandbox',
    readOnly:true,
    rawCredentialObserved:false,
    employeeOrPayrollDataObserved:false,
    latencyMs:30,
    observedAt:'2026-10-03T21:29:00.000Z',
    steps:connectionPlan.steps.map(step=>({id:step.id,status:'PASS'}))
  };
  return {contract,connectionPlan,connectionEvidence,credentialRef};
}
const auth=async()=>({authorization:'Bearer fixture-only'});
const clock=()=>NOW;

test('NetSuite verified read maps to existing VECTOR Worker schema',async()=>{
  const ctx=setup('oracle-netsuite','netsuite-sandbox',{
    sourceInstanceId:'acct-sandbox-1',
    endpointHost:'1234567-sb1.suitetalk.api.netsuite.com',
    authMethod:'oauth2',
    credentialRef:'secret://tenant/northstar/netsuite'
  });
  const plan=buildNetSuiteWorkerSuiteQLRead({...ctx,limit:100,offset:0,nowMs:NOW});
  const execution=await executeProviderRead({
    plan,contract:ctx.contract,credentialAuthorizer:auth,clock,
    fetchImpl:async()=>new Response(JSON.stringify({
      count:2,offset:0,totalResults:2,hasMore:false,
      items:[
        {id:'42',entityid:'EMP42',firstname:'Ada',lastname:'Lovelace',email:'ada@example.test',isinactive:'F'},
        {id:'43',entityid:'EMP43',firstname:'Grace',lastname:'Hopper',email:'grace@example.test',isinactive:false}
      ]
    }),{status:200})
  });
  const mapped=mapNetSuiteWorkerPage({plan,execution,contract:ctx.contract});
  assert.equal(mapped.target,'worker');
  assert.equal(mapped.rowCount,2);
  assert.equal(mapped.records[0].externalId,'42');
  assert.equal(mapped.records[0].employeeNumber,'EMP42');
  assert.equal(mapped.records[0].displayName,'Ada Lovelace');
  assert.equal(mapped.records[0].active,true);
  assert.equal(mapped.page.complete,true);
  assert.match(mapped.schemaObservation.fingerprint,/^[a-f0-9]{64}$/);
  assert.equal(mapped.checkpointAdvanceAllowed,false);
});

test('Staffology verified detail read reuses hardened existing mapper and emits VECTOR Worker',async()=>{
  const ctx=setup('iris-staffology-payroll','staffology-sandbox',{
    sourceInstanceId:'Employer-123',
    endpointHost:'api.staffology.co.uk',
    authMethod:'api-key-basic',
    credentialRef:'secret://tenant/northstar/staffology'
  });
  const plan=buildStaffologyWorkerDetailRead({...ctx,employerId:'Employer-123',employeeId:'Employee-42',nowMs:NOW});
  const execution=await executeProviderRead({
    plan,contract:ctx.contract,credentialAuthorizer:auth,clock,
    fetchImpl:async()=>new Response(JSON.stringify({
      id:'Employee-42',
      status:'Current',
      personalDetails:{firstName:'Ada',lastName:'Lovelace',email:'ada@example.test'},
      employmentDetails:{
        payrollCode:'PAY42',
        starterDetails:{startDate:'2026-01-01'},
        leaverDetails:{hasLeft:false},
        jobTitle:'Operator',
        department:{title:'Line 1'}
      }
    }),{status:200})
  });
  const mapped=mapStaffologyWorkerDetail({plan,execution,contract:ctx.contract});
  assert.equal(mapped.rowCount,1);
  assert.equal(mapped.records[0].externalId,'Employee-42');
  assert.equal(mapped.records[0].employeeNumber,'PAY42');
  assert.equal(mapped.records[0].displayName,'Ada Lovelace');
  assert.equal(mapped.records[0].active,true);
  assert.equal(mapped.records[0].attributes.departmentName,'Line 1');
  assert.equal(mapped.checkpointAdvanceAllowed,false);
});

test('SAP S/4 verified production read maps to VECTOR canonical production-demand events',async()=>{
  const ctx=setup('sap-s4hana','sap-sandbox',{
    sourceInstanceId:'sap-s4-sandbox-1',
    endpointHost:'acme-api.s4hana.cloud.example',
    authMethod:'oauth2',
    credentialRef:'secret://tenant/northstar/sap',
    adapter:'odata'
  });
  const plan=buildSapS4ProductionOrderRead({...ctx,top:100,skip:0,nowMs:NOW});
  const execution=await executeProviderRead({
    plan,contract:ctx.contract,credentialAuthorizer:auth,clock,
    fetchImpl:async()=>new Response(JSON.stringify({
      d:{results:[{
        ManufacturingOrder:'1000001',
        Product:'WIDGET-A',
        ProductionPlant:'PLANT-01',
        ManufacturingOrderType:'PP01',
        MfgOrderPlannedStartDate:'2026-10-04T06:00:00Z',
        MfgOrderPlannedEndDate:'2026-10-04T14:00:00Z',
        MfgOrderPlannedTotalQty:'500',
        ProductionUnit:'EA',
        LastChangeDateTime:'2026-10-03T21:25:00Z'
      }]}
    }),{status:200})
  });
  const mapped=mapSapS4ProductionDemandPage({plan,execution,contract:ctx.contract});
  assert.equal(mapped.target,'production-demand');
  assert.equal(mapped.rowCount,1);
  assert.equal(mapped.records[0].eventType,'production_demand_snapshot');
  assert.equal(mapped.records[0].sourceSystem,'sap-s4hana');
  assert.equal(mapped.records[0].sourceRecordId,'1000001');
  assert.equal(mapped.records[0].siteExternalId,'PLANT-01');
  assert.equal(mapped.records[0].occurredAt,'2026-10-03T21:25:00.000Z');
  assert.equal(mapped.records[0].payload.Product,'WIDGET-A');
  assert.equal(mapped.page.complete,true);
  assert.equal(mapped.checkpointAdvanceAllowed,false);
});

test('mapping cannot be replayed under a different connector contract',async()=>{
  const ns=setup('oracle-netsuite','netsuite-sandbox',{
    sourceInstanceId:'acct-sandbox-1',
    endpointHost:'1234567.suitetalk.api.netsuite.com',
    authMethod:'oauth2',
    credentialRef:'secret://tenant/northstar/netsuite'
  });
  const plan=buildNetSuiteWorkerSuiteQLRead({...ns,limit:100,offset:0,nowMs:NOW});
  const execution=await executeProviderRead({
    plan,contract:ns.contract,credentialAuthorizer:auth,clock,
    fetchImpl:async()=>new Response(JSON.stringify({count:0,offset:0,totalResults:0,hasMore:false,items:[]}),{status:200})
  });
  const other=compileUniversalConnectorContract(connectorById('oracle-netsuite'),{tenantId:'northstar-demo',connectionId:'another-connection'});
  assert.throws(
    ()=>mapNetSuiteWorkerPage({plan,execution,contract:other}),
    error=>error.code==='WFM_PROVIDER_READ_BINDING_MISMATCH'||error.code==='WFM_CONNECTOR_BINDING_MISMATCH'
  );
});

test('duplicate provider identities fail before canonical ingestion',async()=>{
  const ns=setup('oracle-netsuite','netsuite-sandbox',{
    sourceInstanceId:'acct-sandbox-1',
    endpointHost:'1234567.suitetalk.api.netsuite.com',
    authMethod:'oauth2',
    credentialRef:'secret://tenant/northstar/netsuite'
  });
  const plan=buildNetSuiteWorkerSuiteQLRead({...ns,limit:100,offset:0,nowMs:NOW});
  const execution=await executeProviderRead({
    plan,contract:ns.contract,credentialAuthorizer:auth,clock,
    fetchImpl:async()=>new Response(JSON.stringify({
      count:2,offset:0,totalResults:2,hasMore:false,
      items:[{id:'42',isinactive:'F'},{id:'42',isinactive:'F'}]
    }),{status:200})
  });
  assert.throws(()=>mapNetSuiteWorkerPage({plan,execution,contract:ns.contract}),/duplicate NetSuite employee id/);
});
