import test from 'node:test';
import assert from 'node:assert/strict';
import {defineCanonicalMappingSpec,mapCanonicalRecord} from './connector-mapping-spec.mjs';

const receipt={
  providerId:'oracle-netsuite',tenantId:'northstar-demo',connectionId:'netsuite-sandbox',
  target:'worker',configurationFingerprint:'cfg',requestFingerprint:'req',responseSha256:'0'.repeat(64),
  httpStatus:200,observedAt:'2026-10-04T10:20:00.000Z',latencyMs:10,readOnly:true,checkpointAdvanceAllowed:false
};

test('NetSuite-style worker mapping is declarative and only copies reviewed fields',()=>{
  const spec=defineCanonicalMappingSpec({
    schemaVersion:1,id:'netsuite-worker-map-v1',providerId:'oracle-netsuite',
    sourceObjectType:'employee',canonicalType:'worker',
    fields:{
      externalId:{path:'id',kind:'id'},
      employeeNumber:{path:'entityid',kind:'string',optional:true},
      displayName:{concat:[{path:'firstname',kind:'string'},{path:'lastname',kind:'string'}],separator:' '},
      active:{map:{path:'isinactive',cases:[
        {values:['F',false,0,'0'],output:true},
        {values:['T',true,1,'1'],output:false}
      ]}}
    },
    attributes:{email:{path:'email',kind:'string',optional:true}}
  });
  const source={
    id:'42',entityid:'EMP42',firstname:'Ada',lastname:'Lovelace',email:'ada@example.test',
    isinactive:'F',salary:999999,password:'must-not-copy'
  };
  const mapped=mapCanonicalRecord({spec,providerId:'oracle-netsuite',sourceRecord:source,receipt});
  assert.equal(mapped.externalId,'42');
  assert.equal(mapped.employeeNumber,'EMP42');
  assert.equal(mapped.displayName,'Ada Lovelace');
  assert.equal(mapped.active,true);
  assert.equal(mapped.attributes.email,'ada@example.test');
  assert.equal(mapped.attributes.sourceSystem,'oracle-netsuite');
  assert.equal('salary' in mapped.attributes,false);
  assert.equal('password' in mapped.attributes,false);
  assert.match(mapped.attributes.mappingFingerprint,/^sha256:[a-f0-9]{64}$/);
});

test('mapping fingerprint is deterministic across object key order',()=>{
  const a=defineCanonicalMappingSpec({
    schemaVersion:1,id:'map',providerId:'workday',sourceObjectType:'worker',canonicalType:'worker',
    fields:{externalId:{path:'id',kind:'id'},displayName:{path:'name',kind:'string'}}
  });
  const b=defineCanonicalMappingSpec({
    canonicalType:'worker',sourceObjectType:'worker',providerId:'workday',id:'map',schemaVersion:1,
    fields:{displayName:{kind:'string',path:'name'},externalId:{kind:'id',path:'id'}}
  });
  assert.equal(a.mappingFingerprint,b.mappingFingerprint);
});

test('SAP-style production mapping creates existing VECTOR CanonicalEvent shape',()=>{
  const spec=defineCanonicalMappingSpec({
    schemaVersion:1,id:'sap-production-map-v1',providerId:'sap-s4hana',
    sourceObjectType:'A_ProductionOrder_2',canonicalType:'canonical-event',
    eventType:'production_demand_snapshot',
    fields:{
      sourceRecordId:{path:'ManufacturingOrder',kind:'id'},
      occurredAt:{path:'LastChangeDateTime',kind:'date'},
      siteExternalId:{path:'ProductionPlant',kind:'string',optional:true}
    },
    payload:{
      product:{path:'Product',kind:'string'},
      plannedQty:{path:'MfgOrderPlannedTotalQty',kind:'number'}
    }
  });
  const sapReceipt={...receipt,providerId:'sap-s4hana',target:'production-demand'};
  const mapped=mapCanonicalRecord({
    spec,providerId:'sap-s4hana',receipt:sapReceipt,
    sourceRecord:{
      ManufacturingOrder:'1000001',LastChangeDateTime:'2026-10-04T09:00:00Z',
      ProductionPlant:'PLANT-01',Product:'WIDGET-A',MfgOrderPlannedTotalQty:'500'
    }
  });
  assert.equal(mapped.eventType,'production_demand_snapshot');
  assert.equal(mapped.sourceSystem,'sap-s4hana');
  assert.equal(mapped.sourceRecordId,'1000001');
  assert.equal(mapped.siteExternalId,'PLANT-01');
  assert.equal(mapped.occurredAt,'2026-10-04T09:00:00.000Z');
  assert.equal(mapped.payload.product,'WIDGET-A');
  assert.equal(mapped.payload.plannedQty,500);
  assert.match(mapped.eventId,/^sap-s4hana:production_demand_snapshot:1000001:/);
});

test('credential-like source paths and output keys are rejected at definition time',()=>{
  assert.throws(()=>defineCanonicalMappingSpec({
    schemaVersion:1,id:'bad',providerId:'workday',sourceObjectType:'worker',canonicalType:'worker',
    fields:{externalId:{path:'credentials.access_token',kind:'id'}}
  }),/credential-like source field/);

  assert.throws(()=>defineCanonicalMappingSpec({
    schemaVersion:1,id:'bad2',providerId:'workday',sourceObjectType:'worker',canonicalType:'worker',
    fields:{externalId:{path:'id',kind:'id'}},
    attributes:{api_token:{path:'safeField',kind:'string'}}
  }),/unsafe/);
});

test('prototype traversal and unsupported canonical fields are rejected',()=>{
  assert.throws(()=>defineCanonicalMappingSpec({
    schemaVersion:1,id:'bad-proto',providerId:'workday',sourceObjectType:'worker',canonicalType:'worker',
    fields:{externalId:{path:'__proto__.id',kind:'id'}}
  }),/unsafe path segment/);

  assert.throws(()=>defineCanonicalMappingSpec({
    schemaVersion:1,id:'bad-field',providerId:'workday',sourceObjectType:'worker',canonicalType:'worker',
    fields:{externalId:{path:'id',kind:'id'},salary:{path:'salary',kind:'number'}}
  }),/unsupported canonical field/);
});

test('unreviewed map value fails closed instead of guessing',()=>{
  const spec=defineCanonicalMappingSpec({
    schemaVersion:1,id:'active-map',providerId:'oracle-netsuite',sourceObjectType:'employee',canonicalType:'worker',
    fields:{
      externalId:{path:'id',kind:'id'},
      active:{map:{path:'isinactive',cases:[
        {values:['F'],output:true},{values:['T'],output:false}
      ]}}
    }
  });
  assert.throws(()=>mapCanonicalRecord({
    spec,providerId:'oracle-netsuite',receipt,
    sourceRecord:{id:'42',isinactive:'UNKNOWN'}
  }),error=>error.code==='WFM_MAPPING_SOURCE_INVALID');
});

test('provider and read receipt binding are mandatory',()=>{
  const spec=defineCanonicalMappingSpec({
    schemaVersion:1,id:'binding',providerId:'oracle-netsuite',sourceObjectType:'employee',canonicalType:'worker',
    fields:{externalId:{path:'id',kind:'id'}}
  });
  assert.throws(()=>mapCanonicalRecord({
    spec,providerId:'workday',receipt:{...receipt,providerId:'workday'},sourceRecord:{id:'42'}
  }),error=>error.code==='WFM_MAPPING_BINDING_MISMATCH');

  assert.throws(()=>mapCanonicalRecord({
    spec,providerId:'oracle-netsuite',receipt:{...receipt,readOnly:false},sourceRecord:{id:'42'}
  }),error=>error.code==='WFM_MAPPING_RECEIPT_INVALID');
});

test('date number and identity transforms fail closed on malformed source data',()=>{
  const event=defineCanonicalMappingSpec({
    schemaVersion:1,id:'strict-event',providerId:'sap-s4hana',sourceObjectType:'order',canonicalType:'canonical-event',
    eventType:'production_demand_snapshot',
    fields:{sourceRecordId:{path:'id',kind:'id'},occurredAt:{path:'changed',kind:'date'}},
    payload:{qty:{path:'qty',kind:'number'}}
  });
  const sapReceipt={...receipt,providerId:'sap-s4hana'};
  assert.throws(()=>mapCanonicalRecord({
    spec:event,providerId:'sap-s4hana',receipt:sapReceipt,
    sourceRecord:{id:'bad/id',changed:'not-a-date',qty:'abc'}
  }));
});
