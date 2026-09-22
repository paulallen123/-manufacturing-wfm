import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNpsAccounting, normalizeMerakiConnectivity } from './wifi-evidence-adapters.mjs';

const R=Date.parse('2026-09-18T06:00:05Z');

test('NPS Accounting-Start becomes positive Wi-Fi evidence with source timestamp',()=>{
  const r=normalizeNpsAccounting({sourceId:'nps1',employee:'e1',identityBinding:'user_8021x',receivedAtMs:R,packet:{statusType:'Accounting-Start',acctSessionId:'s123',eventTimestamp:'2026-09-18T06:00:00Z',nasIdentifier:'ap-controller-1'}});
  assert.equal(r.status,'evidence');
  assert.equal(r.event.kind,'wifi_authenticated');
  assert.equal(r.event.observedAt,'2026-09-18T06:00:00.000Z');
  assert.equal(r.event.metadata.controllerId,'ap-controller-1');
});

test('NPS Accounting-Stop is weak negative evidence, never a departure anchor kind',()=>{
  const r=normalizeNpsAccounting({sourceId:'nps1',employee:'e1',identityBinding:'user_8021x',receivedAtMs:R,packet:{statusType:'Accounting-Stop',acctSessionId:'s123',eventTimestamp:'2026-09-18T14:00:00Z'}});
  assert.equal(r.status,'evidence');
  assert.equal(r.event.kind,'wifi_disconnected');
});

test('NPS Interim-Update refreshes presence evidence rather than creating clock semantics',()=>{
  const r=normalizeNpsAccounting({sourceId:'nps1',employee:'e1',identityBinding:'managed_device_certificate',receivedAtMs:R,packet:{statusType:'Interim-Update',acctSessionId:'s123'}});
  assert.equal(r.event.kind,'wifi_authenticated');
});

test('NPS NAS On/Off is ignored because it is infrastructure state',()=>{
  const r=normalizeNpsAccounting({sourceId:'nps1',employee:'e1',identityBinding:'user_8021x',receivedAtMs:R,packet:{statusType:'Accounting-Off'}});
  assert.deepEqual(r,{status:'ignored',reason:'NETWORK_DEVICE_STATE_NOT_EMPLOYEE_PRESENCE'});
});

test('shared/unknown Wi-Fi identity is held for review rather than treated as a person',()=>{
  const nps=normalizeNpsAccounting({sourceId:'nps1',employee:'e1',identityBinding:'shared_psk',receivedAtMs:R,packet:{statusType:'Accounting-Start'}});
  const meraki=normalizeMerakiConnectivity({sourceId:'m1',employee:'e1',identityBinding:'mac_only',clientId:'c1',receivedAtMs:R,event:{type:'assoc',occurredAt:'2026-09-18T06:00:00Z'}});
  assert.equal(nps.status,'review_required');
  assert.equal(meraki.status,'review_required');
});

test('Meraki successful auth becomes positive Wi-Fi evidence',()=>{
  const r=normalizeMerakiConnectivity({sourceId:'m1',employee:'e1',clientId:'client-1',identityBinding:'user_8021x',receivedAtMs:R,event:{type:'auth',subtype:'success',occurredAt:'2026-09-18T06:00:00Z',deviceSerial:'Q234-ABCD-5678',ssidNumber:1,band:'5'}});
  assert.equal(r.status,'evidence');
  assert.equal(r.event.kind,'wifi_authenticated');
  assert.equal(r.event.metadata.accessPointId,'Q234-ABCD-5678');
});

test('Meraki failed auth is never presence',()=>{
  const r=normalizeMerakiConnectivity({sourceId:'m1',employee:'e1',clientId:'client-1',identityBinding:'user_8021x',receivedAtMs:R,event:{type:'auth',subtype:'failure',occurredAt:'2026-09-18T06:00:00Z'}});
  assert.deepEqual(r,{status:'ignored',reason:'FAILED_AUTH_IS_NOT_PRESENCE'});
});

test('Meraki disassociation becomes weak negative evidence only',()=>{
  const r=normalizeMerakiConnectivity({sourceId:'m1',employee:'e1',clientId:'client-1',identityBinding:'managed_device_certificate',receivedAtMs:R,event:{type:'disassoc',occurredAt:'2026-09-18T14:00:00Z'}});
  assert.equal(r.status,'evidence');
  assert.equal(r.event.kind,'wifi_disconnected');
});

test('Meraki roam is ignored as a clock transition',()=>{
  const r=normalizeMerakiConnectivity({sourceId:'m1',employee:'e1',clientId:'client-1',identityBinding:'user_8021x',receivedAtMs:R,event:{type:'roam',occurredAt:'2026-09-18T06:30:00Z'}});
  assert.deepEqual(r,{status:'ignored',reason:'ROAM_IS_CONTINUOUS_PRESENCE'});
});

test('stable derived provider IDs deduplicate identical deliveries',()=>{
  const args={sourceId:'m1',employee:'e1',clientId:'client-1',identityBinding:'user_8021x',receivedAtMs:R,event:{type:'assoc',occurredAt:'2026-09-18T06:00:00Z',deviceSerial:'Q234-ABCD-5678',ssidNumber:1,band:'5'}};
  const a=normalizeMerakiConnectivity(args);
  const b=normalizeMerakiConnectivity(args);
  assert.equal(a.event.eventId,b.event.eventId);
  assert.match(a.event.eventId,/^meraki-[0-9a-f]{32}$/);
});
