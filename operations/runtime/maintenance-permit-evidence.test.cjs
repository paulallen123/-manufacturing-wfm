'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assessMaintenancePermitEvidence } = require('./maintenance-permit-evidence.cjs');
const A='a'.repeat(64), B='b'.repeat(64), C='c'.repeat(64);
function fixture(){
 const scope={tenantId:'synthetic',siteId:'site-1',assetId:'asset-1',workOrderId:'wo-1'};
 return {...scope,asOf:'2026-10-29T09:50:00.000Z',maxAgeMinutes:60,
  workOrder:{...scope,source:'CMMS',recordId:'wo-record',revision:'r1',recordSha256:A,observedAt:'2026-10-29T09:45:00.000Z',state:'OPEN',plannedStart:'2026-10-29T10:00:00.000Z',plannedEnd:'2026-10-29T11:00:00.000Z'},
  permit:{...scope,source:'EHS',recordId:'permit-record',revision:'p1',recordSha256:B,observedAt:'2026-10-29T09:40:00.000Z',state:'ACTIVE',workOrderRevision:'r1',workOrderRecordSha256:A,isolationRecordSha256:C,validFrom:'2026-10-29T09:30:00.000Z',validTo:'2026-10-29T12:00:00.000Z'},
  isolation:{...scope,source:'EHS',recordId:'isolation-record',revision:'i1',recordSha256:C,observedAt:'2026-10-29T09:42:00.000Z',state:'CONFIRMED',workOrderRevision:'r1',workOrderRecordSha256:A,validFrom:'2026-10-29T09:30:00.000Z',validTo:'2026-10-29T12:00:00.000Z'}};
}
test('reports only declared permit/isolation evidence for review, without execution authority',()=>{
 const x=assessMaintenancePermitEvidence(fixture());
 assert.equal(x.status,'DECLARED_EVIDENCE_FOR_REVIEW');
 assert.deepEqual(x.blockers,[]);
 assert.equal(x.sourceAuthenticated,false);
 assert.equal(x.safetyAuthority,false);
 assert.equal(x.executionAuthority,false);
 assert.equal(x.permitRecordSha256,B);
});
test('missing, withdrawn and incomplete safety records block review',()=>{
 for(const mutate of [
  x=>{delete x.permit;},x=>{delete x.isolation;},x=>{x.permit.state='REVOKED';},
  x=>{x.isolation.state='WITHDRAWN';},x=>{x.permit.validTo='2026-10-29T10:59:00.000Z';},
  x=>{x.isolation.validFrom='2026-10-29T10:01:00.000Z';}
 ]){const x=fixture();mutate(x);const result=assessMaintenancePermitEvidence(x);assert.equal(result.status,'BLOCKED');assert.ok(result.blockers.length);}
});
test('foreign, stale and contradictory safety evidence fails closed',()=>{
 for(const mutate of [
  x=>{x.permit.tenantId='foreign';},x=>{x.isolation.assetId='foreign';},
  x=>{x.permit.workOrderRevision='r2';},x=>{x.isolation.workOrderRecordSha256=B;},
  x=>{x.permit.isolationRecordSha256=B;},x=>{x.permit.recordSha256=C;},
  x=>{x.permit.recordSha256=A;},x=>{x.isolation.recordSha256=A;x.permit.isolationRecordSha256=A;},
  x=>{x.permit.observedAt='2026-10-29T08:49:59.000Z';},
  x=>{x.isolation.observedAt='2026-10-29T09:51:00.000Z';},
  x=>{x.workOrder.state='CLOSED';},x=>{x.workOrder.plannedEnd='2026-10-29T09:59:00.000Z';},
  x=>{x.permit.validTo='2026-10-29T10:31:00.000Z';x.permit.validFrom='2026-10-29T10:32:00.000Z';}
 ]){const x=fixture();mutate(x);assert.throws(()=>assessMaintenancePermitEvidence(x));}
});
