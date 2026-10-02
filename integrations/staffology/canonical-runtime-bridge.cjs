'use strict';

// Canonical assembly bridge. This module is copied beside the sealed application's
// existing integration modules; it does not replace its server, database or workers.
const {createHash}=require('node:crypto');
const Staffology=require('./staffology-adapter.cjs');

function fail(message,code='STAFFOLOGY_CANONICAL_INTEGRATION_BLOCKED',status=409){const error=Error(message);error.code=code;error.status=status;throw error;}
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';return JSON.stringify(value);}
function sha256(value){return createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');}
function id(value,label){if(typeof value!=='string'||!value.match(/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,119}$/))fail(`${label} is invalid.`);return value;}
function exact(value,label){if(typeof value!=='string'||!value||value!==value.trim()||/[\u0000-\u001f\u007f]/.test(value))fail(`${label} is invalid.`);return value;}
function cents(value,label){
 const raw=typeof value==='number'&&Number.isFinite(value)?String(value):value;
 if(typeof raw!=='string'||!/^\d{1,11}(?:\.\d{1,2})?$/.test(raw))fail(`${label} is not an exact non-negative monetary amount.`,'STAFFOLOGY_PAYROLL_TOTAL_MISMATCH');
 const [whole,fraction='']=raw.split('.');
 return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
}

function releasedBatch(state,{periodId,batchId,expectedChecksum}){
 const period=state?.payrollControl?.periods?.find(row=>row.id===periodId);
 if(!period)fail('The exact retained payroll period is unavailable.');
 const batch=period.batches?.find(row=>row.id===batchId);
 if(!batch||batch.status!=='released')fail('An unchanged released, unsent payroll batch is required.');
 if(typeof batch.checksum!=='string'||batch.checksum!==expectedChecksum)fail('Released payroll checksum does not match the reviewed mapping.');
 if(!Array.isArray(batch.lines)||!batch.lines.length)fail('Released payroll lines are unavailable.');
 const calculated=sha256(batch.csv||'');
 if(calculated!==batch.checksum)fail('Released payroll bytes no longer match their retained checksum.');
 return {period,batch};
}

function preparePayrollInput(state,approval){
 if(!approval||approval.approved!==true)fail('An explicit reviewed Staffology mapping is required.','STAFFOLOGY_MAPPING_AUTHORITY_REQUIRED',403);
 const {period,batch}=releasedBatch(state,{periodId:id(approval.periodId,'Payroll period'),batchId:id(approval.batchId,'Payroll batch'),expectedChecksum:exact(approval.batchChecksum,'Payroll checksum')});
 const employee=id(approval.employeeId,'VECTOR employee'),lines=batch.lines.filter(line=>line.employee===employee);
 if(lines.length!==1)fail('The approved basic-only integration requires exactly one retained employee line.','STAFFOLOGY_MAPPING_AUTHORITY_REQUIRED');
 const line=lines[0];
 if(line.code!=='WORKED_BASIC'||Number(line.allowance||0)!==0||line.grossPence===null)fail('Only one allowance-free WORKED_BASIC line is supported.','STAFFOLOGY_MAPPING_AUTHORITY_REQUIRED');
 if(line.payrollId!==approval.payrollCode)fail('Released payroll identity differs from the approved provider mapping.','STAFFOLOGY_MAPPING_AUTHORITY_REQUIRED');
 const effectiveDate=exact(approval.effectiveDate,'Effective date');
 if(effectiveDate<period.start||effectiveDate>period.end||line.date!==effectiveDate)fail('Approved effective date does not identify the released payroll line.','STAFFOLOGY_MAPPING_AUTHORITY_REQUIRED');
 const input={employerId:id(approval.employerId,'Staffology employer'),employeeId:id(approval.staffologyEmployeeId,'Staffology employee'),entryId:id(approval.entryId,'Staffology entry'),payrollCode:exact(approval.payrollCode,'Payroll code'),effectiveDate,tenant:id(approval.tenant,'Tenant'),batchId:batch.id,sourceRevision:`sha256:${batch.checksum}`,mode:'hourly-basic-replacement',rounding:approval.rounding,taxYear:approval.taxYear,payPeriod:approval.payPeriod,periodNumber:approval.periodNumber,ordinal:approval.ordinal,version:approval.version,lines:[{code:exact(approval.basicPayCode,'Approved basic pay code'),hours:exact(line.hours,'Released hours'),rate:exact(line.rate,'Released rate')}]};
 // Run the adapter's authoritative mapper now so unsupported decimals, rounding
 // or run coordinates fail before any durable intent can be created.
 const mapped=Staffology.mapPayroll(input);
 const expectedPence=cents(mapped.expectedBasicPay,'Mapped basic pay');
 if(!Number.isSafeInteger(line.grossPence)||BigInt(line.grossPence)!==expectedPence)
  fail('Released gross pence differs from approved hours multiplied by rate.','STAFFOLOGY_PAYROLL_TOTAL_MISMATCH');
 if(line.gross!==undefined&&line.gross!==null&&cents(line.gross,'Released gross')!==expectedPence)
  fail('Released gross differs from approved hours multiplied by rate.','STAFFOLOGY_PAYROLL_TOTAL_MISMATCH');
 return Object.freeze(input);
}

function peopleEnvelope(acquisition,receipt){
 if(acquisition?.objectType!=='people'||acquisition.paginationComplete!==true||acquisition.atomicProviderSnapshot!==false||!Array.isArray(acquisition.records)||!acquisition.records.length)fail('A complete bounded Staffology people acquisition is required.');
 if(receipt?.approved!==true||!Array.isArray(receipt.mappings))fail('Reviewed employee-import mappings are required.','STAFFOLOGY_EMPLOYEE_MAPPING_REQUIRED',403);
 const mappings=new Map(receipt.mappings.map(row=>[row?.externalId,row]));
 if(mappings.size!==receipt.mappings.length)fail('Employee-import mappings repeat an external identity.','STAFFOLOGY_EMPLOYEE_MAPPING_REQUIRED');
 const acquiredIds=new Set(acquisition.records.map(record=>record?.externalId));
 if(acquiredIds.has(undefined)||acquiredIds.size!==acquisition.records.length)fail('The acquired employee cohort repeats or omits an external identity.','STAFFOLOGY_EMPLOYEE_MAPPING_REQUIRED');
 if(acquiredIds.size!==mappings.size||[...acquiredIds].some(externalId=>!mappings.has(externalId))||[...mappings.keys()].some(externalId=>!acquiredIds.has(externalId)))
  fail('Employee-import mappings must identify the exact acquired cohort once each.','STAFFOLOGY_EMPLOYEE_MAPPING_REQUIRED');
 const records=acquisition.records.map(record=>{const mapping=mappings.get(record.externalId),identity=record.data?.identity,person=record.data?.person,employment=record.data?.employment;if(!mapping||identity?.employeeId!==record.externalId||mapping.payrollId!==identity?.payrollCode)fail('Every acquired employee needs an exact reviewed payroll and workforce mapping.','STAFFOLOGY_EMPLOYEE_MAPPING_REQUIRED');const former=employment?.status==='Former'||Boolean(employment?.effectiveTo),data={source_id:record.externalId,payroll_id:mapping.payrollId,name:`${person?.firstName||''} ${person?.lastName||''}`.trim(),email:person?.email||'',manager_id:mapping.managerId,site:mapping.site,job:mapping.job,start_date:employment?.effectiveFrom,contract_type:mapping.contractType,weekly_hours:mapping.weeklyHours,language:mapping.language||'en-GB',skills:Array.isArray(mapping.skills)?mapping.skills.join('|'):''};if(former){data.employment_status='Former';data.employment_end_date=exact(employment?.effectiveTo,'Former employee end date');}return {externalId:record.externalId,revision:record.revision,operation:former?'delete':record.operation,data};});
 if(mappings.size!==records.length)fail('Employee-import mappings contain identities outside the acquired cohort.','STAFFOLOGY_EMPLOYEE_MAPPING_REQUIRED');
 return Object.freeze({objectType:'people',cursor:acquisition.cursor,sourceVersion:acquisition.sourceVersion,records});
}

function assertPeopleApplicationRecord(record){
 if(record?.operation==='delete'||record?.data?.employment_status==='Former'||record?.data?.employment_end_date)fail(`Former employee ${record?.externalId||'identity unavailable'} ended ${record?.data?.employment_end_date||'on an unavailable date'} and requires the reviewed employee-change lifecycle workflow; onboarding must not reactivate them.`,'STAFFOLOGY_EMPLOYEE_LIFECYCLE_REQUIRED');
 return record;
}

function createRuntime({loadState,stagePeople=null,assertStagePeople=null,productionBoundaries=null}={}){
 if(typeof loadState!=='function')fail('Canonical payroll state loader is required.','STAFFOLOGY_CANONICAL_CONFIGURATION_INVALID',503);
 return Object.freeze({
  status(){const boundaryStatus=productionBoundaries?.status?.()||{productionDatabase:false,durableOneShotAuthority:false};return {...boundaryStatus,configured:Boolean(boundaryStatus.productionDatabase&&boundaryStatus.durableOneShotAuthority),activationAvailable:false,employeeImport:'reviewed-staging-only',payrollImport:'approval-required',claimBoundary:'Canonical store and authority are assembled but no provider route, client, credentials or worker is activated.'};},
  assertEmployeeStaging(actor,receipt){if(typeof assertStagePeople!=='function')return true;assertStagePeople(actor,receipt);return true;},
  employeeMappingOptions(actor){if(!actor?.tenant||!(actor.permissions||[]).includes('company.configure'))fail('Current company configuration permission is required.','STAFFOLOGY_WRITE_NOT_AUTHORIZED',403);const state=loadState(actor.tenant),unique=values=>[...new Set(values.filter(value=>value!==undefined&&value!==null&&String(value).trim()).map(value=>String(value).trim()))].sort(),contracts=Object.values(state?.workRules?.contracts||{}).flat();return {managers:(state?.org||[]).filter(row=>row?.id&&row?.name).map(row=>({id:row.id,name:row.name})),sites:unique((state?.staff||[]).map(row=>row.site)),jobs:unique([...(state?.workRules?.jobs||[]).map(row=>row.name),...(state?.staff||[]).map(row=>row.job)]),contractTypes:unique(contracts.map(row=>row.type)),weeklyHours:unique(contracts.map(row=>row.weeklyHours))};},
  assertEmployeeMappings(actor,mappings){const options=this.employeeMappingOptions(actor),allowed=(values,value)=>values.some(item=>String(item)===String(value));if(!Array.isArray(mappings)||mappings.some(row=>!row||!options.managers.some(item=>item.id===row.managerId)||!allowed(options.sites,row.site)||!allowed(options.jobs,row.job)||!allowed(options.contractTypes,row.contractType)||!allowed(options.weeklyHours,row.weeklyHours)))fail('Employee mapping is outside the current canonical manager, site, job, contract or weekly-hours options.','STAFFOLOGY_EMPLOYEE_MAPPING_REQUIRED',403);return true;},
  stageEmployeeAcquisition(actor,acquisition,receipt){if(typeof stagePeople!=='function')fail('Canonical employee staging boundary is unavailable.','STAFFOLOGY_EMPLOYEE_IMPORT_NOT_WIRED',503);const envelope=peopleEnvelope(acquisition,receipt),former=envelope.records.filter(row=>row.operation==='delete'),full=stagePeople(actor,envelope,receipt);if(!former.length)return full;const eligible=envelope.records.filter(row=>row.operation!=='delete'),lifecycleHold=Object.freeze({batchId:full.id,held:former.length,employeeIds:Object.freeze(former.map(row=>row.externalId))});if(!eligible.length)return {...full,lifecycleHold};const eligibleReceipt={...receipt,idempotencyKey:`staffology-current-${sha256(receipt.idempotencyKey).slice(0,24)}`},staged=stagePeople(actor,{...envelope,records:eligible},eligibleReceipt);return {...staged,lifecycleHold};},
  preparePayroll(actor,approval){if(!actor?.tenant||actor.tenant!==approval?.tenant||!(actor.permissions||[]).includes('payroll.export'))fail('Current payroll release permission is required.','STAFFOLOGY_WRITE_NOT_AUTHORIZED',403);return preparePayrollInput(loadState(actor.tenant),approval);},
  coordinator(options){if(typeof productionBoundaries?.coordinator!=='function')fail('Production Staffology store and authority are not assembled.','STAFFOLOGY_PRODUCTION_STORE_REQUIRED',503);return productionBoundaries.coordinator(options);}
 });
}

module.exports={createRuntime,releasedBatch,preparePayrollInput,peopleEnvelope,assertPeopleApplicationRecord,sha256};
