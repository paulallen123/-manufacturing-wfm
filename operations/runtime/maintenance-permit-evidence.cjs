'use strict';

// Advisory record consistency only; no permit issuance, safety clearance or work authority.
const SHA=/^[0-9a-f]{64}$/;
function fail(code){throw new Error(code);}
function id(v){return typeof v==='string'&&v.length>0&&v.length<=160&&v.trim()===v&&!/[\u0000-\u001f\u007f]/.test(v);}
function time(v){
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v))fail('INVALID_TIME');
 const n=Date.parse(v);if(!Number.isFinite(n)||new Date(n).toISOString()!==v)fail('INVALID_TIME');return n;
}
function record(row,input,source){
 if(!row||typeof row!=='object'||Array.isArray(row)||row.source!==source||
  row.tenantId!==input.tenantId||row.siteId!==input.siteId||row.assetId!==input.assetId||row.workOrderId!==input.workOrderId)fail('SCOPE_MISMATCH');
 if(!id(row.recordId)||!id(row.revision)||typeof row.recordSha256!=='string'||!SHA.test(row.recordSha256))fail('INVALID_RECORD');
 const observed=time(row.observedAt);
 if(observed>input.asOfMs||input.asOfMs-observed>input.maxAgeMinutes*60000)fail('STALE_RECORD');
 return observed;
}
function interval(row){
 const from=time(row.validFrom),to=time(row.validTo);
 if(from>=to)fail('INVALID_INTERVAL');return {from,to};
}
function assessMaintenancePermitEvidence(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||!id(input.tenantId)||!id(input.siteId)||
  !id(input.assetId)||!id(input.workOrderId)||!Number.isSafeInteger(input.maxAgeMinutes)||
  input.maxAgeMinutes<1||input.maxAgeMinutes>1440)fail('INVALID_SCOPE');
 const asOfMs=time(input.asOf),context={...input,asOfMs},workOrder=input.workOrder;
 record(workOrder,context,'CMMS');
 if(workOrder.state!=='OPEN')fail('WORK_ORDER_NOT_OPEN');
 const start=time(workOrder.plannedStart),end=time(workOrder.plannedEnd);
 if(start>=end||asOfMs>=end)fail('INVALID_WORK_WINDOW');
 const blockers=[],permit=input.permit,isolation=input.isolation;
 if(!permit)blockers.push('PERMIT_MISSING');
 if(!isolation)blockers.push('ISOLATION_MISSING');
 let permitWindow,isolationWindow;
 if(permit){
  record(permit,context,'EHS');permitWindow=interval(permit);
  if(permit.recordSha256===workOrder.recordSha256)fail('SOURCE_RECORD_COLLISION');
  if(permit.workOrderRevision!==workOrder.revision||permit.workOrderRecordSha256!==workOrder.recordSha256)fail('PERMIT_WORK_ORDER_MISMATCH');
  if(permit.state!=='ACTIVE')blockers.push('PERMIT_NOT_ACTIVE');
  if(permitWindow.from>start||permitWindow.to<end)blockers.push('PERMIT_WINDOW_INCOMPLETE');
 }
 if(isolation){
  record(isolation,context,'EHS');isolationWindow=interval(isolation);
  if(isolation.recordSha256===workOrder.recordSha256)fail('SOURCE_RECORD_COLLISION');
  if(isolation.workOrderRevision!==workOrder.revision||isolation.workOrderRecordSha256!==workOrder.recordSha256)fail('ISOLATION_WORK_ORDER_MISMATCH');
  if(isolation.state!=='CONFIRMED')blockers.push('ISOLATION_NOT_CONFIRMED');
  if(isolationWindow.from>start||isolationWindow.to<end)blockers.push('ISOLATION_WINDOW_INCOMPLETE');
 }
 if(permit&&isolation){
  if(permit.recordSha256===isolation.recordSha256||
   permit.recordId===isolation.recordId&&permit.revision===isolation.revision||
   permit.isolationRecordSha256!==isolation.recordSha256)fail('PERMIT_ISOLATION_MISMATCH');
 }
 return Object.freeze({
  tenantId:input.tenantId,siteId:input.siteId,assetId:input.assetId,workOrderId:input.workOrderId,
  workOrderRevision:workOrder.revision,workOrderRecordSha256:workOrder.recordSha256,
  permitRecordSha256:permit?.recordSha256||null,isolationRecordSha256:isolation?.recordSha256||null,
  status:blockers.length?'BLOCKED':'DECLARED_EVIDENCE_FOR_REVIEW',blockers:Object.freeze(blockers),
  sourceAuthenticated:false,permitAuthority:false,safetyAuthority:false,executionAuthority:false,
  claimBoundary:'DECLARED_PERMIT_AND_ISOLATION_RECORDS_ONLY_NO_SAFETY_CLEARANCE'
 });
}
module.exports={assessMaintenancePermitEvidence};
