import test from 'node:test';
import assert from 'node:assert/strict';
import {createExplicitExecutionContextAuthority} from './explicit-execution-context-authority.mjs';

const hashes={
  activation:`sha256:${'a'.repeat(64)}`,
  authorization:`sha256:${'b'.repeat(64)}`,
  metadata:`sha256:${'c'.repeat(64)}`,
  query:`sha256:${'d'.repeat(64)}`,
  schema:`sha256:${'e'.repeat(64)}`,
  payload:`sha256:${'f'.repeat(64)}`
};

const policy=()=>({
  provider:'infor-ln',
  wfmTenantId:'wfm-tenant-uk',
  connectionId:'ln-connection-1',
  sourceTenantId:'infor-tenant-eu',
  apiOrigin:'https://mingle-eu.inforcloudsuite.com',
  apiVersion:'lnapi-v1',
  route:'/lnapi/odata/tiapi.sfcProductionOrder/MachineOperations',
  method:'GET',
  companyId:'0100',
  identityMode:'service-account',
  identityTag:null,
  languageTag:'en-GB',
  serviceActivationFingerprint:hashes.activation,
  routeAuthorizationFingerprint:hashes.authorization,
  metadataFingerprint:hashes.metadata,
  queryFingerprint:hashes.query,
  schemaFingerprint:hashes.schema,
  expectedCheckpointPredecessor:'checkpoint:7',
  expectedObservedAt:'2026-09-27T05:15:00.000Z',
  maxRecords:1000
});

const receipt=()=>({
  provider:'infor-ln',
  wfmTenantId:'wfm-tenant-uk',
  connectionId:'ln-connection-1',
  sourceTenantId:'infor-tenant-eu',
  apiOrigin:'https://mingle-eu.inforcloudsuite.com',
  apiVersion:'lnapi-v1',
  route:'/lnapi/odata/tiapi.sfcProductionOrder/MachineOperations',
  method:'GET',
  companyId:'0100',
  companyHeader:'0100',
  identityMode:'service-account',
  identityTag:null,
  identityHeader:null,
  languageTag:'en-GB',
  contentLanguageHeader:'en-GB',
  usedDefaultCompany:false,
  usedIdentitySwitch:false,
  usedDefaultLanguage:false,
  serviceActivationFingerprint:hashes.activation,
  routeAuthorizationFingerprint:hashes.authorization,
  metadataFingerprint:hashes.metadata,
  queryFingerprint:hashes.query,
  schemaFingerprint:hashes.schema,
  checkpointPredecessor:'checkpoint:7',
  observedAt:'2026-09-27T05:15:00.000Z',
  successful:true,
  complete:true,
  records:[{id:'MO-1\u0000OP-10',sourceVersion:'1',payloadDigest:hashes.payload}]
});

test('admits an exact explicit execution context as reconciliation evidence only',()=>{
  const decision=createExplicitExecutionContextAuthority(policy()).admit(receipt());
  assert.equal(decision.contextReconciliationCandidate,true);
  assert.equal(decision.companyId,'0100');
  assert.equal(decision.languageTag,'en-GB');
  assert.equal(decision.reportedRecordCount,1);
  assert.equal(decision.uniqueVersionCount,1);
  assert.equal(decision.checkpointAdvanceAllowed,false);
  assert.equal(decision.deletionAuthority,false);
  assert.equal(decision.writeBackAuthority,false);
  assert.equal(decision.payrollAuthority,false);
  assert.equal(decision.attendanceAuthority,false);
});

test('rejects omitted default or mismatched company execution',()=>{
  const authority=createExplicitExecutionContextAuthority(policy());
  for(const mutate of [
    value=>{value.companyHeader=null;},
    value=>{value.usedDefaultCompany=true;},
    value=>{value.companyHeader='0200';},
    value=>{value.companyHeader='0100 ';},
    value=>{value.companyId='0200';}
  ]){
    const value=receipt(); mutate(value);
    assert.throws(()=>authority.admit(value),/company/i);
  }
});

test('rejects identity switching and language fallback or drift',()=>{
  assert.throws(
    ()=>createExplicitExecutionContextAuthority({...policy(),identityMode:'explicit-switch',identityTag:'lnapi_admin'}),
    /identity switching|service-account/i
  );
  const authority=createExplicitExecutionContextAuthority(policy());
  for(const mutate of [
    value=>{value.identityHeader='lnapi_admin'; value.usedIdentitySwitch=true;},
    value=>{value.identityMode='explicit-switch';},
    value=>{value.usedDefaultLanguage=true; value.contentLanguageHeader=null;},
    value=>{value.languageTag='de-DE'; value.contentLanguageHeader='de-DE';},
    value=>{value.contentLanguageHeader='fr-FR';}
  ]){
    const value=receipt(); mutate(value);
    assert.throws(()=>authority.admit(value),/identity|language/i);
  }
});

test('rejects mutation methods route widening and authorization drift',()=>{
  assert.throws(()=>createExplicitExecutionContextAuthority({...policy(),method:'POST'}),/GET|read/i);
  assert.throws(()=>createExplicitExecutionContextAuthority({...policy(),method:'get'}),/GET|read/i);
  assert.throws(()=>createExplicitExecutionContextAuthority({...policy(),route:'/lnapi/*'}),/route/i);
  for(const unsafeRoute of [
    '/lnapi/%2e%2e/admin','/lnapi/./admin','/lnapi\\admin','/lnapi/%2Fadmin','/lnapi/%5cadmin',
    '/lnapi/%252e%252e/admin','/lnapi/%252fadmin','/lnapi/%255cadmin',
    '/lnapi/\u0000admin','/lnapi/\tadmin','/lnapi/\nadmin','/lnapi/\u007fadmin'
  ]){
    assert.throws(()=>createExplicitExecutionContextAuthority({...policy(),route:unsafeRoute}),/route/i,unsafeRoute);
  }
  const authority=createExplicitExecutionContextAuthority(policy());
  for(const mutate of [
    value=>{value.method='PATCH';},
    value=>{value.method='get';},
    value=>{value.route='/lnapi/odata/tiapi.sfcProductionOrder';},
    value=>{value.route='/lnapi/odata/tiapi.sfcProductionOrder/MachineOperations ';},
    value=>{value.routeAuthorizationFingerprint=`sha256:${'9'.repeat(64)}`;},
    value=>{value.serviceActivationFingerprint=`sha256:${'8'.repeat(64)}`;}
  ]){
    const value=receipt(); mutate(value);
    assert.throws(()=>authority.admit(value),/method|route|authorization|activation/i);
  }
});

test('rejects failed incomplete stale or over-limit evidence',()=>{
  assert.throws(
    ()=>createExplicitExecutionContextAuthority({...policy(),expectedObservedAt:'2026-02-30T05:15:00.000Z'}),
    /real UTC instant/i
  );
  const authority=createExplicitExecutionContextAuthority(policy());
  const sparse=receipt(); sparse.records=new Array(1);
  assert.throws(()=>authority.admit(sparse),/sparse|array/i);
  for(const mutate of [
    value=>{value.successful=false;},
    value=>{value.complete=false;},
    value=>{value.checkpointPredecessor='checkpoint:6';},
    value=>{value.observedAt='2026-09-27T05:14:59.000Z';},
    value=>{value.records=Array.from({length:1001},(_,index)=>({id:`id-${index}`,sourceVersion:'1',payloadDigest:hashes.payload}));}
  ]){
    const value=receipt(); mutate(value);
    assert.throws(()=>authority.admit(value),/failed|incomplete|predecessor|observation|record limit/i);
  }
});

test('preserves opaque identity tuples and quarantines conflicting versions',()=>{
  const value=receipt();
  value.records=[
    {id:'A\u0000B',sourceVersion:'1',payloadDigest:hashes.payload},
    {id:'A',sourceVersion:'B\u00001',payloadDigest:hashes.payload},
    {id:'é',sourceVersion:'1',payloadDigest:hashes.payload},
    {id:'e\u0301',sourceVersion:'1',payloadDigest:hashes.payload},
    {id:'A\u0000B',sourceVersion:'1',payloadDigest:hashes.payload}
  ];
  const decision=createExplicitExecutionContextAuthority(policy()).admit(value);
  assert.equal(decision.reportedRecordCount,5);
  assert.equal(decision.uniqueVersionCount,4);
  assert.equal(decision.exactReplayCount,1);
  const conflict=receipt();
  conflict.records.push({id:'MO-1\u0000OP-10',sourceVersion:'1',payloadDigest:`sha256:${'1'.repeat(64)}`});
  assert.throws(()=>createExplicitExecutionContextAuthority(policy()).admit(conflict),/conflicting/i);
});

test('rejects secret or executable evidence and returns deeply immutable output',()=>{
  assert.throws(()=>createExplicitExecutionContextAuthority({...policy(),clientSecret:'nope'}),/secret|not allowed/i);
  const accessor=receipt();
  Object.defineProperty(accessor,'password',{enumerable:true,get(){throw new Error('executed');}});
  assert.throws(()=>createExplicitExecutionContextAuthority(policy()).admit(accessor),/secret|credential/i);
  const custom=receipt(); custom.records.token='hidden';
  assert.throws(()=>createExplicitExecutionContextAuthority(policy()).admit(custom),/secret|array index/i);
  const decision=createExplicitExecutionContextAuthority(policy()).admit(receipt());
  assert.equal(Object.isFrozen(decision),true);
  assert.equal(Object.isFrozen(decision.records),true);
  assert.equal(Object.isFrozen(decision.records[0]),true);
});
