'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Adapter=require('../staffology-adapter.cjs');
const Bridge=require('../canonical-runtime-bridge.cjs');
const Boundaries=require('../canonical-production-boundaries.cjs');
const {DatabaseSync}=require('node:sqlite');

const binding={tenant:'synthetic-tenant',implementationRunId:'synthetic-run',candidateSha:'b'.repeat(40),deploymentId:'synthetic-deploy',configurationId:'synthetic-config',employerId:'synthetic-employer'};
const input={...binding,batchId:'approved-batch',sourceRevision:'approved-rev',employeeId:'synthetic-employee',entryId:'synthetic-entry',payrollCode:'TEST01',effectiveDate:'2026-09-30',taxYear:'Year2026',payPeriod:'Monthly',periodNumber:6,ordinal:1,version:0,mode:'hourly-basic-replacement',rounding:'exact-cent',lines:[{code:'BASIC',hours:'1.25',rate:'10'}]};

test('successor red: a pre-dispatch read failure is durably distinguished from an attempted send',async()=>{
 const rows=new Map();
 const store={
  get:async id=>structuredClone(rows.get(id)),
  begin:async row=>{rows.set(row.deliveryId,{...structuredClone(row),token:'private-token'});return {acquired:true,token:'private-token'};},
  assertOwned:async()=>true,
  recordEvidence:async()=>true,
  acknowledge:async()=>assert.fail('must not acknowledge'),
  markUncertain:async(id,details)=>{rows.set(id,{...rows.get(id),status:'uncertain',details});return true;},
  markRejected:async(id,details)=>{rows.set(id,{...rows.get(id),status:'rejected',details});return true;}
 };
 let posts=0;
 const client=async(_url,options)=>{if(options.method==='POST')posts++;throw Error('INJECTED_INITIAL_GET_FAILURE');};
 const coordinator=Adapter.createDeliveryCoordinator({binding,config:{apiKey:'synthetic-key',baseUrl:'https://api.staffology.co.uk',timeoutMs:50},store,client,authorizeWrite:async()=>true});
 await assert.rejects(coordinator.deliver(input));
 assert.equal(posts,0);
 assert.equal([...rows.values()][0].status,'uncertain');
 assert.equal([...rows.values()][0].details.dispatchStarted,false);
});

test('successor red: a former employee cannot enter the onboarding upsert workflow',()=>{
 const mapped=Adapter.mapEmployee({id:'former-1',status:'Former',personalDetails:{firstName:'Former',lastName:'Worker',email:'former@example.invalid'},employmentDetails:{payrollCode:'FORMER1',starterDetails:{startDate:'2020-01-01'},leaverDetails:{hasLeft:true,leaveDate:'2026-09-30'}}},{employerId:'synthetic-employer'});
 const acquisition={objectType:'people',cursor:'pageNum:0',sourceVersion:'v1',paginationComplete:true,atomicProviderSnapshot:false,records:[mapped]};
 const receipt={approved:true,mappings:[{externalId:'former-1',payrollId:'FORMER1',managerId:'m1',site:'Leeds',job:'Operator',contractType:'full_time',weeklyHours:'40'}]};
 const envelope=Bridge.peopleEnvelope(acquisition,receipt);
 assert.equal(envelope.records[0].operation,'delete');
 assert.equal(envelope.records[0].data.employment_status,'Former');
 assert.equal(envelope.records[0].data.employment_end_date,'2026-09-30');
 assert.throws(()=>Bridge.assertPeopleApplicationRecord(envelope.records[0]),{code:'STAFFOLOGY_EMPLOYEE_LIFECYCLE_REQUIRED'});
});

test('successor red: permit consumption remains bound to the approver current authority',()=>{
 const db=new DatabaseSync(':memory:');
 const actor={tenant:binding.tenant,personId:'approver-1',email:'approver@example.invalid',permissions:['payroll.export','company.configure']};
 const authority=Boundaries.createAuthority(db,{now:()=>1_000,resolvePrincipal:()=>actor});
 const permit={binding,deliveryId:'staffology:'+ 'a'.repeat(64),digest:'b'.repeat(64),run:{taxYear:'Year2026',payPeriod:'Monthly',periodNumber:6,ordinal:1,version:0},entryId:'synthetic-entry',baselineSha256:'c'.repeat(64),baselineRunSha256:'d'.repeat(64),expectedBasicPay:'12.50',rounding:'exact-cent'};
 authority.issue(actor,permit);
 assert.equal(authority.check(permit),true);
 actor.permissions=[];
 assert.equal(authority.check(permit),false);
 assert.throws(()=>authority.consume(permit),{code:'STAFFOLOGY_WRITE_NOT_AUTHORIZED'});
 db.close();
});
