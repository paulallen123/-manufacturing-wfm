import test from 'node:test';
import assert from 'node:assert/strict';
import {createAzureWorkflowDeliveryAuthority} from './azure-workflow-delivery-authority.mjs';

const sha=value=>`sha256:${value.repeat(64)}`;
const policy=(overrides={})=>({
 provider:'azure-logic-apps-power-automate',
 wfmTenantId:'tenant-uk',
 connectionId:'logic-1',
 azureTenantId:'11111111-1111-4111-8111-111111111111',
 subscriptionId:'22222222-2222-4222-8222-222222222222',
 resourceGroupName:'rg-vector-prod-uk',
 hostingModel:'standard',
 resourceName:'logic-vector-uk',
 workflowName:'FactoryWorkforceImport',
 region:'uksouth',
 managementOrigin:'https://management.azure.com',
 apiVersion:'2026-03-15',
 dataset:'manufacturing-workforce-events',
 principalFingerprint:sha('a'),
 workflowDefinitionFingerprint:sha('b'),
 connectionSetFingerprint:sha('c'),
 schemaFingerprint:sha('d'),
 mappingFingerprint:sha('e'),
 sourceScopeFingerprint:sha('f'),
 expectedCheckpointPredecessor:'cp:204',
 windowStart:'2026-09-27T09:00:00.000Z',
 windowEnd:'2026-09-27T10:00:00.000Z',
 expectedObservedAt:'2026-09-27T10:10:00.000Z',
 expectedClientTrackingId:'client-batch-204',
 approvedActionNames:['Read_Source','Map_To_Vector','Deliver_To_Vector'],
 deliveryActionName:'Deliver_To_Vector',
 maxPages:3,
 maxActions:8,
 maxRecords:10000,
 ...overrides
});

const runPath=runName=>`/subscriptions/22222222-2222-4222-8222-222222222222/resourceGroups/rg-vector-prod-uk/providers/Microsoft.Web/sites/logic-vector-uk/hostruntime/runtime/webhooks/workflow/api/management/workflows/FactoryWorkforceImport/runs/${runName}/actions`;
const action=(name,start,end,digest=sha('7'))=>({name,status:'Succeeded',startTime:start,endTime:end,trackingId:`track-${name}`,payloadDigest:digest});
const receipt=()=>{
 const runName='08586676746934337772206998657CU22';
 return {
  provider:'azure-logic-apps-power-automate',
  wfmTenantId:'tenant-uk',
  connectionId:'logic-1',
  azureTenantId:'11111111-1111-4111-8111-111111111111',
  subscriptionId:'22222222-2222-4222-8222-222222222222',
  resourceGroupName:'rg-vector-prod-uk',
  hostingModel:'standard',
  resourceName:'logic-vector-uk',
  workflowName:'FactoryWorkforceImport',
  region:'uksouth',
  managementOrigin:'https://management.azure.com',
  apiVersion:'2026-03-15',
  method:'GET',
  actionListPath:runPath(runName),
  principalFingerprint:sha('a'),
  workflowDefinitionFingerprint:sha('b'),
  connectionSetFingerprint:sha('c'),
  schemaFingerprint:sha('d'),
  mappingFingerprint:sha('e'),
  sourceScopeFingerprint:sha('f'),
  checkpointPredecessor:'cp:204',
  windowStart:'2026-09-27T09:00:00.000Z',
  windowEnd:'2026-09-27T10:00:00.000Z',
  observedAt:'2026-09-27T10:10:00.000Z',
  run:{name:runName,status:'Succeeded',startTime:'2026-09-27T10:00:05.000Z',endTime:'2026-09-27T10:02:00.000Z',clientTrackingId:'client-batch-204',workflowDefinitionFingerprint:sha('b')},
  pages:[
   {pageIndex:0,requestCursorFingerprint:null,nextCursorFingerprint:sha('1'),terminal:false,actions:[
    action('Read_Source','2026-09-27T10:00:06.000Z','2026-09-27T10:00:30.000Z',sha('5')),
    action('Map_To_Vector','2026-09-27T10:00:31.000Z','2026-09-27T10:01:00.000Z',sha('6'))
   ]},
   {pageIndex:1,requestCursorFingerprint:sha('1'),nextCursorFingerprint:null,terminal:true,actions:[
    action('Deliver_To_Vector','2026-09-27T10:01:01.000Z','2026-09-27T10:01:50.000Z',sha('7'))
   ]}
  ],
  deliveryReceipt:{dataset:'manufacturing-workforce-events',runName,actionName:'Deliver_To_Vector',successful:true,complete:true,recordCount:240,payloadDigest:sha('7'),schemaFingerprint:sha('d'),mappingFingerprint:sha('e'),sourceScopeFingerprint:sha('f'),windowStart:'2026-09-27T09:00:00.000Z',windowEnd:'2026-09-27T10:00:00.000Z',observedAt:'2026-09-27T10:03:00.000Z'}
 };
};

test('admits one exact succeeded workflow plus complete downstream delivery as reconciliation evidence only',()=>{
 const decision=createAzureWorkflowDeliveryAuthority(policy()).admit(receipt());
 assert.equal(decision.workflowDeliveryReconciliationCandidate,true);
 assert.equal(decision.runName,'08586676746934337772206998657CU22');
 assert.equal(decision.actionCount,3);
 assert.equal(decision.deliveryRecordCount,240);
 for(const key of ['checkpointAdvanceAllowed','deletionAuthority','workflowMutationAuthority','workflowResubmitAuthority','connectionMutationAuthority','operationalDecisionAuthority','causalClaimAuthority','writeBackAuthority','payrollAuthority','attendanceAuthority']) assert.equal(decision[key],false);
 assert.equal(Object.isFrozen(decision),true);
 assert.equal(Object.isFrozen(decision.delivery),true);
});

test('binds Azure tenant subscription resource workflow region route version and authority fingerprints',()=>{
 const authority=createAzureWorkflowDeliveryAuthority(policy());
 const mutations=[
  value=>value.azureTenantId='33333333-3333-4333-8333-333333333333',
  value=>value.subscriptionId='33333333-3333-4333-8333-333333333333',
  value=>value.resourceGroupName='rg-other',
  value=>value.resourceName='logic-other',
  value=>value.workflowName='OtherFlow',
  value=>value.region='westeurope',
  value=>value.managementOrigin='https://management.usgovcloudapi.net',
  value=>value.apiVersion='2019-05-01',
  value=>value.method='POST',
  value=>value.principalFingerprint=sha('0'),
  value=>value.workflowDefinitionFingerprint=sha('0'),
  value=>value.connectionSetFingerprint=sha('0'),
  value=>value.run.clientTrackingId='client-other-batch',
  value=>value.checkpointPredecessor='cp:203'
 ];
 for(const mutate of mutations){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/tenant|subscription|resource|workflow|region|origin|version|method|principal|definition|connection|tracking|predecessor/i);}
});

test('requires a complete gapless terminal action page chain',()=>{
 const authority=createAzureWorkflowDeliveryAuthority(policy());
 for(const mutate of [
  value=>value.pages[1].pageIndex=2,
  value=>value.pages[1].requestCursorFingerprint=sha('2'),
  value=>value.pages[0].terminal=true,
  value=>value.pages[0].nextCursorFingerprint=null,
  value=>value.pages[1].terminal=false,
  value=>value.pages[1].nextCursorFingerprint=sha('2'),
  value=>value.pages.push({...value.pages[1],pageIndex:2,requestCursorFingerprint:null})
 ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/page|cursor|terminal|limit/i);}
 const loop=receipt();
 const mapped=loop.pages[0].actions.pop();
 const delivered=loop.pages[1].actions[0];
 loop.pages[1]={pageIndex:1,requestCursorFingerprint:sha('1'),nextCursorFingerprint:sha('1'),terminal:false,actions:[mapped]};
 loop.pages.push({pageIndex:2,requestCursorFingerprint:sha('1'),nextCursorFingerprint:null,terminal:true,actions:[delivered]});
 assert.throws(()=>authority.admit(loop),/cursor|loop/i);
});

test('requires the exact approved action set with succeeded non-conflicting outcomes',()=>{
 const authority=createAzureWorkflowDeliveryAuthority(policy());
 const missing=receipt();missing.pages[0].actions.pop();assert.throws(()=>authority.admit(missing),/action|approved|missing/i);
 const unknown=receipt();unknown.pages[0].actions[0].name='Delete_Source';assert.throws(()=>authority.admit(unknown),/action|approved/i);
 for(const status of ['Failed','Faulted','TimedOut','Cancelled','Skipped','Running']){const value=receipt();value.pages[0].actions[0].status=status;assert.throws(()=>authority.admit(value),/status|succeeded/i);}
 const duplicate=receipt();duplicate.pages[1].actions.push({...duplicate.pages[0].actions[0]});assert.throws(()=>authority.admit(duplicate),/duplicate|action/i);
});

test('rejects failed incomplete or temporally impossible workflow runs',()=>{
 const authority=createAzureWorkflowDeliveryAuthority(policy());
 for(const mutate of [
  value=>value.run.status='Failed',
  value=>value.run.endTime='2026-09-27T09:59:59.000Z',
  value=>value.run.startTime='2026-09-27T10:02:01.000Z',
  value=>value.run.workflowDefinitionFingerprint=sha('0'),
  value=>value.pages[0].actions[0].startTime='2026-09-27T09:59:59.000Z',
  value=>value.pages[1].actions[0].endTime='2026-09-27T10:02:01.000Z'
 ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/run|status|time|definition|action/i);}
});

test('requires a later complete delivery receipt bound to the run action data and canonical scope',()=>{
 const authority=createAzureWorkflowDeliveryAuthority(policy());
 for(const mutate of [
  value=>value.deliveryReceipt.successful=false,
  value=>value.deliveryReceipt.complete=false,
  value=>value.deliveryReceipt.runName='other',
  value=>value.deliveryReceipt.actionName='Map_To_Vector',
  value=>value.deliveryReceipt.payloadDigest=sha('8'),
  value=>value.deliveryReceipt.schemaFingerprint=sha('0'),
  value=>value.deliveryReceipt.mappingFingerprint=sha('0'),
  value=>value.deliveryReceipt.sourceScopeFingerprint=sha('0'),
  value=>value.deliveryReceipt.windowEnd='2026-09-27T10:01:00.000Z',
  value=>value.deliveryReceipt.observedAt='2026-09-27T10:01:49.000Z'
 ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/delivery|complete|run|action|digest|schema|mapping|scope|window|later/i);}
});

test('supports Consumption and Standard only with their exact documented management routes',()=>{
 const standard=createAzureWorkflowDeliveryAuthority(policy()).admit(receipt());assert.equal(standard.hostingModel,'standard');
 const consumptionPolicy=policy({hostingModel:'consumption',resourceName:'logic-vector-consumption',workflowName:'logic-vector-consumption',apiVersion:'2019-05-01'});
 const consumptionReceipt=receipt();Object.assign(consumptionReceipt,{hostingModel:'consumption',resourceName:'logic-vector-consumption',workflowName:'logic-vector-consumption',apiVersion:'2019-05-01'});
 consumptionReceipt.actionListPath=`/subscriptions/${consumptionReceipt.subscriptionId}/resourceGroups/${consumptionReceipt.resourceGroupName}/providers/Microsoft.Logic/workflows/logic-vector-consumption/runs/${consumptionReceipt.run.name}/actions`;
 assert.equal(createAzureWorkflowDeliveryAuthority(consumptionPolicy).admit(consumptionReceipt).hostingModel,'consumption');
 assert.throws(()=>createAzureWorkflowDeliveryAuthority(policy({hostingModel:'hybrid'})),/hosting/i);
});

test('preserves documented Azure seven-digit fractional UTC timestamps without millisecond loss',()=>{
 const value=receipt();
 value.run.startTime='2026-09-27T10:00:05.0000001Z';
 value.pages[0].actions[0].startTime='2026-09-27T10:00:06.0000001Z';
 value.pages[0].actions[0].endTime='2026-09-27T10:00:30.0000001Z';
 value.pages[0].actions[1].startTime='2026-09-27T10:00:31.0000001Z';
 value.pages[0].actions[1].endTime='2026-09-27T10:01:00.0000001Z';
 value.pages[1].actions[0].startTime='2026-09-27T10:01:01.0000001Z';
 value.pages[1].actions[0].endTime='2026-09-27T10:01:50.0000001Z';
 value.run.endTime='2026-09-27T10:02:00.0000001Z';
 const decision=createAzureWorkflowDeliveryAuthority(policy()).admit(value);
 assert.equal(decision.runStart,'2026-09-27T10:00:05.0000001Z');
 assert.equal(decision.actions[0].startTime,'2026-09-27T10:00:06.0000001Z');
});

test('isolates evidence fingerprints by approved principal definition connection set and execution caps',()=>{
 const base=createAzureWorkflowDeliveryAuthority(policy()).admit(receipt()).evidenceFingerprint;
 for(const [policyPatch,receiptPatch] of [
  [{principalFingerprint:sha('0')},value=>value.principalFingerprint=sha('0')],
  [{workflowDefinitionFingerprint:sha('0')},value=>{value.workflowDefinitionFingerprint=sha('0');value.run.workflowDefinitionFingerprint=sha('0')}],
  [{connectionSetFingerprint:sha('0')},value=>value.connectionSetFingerprint=sha('0')],
  [{maxPages:4},()=>{}],
  [{maxActions:9},()=>{}],
  [{maxRecords:20000},()=>{}]
 ]){
  const value=receipt();receiptPatch(value);
  const isolated=createAzureWorkflowDeliveryAuthority(policy(policyPatch)).admit(value);
  assert.notEqual(isolated.evidenceFingerprint,base);
 }
});

test('rejects oversized sparse secret executable and hidden evidence and returns deterministic immutable output',()=>{
 const authority=createAzureWorkflowDeliveryAuthority(policy());
 const oversized=receipt();oversized.pages[0].actions.push(action('Extra','2026-09-27T10:01:00.000Z','2026-09-27T10:01:01.000Z'));assert.throws(()=>authority.admit(oversized),/action|approved/i);
 const sparse=receipt();sparse.pages.length=3;assert.throws(()=>authority.admit(sparse),/sparse|page/i);
 const secret=receipt();secret.deliveryReceipt.accessToken='nope';assert.throws(()=>authority.admit(secret),/secret|token|allowed/i);
 const executable=receipt();Object.defineProperty(executable.run,'status',{get(){return 'Succeeded'},enumerable:true});assert.throws(()=>authority.admit(executable),/hidden|executable|plain/i);
 const hidden=receipt();Object.defineProperty(hidden.pages[0],'hidden',{value:true});assert.throws(()=>authority.admit(hidden),/hidden|allowed/i);
 const first=authority.admit(receipt()),second=authority.admit(receipt());assert.equal(first.evidenceFingerprint,second.evidenceFingerprint);assert.deepEqual(first,second);
 assert.equal(Object.isFrozen(first.actions),true);assert.equal(Object.isFrozen(first.actions[0]),true);
});
