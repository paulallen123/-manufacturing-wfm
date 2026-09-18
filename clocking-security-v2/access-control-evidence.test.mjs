import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAccessDecision,planAccessConnection} from './access-control-evidence.mjs';

const T=Date.parse('2026-09-18T06:00:00Z');
const base={sourceId:'door-feed',employee:'e1',provider:'kisi',receivedAtMs:T+1000,identityBinding:'assigned_badge'};

test('granted credential event at configured entry becomes access_entry evidence',()=>{
  const r=normalizeAccessDecision({...base,event:{id:'evt-000001',decision:'granted',doorId:'north-gate',occurredAt:new Date(T).toISOString()},accessPoint:{id:'north-gate',direction:'entry',zoneId:'site'}});
  assert.equal(r.status,'evidence');
  assert.equal(r.event.kind,'access_entry');
  assert.equal(r.event.metadata.accessPointId,'north-gate');
  assert.equal(r.event.metadata.zoneId,'site');
});

test('configured exit becomes access_exit evidence',()=>{
  const r=normalizeAccessDecision({...base,event:{id:'evt-000002',granted:true,readerId:'gate-out',timestamp:new Date(T).toISOString()},accessPoint:{id:'gate-out',direction:'exit'}});
  assert.equal(r.status,'evidence');
  assert.equal(r.event.kind,'access_exit');
});

test('remote unlock or door status is never inferred as a person crossing',()=>{
  const r=normalizeAccessDecision({...base,event:{id:'evt-000003',type:'door_unlocked',doorId:'north-gate',timestamp:new Date(T).toISOString()},accessPoint:{id:'north-gate',direction:'entry'}});
  assert.equal(r.status,'ignored');
  assert.equal(r.reason,'NOT_A_GRANTED_PERSON_ACCESS_EVENT');
});

test('unknown direction fails to review rather than guessing IN or OUT',()=>{
  const r=normalizeAccessDecision({...base,event:{id:'evt-000004',decision:'granted',doorId:'shared-reader',timestamp:new Date(T).toISOString()},accessPoint:{id:'shared-reader',direction:'unknown'}});
  assert.equal(r.status,'review_required');
  assert.equal(r.reason,'UNKNOWN_ACCESS_DIRECTION');
});

test('weak/shared identity binding cannot become attendance evidence',()=>{
  const r=normalizeAccessDecision({...base,identityBinding:'shared_pin',event:{id:'evt-000005',decision:'granted',doorId:'north-gate'},accessPoint:{id:'north-gate',direction:'entry'}});
  assert.equal(r.status,'review_required');
  assert.equal(r.reason,'WEAK_ACCESS_IDENTITY_BINDING');
});

test('access denied is operational intelligence, not presence evidence',()=>{
  const r=normalizeAccessDecision({...base,event:{id:'evt-000006',decision:'denied',doorId:'restricted',occurredAt:new Date(T).toISOString()},accessPoint:{id:'restricted',direction:'entry'}});
  assert.equal(r.status,'operational_event');
  assert.equal(r.event.type,'access_denied');
});

test('attendance-ineligible doors are ignored even when access is granted',()=>{
  const r=normalizeAccessDecision({...base,event:{id:'evt-000007',decision:'granted',doorId:'canteen',occurredAt:new Date(T).toISOString()},accessPoint:{id:'canteen',direction:'entry',attendanceEligible:false}});
  assert.equal(r.status,'ignored');
  assert.equal(r.reason,'ACCESS_POINT_NOT_ATTENDANCE_ELIGIBLE');
});

test('connection planner chooses lowest-friction real-time lane',()=>{
  assert.equal(planAccessConnection({provider:'kisi'}).strategy,'cloud_webhook');
  assert.equal(planAccessConnection({provider:'gallagher',hasCloudGateway:true}).strategy,'cloud_gateway_live_events');
  assert.equal(planAccessConnection({provider:'genetec',webSdkReachable:false}).strategy,'edge_websdk_event_listener');
  assert.equal(planAccessConnection({provider:'unknown',onvifProfileA:true}).strategy,'edge_onvif_events');
});
