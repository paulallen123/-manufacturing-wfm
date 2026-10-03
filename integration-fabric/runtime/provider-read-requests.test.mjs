import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';
import {compileUniversalConnectorContract} from './universal-connector-contract.mjs';
import {buildSafeConnectionTest} from './connection-test-plan.mjs';
import {
  buildStaffologyWorkerPageRead,
  buildStaffologyWorkerDetailRead,
  buildNetSuiteWorkerSuiteQLRead,
  buildSapS4ProductionOrderRead,
  assertProviderReadPlan
} from './provider-read-requests.mjs';

const NOW=Date.parse('2026-10-03T21:30:00.000Z');

function contractFor(providerId,connectionId){
  const connector=connectorById(providerId);
  assert.ok(connector,`missing connector ${providerId}`);
  return compileUniversalConnectorContract(connector,{tenantId:'northstar-demo',connectionId});
}

function connectionFor(contract,{sourceInstanceId,endpointHost,authMethod,credentialRef,adapter='http-json'}){
  const plan=buildSafeConnectionTest({
    providerKey:contract.provider.id,
    sourceInstanceId,
    wfmTenantId:contract.binding.tenantId,
    connectionId:contract.binding.connectionId,
    endpointHost,
    environment:'sandbox',
    adapter,
    authMethod,
    credentialRef,
    capabilities:['metadata','read'],
    requestedSemanticScopes:['vector.read']
  });
  const evidence={
    configurationFingerprint:plan.configurationFingerprint,
    providerKey:plan.configuration.providerKey,
    sourceInstanceId:plan.configuration.sourceInstanceId,
    wfmTenantId:plan.configuration.wfmTenantId,
    connectionId:plan.configuration.connectionId,
    endpointHost:plan.configuration.endpointHost,
    environment:plan.configuration.environment,
    readOnly:true,
    rawCredentialObserved:false,
    employeeOrPayrollDataObserved:false,
    latencyMs:45,
    observedAt:'2026-10-03T21:29:00.000Z',
    steps:plan.steps.map(step=>({id:step.id,status:'PASS'}))
  };
  return {plan,evidence};
}

test('Staffology worker read is exact-host bound and remains read-only',()=>{
  const contract=contractFor('iris-staffology-payroll','staffology-sandbox');
  const ref='secret://tenant/northstar/staffology';
  const {plan,evidence}=connectionFor(contract,{
    sourceInstanceId:'staffology-employer-demo',
    endpointHost:'api.staffology.co.uk',
    authMethod:'api-key-basic',
    credentialRef:ref
  });
  const read=buildStaffologyWorkerPageRead({
    contract,connectionPlan:plan,connectionEvidence:evidence,credentialRef:ref,
    employerId:'Employer-123',pageNum:2,pageSize:100,nowMs:NOW
  });
  assert.equal(assertProviderReadPlan(read,contract),true);
  const url=new URL(read.request.url);
  assert.equal(url.host,'api.staffology.co.uk');
  assert.equal(url.pathname,'/employers/Employer-123/employees');
  assert.equal(url.searchParams.get('pageNum'),'2');
  assert.equal(read.request.method,'GET');
  assert.equal(read.writeAuthority,false);
});

test('NetSuite SuiteQL worker read uses fixed query, required transient header and deterministic paging',()=>{
  const contract=contractFor('oracle-netsuite','netsuite-sandbox');
  const ref='secret://tenant/northstar/netsuite';
  const {plan,evidence}=connectionFor(contract,{
    sourceInstanceId:'acct-sandbox-1',
    endpointHost:'1234567-sb1.suitetalk.api.netsuite.com',
    authMethod:'oauth2',
    credentialRef:ref
  });
  const read=buildNetSuiteWorkerSuiteQLRead({
    contract,connectionPlan:plan,connectionEvidence:evidence,credentialRef:ref,
    limit:250,offset:500,query:'DROP TABLE employee',nowMs:NOW
  });
  assert.equal(assertProviderReadPlan(read,contract),true);
  assert.equal(read.request.method,'POST');
  assert.equal(read.request.readViaPostProven,true);
  assert.equal(read.request.headers.prefer,'transient');
  assert.equal(JSON.parse(read.request.body).q,'SELECT id, entityid, firstname, lastname, email, isinactive FROM employee ORDER BY id');
  const url=new URL(read.request.url);
  assert.equal(url.host,'1234567-sb1.suitetalk.api.netsuite.com');
  assert.equal(url.searchParams.get('limit'),'250');
  assert.equal(url.searchParams.get('offset'),'500');
  assert.equal(read.pagination.uniqueOrder,'id');
});

test('SAP S/4 production-order read is bound to the exact connection-proven host',()=>{
  const contract=contractFor('sap-s4hana','sap-sandbox');
  const ref='secret://tenant/northstar/sap';
  const {plan,evidence}=connectionFor(contract,{
    sourceInstanceId:'sap-s4-sandbox-1',
    endpointHost:'acme-api.s4hana.cloud.example',
    authMethod:'oauth2',
    credentialRef:ref,
    adapter:'odata'
  });
  const read=buildSapS4ProductionOrderRead({
    contract,connectionPlan:plan,connectionEvidence:evidence,credentialRef:ref,
    top:200,skip:400,nowMs:NOW
  });
  assert.equal(assertProviderReadPlan(read,contract),true);
  const url=new URL(read.request.url);
  assert.equal(url.host,'acme-api.s4hana.cloud.example');
  assert.equal(url.pathname,'/sap/opu/odata/sap/API_PRODUCTION_ORDER_2_SRV/A_ProductionOrder_2');
  assert.equal(url.searchParams.get('$top'),'200');
  assert.equal(url.searchParams.get('$skip'),'400');
  assert.equal(url.searchParams.get('$orderby'),'ManufacturingOrder');
  assert.equal(read.target,'production-demand');
});

test('provider read cannot reuse another tenant connection endpoint credential or stale proof',()=>{
  const contract=contractFor('oracle-netsuite','netsuite-sandbox');
  const ref='secret://tenant/northstar/netsuite';
  const {plan,evidence}=connectionFor(contract,{
    sourceInstanceId:'acct-sandbox-1',
    endpointHost:'1234567-sb1.suitetalk.api.netsuite.com',
    authMethod:'oauth2',
    credentialRef:ref
  });

  assert.throws(()=>buildNetSuiteWorkerSuiteQLRead({
    contract,connectionPlan:plan,
    connectionEvidence:{...evidence,wfmTenantId:'other-tenant'},
    credentialRef:ref,nowMs:NOW
  }),error=>error.code==='WFM_PROVIDER_CONNECTION_NOT_VERIFIED');

  assert.throws(()=>buildNetSuiteWorkerSuiteQLRead({
    contract,connectionPlan:plan,connectionEvidence:evidence,
    credentialRef:'secret://tenant/northstar/other-secret',nowMs:NOW
  }),error=>error.code==='WFM_PROVIDER_CONNECTION_BINDING_MISMATCH');

  assert.throws(()=>buildNetSuiteWorkerSuiteQLRead({
    contract,connectionPlan:plan,
    connectionEvidence:{...evidence,observedAt:'2026-10-03T20:00:00.000Z'},
    credentialRef:ref,nowMs:NOW
  }),error=>error.code==='WFM_PROVIDER_CONNECTION_NOT_VERIFIED');

  const wrongHostPlan=structuredClone(plan);
  wrongHostPlan.configuration.endpointHost='attacker.example';
  assert.throws(()=>buildNetSuiteWorkerSuiteQLRead({
    contract,connectionPlan:wrongHostPlan,connectionEvidence:evidence,
    credentialRef:ref,nowMs:NOW
  }));
});

test('NetSuite host and pagination are constrained before any request can be formed',()=>{
  const contract=contractFor('oracle-netsuite','netsuite-sandbox');
  const ref='secret://tenant/northstar/netsuite';
  const {plan,evidence}=connectionFor(contract,{
    sourceInstanceId:'acct-sandbox-1',
    endpointHost:'attacker.example',
    authMethod:'oauth2',
    credentialRef:ref
  });
  assert.throws(()=>buildNetSuiteWorkerSuiteQLRead({
    contract,connectionPlan:plan,connectionEvidence:evidence,credentialRef:ref,nowMs:NOW
  }),/NetSuite SuiteTalk account host/);

  const safe=connectionFor(contract,{
    sourceInstanceId:'acct-sandbox-1',
    endpointHost:'1234567.suitetalk.api.netsuite.com',
    authMethod:'oauth2',
    credentialRef:ref
  });
  assert.throws(()=>buildNetSuiteWorkerSuiteQLRead({
    contract,connectionPlan:safe.plan,connectionEvidence:safe.evidence,credentialRef:ref,
    limit:250,offset:1,nowMs:NOW
  }),/divisible/);
});


test('Staffology detail read stays on exact employer and employee identity',()=>{
  const contract=contractFor('iris-staffology-payroll','staffology-sandbox');
  const ref='secret://tenant/northstar/staffology';
  const {plan,evidence}=connectionFor(contract,{
    sourceInstanceId:'staffology-employer-demo',
    endpointHost:'api.staffology.co.uk',
    authMethod:'api-key-basic',
    credentialRef:ref
  });
  const read=buildStaffologyWorkerDetailRead({
    contract,connectionPlan:plan,connectionEvidence:evidence,credentialRef:ref,
    employerId:'Employer-123',employeeId:'Employee-42',nowMs:NOW
  });
  assert.equal(assertProviderReadPlan(read,contract),true);
  const url=new URL(read.request.url);
  assert.equal(url.host,'api.staffology.co.uk');
  assert.equal(url.pathname,'/employers/Employer-123/employees/Employee-42');
  assert.equal(url.search,'');
  assert.equal(read.mappingProfile,'staffology-worker-detail-v1');
  assert.equal(read.pagination,null);
});
