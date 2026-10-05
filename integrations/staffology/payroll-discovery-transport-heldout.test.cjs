'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const Staffology=require('./staffology-adapter.cjs');
const Operations=require('./canonical-operations.cjs');
const Boundaries=require('./canonical-production-boundaries.cjs');

const binding={tenant:'northstar-demo',implementationRunId:'run-001',candidateSha:'a'.repeat(40),deploymentId:'deployment-001',configurationId:'configuration-001',employerId:'employer-001'};
const actor={email:'payroll@northstar.example',tenant:binding.tenant,personId:'pay-1',permissions:['payroll.export','company.configure']};
const config={apiKey:'offline-synthetic-key-001',baseUrl:'https://api.staffology.co.uk',timeoutMs:1000};
const run=()=>({taxYear:'Year2026',payPeriod:'Monthly',period:9,ordinal:1,version:0,state:'Open',isClosed:false,isLatestVersion:true,startDate:'2026-09-01',endDate:'2026-09-30',paymentDate:'2026-09-30',
 entries:[{id:'entry-001',name:'PII MUST NOT LEAK',metadata:{employeeId:'employee-001',payrollCode:'PAY001'},url:'/employers/employer-001/payrun/Year2026/Monthly/9/entry-001'}]});
const entry=amount=>({id:'entry-001',employee:{id:'employee-001',name:'PII MUST NOT LEAK'},personalDetails:{email:'secret@example.invalid'},employmentDetails:{payrollCode:'PAY001'},taxYear:'Year2026',payPeriod:'Monthly',period:9,ordinal:1,payRunVersion:0,state:'Open',isClosed:false,isLatestVersion:true,paymentAfterLeaving:false,unpaidAbsence:false,recievingOffsetPay:false,percentageOfWorkingDaysPaidAsNormal:1,workingDaysNotPaidAsNormal:0,payOptions:{basis:'Hourly',payCode:'BASIC',payAmount:10,payAmountMultiplier:amount===100?10:1.25,autoAdjustForLeave:false,excludedRegularPayLines:[],regularPayLines:[{code:'BASIC',rate:10,multiplier:amount===100?10:1.25,value:amount,leaveId:null,leaveStatutoryDaysPaid:0,leaveStatutoryWeeksPaid:0,autoAdjustForLeave:false,isLeaveBasedBackPayLine:false}]},totals:{basicPay:amount}});
const currentEmployee=()=>({id:'employee-001',status:'Current',personalDetails:{firstName:'PII',lastName:'MUST NOT LEAK',email:'secret@example.invalid'},employmentDetails:{payrollCode:'PAY001',onHold:false,starterDetails:{startDate:'2020-01-01'},leaverDetails:{hasLeft:false,leaveDate:null,paymentAfterLeaving:false}}});
const payCode={code:'BASIC',isDeduction:false,isNiable:true,isTaxable:true,isPensionable:true,isAttachable:true,isRealTimeClass1aNiable:false,isNotContributingToHolidayPay:false,isQualifyingEarningsForAe:true,isNotTierable:false,isAutoAdjust:false,calculationType:'Basic',multiplierType:'Hourly',hourlyRateMultiplier:1,isSystemCode:false,isControlCode:false,isNotional:false};
const response=(value,{status=200,requestId}={})=>new Response(value===undefined?null:JSON.stringify(value),{status,headers:requestId?{'x-request-id':requestId}:{}});

test('read-only payroll discovery uses GET only, refuses stale authority and returns no PII or secret material',async()=>{
 let calls=[],current=true;
 const client=async(url,options)=>{calls.push({url,method:options.method});assert.equal(options.method,'GET');const p=new URL(url).pathname;if(p==='/open')return response([run()]);if(p.endsWith('/entry-001'))return response(entry(100));if(p.endsWith('/employees/employee-001'))return response(currentEmployee());if(p.endsWith('/paycodes'))return response([payCode]);return response(run());};
 const profile={binding,provider:config,cohort:Object.freeze(['employee-001']),pageSize:100,maxPages:10,payroll:null,connector:{id:'staffology-people',scope:'staffology-reviewed-people'}};
 const boundaries={approvedCoordinator(){throw Error('not used');},assertCurrentPrincipal(){if(!current){const e=Error('stale');e.code='STAFFOLOGY_WRITE_NOT_AUTHORIZED';e.status=403;throw e;}}};
 const operations=Operations.createOperations({runtime:{},boundaries,profile,client});
 await assert.rejects(operations.discoverPayroll({...actor,tenant:'other'}),{code:'STAFFOLOGY_WRITE_NOT_AUTHORIZED'});assert.equal(calls.length,0);
 current=false;await assert.rejects(operations.discoverPayroll(actor),{code:'STAFFOLOGY_WRITE_NOT_AUTHORIZED'});assert.equal(calls.length,0);
 current=true;const found=await operations.discoverPayroll(actor);
 assert.equal(found.providerWritePerformed,false);assert.ok(calls.length>=3);assert.equal(calls.some(x=>x.method!=='GET'),false);
 const text=JSON.stringify(found);for(const forbidden of ['PII MUST NOT LEAK','secret@example.invalid','offline-synthetic-key-001','personalDetails','name'])assert.equal(text.includes(forbidden),false,forbidden);
 const item=found.runs[0].entries[0];assert.deepEqual(Object.keys(item).sort(),['basis','entryId','payCode','payCodeDefinition','payCodeDefinitionSha256','payrollCode','providerEmployeeId','regularLineCount','safeReplacement','safeReplacementReason'].sort());
 assert.equal(item.safeReplacement,true);assert.match(item.payCodeDefinitionSha256,/^[a-f0-9]{64}$/);assert.equal(item.payCodeDefinition.code,'BASIC');assert.equal(item.providerEmployeeId,'employee-001');assert.equal(item.payrollCode,'PAY001');
});

function dbFixture(t){
 const dir=mkdtempSync(join(tmpdir(),'staffology-transport-heldout-')),file=join(dir,'store.sqlite'),db=new DatabaseSync(file),handles=[db];
 t.after(()=>{for(const h of handles.reverse())try{h.close();}catch{}rmSync(dir,{recursive:true,force:true});});
 const boundaries=Boundaries.createBoundaries({db,resolvePrincipal:()=>actor});
 return {file,db,boundaries,reopen(){db.close();handles.pop();const next=new DatabaseSync(file);handles.push(next);return next;}};
}
function input(){return {...binding,employeeId:'employee-001',entryId:'entry-001',payrollCode:'PAY001',effectiveDate:'2026-09-15',batchId:'batch-001',sourceRevision:'sha256:'+('b'.repeat(64)),mode:'hourly-basic-replacement',rounding:'exact-cent',taxYear:'Year2026',payPeriod:'Monthly',periodNumber:9,ordinal:1,version:0,lines:[{code:'BASIC',hours:'1.25',rate:'10.00'}]};}
function providerClient(counter,{requestId}={}){
 let changed=false;
 return async(url,options)=>{const p=new URL(url).pathname;if(options.method==='POST'){counter.posts++;changed=true;return response(undefined,{requestId});}counter.gets++;if(p==='/open')return response([run()]);if(p.endsWith('/entry-001'))return response(entry(changed?12.5:100));return response(run());};
}

test('successful POST transport evidence survives SQLite reopen and missing request id is explicit null',async t=>{
 const f=dbFixture(t),counter={posts:0,gets:0},coordinator=f.boundaries.approvedCoordinator(actor,{binding,config,client:providerClient(counter)});
 const result=await coordinator.deliver(input());assert.equal(result.reconciliation.status,'reconciled');assert.equal(counter.posts,1);
 const row=f.db.prepare("SELECT evidence_json FROM outbound_staffology_private_evidence WHERE phase='transport'").get();assert.ok(row);const transport=JSON.parse(row.evidence_json);
 assert.equal(transport.phase,'transport');assert.equal(transport.httpStatus,200);assert.equal(transport.requestId,null);assert.match(transport.requestSha256,/^[a-f0-9]{64}$/);assert.match(transport.responseSha256,/^[a-f0-9]{64}$/);
 const reopened=f.reopen(),again=JSON.parse(reopened.prepare("SELECT evidence_json FROM outbound_staffology_private_evidence WHERE phase='transport'").get().evidence_json);assert.deepEqual(again,transport);
});

test('transport-evidence persistence failure can neither acknowledge nor resend',async t=>{
 const f=dbFixture(t),counter={posts:0,gets:0},base=f.boundaries.createStore({binding,workerId:'heldout-worker',leaseMs:60000}),store={...base,recordEvidence(id,evidence,token){if(evidence?.phase==='transport')throw Error('INJECTED_TRANSPORT_PERSISTENCE_FAILURE');return base.recordEvidence(id,evidence,token);}};
 const coordinator=Staffology.createDeliveryCoordinator({store,config,binding,client:providerClient(counter),authorizeWrite:permit=>{f.boundaries.authority.issue(actor,permit,{ttlMs:300000});return f.boundaries.authority.check(permit);}});
 await assert.rejects(coordinator.deliver(input()),{code:'STAFFOLOGY_TRANSPORT_EVIDENCE_NOT_PERSISTED'});
 assert.equal(counter.posts,1);let row=f.db.prepare('SELECT status,receipt_json,uncertain_json FROM outbound_staffology_deliveries').get();assert.equal(row.status,'uncertain');assert.equal(row.receipt_json,null);assert.equal(JSON.parse(row.uncertain_json).code,'STAFFOLOGY_TRANSPORT_EVIDENCE_NOT_PERSISTED');
 const replay=await coordinator.deliver(input());assert.equal(replay.replayed,true);assert.equal(replay.status,'uncertain');assert.equal(counter.posts,1);
 row=f.db.prepare('SELECT status,receipt_json FROM outbound_staffology_deliveries').get();assert.equal(row.status,'uncertain');assert.equal(row.receipt_json,null);
});
