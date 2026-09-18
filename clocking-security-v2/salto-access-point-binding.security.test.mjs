import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSaltoNebulaEvent} from './access-push-adapters.mjs';

const T=Date.parse('2026-09-18T13:10:00Z');
const TYPE='com.saltosystems.nebula.event.v1.accesspointunlocked';
function event({accessPoint='installations/acme/access-points/d1',user='installations/acme/users/u1'}={}){
  return {
    name:'installations/acme/events/evt-security-binding',
    type:TYPE,
    occur_time:new Date(T).toISOString(),
    create_time:new Date(T+60_000).toISOString(),
    data:{
      user,
      access_point:accessPoint,
      credential_type:'salto.nebula.user.v1.CardKey',
      direction:'ENTRY',
    },
  };
}
function input(overrides={}){
  return {
    sourceId:'salto',
    employee:'e1',
    expectedProviderUserResource:'installations/acme/users/u1',
    accessPoint:{id:'d1',direction:'entry',attendanceEligible:true,zoneId:'site'},
    receivedAtMs:T+120_000,
    identityBinding:'assigned_badge',
    event:event(),
    ...overrides,
  };
}

test('SALTO event from a different access point cannot be relabelled as an attendance door',()=>{
  const r=normalizeSaltoNebulaEvent(input({event:event({accessPoint:'installations/acme/access-points/loading-bay'})}));
  assert.equal(r.status,'review_required');
  assert.equal(r.reason,'ACCESS_POINT_ID_MISMATCH');
});

test('SALTO event from another installation cannot reuse the same local access-point ID',()=>{
  const r=normalizeSaltoNebulaEvent(input({event:event({accessPoint:'installations/other-site/access-points/d1'})}));
  assert.equal(r.status,'review_required');
  assert.equal(r.reason,'ACCESS_POINT_INSTALLATION_MISMATCH');
});

test('configured full SALTO access-point resource must match exactly',()=>{
  const r=normalizeSaltoNebulaEvent(input({
    accessPoint:{id:'d1',providerResource:'installations/acme/access-points/d1',direction:'entry',attendanceEligible:true,zoneId:'site'},
    event:event({accessPoint:'installations/acme/access-points/d2'}),
  }));
  assert.equal(r.status,'review_required');
  assert.equal(r.reason,'ACCESS_POINT_RESOURCE_MISMATCH');
});

test('matching SALTO user, installation and access point still becomes attendance evidence',()=>{
  const r=normalizeSaltoNebulaEvent(input());
  assert.equal(r.status,'evidence');
  assert.equal(r.event.kind,'access_entry');
  assert.equal(r.event.metadata.accessPointId,'d1');
});
