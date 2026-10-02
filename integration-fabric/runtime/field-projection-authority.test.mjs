import test from 'node:test';
import assert from 'node:assert/strict';
import {createFieldProjectionAuthority} from './field-projection-authority.mjs';

const policy=(overrides={})=>({
  provider:'bamboohr',
  wfmTenantId:'tenant-uk-1',
  connectionId:'connection-bamboo-1',
  sourceAccountId:'bamboo-company-acme',
  apiOrigin:'https://acme.bamboohr.com',
  apiVersion:'v1',
  resource:'employees-core',
  routePath:'/api/v1/reports/custom',
  method:'POST',
  readOperation:'ad-hoc-custom-report',
  schemaFingerprint:'sha256:bamboo-fields-v1',
  projectionFingerprint:'sha256:bamboo-core-workforce-v1',
  identityField:'employeeId',
  allowedFields:['employeeId','firstName','lastName','department','division','jobTitle','location','hireDate','status'],
  requiredFields:['employeeId','department','jobTitle','location','status'],
  deniedSensitiveFields:['ssn','sin','nationalId','nin','bankAccountNumber','birthDate','medicalNotes'],
  maxFields:12,
  maxRecords:1000,
  ...overrides
});

const request=(overrides={})=>({
  provider:'bamboohr',
  wfmTenantId:'tenant-uk-1',
  connectionId:'connection-bamboo-1',
  sourceAccountId:'bamboo-company-acme',
  apiOrigin:'https://acme.bamboohr.com',
  apiVersion:'v1',
  resource:'employees-core',
  routePath:'/api/v1/reports/custom',
  method:'POST',
  readOperation:'ad-hoc-custom-report',
  schemaFingerprint:'sha256:bamboo-fields-v1',
  projectionFingerprint:'sha256:bamboo-core-workforce-v1',
  fields:['employeeId','department','jobTitle','location','status'],
  ...overrides
});

const row=(overrides={})=>({
  sourceId:'employee-100',
  sourceVersion:'2026-09-27T00:05:00.000Z',
  payloadDigest:'sha256:employee-100-v1',
  restrictedFields:[],
  values:{employeeId:'employee-100',department:'Assembly',jobTitle:'Welder',location:'Leeds',status:'Active'},
  ...overrides
});

const batch=(overrides={})=>({
  ...request(),
  requestedFields:['employeeId','department','jobTitle','location','status'],
  returnedFields:['employeeId','department','jobTitle','location','status'],
  observedAt:'2026-09-27T00:10:00Z',
  complete:true,
  paginationComplete:true,
  rows:[row()],
  ...overrides
});

test('authorizes an exact POST report as read intent without granting mutation authority',()=>{
  const plan=createFieldProjectionAuthority(policy()).authorizeRead(request());
  assert.equal(plan.method,'POST');
  assert.equal(plan.readIntent,true);
  assert.equal(plan.mutationAuthority,false);
  assert.equal(plan.writeBackAuthority,false);
  assert.deepEqual(plan.fields,['department','employeeId','jobTitle','location','status']);
  assert.match(plan.requestFingerprint,/^sha256:[a-f0-9]{64}$/);
});

test('rejects tenant, account, origin, route, method, version, resource and schema drift',()=>{
  for(const [field,value] of [
    ['wfmTenantId','tenant-other'],['sourceAccountId','other-company'],
    ['apiOrigin','https://other.bamboohr.com'],['routePath','/api/v1/employees/100'],
    ['method','PATCH'],['apiVersion','v2'],['resource','payroll'],
    ['schemaFingerprint','sha256:changed'],['projectionFingerprint','sha256:changed-projection']
  ]) assert.throws(
    ()=>createFieldProjectionAuthority(policy()).authorizeRead(request({[field]:value})),
    /approved authority/
  );
});

test('rejects insecure, wildcard, credential-bearing and non-origin API endpoints',()=>{
  for(const apiOrigin of [
    'http://acme.bamboohr.com','https://*.bamboohr.com',
    'https://key:secret@acme.bamboohr.com','https://acme.bamboohr.com/api/v1'
  ]) assert.throws(()=>createFieldProjectionAuthority(policy({apiOrigin})),/exact HTTPS origin/);
});

test('rejects field widening and sensitive fields even when the source account might permit them',()=>{
  assert.throws(
    ()=>createFieldProjectionAuthority(policy()).authorizeRead(request({fields:['employeeId','department','payRate']})),
    /not allowlisted/
  );
  assert.throws(
    ()=>createFieldProjectionAuthority(policy({allowedFields:[...policy().allowedFields,'nationalId']})),
    /sensitive field/i
  );
});

test('normalises Unicode field identifiers and rejects ambiguous duplicates',()=>{
  const authority=createFieldProjectionAuthority(policy({
    allowedFields:['employeeId','custom_Caf\u00e9'],requiredFields:['employeeId','custom_Caf\u00e9']
  }));
  const plan=authority.authorizeRead(request({fields:['employeeId','custom_Cafe\u0301']}));
  assert.deepEqual(plan.fields,['custom_Caf\u00e9','employeeId']);
  assert.throws(
    ()=>createFieldProjectionAuthority(policy({
      allowedFields:['employeeId','custom_Caf\u00e9','custom_Cafe\u0301']
    })),
    /duplicate field/i
  );
});

test('preserves Unicode-normalised custom-field values and rejects normalisation collisions',()=>{
  const customPolicy=policy({
    allowedFields:['employeeId','custom_Caf\u00e9'],requiredFields:['employeeId','custom_Caf\u00e9']
  });
  const customBatch={
    ...batch(),
    fields:['employeeId','custom_Caf\u00e9'],
    requestedFields:['employeeId','custom_Caf\u00e9'],
    returnedFields:['employeeId','custom_Caf\u00e9'],
    rows:[row({
      values:{employeeId:'employee-100',custom_Cafe\u0301:'trained'}
    })]
  };
  const decision=createFieldProjectionAuthority(customPolicy).admitBatch(customBatch);
  assert.equal(decision.records[0].values.custom_Caf\u00e9,'trained');
  assert.throws(()=>createFieldProjectionAuthority(customPolicy).admitBatch({
    ...customBatch,
    rows:[row({values:{employeeId:'employee-100',custom_Caf\u00e9:'trained',custom_Cafe\u0301:'other'}})]
  }),/normalisation collision/i);
});

test('quarantines missing, extra or drifted response fields instead of silently accepting schema changes',()=>{
  const authority=createFieldProjectionAuthority(policy());
  assert.throws(()=>authority.admitBatch(batch({returnedFields:['employeeId','department','jobTitle','status']})),/returned field set/i);
  assert.throws(()=>authority.admitBatch(batch({returnedFields:[...batch().returnedFields,'custom_newField']})),/returned field set/i);
  assert.throws(()=>authority.admitBatch(batch({schemaFingerprint:'sha256:new-schema'})),/approved authority/);
});

test('preserves restricted-field evidence and refuses absence or deletion authority',()=>{
  const restricted=row({
    restrictedFields:['department'],
    values:{employeeId:'employee-100',department:null,jobTitle:'Welder',location:'Leeds',status:'Active'}
  });
  const decision=createFieldProjectionAuthority(policy()).admitBatch(batch({rows:[restricted]}));
  assert.equal(decision.fieldComplete,false);
  assert.deepEqual(decision.restrictedFields,['department']);
  assert.equal(decision.absenceAuthority,false);
  assert.equal(decision.deletionAuthority,false);
  assert.equal(decision.checkpointAdvanceAllowed,false);
});

test('rejects a restricted or missing stable employee identity',()=>{
  const authority=createFieldProjectionAuthority(policy());
  assert.throws(()=>authority.admitBatch(batch({rows:[row({restrictedFields:['employeeId']})]})),/identity field.*restricted/i);
  assert.throws(()=>authority.admitBatch(batch({rows:[row({sourceId:'employee-100',values:{department:'Assembly',jobTitle:'Welder',location:'Leeds',status:'Active'}})]})),/identity field.*missing/i);
  assert.throws(()=>authority.admitBatch(batch({rows:[row({sourceId:'employee-100',values:{employeeId:'employee-101',department:'Assembly',jobTitle:'Welder',location:'Leeds',status:'Active'}})]})),/identity.*sourceId/i);
});

test('collapses exact replays but quarantines conflicting source versions',()=>{
  const first=row();
  const exact={...row(),values:{...row().values}};
  const decision=createFieldProjectionAuthority(policy()).admitBatch(batch({rows:[first,exact]}));
  assert.equal(decision.uniqueRecordCount,1);
  assert.equal(decision.exactReplayCount,1);
  assert.throws(
    ()=>createFieldProjectionAuthority(policy()).admitBatch(batch({rows:[first,row({payloadDigest:'sha256:conflict'})]})),
    /conflicting duplicate/i
  );
});

test('keeps the immutable company employee ID as identity rather than editable employee number',()=>{
  const widenedPolicy=policy({allowedFields:[...policy().allowedFields,'employeeNumber']});
  const decision=createFieldProjectionAuthority(widenedPolicy).admitBatch(batch({
    requestedFields:[...batch().requestedFields,'employeeNumber'],
    returnedFields:[...batch().returnedFields,'employeeNumber'],
    fields:[...batch().fields,'employeeNumber'],
    rows:[row({values:{...row().values,employeeNumber:'E-0099'}})]
  }));
  assert.equal(decision.identityField,'employeeId');
  assert.equal(decision.records[0].sourceId,'employee-100');
});

test('requires a complete bounded result and never turns row absence into authority',()=>{
  const authority=createFieldProjectionAuthority(policy());
  assert.throws(()=>authority.admitBatch(batch({complete:false})),/incomplete/i);
  assert.throws(()=>authority.admitBatch(batch({paginationComplete:false})),/pagination.*incomplete/i);
  assert.throws(()=>createFieldProjectionAuthority(policy({maxRecords:1})).admitBatch(batch({rows:[row(),row({sourceId:'employee-200',payloadDigest:'sha256:200',values:{...row().values,employeeId:'employee-200'}})]})),/record limit/i);
  const empty=authority.admitBatch(batch({rows:[]}));
  assert.equal(empty.absenceAuthority,false);
  assert.equal(empty.deletionAuthority,false);
});

test('classifies 429 throttling separately from 503 outage and never refreshes auth for either',()=>{
  const authority=createFieldProjectionAuthority(policy());
  assert.deepEqual(authority.classifyFailure({status:429,retryAfterSeconds:7}),{
    kind:'rate-limit',retry:true,retryAfterSeconds:7,refreshAuthentication:false,broadenRoute:false
  });
  assert.deepEqual(authority.classifyFailure({status:503}),{
    kind:'provider-unavailable',retry:true,retryAfterSeconds:null,refreshAuthentication:false,broadenRoute:false
  });
  assert.deepEqual(authority.classifyFailure({status:403}),{
    kind:'permission-or-key-block',retry:false,retryAfterSeconds:null,refreshAuthentication:false,broadenRoute:false
  });
});

test('rejects secret-bearing, executable or mutable returned evidence',()=>{
  const secret=batch();
  secret.rows[0].apiKey='do-not-store';
  assert.throws(()=>createFieldProjectionAuthority(policy()).admitBatch(secret),/secret|credential/i);
  const executable=batch();
  Object.defineProperty(executable.rows[0].values,'status',{enumerable:true,get(){throw new Error('executed');}});
  assert.throws(()=>createFieldProjectionAuthority(policy()).admitBatch(executable),/executable|hidden/i);
  const decision=createFieldProjectionAuthority(policy()).admitBatch(batch());
  assert.equal(Object.isFrozen(decision),true);
  assert.equal(Object.isFrozen(decision.records),true);
  assert.throws(()=>decision.records.push({}),TypeError);
});

// Regression: inert cloning must inspect an array descriptor before reading its value.
test('rejects indexed accessors without executing untrusted policy data',()=>{
  const input=policy();let calls=0;const values=[];
  Object.defineProperty(values,'0',{enumerable:true,get(){calls++;return 'employeeId';}});
  input.allowedFields=values;
  assert.throws(()=>createFieldProjectionAuthority(input),/executable|hidden/i);
  assert.equal(calls,0,'array accessor was executed before rejection');
});

test('rejects route paths that change the approved HTTPS origin',()=>{
  for(const routePath of ['//outside.example.invalid/read','/\\outside.example.invalid/read','/\t/outside.example.invalid/read','/\n/outside.example.invalid/read']){
    assert.throws(()=>createFieldProjectionAuthority(policy({routePath})),/exact path/);
    assert.throws(()=>createFieldProjectionAuthority(policy()).authorizeRead(request({routePath})),/exact path/);
  }
});
