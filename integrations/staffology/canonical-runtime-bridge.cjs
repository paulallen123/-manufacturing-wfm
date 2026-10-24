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

function payrollLineIdentity(line){
 if(!line||typeof line!=='object')fail('Released payroll line is invalid.','STAFFOLOGY_BATCH_COMPONENT_UNSUPPORTED');
 const identity={
  employee:id(line.employee,'VECTOR employee'),
  payrollId:exact(line.payrollId,'Released payroll identity'),
  date:exact(line.date,'Released payroll date'),
  code:exact(line.code,'Released payroll component'),
  minutes:Number(line.minutes),
  hours:String(line.hours??''),
  rate:String(line.rate??''),
  grossPence:Number(line.grossPence),
  allowance:Number(line.allowance||0)
 };
 if(!Number.isSafeInteger(identity.minutes)||identity.minutes<0||!Number.isSafeInteger(identity.grossPence)||identity.grossPence<0)
  fail('Released payroll line totals are invalid.','STAFFOLOGY_PAYROLL_TOTAL_MISMATCH');
 return Object.freeze({...identity,digest:sha256(identity)});
}

function releasedBatchManifest(state,{periodId,batchId,batchChecksum,expectedChecksum=batchChecksum,mappings=[]}){
 const {period,batch}=releasedBatch(state,{periodId,batchId,expectedChecksum});
 if(!Array.isArray(mappings))fail('Released payroll batch mappings are invalid.','STAFFOLOGY_BATCH_COMPONENT_UNSUPPORTED');
 const declared=new Map();
 for(const item of mappings){
  if(!item||typeof item!=='object'||Array.isArray(item)||!['mapped','unsupported'].includes(item.status))
   fail('Every released payroll line must be mapped or explicitly unsupported.','STAFFOLOGY_BATCH_COMPONENT_UNSUPPORTED');
  const lineDigest=exact(item.lineDigest,'Released line digest');
  if(!/^[a-f0-9]{64}$/.test(lineDigest)||declared.has(lineDigest))fail('Released payroll line manifest is invalid.','STAFFOLOGY_BATCH_COMPONENT_UNSUPPORTED');
  declared.set(lineDigest,item);
 }
 const lines=batch.lines.map(payrollLineIdentity),unsupported=[],mapped=[];
 for(const line of lines){
  const item=declared.get(line.digest);
  if(!item){unsupported.push({lineDigest:line.digest,code:line.code,reason:'UNMAPPED_RELEASED_COMPONENT'});continue;}
  if(item.status==='unsupported'){unsupported.push({lineDigest:line.digest,code:line.code,reason:exact(item.reason,'Unsupported component reason')});continue;}
  if(line.code!=='WORKED_BASIC'||line.allowance!==0)unsupported.push({lineDigest:line.digest,code:line.code,reason:'STAFFOLOGY_BATCH_COMPONENT_UNSUPPORTED'});
  else mapped.push({lineDigest:line.digest,line,mapping:item});
 }
 if(declared.size!==lines.length)
  fail('Every released payroll line must be explicitly classified in the immutable batch manifest.','STAFFOLOGY_BATCH_COMPONENT_UNSUPPORTED');
 const grossPence=lines.reduce((n,line)=>n+line.grossPence,0);
 return Object.freeze({period,batch,manifest:Object.freeze({
  schemaVersion:1,batchId:batch.id,batchChecksum:batch.checksum,expectedLineCount:lines.length,
  mappedLineCount:mapped.length,unsupportedLineCount:unsupported.length,grossPence,
  lineDigests:Object.freeze(lines.map(line=>line.digest).sort()),manifestDigest:sha256({batchId:batch.id,batchChecksum:batch.checksum,lines:lines.map(line=>line.digest).sort()})
 })});
}

function preparePayrollInput(state,approval){
 if(!approval||approval.approved!==true)fail('An explicit reviewed Staffology mapping is required.','STAFFOLOGY_MAPPING_AUTHORITY_REQUIRED',403);
 const {period,batch}=releasedBatch(state,{periodId:id(approval.periodId,'Payroll period'),batchId:id(approval.batchId,'Payroll batch'),expectedChecksum:exact(approval.batchChecksum,'Payroll checksum')});
 const employee=id(approval.employeeId,'VECTOR employee');
 const staff=(state?.staff||[]).filter(row=>row&&row.id===employee&&row.sourceId===approval.staffologyEmployeeId&&row.payrollId===approval.payrollCode&&row.onboardingReady===true);
 if(staff.length!==1)fail('Payroll identity is not linked to one active, source-bound, onboarding-ready VECTOR staff row.','STAFFOLOGY_PAYROLL_IDENTITY_NOT_READY',409);
 const lines=batch.lines.filter(line=>line.employee===employee);
 if(lines.length!==1)fail('The approved basic-only integration requires exactly one retained employee line.','STAFFOLOGY_MAPPING_AUTHORITY_REQUIRED');
 const line=lines[0];
 if(line.code!=='WORKED_BASIC'||Number(line.allowance||0)!==0||line.grossPence===null)fail('Only one allowance-free WORKED_BASIC line is supported.','STAFFOLOGY_MAPPING_AUTHORITY_REQUIRED');
 if(line.payrollId!==approval.payrollCode)fail('Released payroll identity differs from the approved provider mapping.','STAFFOLOGY_MAPPING_AUTHORITY_REQUIRED');
 const effectiveDate=exact(approval.effectiveDate,'Effective date');
 if(effectiveDate<period.start||effectiveDate>period.end||line.date!==effectiveDate)fail('Approved effective date does not identify the released payroll line.','STAFFOLOGY_MAPPING_AUTHORITY_REQUIRED');
 const payCodeDefinitionSha256=exact(approval.payCodeDefinitionSha256,'Pay-code definition digest');if(!/^[a-f0-9]{64}$/.test(payCodeDefinitionSha256))fail('A current Staffology pay-code semantic digest is required.','STAFFOLOGY_MAPPING_AUTHORITY_REQUIRED',403);
 const releasedLineIdentity=payrollLineIdentity(line);
 const input={employerId:id(approval.employerId,'Staffology employer'),employeeId:id(approval.staffologyEmployeeId,'Staffology employee'),entryId:id(approval.entryId,'Staffology entry'),payrollCode:exact(approval.payrollCode,'Payroll code'),effectiveDate,tenant:id(approval.tenant,'Tenant'),batchId:batch.id,sourceRevision:`sha256:${batch.checksum}`,sourceLineDigest:releasedLineIdentity.digest,mode:'hourly-basic-replacement',rounding:approval.rounding,taxYear:approval.taxYear,payPeriod:approval.payPeriod,periodNumber:approval.periodNumber,ordinal:approval.ordinal,version:approval.version,payCodeDefinitionSha256,lines:[{code:exact(approval.basicPayCode,'Approved basic pay code'),hours:exact(line.hours,'Released hours'),rate:exact(line.rate,'Released rate')}]};
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

function reviewedEmail(value){if(value===undefined||value==='')return '';if(typeof value!=='string'||value.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))fail('Reviewed VECTOR email is invalid.','STAFFOLOGY_EMPLOYEE_MAPPING_REQUIRED',403);return value;}

function peopleEnvelope(acquisition,receipt){
 if(acquisition?.objectType!=='people'||acquisition.paginationComplete!==true||acquisition.atomicProviderSnapshot!==false||!Array.isArray(acquisition.records)||!acquisition.records.length)fail('A complete bounded Staffology people acquisition is required.');
 if(receipt?.approved!==true||!Array.isArray(receipt.mappings))fail('Reviewed employee-import mappings are required.','STAFFOLOGY_EMPLOYEE_MAPPING_REQUIRED',403);
 const mappings=new Map(receipt.mappings.map(row=>[row?.externalId,row]));
 if(mappings.size!==receipt.mappings.length)fail('Employee-import mappings repeat an external identity.','STAFFOLOGY_EMPLOYEE_MAPPING_REQUIRED');
 const acquiredIds=new Set(acquisition.records.map(record=>record?.externalId));
 if(acquiredIds.has(undefined)||acquiredIds.size!==acquisition.records.length)fail('The acquired employee cohort repeats or omits an external identity.','STAFFOLOGY_EMPLOYEE_MAPPING_REQUIRED');
 if(acquiredIds.size!==mappings.size||[...acquiredIds].some(externalId=>!mappings.has(externalId))||[...mappings.keys()].some(externalId=>!acquiredIds.has(externalId)))
  fail('Employee-import mappings must identify the exact acquired cohort once each.','STAFFOLOGY_EMPLOYEE_MAPPING_REQUIRED');
 const records=acquisition.records.map(record=>{
  const mapping=mappings.get(record.externalId),identity=record.data?.identity,person=record.data?.person,employment=record.data?.employment;
  if(!mapping||identity?.employeeId!==record.externalId||mapping.payrollId!==identity?.payrollCode)fail('Every acquired employee needs an exact reviewed payroll and workforce mapping.','STAFFOLOGY_EMPLOYEE_MAPPING_REQUIRED');
  const providedEmail=reviewedEmail(mapping.email),sourceEmail=person?.email||'';
  if(providedEmail&&sourceEmail&&providedEmail.toLowerCase()!==sourceEmail.toLowerCase())fail('Reviewed VECTOR email cannot replace the existing provider email.','STAFFOLOGY_EMPLOYEE_MAPPING_REQUIRED',403);
  const status=employment?.status??null,hasLeft=employment?.hasLeft??null,effectiveTo=employment?.effectiveTo??null;
  if(status!==null&&!['Current','Former','Upcoming'].includes(status))fail('Employee lifecycle status is invalid.','STAFFOLOGY_EMPLOYEE_LIFECYCLE_UNRESOLVED');
  if(hasLeft!==null&&typeof hasLeft!=='boolean')fail('Employee leaver status is invalid.','STAFFOLOGY_EMPLOYEE_LIFECYCLE_UNRESOLVED');
  if((['Current','Upcoming'].includes(status)&&hasLeft===true)||(status==='Former'&&hasLeft===false))
   fail('Employee status contradicts the provider leaver status.','STAFFOLOGY_EMPLOYEE_LIFECYCLE_UNRESOLVED');
  if(effectiveTo&&['Current','Upcoming'].includes(status)&&hasLeft===null)
   fail('An employee end date requires explicit provider leaver status.','STAFFOLOGY_EMPLOYEE_LIFECYCLE_UNRESOLVED');
  const former=status==='Former'||hasLeft===true;
  if(former&&!effectiveTo)fail('A provider-confirmed former employee requires an end date.','STAFFOLOGY_EMPLOYEE_LIFECYCLE_UNRESOLVED');
  const data={source_id:record.externalId,payroll_id:mapping.payrollId,name:`${person?.firstName||''} ${person?.lastName||''}`.trim(),email:sourceEmail||providedEmail,manager_id:mapping.managerId,site:mapping.site,job:mapping.job,start_date:employment?.effectiveFrom,contract_type:mapping.contractType,weekly_hours:mapping.weeklyHours,language:mapping.language||'en-GB',skills:Array.isArray(mapping.skills)?mapping.skills.join('|'):''};
  if(!sourceEmail&&providedEmail)data.email_mapping_origin='reviewed-vector-mapping';
  if(former){data.employment_status='Former';data.employment_end_date=exact(effectiveTo,'Former employee end date');}
  return {externalId:record.externalId,revision:record.revision,operation:former?'delete':record.operation,data};
 });
 if(mappings.size!==records.length)fail('Employee-import mappings contain identities outside the acquired cohort.','STAFFOLOGY_EMPLOYEE_MAPPING_REQUIRED');
 return Object.freeze({objectType:'people',cursor:acquisition.cursor,sourceVersion:acquisition.sourceVersion,records});
}

function assertPeopleApplicationRecord(record){
 if(record?.operation==='delete'||record?.data?.employment_status==='Former'||record?.data?.employment_end_date)fail(`Former employee ${record?.externalId||'identity unavailable'} ended ${record?.data?.employment_end_date||'on an unavailable date'} and requires the reviewed employee-change lifecycle workflow; onboarding must not reactivate them.`,'STAFFOLOGY_EMPLOYEE_LIFECYCLE_REQUIRED');
 return record;
}

const CONFIGURATION_BINDING_FIELDS=['tenant','runId','configurationDigest','scopeChangeEventId'];
function configurationBinding(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||
  ['tenant','runId','configurationDigest'].some(key=>typeof value[key]!=='string'||!value[key]||value[key]!==value[key].trim()||/[\u0000-\u001f\u007f]/.test(value[key]))||
  !Number.isSafeInteger(value.scopeChangeEventId)||value.scopeChangeEventId<0)
  fail('Current configured-site authority is unavailable.','STAFFOLOGY_CONFIGURED_SITE_AUTHORITY_REQUIRED',503);
 return Object.freeze(Object.fromEntries(CONFIGURATION_BINDING_FIELDS.map(key=>[key,value[key]])));
}
function sameConfigurationBinding(expected,actual){
 return expected&&typeof expected==='object'&&!Array.isArray(expected)&&CONFIGURATION_BINDING_FIELDS.every(key=>expected[key]===actual[key]);
}
// Copy data descriptors before callbacks; validation and the envelope share the
// same frozen values without evaluating receipt or mapping accessors.
function employeeDataSnapshot(value,ancestors=new Set(),depth=0){
 if(value===null||['string','boolean','undefined'].includes(typeof value)||(typeof value==='number'&&Number.isFinite(value)))return value;
 const array=Array.isArray(value);
 if(!value||typeof value!=='object'||depth>64||ancestors.has(value)||Object.getPrototypeOf(value)!==(array?Array.prototype:Object.prototype))
  fail('Employee mapping receipt must contain only plain data.','STAFFOLOGY_EMPLOYEE_MAPPING_REQUIRED',403);
 const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors).filter(key=>!array||key!=='length'),snapshot=array?[]:{};
 if(array&&keys.length!==descriptors.length.value)
  fail('Employee mapping arrays must be dense plain data.','STAFFOLOGY_EMPLOYEE_MAPPING_REQUIRED',403);
 ancestors.add(value);
 for(const key of keys){
  const descriptor=descriptors[key];
  if(typeof key!=='string'||!descriptor.enumerable||!Object.hasOwn(descriptor,'value')||(array&&(!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=descriptors.length.value)))
   fail('Employee mapping receipt accessors or non-data fields are not allowed.','STAFFOLOGY_EMPLOYEE_MAPPING_REQUIRED',403);
  Object.defineProperty(snapshot,key,{value:employeeDataSnapshot(descriptor.value,ancestors,depth+1),enumerable:true,writable:true,configurable:true});
 }
 ancestors.delete(value);
 return Object.freeze(snapshot);
}

function createRuntime(options={}){
 // Inspect declarations before evaluating any constructor accessors. Inherited
 // or accessor callbacks must not erase opt-in or silently select the legacy lane.
 const callbackDescriptors=['configuredSitesForTenant','configurationContextForTenant'].map(key=>{
  const descriptor=Object.getOwnPropertyDescriptor(options,key);
  if((!descriptor&&key in options)||(descriptor&&!Object.hasOwn(descriptor,'value')))
   fail('Configured-site callbacks must be own data properties.','STAFFOLOGY_CONFIGURED_SITE_AUTHORITY_REQUIRED',503);
  return descriptor;
 });
 const [configuredSitesForTenant,configurationContextForTenant]=callbackDescriptors.map(descriptor=>descriptor?.value);
 const {loadState,stagePeople=null,assertStagePeople=null,productionBoundaries=null}=options;
 if(typeof loadState!=='function')fail('Canonical payroll state loader is required.','STAFFOLOGY_CANONICAL_CONFIGURATION_INVALID',503);
 // Opt-in server assembly only. A partially wired lane must never fall back to staff.
 const configuredSiteLane=callbackDescriptors.some(Boolean);
 function currentConfigurationBinding(tenant){
  const context=configurationContextForTenant({tenant}),binding=configurationBinding(context);
  if(context.applied!==true||binding.tenant!==tenant)
   fail('Current tenant configuration is not applied.','STAFFOLOGY_CONFIGURED_SITE_AUTHORITY_REQUIRED',503);
  return binding;
 }
 function configuredSiteSnapshot(tenant){
  if(typeof configuredSitesForTenant!=='function'||typeof configurationContextForTenant!=='function')
   fail('Both configured-site authority callbacks are required.','STAFFOLOGY_CONFIGURED_SITE_AUTHORITY_REQUIRED',503);
  const binding=currentConfigurationBinding(tenant);
  const snapshot=configuredSitesForTenant({tenant}),siteBinding=configurationBinding(snapshot);
  if(!sameConfigurationBinding(siteBinding,binding))
   fail('Configured sites differ from the current tenant configuration.','STAFFOLOGY_CONFIGURED_SITE_BINDING_MISMATCH');
  if(!Array.isArray(snapshot.siteLabels)||!snapshot.siteLabels.length)
   fail('Exact configured site labels are unavailable.','STAFFOLOGY_CONFIGURED_SITE_AUTHORITY_REQUIRED',503);
  const sites=[...snapshot.siteLabels];
  if(sites.some(label=>typeof label!=='string'||!label||label!==label.trim()||/[\u0000-\u001f\u007f]/.test(label))||new Set(sites).size!==sites.length)
   fail('Configured site labels are invalid or ambiguous.','STAFFOLOGY_CONFIGURED_SITE_AUTHORITY_REQUIRED',503);
  if(!sameConfigurationBinding(binding,currentConfigurationBinding(tenant)))
   fail('Configured-site authority changed while reading its snapshot.','STAFFOLOGY_CONFIGURED_SITE_BINDING_MISMATCH');
  return Object.freeze({configurationBinding:binding,sites:Object.freeze(sites)});
 }
 function assertMappings(runtime,actor,mappings,reviewedConfigurationBinding){const options=runtime.employeeMappingOptions(actor),allowed=(values,value)=>values.some(item=>String(item)===String(value));if(configuredSiteLane&&!sameConfigurationBinding(reviewedConfigurationBinding,options.configurationBinding))fail('Reviewed configured-site preview is missing or stale.','STAFFOLOGY_CONFIGURED_SITE_BINDING_MISMATCH');if(!Array.isArray(mappings)||mappings.some(row=>!row||!options.managers.some(item=>item.id===row.managerId)||!(configuredSiteLane?options.sites.includes(row.site):allowed(options.sites,row.site))||!allowed(options.jobs,row.job)||!allowed(options.contractTypes,row.contractType)||!allowed(options.weeklyHours,row.weeklyHours)))fail('Employee mapping is outside the current canonical manager, site, job, contract or weekly-hours options.','STAFFOLOGY_EMPLOYEE_MAPPING_REQUIRED',403);for(const row of mappings)reviewedEmail(row.email);return true;}
 return Object.freeze({
  status(){const boundaryStatus=productionBoundaries?.status?.()||{productionDatabase:false,durableOneShotAuthority:false};return {...boundaryStatus,configured:Boolean(boundaryStatus.productionDatabase&&boundaryStatus.durableOneShotAuthority),activationAvailable:false,employeeImport:'reviewed-staging-only',payrollImport:'approval-required',claimBoundary:'Canonical store and authority are assembled but no provider route, client, credentials or worker is activated.'};},
  assertEmployeeStaging(actor,receipt){if(typeof assertStagePeople!=='function')return true;assertStagePeople(actor,receipt);return true;},
  employeeMappingOptions(actor){if(!actor?.tenant||!(actor.permissions||[]).includes('company.configure'))fail('Current company configuration permission is required.','STAFFOLOGY_WRITE_NOT_AUTHORIZED',403);const state=loadState(actor.tenant),unique=values=>[...new Set(values.filter(value=>value!==undefined&&value!==null&&String(value).trim()).map(value=>String(value).trim()))].sort(),contracts=Object.values(state?.workRules?.contracts||{}).flat(),configured=configuredSiteLane?configuredSiteSnapshot(actor.tenant):null;return {managers:(state?.org||[]).filter(row=>row?.id&&row?.name).map(row=>({id:row.id,name:row.name})),sites:configured?configured.sites:unique((state?.staff||[]).map(row=>row.site)),...(configured?{configurationBinding:configured.configurationBinding}:{}),jobs:unique([...(state?.workRules?.jobs||[]).map(row=>row.name),...(state?.staff||[]).map(row=>row.job)]),contractTypes:unique(contracts.map(row=>row.type)),weeklyHours:unique(contracts.map(row=>row.weeklyHours))};},
  // The reviewed binding is a comparison precondition, never an authority source.
  // The owner must retrieve it from an authenticated stored preview receipt.
  assertEmployeeMappings(actor,mappings,reviewedConfigurationBinding){return assertMappings(this,actor,configuredSiteLane?employeeDataSnapshot(mappings):mappings,reviewedConfigurationBinding);},
  stageEmployeeAcquisition(actor,acquisition,receipt,reviewedConfigurationBinding){if(typeof stagePeople!=='function')fail('Canonical employee staging boundary is unavailable.','STAFFOLOGY_EMPLOYEE_IMPORT_NOT_WIRED',503);if(configuredSiteLane)receipt=employeeDataSnapshot(receipt);const stage=(envelope,stagingReceipt)=>{if(configuredSiteLane){this.assertEmployeeStaging(actor,stagingReceipt);assertMappings(this,actor,receipt.mappings,reviewedConfigurationBinding);}return stagePeople(actor,envelope,stagingReceipt);},envelope=peopleEnvelope(acquisition,receipt),former=envelope.records.filter(row=>row.operation==='delete'),full=stage(envelope,receipt);if(!former.length)return full;const eligible=envelope.records.filter(row=>row.operation!=='delete'),lifecycleHold=Object.freeze({batchId:full.id,held:former.length,employeeIds:Object.freeze(former.map(row=>row.externalId))});if(!eligible.length)return {...full,lifecycleHold};const eligibleReceipt={...receipt,idempotencyKey:`staffology-current-${sha256(receipt.idempotencyKey).slice(0,24)}`},staged=stage({...envelope,records:eligible},configuredSiteLane?Object.freeze(eligibleReceipt):eligibleReceipt);return {...staged,lifecycleHold};},
  preparePayroll(actor,approval){if(!actor?.tenant||actor.tenant!==approval?.tenant||!(actor.permissions||[]).includes('payroll.export'))fail('Current payroll release permission is required.','STAFFOLOGY_WRITE_NOT_AUTHORIZED',403);return preparePayrollInput(loadState(actor.tenant),approval);},
  prepareBatchManifest(actor,manifest){if(!actor?.tenant||!(actor.permissions||[]).includes('payroll.export'))fail('Current payroll release permission is required.','STAFFOLOGY_WRITE_NOT_AUTHORIZED',403);return releasedBatchManifest(loadState(actor.tenant),manifest);},
  payrollLineIdentity(row){return payrollLineIdentity(row);},
  coordinator(options){if(typeof productionBoundaries?.coordinator!=='function')fail('Production Staffology store and authority are not assembled.','STAFFOLOGY_PRODUCTION_STORE_REQUIRED',503);return productionBoundaries.coordinator(options);}
 });
}

module.exports={createRuntime,releasedBatch,releasedBatchManifest,payrollLineIdentity,preparePayrollInput,peopleEnvelope,assertPeopleApplicationRecord,sha256};
