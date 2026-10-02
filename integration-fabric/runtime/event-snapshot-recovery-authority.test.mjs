import test from 'node:test';
import assert from 'node:assert/strict';
import {createEventSnapshotRecoveryAuthority} from './event-snapshot-recovery-authority.mjs';

const hashes={
  query:`sha256:${'a'.repeat(64)}`,
  eventSchema:`sha256:${'b'.repeat(64)}`,
  snapshotSchema:`sha256:${'c'.repeat(64)}`,
  payload:`sha256:${'d'.repeat(64)}`,
  changedPayload:`sha256:${'e'.repeat(64)}`
};

const policy=()=>({
  provider:'infor-wms',wfmTenantId:'wfm-tenant-uk',connectionId:'wms-connection-1',sourceTenantId:'infor-tenant-eu',
  apiOrigin:'https://mingle-eu.inforcloudsuite.com',apiVersion:'wms-rest-v1',facilityId:'FAC-UK',warehouseId:'WH-01',ownerId:'OWNER-A',
  resource:'inventory-balance',snapshotRoute:'/WMS/rest/inventory',eventTopic:'Sync.InventoryBalance',queryFingerprint:hashes.query,
  eventSchemaFingerprint:hashes.eventSchema,snapshotSchemaFingerprint:hashes.snapshotSchema,
  expectedCheckpointPredecessor:'checkpoint:42',windowStart:'2026-09-27T04:00:00.000Z',windowEnd:'2026-09-27T05:00:00.000Z',
  maxHints:1000,maxRecords:5000
});

const receipt=()=>({
  provider:'infor-wms',wfmTenantId:'wfm-tenant-uk',connectionId:'wms-connection-1',sourceTenantId:'infor-tenant-eu',
  apiOrigin:'https://mingle-eu.inforcloudsuite.com',apiVersion:'wms-rest-v1',facilityId:'FAC-UK',warehouseId:'WH-01',ownerId:'OWNER-A',
  resource:'inventory-balance',snapshotRoute:'/WMS/rest/inventory',eventTopic:'Sync.InventoryBalance',queryFingerprint:hashes.query,
  eventSchemaFingerprint:hashes.eventSchema,snapshotSchemaFingerprint:hashes.snapshotSchema,
  checkpointPredecessor:'checkpoint:42',coveredFrom:'2026-09-27T04:00:00.000Z',coveredTo:'2026-09-27T05:00:00.000Z',
  observedAt:'2026-09-27T05:00:00.000Z',eventGapDetected:true,failedEventIds:['evt-1'],recoveredEventIds:['evt-1'],
  snapshotSuccessful:true,snapshotComplete:true,terminalPage:true,
  hints:[{eventId:'evt-1',sourceId:'SKU-1\u0000LOT-1',sourceVersion:'7',payloadDigest:hashes.payload,occurredAt:'2026-09-27T04:30:00.000Z'}],
  records:[{sourceId:'SKU-1\u0000LOT-1',sourceVersion:'7',payloadDigest:hashes.payload}]
});

test('admits a fully scoped closed-window recovery snapshot as reconciliation evidence only',()=>{
  const decision=createEventSnapshotRecoveryAuthority(policy()).admit(receipt());
  assert.equal(decision.recoveryReconciliationCandidate,true);
  assert.equal(decision.recoveredFailureCount,1);
  assert.equal(decision.uniqueRecordVersionCount,1);
  assert.equal(decision.checkpointAdvanceAllowed,false);
  assert.equal(decision.deletionAuthority,false);
  assert.equal(decision.writeBackAuthority,false);
  assert.equal(decision.payrollAuthority,false);
  assert.equal(decision.attendanceAuthority,false);
});

test('rejects facility warehouse owner tenant and endpoint drift',()=>{
  const authority=createEventSnapshotRecoveryAuthority(policy());
  for(const mutate of [
    value=>{value.sourceTenantId='infor-tenant-us';},value=>{value.facilityId='FAC-DE';},value=>{value.warehouseId='WH-02';},
    value=>{value.ownerId='OWNER-B';},value=>{value.apiOrigin='https://mingle-us.inforcloudsuite.com';},value=>{value.apiVersion='wms-rest-v2';}
  ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/tenant|facility|warehouse|owner|origin|version/i);}
});

test('rejects mutation, widened, traversal, encoded and ambiguous snapshot routes',()=>{
  for(const route of [
    '/WMS/rest/*','/WMS/rest/../admin','/WMS/rest/%2e%2e/admin','/WMS//rest/inventory','/WMS\\rest\\inventory',
    '/WMS/rest/inventory?all=true','/WMS/rest/\u0000inventory','/WMS/rest/%3Finventory','/WMS/rest/%23inventory',
    '/WMS/rest/%2ainventory','/WMS/rest/inven tory','/WMS/rest/%zz'
  ]){
    assert.throws(()=>createEventSnapshotRecoveryAuthority({...policy(),snapshotRoute:route}),/route/i,route);
  }
});

test('rejects open, partial, failed, non-terminal or wrong-window snapshots',()=>{
  const authority=createEventSnapshotRecoveryAuthority(policy());
  for(const mutate of [
    value=>{value.snapshotSuccessful=false;},value=>{value.snapshotComplete=false;},value=>{value.terminalPage=false;},
    value=>{value.coveredFrom='2026-09-27T04:00:01.000Z';},value=>{value.coveredTo='2026-09-27T04:59:59.000Z';},
    value=>{value.observedAt='2026-09-27T04:59:59.000Z';},value=>{value.checkpointPredecessor='checkpoint:41';}
  ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/failed|complete|terminal|window|observation|predecessor/i);}
});

test('requires every failed hint to be declared recovered and present in the snapshot',()=>{
  const authority=createEventSnapshotRecoveryAuthority(policy());
  for(const mutate of [
    value=>{value.recoveredEventIds=[];},value=>{value.hints=[];},value=>{value.records=[];},
    value=>{value.records[0].sourceVersion='8';},value=>{value.records[0].payloadDigest=hashes.changedPayload;}
  ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/failed event|hint|snapshot|recovered/i);}
});

test('rejects duplicate failed or recovered event identities and conflicting event replays',()=>{
  const authority=createEventSnapshotRecoveryAuthority(policy());
  const duplicateFailed=receipt();duplicateFailed.failedEventIds.push('evt-1');
  assert.throws(()=>authority.admit(duplicateFailed),/duplicate/i);
  const duplicateRecovered=receipt();duplicateRecovered.recoveredEventIds.push('evt-1');
  assert.throws(()=>authority.admit(duplicateRecovered),/duplicate/i);
  const conflict=receipt();conflict.hints.push({...conflict.hints[0],payloadDigest:hashes.changedPayload});
  assert.throws(()=>authority.admit(conflict),/conflicting/i);
});

test('collapses exact hint and record replays while preserving opaque identifiers',()=>{
  const value=receipt();
  value.hints.push({...value.hints[0]});
  value.records.push({...value.records[0]},{sourceId:'SKU-1',sourceVersion:'LOT-1\u00007',payloadDigest:hashes.payload},{sourceId:'é',sourceVersion:'1',payloadDigest:hashes.payload},{sourceId:'e\u0301',sourceVersion:'1',payloadDigest:hashes.payload});
  const decision=createEventSnapshotRecoveryAuthority(policy()).admit(value);
  assert.equal(decision.exactHintReplayCount,1);
  assert.equal(decision.exactRecordReplayCount,1);
  assert.equal(decision.uniqueRecordVersionCount,4);
});

test('binds failed event identity and occurrence time into recovery evidence',()=>{
  const authority=createEventSnapshotRecoveryAuthority(policy());
  const first=authority.admit(receipt());
  const changedIdentity=receipt();
  changedIdentity.failedEventIds=['evt-2'];changedIdentity.recoveredEventIds=['evt-2'];changedIdentity.hints[0].eventId='evt-2';
  const changedTime=receipt();changedTime.hints[0].occurredAt='2026-09-27T04:31:00.000Z';
  assert.notEqual(first.reconciliationFingerprint,authority.admit(changedIdentity).reconciliationFingerprint);
  assert.notEqual(first.reconciliationFingerprint,authority.admit(changedTime).reconciliationFingerprint);
});

test('rejects future hints, impossible times, oversized receipts and sparse arrays',()=>{
  assert.throws(()=>createEventSnapshotRecoveryAuthority({...policy(),windowEnd:'2026-02-30T05:00:00.000Z'}),/real UTC instant/i);
  const authority=createEventSnapshotRecoveryAuthority(policy());
  for(const mutate of [
    value=>{value.hints[0].occurredAt='2026-09-27T05:00:00.001Z';},
    value=>{value.hints=Array.from({length:1001},(_,i)=>({...receipt().hints[0],eventId:`evt-${i}`}));},
    value=>{value.records=Array.from({length:5001},(_,i)=>({sourceId:`id-${i}`,sourceVersion:'1',payloadDigest:hashes.payload}));},
    value=>{value.hints=new Array(1);},value=>{value.records=new Array(1);}
  ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/window|limit|sparse|array/i);}
});

test('rejects schema, query, resource, topic and route drift',()=>{
  const authority=createEventSnapshotRecoveryAuthority(policy());
  for(const mutate of [
    value=>{value.queryFingerprint=`sha256:${'1'.repeat(64)}`;},value=>{value.eventSchemaFingerprint=`sha256:${'2'.repeat(64)}`;},
    value=>{value.snapshotSchemaFingerprint=`sha256:${'3'.repeat(64)}`;},value=>{value.resource='shipment';},
    value=>{value.eventTopic='Process.Shipment';},value=>{value.snapshotRoute='/WMS/rest/orders';}
  ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/query|schema|resource|topic|route/i);}
});

test('rejects secret, executable and hidden evidence and returns immutable decisions',()=>{
  assert.throws(()=>createEventSnapshotRecoveryAuthority({...policy(),clientSecret:'nope'}),/secret|not allowed/i);
  const accessor=receipt();Object.defineProperty(accessor,'token',{enumerable:true,get(){throw new Error('executed');}});
  assert.throws(()=>createEventSnapshotRecoveryAuthority(policy()).admit(accessor),/secret|credential/i);
  const hidden=receipt();Object.defineProperty(hidden.records[0],'extra',{enumerable:false,value:'hidden'});
  assert.throws(()=>createEventSnapshotRecoveryAuthority(policy()).admit(hidden),/hidden|allowed/i);
  const decision=createEventSnapshotRecoveryAuthority(policy()).admit(receipt());
  assert.equal(Object.isFrozen(decision),true);assert.equal(Object.isFrozen(decision.records),true);assert.equal(Object.isFrozen(decision.records[0]),true);
});
