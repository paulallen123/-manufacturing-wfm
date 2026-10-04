import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createIntegrationEntitlement,integrationCapacity,authorizeIntegrationActivation
} from './integration-entitlements.mjs';

const NOW=Date.parse('2026-10-04T17:50:00.000Z');
function certified(providerId='oracle-netsuite',overrides={}){
  return {
    state:'PROVIDER_READ_PROVEN',providerId,target:'worker',
    customerSelectable:true,readProven:true,writeProven:false,productionCertified:false,
    ...overrides
  };
}
function entitlement(overrides={}){
  return createIntegrationEntitlement({
    tenantId:'tenant-a',entitlementId:'integration-core',revision:1,
    baseConnections:3,connectionPacks:[],...overrides
  });
}
const active=(id,providerId='oracle-netsuite')=>({
  tenantId:'tenant-a',connectionId:id,providerId,state:'active'
});

test('base bundle limits active connections without limiting connector catalogue',()=>{
  const e=entitlement();
  const current=[active('c1'),active('c2','sap-s4hana'),active('c3','workday')];
  const result=authorizeIntegrationActivation({
    entitlement:e,certification:certified('ukg-pro-wfm'),activeConnections:current,
    requested:{tenantId:'tenant-a',connectionId:'c4',providerId:'ukg-pro-wfm'},nowMs:NOW
  });
  assert.equal(result.status,'CAPACITY_REACHED');
  assert.equal(result.allowed,false);
  assert.equal(result.capacity.totalConnections,3);
  assert.equal(result.readEnabled,false);
});

test('additional connection packs expand capacity independently of connector types',()=>{
  const e=entitlement({
    connectionPacks:[
      {packId:'integration-plus-5',connections:5,enabled:true},
      {packId:'future-pack',connections:10,startsAt:'2026-11-01T00:00:00.000Z'}
    ]
  });
  const capacity=integrationCapacity(e,{nowMs:NOW});
  assert.equal(capacity.baseConnections,3);
  assert.equal(capacity.additionalConnections,5);
  assert.equal(capacity.totalConnections,8);
  assert.deepEqual(capacity.activePackIds,['integration-plus-5']);

  const result=authorizeIntegrationActivation({
    entitlement:e,certification:certified('sap-s4hana'),
    activeConnections:[active('c1'),active('c2'),active('c3'),active('c4')],
    requested:{tenantId:'tenant-a',connectionId:'sap-prod',providerId:'sap-s4hana'},nowMs:NOW
  });
  assert.equal(result.status,'ACTIVATION_AUTHORISED');
  assert.equal(result.activeConnectionsAfter,5);
});

test('expired or disabled packs add no commercial capacity',()=>{
  const e=entitlement({
    baseConnections:1,
    connectionPacks:[
      {packId:'expired',connections:10,expiresAt:'2026-10-04T17:00:00.000Z'},
      {packId:'disabled',connections:10,enabled:false}
    ]
  });
  const capacity=integrationCapacity(e,{nowMs:NOW});
  assert.equal(capacity.totalConnections,1);
  assert.deepEqual(capacity.activePackIds,[]);
});

test('multiple environments of the same connector consume separate connection slots',()=>{
  const e=entitlement({baseConnections:2});
  const result=authorizeIntegrationActivation({
    entitlement:e,certification:certified('sap-s4hana'),
    activeConnections:[active('sap-production','sap-s4hana')],
    requested:{tenantId:'tenant-a',connectionId:'sap-sandbox',providerId:'sap-s4hana'},nowMs:NOW
  });
  assert.equal(result.status,'ACTIVATION_AUTHORISED');
  assert.equal(result.activeConnectionsAfter,2);
  assert.equal(result.consumesAdditionalSlot,true);
});

test('already-active connection is idempotent and does not consume another slot',()=>{
  const e=entitlement({baseConnections:1});
  const result=authorizeIntegrationActivation({
    entitlement:e,certification:certified('oracle-netsuite'),
    activeConnections:[active('netsuite-production')],
    requested:{tenantId:'tenant-a',connectionId:'netsuite-production',providerId:'oracle-netsuite'},nowMs:NOW
  });
  assert.equal(result.status,'ALREADY_ACTIVE');
  assert.equal(result.consumesAdditionalSlot,false);
  assert.equal(result.activeConnections,1);
});

test('commercial entitlement cannot make a merely CI-tested connector customer-selectable',()=>{
  const e=entitlement({baseConnections:100});
  assert.throws(()=>authorizeIntegrationActivation({
    entitlement:e,
    certification:certified('oracle-netsuite',{
      state:'CI_TESTED',customerSelectable:false,readProven:false
    }),
    activeConnections:[],
    requested:{tenantId:'tenant-a',connectionId:'netsuite-production',providerId:'oracle-netsuite'},nowMs:NOW
  }),error=>error.code==='WFM_INTEGRATION_CONNECTOR_NOT_CERTIFIED');
});

test('downgrade below current usage does not silently disconnect existing connections',()=>{
  const e=entitlement({baseConnections:1});
  const current=[active('c1'),active('c2','sap-s4hana')];

  const existing=authorizeIntegrationActivation({
    entitlement:e,certification:certified('oracle-netsuite'),activeConnections:current,
    requested:{tenantId:'tenant-a',connectionId:'c1',providerId:'oracle-netsuite'},nowMs:NOW
  });
  assert.equal(existing.status,'ALREADY_ACTIVE');
  assert.equal(existing.readEnabled,true);

  const next=authorizeIntegrationActivation({
    entitlement:e,certification:certified('workday'),activeConnections:current,
    requested:{tenantId:'tenant-a',connectionId:'c3',providerId:'workday'},nowMs:NOW
  });
  assert.equal(next.status,'OVER_CAPACITY_NO_NEW_CONNECTIONS');
  assert.equal(next.allowed,false);
});

test('tenant boundaries and connection-id provider conflicts fail closed',()=>{
  const e=entitlement();
  assert.throws(()=>authorizeIntegrationActivation({
    entitlement:e,certification:certified(),
    activeConnections:[{tenantId:'other',connectionId:'c1',providerId:'oracle-netsuite',state:'active'}],
    requested:{tenantId:'tenant-a',connectionId:'c2',providerId:'oracle-netsuite'},nowMs:NOW
  }),error=>error.code==='WFM_INTEGRATION_ENTITLEMENT_TENANT_MISMATCH');

  assert.throws(()=>authorizeIntegrationActivation({
    entitlement:e,certification:certified('sap-s4hana'),
    activeConnections:[active('shared-id','oracle-netsuite')],
    requested:{tenantId:'tenant-a',connectionId:'shared-id',providerId:'sap-s4hana'},nowMs:NOW
  }),error=>error.code==='WFM_INTEGRATION_CONNECTION_ID_CONFLICT');
});

test('duplicate active connection identities are rejected instead of undercounting usage',()=>{
  const e=entitlement();
  assert.throws(()=>authorizeIntegrationActivation({
    entitlement:e,certification:certified(),
    activeConnections:[active('c1'),active('c1')],
    requested:{tenantId:'tenant-a',connectionId:'c2',providerId:'oracle-netsuite'},nowMs:NOW
  }),/duplicate active connection/);
});

test('write authority comes from connector proof, never from buying more connections',()=>{
  const e=entitlement({baseConnections:100,connectionPacks:[{packId:'large-pack',connections:100}]});
  const readOnly=authorizeIntegrationActivation({
    entitlement:e,certification:certified('oracle-netsuite',{writeProven:false}),
    activeConnections:[],
    requested:{tenantId:'tenant-a',connectionId:'ns-read',providerId:'oracle-netsuite'},nowMs:NOW
  });
  assert.equal(readOnly.writeEnabled,false);

  const writeProven=authorizeIntegrationActivation({
    entitlement:e,certification:certified('oracle-netsuite',{
      state:'PROVIDER_WRITE_PROVEN',writeProven:true
    }),
    activeConnections:[],
    requested:{tenantId:'tenant-a',connectionId:'ns-write',providerId:'oracle-netsuite'},nowMs:NOW
  });
  assert.equal(writeProven.writeEnabled,true);
  assert.equal(writeProven.customerProofClaimAllowed,false);
});

test('invalid bundle construction fails closed',()=>{
  assert.throws(()=>createIntegrationEntitlement({
    tenantId:'tenant-a',entitlementId:'bad',revision:1,baseConnections:-1
  }));
  assert.throws(()=>createIntegrationEntitlement({
    tenantId:'tenant-a',entitlementId:'bad',revision:1,baseConnections:1,
    connectionPacks:[
      {packId:'same',connections:5},{packId:'same',connections:5}
    ]
  }),/duplicate connection pack/);
  assert.throws(()=>createIntegrationEntitlement({
    tenantId:'tenant-a',entitlementId:'bad',revision:1,baseConnections:1,
    connectionPacks:[{
      packId:'bad-dates',connections:5,
      startsAt:'2026-11-01T00:00:00.000Z',expiresAt:'2026-10-01T00:00:00.000Z'
    }]
  }),/start must precede expiry/);
});
