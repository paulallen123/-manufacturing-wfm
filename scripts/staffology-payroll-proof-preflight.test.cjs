'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {mkdtempSync,writeFileSync,readFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const {spawnSync}=require('node:child_process');
const Operations=require('../integrations/staffology/canonical-operations.cjs');
const Bridge=require('../integrations/staffology/canonical-runtime-bridge.cjs');
const Adapter=require('../integrations/staffology/staffology-adapter.cjs');
const {validatePayrollProofInputs}=require('./staffology-payroll-proof-preflight.cjs');
const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
 const sourceSha='a'.repeat(40),binding={tenant:'synthetic-tenant',implementationRunId:'synthetic-run',candidateSha:sourceSha,deploymentId:'synthetic-deployment',configurationId:'synthetic-configuration',employerId:'synthetic-employer'};
 const actor={tenant:binding.tenant,personId:'synthetic-person',email:'synthetic@example.invalid',permissions:['payroll.export','company.configure']};
 const csv='retained-synthetic-released-bytes',batchChecksum=hash(csv);
 const line={employee:'vector-employee-001',payrollId:'PAY901',date:'2026-09-15',code:'WORKED_BASIC',minutes:75,hours:'1.25',rate:'10.00',allowance:0,grossPence:1250,gross:'12.50'};
 const payroll={tenant:binding.tenant,periodId:'2026-09-01',batchId:'synthetic-batch',batchChecksum,employeeId:line.employee,employerId:binding.employerId,staffologyEmployeeId:'provider-employee-001',entryId:'provider-entry-001',payrollCode:line.payrollId,effectiveDate:line.date,basicPayCode:'BASIC',payCodeDefinitionSha256:'b'.repeat(64),rounding:'exact-cent',taxYear:'Year2026',payPeriod:'Monthly',periodNumber:9,ordinal:1,version:0,expectedHours:'1.25',expectedRate:'10.00',expectedBasicPay:'12.50'};
 const batchManifest={periodId:payroll.periodId,batchId:payroll.batchId,batchChecksum,lines:[{lineDigest:Bridge.payrollLineIdentity(line).digest,status:'mapped',approval:payroll}]};
 const profile={...binding,employeeIds:[payroll.staffologyEmployeeId],payroll,batchManifest};
 const state={staff:[{id:line.employee,sourceId:payroll.staffologyEmployeeId,payrollId:line.payrollId,onboardingReady:true}],payrollControl:{periods:[{id:payroll.periodId,start:'2026-09-01',end:'2026-09-30',batches:[{id:payroll.batchId,status:'released',checksum:batchChecksum,csv,lines:[line]}]}]}};
 return {sourceSha,binding,actor,profile,state};
}
function loaded(input){return Operations.loadConfiguration({WFM_STAFFOLOGY_OPERATION_JSON:JSON.stringify(input.profile),STAFFOLOGY_API_KEY:'offline-structure-check-only',WFM_BUILD_SOURCE_SHA:input.sourceSha},{readSeal:()=>input.sourceSha});}
function denies(input,code){const result=validatePayrollProofInputs(input);assert.equal(result.contractValid,false);assert.ok(result.blockerCodes.includes(code),JSON.stringify(result));assert.equal(result.authorizationGranted,false);assert.equal(result.proofEligible,false);return result;}
test('current profile parser accepts scope structure but cannot reconcile retained released amounts',()=>{
 const input=fixture();input.profile.payroll.expectedBasicPay='1250.00';
 assert.equal(loaded(input).payroll.expectedBasicPay,'1250.00');
 denies(input,'STAFFOLOGY_PAYROLL_SCOPE_MISMATCH');
});
test('complete exact inputs pass a real canonical bridge without granting authority or changing inputs',()=>{
 const input=fixture(),before=JSON.stringify(input),result=validatePayrollProofInputs(input);
 assert.equal(result.contractValid,true);assert.deepEqual(result.blockerCodes,[]);
 assert.equal(result.authorizationGranted,false);assert.equal(result.proofEligible,false);
 assert.equal(result.lineCount,1);assert.equal(result.sourceSha,input.sourceSha);
 assert.equal(JSON.stringify(input),before);assert.equal(result.providerRequestsPerformed,false);
 assert.ok(result.requiredExternalEvidence.includes('CURRENT_APPROVED_NONPRODUCTION_OPERATION'));
 assert.deepEqual(Object.keys(result.moduleSha256).sort(),['adapter','boundaries','bridge','operations']);
});
test('all exact binding coordinates and independent source seal fail closed on drift',()=>{
 for(const key of Object.keys(fixture().binding)){
  const input=fixture();input.binding[key]=key==='candidateSha'?'c'.repeat(40):'other-'+input.binding[key];
  denies(input,key==='candidateSha'?'STAFFOLOGY_PREFLIGHT_SOURCE_MISMATCH':'STAFFOLOGY_PREFLIGHT_BINDING_MISMATCH');
 }
 const input=fixture();input.sourceSha='d'.repeat(40);denies(input,'STAFFOLOGY_PREFLIGHT_SOURCE_MISMATCH');
});
test('hosted profile may omit deployment only with the exact existing trusted-binding UUID contract',()=>{
 const input=fixture();delete input.profile.deploymentId;input.binding.deploymentId='12345678-1234-1234-1234-123456789abc';
 assert.equal(validatePayrollProofInputs(input).contractValid,true);
 input.binding.deploymentId='malformed-deployment';denies(input,'STAFFOLOGY_OPERATION_CONFIGURATION_INVALID');
});
test('missing, unsupported and wrong released-line digests cannot form an eligible batch',()=>{
 const missing=fixture(),line=structuredClone(missing.state.payrollControl.periods[0].batches[0].lines[0]);line.employee='vector-employee-002';line.payrollId='PAY902';
 missing.state.payrollControl.periods[0].batches[0].lines.push(line);denies(missing,'STAFFOLOGY_BATCH_COMPONENT_UNSUPPORTED');
 const unsupported=fixture();unsupported.profile.batchManifest.lines.push({lineDigest:'f'.repeat(64),status:'unsupported',reason:'SYNTHETIC_UNSUPPORTED_COMPONENT'});
 denies(unsupported,'STAFFOLOGY_BATCH_COMPONENT_UNSUPPORTED');
 const wrong=fixture();wrong.profile.batchManifest.lines[0].lineDigest='f'.repeat(64);denies(wrong,'STAFFOLOGY_BATCH_COMPONENT_UNSUPPORTED');
});
test('financial scope drift is rejected for rate, hours, amount and released gross',()=>{
 for(const [field,value] of [['expectedHours','2.50'],['expectedRate','20.00'],['expectedBasicPay','25.00']]){
  const input=fixture();input.profile.payroll[field]=value;denies(input,'STAFFOLOGY_PAYROLL_SCOPE_MISMATCH');
 }
 const input=fixture(),line=input.state.payrollControl.periods[0].batches[0].lines[0];line.grossPence=125000;line.gross='1250.00';input.profile.batchManifest.lines[0].lineDigest=Bridge.payrollLineIdentity(line).digest;
 denies(input,'STAFFOLOGY_PAYROLL_TOTAL_MISMATCH');
});
test('changed released bytes, sent batch, wrong linked employee and stale permission are held',()=>{
 const bytes=fixture();bytes.state.payrollControl.periods[0].batches[0].csv+='changed';denies(bytes,'STAFFOLOGY_CANONICAL_INTEGRATION_BLOCKED');
 const sent=fixture();sent.state.payrollControl.periods[0].batches[0].status='sent';denies(sent,'STAFFOLOGY_CANONICAL_INTEGRATION_BLOCKED');
 const identity=fixture();identity.state.staff[0].sourceId='other-provider-employee';denies(identity,'STAFFOLOGY_PAYROLL_IDENTITY_NOT_READY');
 const permission=fixture();permission.actor.permissions=['payroll.export'];denies(permission,'STAFFOLOGY_WRITE_NOT_AUTHORIZED');
 const malformed=fixture();malformed.actor.permissions='payroll.export,company.configure';denies(malformed,'STAFFOLOGY_WRITE_NOT_AUTHORIZED');
});
test('dormant, malformed and secret-bearing profiles produce only redacted blocker codes',()=>{
 const dormant=fixture();dormant.profile=null;denies(dormant,'STAFFOLOGY_PAYROLL_DORMANT');
 const secret=fixture();secret.profile.apiKey='SENTINEL_SECRET_MUST_NOT_ESCAPE';const result=denies(secret,'STAFFOLOGY_PREFLIGHT_PROFILE_FIELDS_INVALID');assert.ok(!JSON.stringify(result).includes('SENTINEL'));
 const invalid=fixture();invalid.profile.employeeIds=[];denies(invalid,'STAFFOLOGY_OPERATION_CONFIGURATION_INVALID');
});
test('real CLI checks private files, returns only digests, and performs no file mutation',t=>{
 const dir=mkdtempSync(join(tmpdir(),'staffology-preflight-cli-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const input=fixture(),paths={};for(const key of ['profile','state','actor','binding']){paths[key]=join(dir,key+'.json');writeFileSync(paths[key],JSON.stringify(input[key]),{mode:0o600});}paths.seal=join(dir,'source-seal');writeFileSync(paths.seal,input.sourceSha+'\n',{mode:0o600});
 const before=Object.fromEntries(Object.entries(paths).map(([k,p])=>[k,hash(readFileSync(p))]));
 const args=Object.entries(paths).flatMap(([key,path])=>['--'+key,path]),cli=resolve(__dirname,'staffology-payroll-proof-preflight.cjs');
 const result=spawnSync(process.execPath,[cli,...args],{encoding:'utf8',env:{...process.env,STAFFOLOGY_API_KEY:'UNREAD_AMBIENT_SECRET_SENTINEL'}});
 assert.equal(result.status,0,result.stderr);const output=JSON.parse(result.stdout);assert.equal(output.contractValid,true);assert.equal(output.authorizationGranted,false);assert.equal(output.proofEligible,false);
 for(const value of ['synthetic@example.invalid','provider-employee-001','PAY901','12.50','UNREAD_AMBIENT_SECRET_SENTINEL'])assert.ok(!result.stdout.includes(value));
 assert.deepEqual(Object.fromEntries(Object.entries(paths).map(([k,p])=>[k,hash(readFileSync(p))])),before);
 input.profile.payroll.expectedBasicPay='1250.00';writeFileSync(paths.profile,JSON.stringify(input.profile));const rejected=spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});assert.equal(rejected.status,1);assert.equal(JSON.parse(rejected.stdout).contractValid,false);
 const malformed=spawnSync(process.execPath,[cli,'--profile','SENTINEL_PRIVATE_PATH'],{encoding:'utf8'});assert.equal(malformed.status,1);assert.ok(!malformed.stdout.includes('SENTINEL_PRIVATE_PATH'));assert.ok(!malformed.stderr.includes('SENTINEL_PRIVATE_PATH'));assert.ok(!malformed.stderr.includes('Error:'));
});
