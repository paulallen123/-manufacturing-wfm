import test from 'node:test';
import assert from 'node:assert/strict';
import {emulateProviderRequest,listProviderProfiles} from './provider-emulator.mjs';

test('catalog contains provider-specific emulators',()=>{
  const p=listProviderProfiles();
  for(const id of ['oracle-netsuite','sap-s4hana','workday','adp-workforce-now','mulesoft-gateway','legacy-sftp-payroll']){
    assert.ok(p.providers.some(x=>x.id===id));
  }
});

test('NetSuite emulator uses SuiteQL POST style and stable paging',()=>{
  const r=emulateProviderRequest({providerId:'oracle-netsuite',limit:25});
  assert.equal(r.result.request.method,'POST');
  assert.equal(r.result.request.path,'/services/rest/query/v1/suiteql');
  assert.equal(r.result.request.headers.Prefer,'transient');
  assert.equal(r.result.body.count,25);
  assert.equal(r.certifiedByProvider,false);
});

test('SAP emulator emits nextLink/skiptoken semantics',()=>{
  const r=emulateProviderRequest({providerId:'sap-s4hana',limit:50});
  assert.match(r.result.body['@odata.nextLink'],/\$skiptoken=50/);
});

test('Workday emulator constrains page size and returns data plus total',()=>{
  const r=emulateProviderRequest({providerId:'workday',limit:1000});
  assert.equal(r.result.body.data.length,100);
  assert.equal(r.result.body.total,237);
});

test('ADP emulator reaches 204 terminal page and can model async 202',()=>{
  const done=emulateProviderRequest({providerId:'adp-workforce-now',offset:300});
  assert.equal(done.result.status,204);
  const asyncRun=emulateProviderRequest({providerId:'adp-workforce-now',fault:'async'});
  assert.equal(asyncRun.result.status,202);
  assert.equal(asyncRun.result.retryClass,'POLL');
});

test('MuleSoft emulator preserves transformation provenance',()=>{
  const r=emulateProviderRequest({providerId:'mulesoft-gateway'});
  assert.match(r.result.transformation.inputDigest,/^[a-f0-9]{64}$/);
  assert.match(r.result.transformation.outputDigest,/^[a-f0-9]{64}$/);
  assert.notEqual(r.result.transformation.inputDigest,r.result.transformation.outputDigest);
});

test('provider emulators fail closed on expired credentials',()=>{
  const r=emulateProviderRequest({providerId:'oracle-netsuite',tokenState:'EXPIRED'});
  assert.equal(r.result.status,401);
  assert.equal(r.result.retryClass,'REAUTH');
  assert.equal(r.authority.providerCredential,false);
});
