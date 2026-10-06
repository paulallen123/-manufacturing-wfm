'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const Operations=require('./canonical-operations.cjs');
const Bridge=require('./canonical-runtime-bridge.cjs');
const Boundaries=require('./canonical-production-boundaries.cjs');
const Adapter=require('./staffology-adapter.cjs');

const sha='b'.repeat(40);
const binding={tenant:'northstar-demo',implementationRunId:'run-multi',candidateSha:sha,deploymentId:'deployment-multi',configurationId:'config-multi',employerId:'employer-001'};
const actor={tenant:binding.tenant,personId:'payroll-admin',email:'payroll@example.invalid',permissions:['payroll.export','company.configure']};
const csv='two-line-released-payroll',checksum=createHash('sha256').update(csv).digest('hex');
const payCode={code:'BASIC',isDeduction:false,isNiable:true,isTaxable:true,isPensionable:true,isAttachable:true,isRealTimeClass1aNiable:false,isNotContributingToHolidayPay:false,isQualifyingEarningsForAe:true,isNotTierable:false,isAutoAdjust:false,calculationType:'Basic',multiplierType:'Hourly',hourlyRateMultiplier:1,isSystemCode:false,isControlCode:false,isNotional:false};
const payCodeDefinitionSha256=Adapter.sha256(payCode);
const lines=[
 {employee:'vector-001',payrollId:'PAY901',date:'2026-09-15',code:'WORKED_BASIC',minutes:75,hours:'1.25',rate:'10.00',allowance:0,grossPence:1250,gross:'12.50'},
 {employee:'vector-002',payrollId:'PAY902',date:'2026-09-15',code:'WORKED_BASIC',minutes:150,hours:'2.50',rate:'10.00',allowance:0,grossPence:2500,gross:'25.00'}
];
const approval=(index)=>({tenant:binding.tenant,periodId:'2026-09-01',batchId:'batch-multi',batchChecksum:checksum,employeeId:lines[index].employee,employerId:binding.employerId,staffologyEmployeeId:'employee-00'+(index+1),entryId:'entry-00'+(index+1),payrollCode:lines[index].payrollId,effectiveDate:lines[index].date,basicPayCode:'BASIC',payCodeDefinitionSha256,rounding:'exact-cent',taxYear:'Year2026',payPeriod:'Monthly',periodNumber:9,ordinal:1,version:0,expectedHours:lines[index].hours,expectedRate:lines[index].rate,expectedBasicPay:index===0?'12.50':'25.00'});
const primary=approval(0);
const manifest={periodId:primary.periodId,batchId:primary.batchId,batchChecksum:checksum,lines:lines.map((line,index)=>({lineDigest:Bridge.payrollLineIdentity(line).digest,status:'mapped',approval:approval(index)}))};
const profile={binding,connector:{id:'staffology-people',scope:'staffology-reviewed-people',tenant:binding.tenant,provider:'staffology',objectTypes:['people']},provider:{apiKey:'offline-synthetic-key-001',baseUrl:'https://api.staffology.co.uk',timeoutMs:1000},cohort:['employee-001','employee-002'],payroll:primary,batchManifest:manifest,pageSize:2,maxPages:2};
const state=()=>({staff:[
 {id:'vector-001',sourceId:'employee-001',payrollId:'PAY901',onboardingReady:true},
 {id:'vector-002',sourceId:'employee-002',payrollId:'PAY902',onboardingReady:true}
],payrollControl:{periods:[{id:'2026-09-01',start:'2026-09-01',end:'2026-09-30',batches:[{id:'batch-multi',status:'released',checksum,csv,lines}]}]}});

function provider(){
 let posts=0;const accepted=new Set();
 const run={taxYear:'Year2026',payPeriod:'Monthly',period:9,ordinal:1,version:0,state:'Open',startDate:'2026-09-01',endDate:'2026-09-30'};
 const employee=(index)=>({id:'employee-00'+(index+1),status:'Current',personalDetails:{firstName:'Synthetic',lastName:String(index+1)},employmentDetails:{payrollCode:lines[index].payrollId,onHold:false,starterDetails:{startDate:'2026-01-01'},leaverDetails:{hasLeft:false,leaveDate:null,paymentAfterLeaving:false}}});
 const entry=(index,after)=>{const hours=after?Number(lines[index].hours):10,value=after?Number(index===0?12.5:25):100;return {id:'entry-00'+(index+1),employee:{id:'employee-00'+(index+1)},employmentDetails:{payrollCode:lines[index].payrollId},taxYear:'Year2026',payPeriod:'Monthly',period:9,ordinal:1,payRunVersion:0,state:'Open',paymentAfterLeaving:false,unpaidAbsence:false,recievingOffsetPay:false,percentageOfWorkingDaysPaidAsNormal:1,workingDaysNotPaidAsNormal:0,payOptions:{basis:'Hourly',payCode:'BASIC',payAmount:10,payAmountMultiplier:hours,autoAdjustForLeave:false,excludedRegularPayLines:[],regularPayLines:[{code:'BASIC',rate:10,multiplier:hours,value,leaveId:null,leaveStatutoryDaysPaid:0,leaveStatutoryWeeksPaid:0,autoAdjustForLeave:false,isLeaveBasedBackPayLine:false}]},totals:{basicPay:value}};};
 const response=value=>new Response(value===undefined?null:JSON.stringify(value),{status:200});
 const client=async(url,options)=>{const parsed=new URL(url),path=parsed.pathname;if(options.method==='POST'){posts++;const body=JSON.parse(options.body),code=body[0].payrollCode;accepted.add(code);return response();}if(path==='/open')return response([run]);if(path.endsWith('/paycodes'))return response([payCode]);for(let i=0;i<2;i++){if(path.endsWith('/employees/employee-00'+(i+1)))return response(employee(i));if(path.endsWith('/entry-00'+(i+1)))return response(entry(i,accepted.has(lines[i].payrollId)));}return response(run);};
 return {client,get posts(){return posts;}};
}

test('multi-line released batch is fully acknowledged once and replay issues zero additional provider POSTs',async()=>{
 const db=new DatabaseSync(':memory:'),p=provider(),boundaries=Boundaries.createBoundaries({db,resolvePrincipal:()=>actor}),runtime=Bridge.createRuntime({loadState:state,productionBoundaries:boundaries}),operations=Operations.createOperations({runtime,boundaries,profile,client:p.client});
 const first=await operations.approveAndDeliver(actor,{reviewed:true,approval:primary});
 assert.equal(first.deliveries.length,2);assert.equal(p.posts,2);
 assert.equal(first.batchReceipt.expectedLineCount,2);assert.equal(first.batchReceipt.acknowledgedLineCount,2);assert.equal(first.batchReceipt.heldLineCount,0);assert.equal(first.batchReceipt.allIdentitiesAccountedFor,true);assert.equal(first.batchReceipt.fullPayrollVerified,true);
 const replay=await operations.approveAndDeliver(actor,{reviewed:true,approval:primary});
 assert.equal(replay.deliveries.length,2);assert.equal(replay.deliveries.every(item=>item.replayed===true),true);assert.equal(p.posts,2);assert.equal(replay.batchReceipt.fullPayrollVerified,true);
 const readback=await operations.readback(actor,{reviewed:true,approval:primary});
 assert.equal(readback.readbacks.length,2);assert.equal(readback.batchReceipt.fullPayrollVerified,true);assert.equal(p.posts,2);
 db.close();
});
