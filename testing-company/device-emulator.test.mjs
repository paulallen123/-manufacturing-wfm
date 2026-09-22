import test from 'node:test';
import assert from 'node:assert/strict';
import {emulateDevice,listDevices,runDeviceSuite} from './device-emulator.mjs';

test('device lab covers phone kiosk terminal access HMI Wi-Fi and privacy boundary',()=>{
  const ids=listDevices().devices.map(x=>x.id);
  for(const id of ['personal-mobile','shared-tablet-kiosk','wall-terminal','access-reader','workstation-hmi','wifi-radius','privacy-sensitive-biometric-terminal']) assert.ok(ids.includes(id));
});

test('mobile offline replay preserves occurrence and receipt timestamps separately',()=>{
  const r=emulateDevice({deviceId:'personal-mobile',fault:'offline-replay'});
  assert.equal(r.result.status,'recovered');
  assert.notEqual(r.emitted[0].occurredAt,r.emitted[0].receivedAt);
  assert.equal(r.result.payrollMutationPermitted,false);
});

test('shared kiosk session bleed is rejected',()=>{
  const r=emulateDevice({deviceId:'shared-tablet-kiosk',fault:'session-bleed'});
  assert.equal(r.result.status,'rejected');
  assert.equal(r.invariants.employeeBound,false);
});

test('terminal duplicate punch is idempotency test',()=>{
  const r=emulateDevice({deviceId:'wall-terminal',fault:'duplicate-punch'});
  assert.equal(r.result.duplicates,1);
  assert.equal(r.emitted[0].eventId,r.emitted[1].eventId);
});

test('access door-state-only event cannot become attendance',()=>{
  const r=emulateDevice({deviceId:'access-reader',fault:'door-state-only'});
  assert.equal(r.result.status,'ignored');
  assert.equal(r.result.vectorDisposition,'not_person_presence_evidence');
});

test('HMI logout cannot automatically clock worker out',()=>{
  const r=emulateDevice({deviceId:'workstation-hmi',action:'LOGOUT',fault:'logout-without-departure'});
  assert.equal(r.result.vectorDisposition,'must_not_generate_automatic_out');
  assert.equal(r.invariants.automaticOutFromNegativeSignal,false);
});

test('Wi-Fi signal loss cannot automatically stop pay',()=>{
  const r=emulateDevice({deviceId:'wifi-radius',fault:'signal-loss'});
  assert.equal(r.result.vectorDisposition,'must_not_generate_automatic_out');
});

test('raw biometric material is rejected by default',()=>{
  const r=emulateDevice({deviceId:'privacy-sensitive-biometric-terminal',fault:'raw-template-present'});
  assert.equal(r.result.status,'rejected');
});

test('all device suites retain zero silent payroll mutation invariant',()=>{
  for(const d of listDevices().devices){
    const suite=runDeviceSuite({deviceId:d.id});
    assert.equal(suite.pass,true,d.id);
  }
});
