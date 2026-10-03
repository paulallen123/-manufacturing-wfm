import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';
import {compileUniversalConnectorContract} from './universal-connector-contract.mjs';
import {buildSafeConnectionTest} from './connection-test-plan.mjs';
import {
  acquireNetSuiteWorkers,
  acquireStaffologyWorkers,
  acquireSapS4ProductionDemand
} from './provider-acquisition.mjs';

const NOW=Date.parse('2026-10-03T22:20:00.000Z');
const clock=()=>NOW;
const auth=async()=>({authorization:'Bearer fixture-only'});

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
    latencyMs:20,
    observedAt:'2026-10-03T22:19:30.000Z',
    steps:connectionPlan.steps.map(step=>({id:step.id,status:'PASS'}))
  };
  return {contract,connectionPlan,connectionEvidence,credentialRef};
}
function nsContext(){
  return setup('oracle-netsuite','netsuite-sandbox',{
    sourceInstanceId:'acct-sandbox-1',
    endpointHost:'1234567-sb1.suitetalk.api.netsuite.com',
    authMethod:'oauth2',
    credentialRef:'secret://tenant/northstar/netsuite'
  });
}
function staffContext(){
  return setup('iris-staffology-payroll','staffology-sandbox',{
    sourceInstanceId:'Employer-123',
    endpointHost:'api.staffology.co.uk',
    authMethod:'api-key-basic',
    credentialRef:'secret://tenant/northstar/staffology'
  });
}
function sapContext(){
  return setup('sap-s4hana','sap-sandbox',{
    sourceInstanceId:'sap-s4-sandbox-1',
    endpointHost:'acme-api.s4hana.cloud.example',
    authMethod:'oauth2',
    credentialRef:'secret://tenant/northstar/sap',
    adapter:'odata'
  });
}
const nsEmployee=(id)=>({id:String(id),entityid:`EMP${id}`,firstname:'Ada',lastname:`Worker${id}`,email:`w${id}@example.test`,isinactive:'F'});
const staffEmployee=(id)=>({
  id,
  status:'Current',
  personalDetails:{firstName:'Ada',lastName:id,email:`${id}@example.test`},
  employmentDetails:{payrollCode:`PAY-${id}`,starterDetails:{startDate:'2026-01-01'},leaverDetails:{hasLeft:false},jobTitle:'Operator',department:{title:'Line 1'}}
});
const sapOrder=(id)=>({
  ManufacturingOrder:String(id),Product:'WIDGET-A',ProductionPlant:'PLANT-01',ManufacturingOrderType:'PP01',
  MfgOrderPlannedStartDate:'2026-10-04T06:00:00Z',MfgOrderPlannedEndDate:'2026-10-04T14:00:00Z',
  MfgOrderPlannedTotalQty:'500',ProductionUnit:'EA',LastChangeDateTime:'2026-10-03T22:15:00Z'
});

test('NetSuite only stages after every deterministic page reconciles',async()=>{
  const ctx=nsContext();
  const offsets=[];
  const result=await acquireNetSuiteWorkers({
    ...ctx,credentialAuthorizer:auth,runId:'ns-run-1',pageSize:2,maxPages:10,nowMs:NOW,clock,
    fetchImpl:async urlValue=>{
      const url=new URL(urlValue),offset=Number(url.searchParams.get('offset'));offsets.push(offset);
      if(offset===0) return new Response(JSON.stringify({count:2,offset:0,totalResults:3,hasMore:true,items:[nsEmployee(1),nsEmployee(2)]}),{status:200});
      if(offset===2) return new Response(JSON.stringify({count:1,offset:2,totalResults:3,hasMore:false,items:[nsEmployee(3)]}),{status:200});
      throw new Error('unexpected offset');
    }
  });
  assert.deepEqual(offsets,[0,2]);
  assert.equal(result.status,'SAFE_TO_STAGE');
  assert.equal(result.records.length,3);
  assert.equal(result.reconciliation.safeToCommit,true);
  assert.equal(result.reconciliation.safeToAdvanceWatermark,true);
  assert.ok(result.checkpointCandidate);
  assert.equal(result.deletionAuthority,false);
  assert.equal(result.customerProofClaimAllowed,false);
});

test('NetSuite changing total across pages is quarantined and cannot advance checkpoint',async()=>{
  const ctx=nsContext();
  const result=await acquireNetSuiteWorkers({
    ...ctx,credentialAuthorizer:auth,runId:'ns-run-drift',pageSize:2,maxPages:10,nowMs:NOW,clock,
    fetchImpl:async urlValue=>{
      const offset=Number(new URL(urlValue).searchParams.get('offset'));
      if(offset===0) return new Response(JSON.stringify({count:2,offset:0,totalResults:3,hasMore:true,items:[nsEmployee(1),nsEmployee(2)]}),{status:200});
      return new Response(JSON.stringify({count:2,offset:2,totalResults:4,hasMore:false,items:[nsEmployee(3),nsEmployee(4)]}),{status:200});
    }
  });
  assert.equal(result.status,'QUARANTINED');
  assert.ok(result.diagnostics.includes('netsuite-total-results-changed'));
  assert.equal(result.reconciliation.safeToCommit,false);
  assert.equal(result.checkpointCandidate,null);
});

test('NetSuite page bound cannot turn a partial sync green',async()=>{
  const ctx=nsContext();
  const result=await acquireNetSuiteWorkers({
    ...ctx,credentialAuthorizer:auth,runId:'ns-run-partial',pageSize:2,maxPages:1,nowMs:NOW,clock,
    fetchImpl:async()=>new Response(JSON.stringify({count:2,offset:0,totalResults:4,hasMore:true,items:[nsEmployee(1),nsEmployee(2)]}),{status:200})
  });
  assert.equal(result.status,'QUARANTINED');
  assert.ok(result.diagnostics.includes('max-page-bound-reached'));
  assert.ok(result.reconciliation.reasons.includes('incomplete-batch'));
  assert.equal(result.checkpointCandidate,null);
});

test('Staffology list pages and detail reads reconcile as one worker snapshot',async()=>{
  const ctx=staffContext();
  const requested=[];
  const result=await acquireStaffologyWorkers({
    ...ctx,credentialAuthorizer:auth,employerId:'Employer-123',runId:'staff-run-1',pageSize:2,maxPages:10,detailConcurrency:2,nowMs:NOW,clock,
    fetchImpl:async urlValue=>{
      const url=new URL(urlValue);requested.push(url.pathname+url.search);
      if(url.pathname==='/employers/Employer-123/employees'){
        const page=Number(url.searchParams.get('pageNum'));
        if(page===0) return new Response(JSON.stringify([
          {id:'EMP1',url:'https://api.staffology.co.uk/employers/Employer-123/employees/EMP1'},
          {id:'EMP2',url:'/employers/Employer-123/employees/EMP2'}
        ]),{status:200});
        if(page===1) return new Response(JSON.stringify([{id:'EMP3'}]),{status:200});
      }
      const id=url.pathname.split('/').at(-1);
      if(['EMP1','EMP2','EMP3'].includes(id)) return new Response(JSON.stringify(staffEmployee(id)),{status:200});
      throw new Error('unexpected Staffology URL');
    }
  });
  assert.equal(result.status,'SAFE_TO_STAGE');
  assert.equal(result.records.length,3);
  assert.equal(result.receiptCount,5);
  assert.equal(new Set(result.records.map(x=>x.externalId)).size,3);
  assert.ok(requested.includes('/employers/Employer-123/employees?pageNum=1&pageSize=2'));
  assert.ok(result.checkpointCandidate);
});

test('Staffology contradictory item URL is rejected before detail disclosure',async()=>{
  const ctx=staffContext();
  await assert.rejects(
    ()=>acquireStaffologyWorkers({
      ...ctx,credentialAuthorizer:auth,employerId:'Employer-123',runId:'staff-run-hostile',pageSize:2,nowMs:NOW,clock,
      fetchImpl:async urlValue=>{
        const url=new URL(urlValue);
        if(url.pathname==='/employers/Employer-123/employees') return new Response(JSON.stringify([{id:'EMP1',url:'https://attacker.example/employees/EMP1'}]),{status:200});
        throw new Error('detail must not execute');
      }
    }),
    error=>error.code==='WFM_STAFFOLOGY_LIST_IDENTITY_MISMATCH'
  );
});

test('SAP pagination never follows raw next links and stages only after terminal page',async()=>{
  const ctx=sapContext();
  const skips=[];
  const result=await acquireSapS4ProductionDemand({
    ...ctx,credentialAuthorizer:auth,runId:'sap-run-1',pageSize:2,maxPages:10,nowMs:NOW,clock,
    fetchImpl:async urlValue=>{
      const url=new URL(urlValue),skip=Number(url.searchParams.get('$skip'));skips.push(skip);
      assert.equal(url.host,'acme-api.s4hana.cloud.example');
      if(skip===0) return new Response(JSON.stringify({d:{results:[sapOrder(1001),sapOrder(1002)],__next:'https://attacker.example/do-not-follow'}}),{status:200});
      if(skip===2) return new Response(JSON.stringify({d:{results:[sapOrder(1003)]}}),{status:200});
      throw new Error('unexpected SAP skip');
    }
  });
  assert.deepEqual(skips,[0,2]);
  assert.equal(result.status,'SAFE_TO_STAGE');
  assert.equal(result.records.length,3);
  assert.equal(result.records[0].eventType,'production_demand_snapshot');
  assert.ok(result.checkpointCandidate);
});

test('cross-page duplicate SAP identity quarantines the acquisition',async()=>{
  const ctx=sapContext();
  const result=await acquireSapS4ProductionDemand({
    ...ctx,credentialAuthorizer:auth,runId:'sap-run-dup',pageSize:1,maxPages:5,nowMs:NOW,clock,
    fetchImpl:async urlValue=>{
      const skip=Number(new URL(urlValue).searchParams.get('$skip'));
      if(skip===0) return new Response(JSON.stringify({d:{results:[sapOrder(1001)],__next:'/next'}}),{status:200});
      return new Response(JSON.stringify({d:{results:[sapOrder(1001)]}}),{status:200});
    }
  });
  assert.equal(result.status,'QUARANTINED');
  assert.ok(result.reconciliation.reasons.includes('duplicate-row-keys'));
  assert.equal(result.checkpointCandidate,null);
});

test('schema type conflict across pages quarantines instead of silently learning it',async()=>{
  const ctx=sapContext();
  const first=sapOrder(1001),second=sapOrder(1002);
  first.CustomSignal='normal';
  second.CustomSignal={unexpected:'object'};
  const result=await acquireSapS4ProductionDemand({
    ...ctx,credentialAuthorizer:auth,runId:'sap-run-schema',pageSize:1,maxPages:5,nowMs:NOW,clock,
    fetchImpl:async urlValue=>{
      const skip=Number(new URL(urlValue).searchParams.get('$skip'));
      if(skip===0) return new Response(JSON.stringify({d:{results:[first],__next:'/next'}}),{status:200});
      return new Response(JSON.stringify({d:{results:[second]}}),{status:200});
    }
  });
  assert.equal(result.status,'QUARANTINED');
  assert.ok(result.reconciliation.reasons.includes('schema-unverified'));
  assert.equal(result.checkpointCandidate,null);
});

test('previous checkpoint from another source scope is rejected',async()=>{
  const ctx=nsContext();
  await assert.rejects(
    ()=>acquireNetSuiteWorkers({
      ...ctx,credentialAuthorizer:auth,runId:'ns-run-scope',pageSize:2,nowMs:NOW,clock,
      previousCheckpoint:{scopeNamespace:'scope:v1:not-this-connection',watermark:'sha256:old',watermarkKind:'opaque'},
      fetchImpl:async()=>new Response(JSON.stringify({count:1,offset:0,totalResults:1,hasMore:false,items:[nsEmployee(1)]}),{status:200})
    }),
    /scope mismatch/
  );
});
