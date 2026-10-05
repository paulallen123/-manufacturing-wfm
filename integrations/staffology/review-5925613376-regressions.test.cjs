'use strict';
// Reproductions supplied by the independent retest in issue #288 comment
// 5925613376. Synthetic data only; no provider or hosted operation is used.
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const Bridge=require('./canonical-runtime-bridge.cjs');

const csv='reviewed-released-payroll-bytes';
const checksum=createHash('sha256').update(csv).digest('hex');
const releasedLine={employee:'vector-employee-1',payrollId:'PAY001',date:'2026-09-15',code:'WORKED_BASIC',hours:'1.25',rate:'10.00',allowance:'0.00',grossPence:1250,gross:'12.50'};
const approval={approved:true,tenant:'northstar-demo',periodId:'period-001',batchId:'batch-001',batchChecksum:checksum,employeeId:'vector-employee-1',employerId:'employer-001',staffologyEmployeeId:'staffology-employee-1',entryId:'entry-001',payrollCode:'PAY001',effectiveDate:'2026-09-15',basicPayCode:'BASIC',payCodeDefinitionSha256:'f'.repeat(64),rounding:'exact-cent',taxYear:'Year2026',payPeriod:'Monthly',periodNumber:9,ordinal:1,version:0};
function state(line=releasedLine){return {staff:[{id:'vector-employee-1',sourceId:'staffology-employee-1',payrollId:'PAY001',onboardingReady:true}],payrollControl:{periods:[{id:'period-001',start:'2026-09-01',end:'2026-09-30',batches:[{id:'batch-001',status:'released',checksum,csv,lines:[line]}]}]}};}
function employee(externalId,payrollCode){return {externalId,revision:`revision-${externalId}`,operation:'upsert',data:{identity:{provider:'staffology',employeeId:externalId,payrollCode},person:{firstName:'Test',lastName:externalId,email:`${externalId}@example.invalid`},employment:{effectiveFrom:'2026-09-01'}}};}
function mapping(externalId,payrollId){return {externalId,payrollId,managerId:'manager-1',site:'Leeds',job:'Operator',contractType:'full_time',weeklyHours:'40'};}
function acquisition(records){return {objectType:'people',cursor:'pageNum:0',sourceVersion:'review-version',paginationComplete:true,atomicProviderSnapshot:false,records};}

test('R06 rejects £1,250 released gross for approved 1.25 × £10 = £12.50',()=>{
 assert.throws(()=>Bridge.preparePayrollInput(state({...releasedLine,grossPence:125000,gross:'1250.00'}),approval),{code:'STAFFOLOGY_PAYROLL_TOTAL_MISMATCH'});
 assert.equal(Bridge.preparePayrollInput(state(),approval).lines[0].hours,'1.25');
});

test('R08 rejects duplicated acquired employee that omits another reviewed employee',()=>{
 const records=[employee('employee-1','PAY001'),employee('employee-1','PAY001')];
 const receipt={approved:true,mappings:[mapping('employee-1','PAY001'),mapping('employee-2','PAY002')]};
 assert.throws(()=>Bridge.peopleEnvelope(acquisition(records),receipt),{code:'STAFFOLOGY_EMPLOYEE_MAPPING_REQUIRED'});
});

test('R08 accepts a one-to-one exact acquired and reviewed employee cohort',()=>{
 const records=[employee('employee-1','PAY001'),employee('employee-2','PAY002')];
 const receipt={approved:true,mappings:[mapping('employee-1','PAY001'),mapping('employee-2','PAY002')]};
 assert.deepEqual(Bridge.peopleEnvelope(acquisition(records),receipt).records.map(row=>row.externalId),['employee-1','employee-2']);
});
