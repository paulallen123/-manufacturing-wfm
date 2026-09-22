import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCompanySnapshot,createScenarioRun,compareObserved,scenarioPortfolio} from './simulation-engine.mjs';

test('Northstar deterministically creates 10,000 employees across 50 sites',()=>{
  const a=buildCompanySnapshot({seed:'same'});
  const b=buildCompanySnapshot({seed:'same'});
  assert.equal(a.sites.length,50);
  assert.equal(a.sites.reduce((n,s)=>n+s.employees,0),10000);
  assert.deepEqual(a,b);
});

test('different seeds alter operating conditions without altering company scale',()=>{
  const a=buildCompanySnapshot({seed:'a'});
  const b=buildCompanySnapshot({seed:'b'});
  assert.notEqual(a.snapshotDigest,b.snapshotDigest);
  assert.equal(a.sites.reduce((n,s)=>n+s.employees,0),10000);
  assert.equal(b.sites.reduce((n,s)=>n+s.employees,0),10000);
});

test('scenario runs never grant production/customer/payroll authority',()=>{
  const run=createScenarioRun({scenarioId:'payroll-close-delta',seed:'proof',mode:'VECTOR_TEST_TENANT',vectorSourceIdentity:'forge:test'});
  assert.deepEqual(run.authority,{production:false,customerTenant:false,payrollRelease:false,publishedSchedule:false,policyOverride:false});
  assert.match(run.claimBoundary,/not realised customer ROI/);
});

test('evidence receipt fails closed when an expected control is missing',()=>{
  const run=createScenarioRun({scenarioId:'cross-tenant-injection'});
  const receipt=compareObserved(run,['request rejected','no cross-tenant read/write']);
  assert.equal(receipt.pass,false);
  assert.ok(receipt.missing.includes('immutable denial evidence'));
});

test('catalog contains multiple operational and integration families',()=>{
  const portfolio=scenarioPortfolio();
  assert.ok(portfolio.length>=18);
  assert.ok(portfolio.some(x=>x.family==='integration'));
  assert.ok(portfolio.some(x=>x.family==='payroll'));
  assert.ok(portfolio.some(x=>x.family==='security'));
  assert.ok(portfolio.some(x=>x.family==='compound'));
});
