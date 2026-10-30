'use strict';

// Synthetic, offline follow-up to #535. No coordinator, protected authority,
// provider adapter call, database, hosted service or business action is created.
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {validatePayrollProofInputs}=require('./staffology-payroll-proof-preflight.cjs');
const Bridge=require('../integrations/staffology/canonical-runtime-bridge.cjs');

const NO_GRANT_FIELDS=[
 'authorizationGranted','proofEligible','providerRequestsPerformed',
 'credentialReadinessVerified','currentPrincipalAuthorityVerified','inputProvenanceVerified'
];
function fixture(){
 const sourceSha='a'.repeat(40);
 const binding={tenant:'synthetic-tenant',implementationRunId:'synthetic-run',candidateSha:sourceSha,deploymentId:'synthetic-deployment',configurationId:'synthetic-configuration',employerId:'synthetic-employer'};
 const actor={tenant:binding.tenant,email:'reviewer@example.invalid',permissions:['payroll.export','company.configure']};
 const csv='two retained synthetic lines',batchChecksum=createHash('sha256').update(csv).digest('hex');
 const rows=[
  {employee:'vector-worker-001',payrollId:'PAY001',date:'2026-09-15',code:'WORKED_BASIC',minutes:75,hours:'1.25',rate:'10.00',allowance:0,grossPence:1250,gross:'12.50'},
  {employee:'vector-worker-002',payrollId:'PAY002',date:'2026-09-15',code:'WORKED_BASIC',minutes:135,hours:'2.25',rate:'12.00',allowance:0,grossPence:2700,gross:'27.00'}
 ];
 const mappings=rows.map((row,index)=>({lineDigest:Bridge.payrollLineIdentity(row).digest,status:'mapped',approval:{
  tenant:binding.tenant,periodId:'2026-09-01',batchId:'synthetic-batch',batchChecksum,employeeId:row.employee,employerId:binding.employerId,
  staffologyEmployeeId:'provider-worker-00'+(index+1),entryId:'provider-entry-00'+(index+1),payrollCode:row.payrollId,effectiveDate:row.date,
  basicPayCode:'BASIC',payCodeDefinitionSha256:'b'.repeat(64),rounding:'exact-cent',taxYear:'Year2026',payPeriod:'Monthly',periodNumber:9,ordinal:1,version:0,
  expectedHours:row.hours,expectedRate:row.rate,expectedBasicPay:row.gross
 }}));
 const profile={...binding,employeeIds:mappings.map(row=>row.approval.staffologyEmployeeId),payroll:structuredClone(mappings[0].approval),batchManifest:{periodId:'2026-09-01',batchId:'synthetic-batch',batchChecksum,lines:mappings}};
 const state={staff:rows.map((row,index)=>({id:row.employee,sourceId:mappings[index].approval.staffologyEmployeeId,payrollId:row.payrollId,onboardingReady:true})),payrollControl:{periods:[{id:'2026-09-01',start:'2026-09-01',end:'2026-09-30',batches:[{id:'synthetic-batch',status:'released',checksum:batchChecksum,csv,lines:rows}]}]}};
 return {sourceSha,binding,actor,profile,state};
}
function check(input,valid,code){
 const before=JSON.stringify(input),result=validatePayrollProofInputs(input);
 assert.equal(result.contractValid,valid,JSON.stringify(result));
 for(const field of NO_GRANT_FIELDS)assert.equal(result[field],false,field+' must stay false');
 assert.equal(JSON.stringify(input),before,'offline check changed supplied inputs');
 if(code)assert.ok(result.blockerCodes.includes(code),JSON.stringify(result));
 return result;
}
test('complete two-worker input checks every released line and grants no authority',()=>{
 const result=check(fixture(),true);assert.equal(result.lineCount,2);
 assert.match(result.manifestDigest,/^[a-f0-9]{64}$/);
});
test('a correct primary worker cannot hide a financial mismatch in the other worker',()=>{
 for(const [field,value] of [['expectedBasicPay','2700.00'],['expectedHours','22.50'],['expectedRate','120.00']]){
  const input=fixture();input.profile.batchManifest.lines[1].approval[field]=value;
  check(input,false,'STAFFOLOGY_PAYROLL_SCOPE_MISMATCH');
 }
});
test('individually valid worker mappings cannot be swapped between released line digests',()=>{
 const input=fixture(),lines=input.profile.batchManifest.lines;
 [lines[0].approval,lines[1].approval]=[lines[1].approval,lines[0].approval];
 check(input,false,'STAFFOLOGY_PAYROLL_SCOPE_MISMATCH');
});
test('two VECTOR workers cannot target one provider business operation',()=>{
 const input=fixture(),first=input.profile.batchManifest.lines[0].approval,second=input.profile.batchManifest.lines[1].approval;
 second.staffologyEmployeeId=first.staffologyEmployeeId;
 second.payrollCode=first.payrollCode;
 input.profile.employeeIds=[first.staffologyEmployeeId];
 input.state.staff[1].sourceId=first.staffologyEmployeeId;
 input.state.staff[1].payrollId=first.payrollCode;
 const line=input.state.payrollControl.periods[0].batches[0].lines[1];
 line.payrollId=first.payrollCode;
 input.profile.batchManifest.lines[1].lineDigest=Bridge.payrollLineIdentity(line).digest;
 check(input,false,'STAFFOLOGY_BATCH_COMPONENT_UNSUPPORTED');
});
test('removing a non-primary worker mapping or identity refuses the whole batch',()=>{
 const missing=fixture();missing.profile.batchManifest.lines.pop();
 check(missing,false,'STAFFOLOGY_BATCH_COMPONENT_UNSUPPORTED');
 const unready=fixture();unready.state.staff[1].onboardingReady=false;
 check(unready,false,'STAFFOLOGY_PAYROLL_IDENTITY_NOT_READY');
});
test('source, dormant, malformed and permission refusals keep every no-grant flag false',()=>{
 const source=fixture();source.sourceSha='d'.repeat(40);check(source,false,'STAFFOLOGY_PREFLIGHT_SOURCE_MISMATCH');
 const dormant=fixture();dormant.profile=null;check(dormant,false,'STAFFOLOGY_PAYROLL_DORMANT');
 const secret=fixture();secret.profile.apiKey='PRIVATE_SENTINEL';
 assert.ok(!JSON.stringify(check(secret,false,'STAFFOLOGY_PREFLIGHT_PROFILE_FIELDS_INVALID')).includes('PRIVATE_SENTINEL'));
 const actor=fixture();actor.actor.permissions=[];check(actor,false,'STAFFOLOGY_WRITE_NOT_AUTHORIZED');
});
test('valid and refused checks never reach the ambient HTTP transport',()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=()=>{calls++;throw Error('Provider transport must remain unused');};
 try{
  check(fixture(),true);
  const input=fixture();input.profile.batchManifest.lines[1].approval.expectedBasicPay='2700.00';
  check(input,false,'STAFFOLOGY_PAYROLL_SCOPE_MISMATCH');
  assert.equal(calls,0);
 }finally{globalThis.fetch=original;}
});
