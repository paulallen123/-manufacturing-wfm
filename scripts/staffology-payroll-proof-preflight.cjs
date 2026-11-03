'use strict';

// Offline comparison only. Never construct a coordinator, authority, database,
// provider client or operation, and never consume the ambient API key.
const {createHash}=require('node:crypto');
const {readFileSync,statSync}=require('node:fs');
const Operations=require('../integrations/staffology/canonical-operations.cjs');
const Bridge=require('../integrations/staffology/canonical-runtime-bridge.cjs');
const Adapter=require('../integrations/staffology/staffology-adapter.cjs');
const {exactBinding}=require('../integrations/staffology/canonical-production-boundaries.cjs');

const PROFILE_FIELDS=['tenant','implementationRunId','candidateSha','deploymentId','configurationId','employerId','employeeIds','payroll','batchManifest','connector','timeoutMs','pageSize','maxPages','approvalTtlMs'];
const REQUIRED_EXTERNAL_EVIDENCE=Object.freeze([
 'CURRENT_APPROVED_NONPRODUCTION_OPERATION',
 'CURRENT_AUTHENTICATED_PRINCIPAL_AND_ONE_SHOT_RUNTIME_APPROVAL',
 'EXACT_RELEASE_IMAGE_SECURITY_AND_RECOVERY_ADMISSION',
 'CURRENT_PROVIDER_EMPLOYER_COHORT_OPEN_RUN_AND_PAY_CODE_EVIDENCE',
 'VECTOR_DISPATCH_PROVIDER_ACCEPTANCE_AND_INDEPENDENT_DURABLE_READBACK',
 'INTENDED_ROLE_CUSTOMER_JOURNEY_REFRESH_FRESH_LOGIN_AND_AUDIT'
]);
const MODULES={
 operations:require.resolve('../integrations/staffology/canonical-operations.cjs'),
 bridge:require.resolve('../integrations/staffology/canonical-runtime-bridge.cjs'),
 adapter:require.resolve('../integrations/staffology/staffology-adapter.cjs'),
 boundaries:require.resolve('../integrations/staffology/canonical-production-boundaries.cjs')
};
function fail(code){const error=Error(code);error.code=code;throw error;}
function sha256(value){return createHash('sha256').update(value).digest('hex');}
function baseResult(){return {
 schemaVersion:1,contractValid:false,authorizationGranted:false,proofEligible:false,
 providerRequestsPerformed:false,credentialReadinessVerified:false,
 currentPrincipalAuthorityVerified:false,inputProvenanceVerified:false,
 claimBoundary:'Offline input consistency only; NOT AUTHORIZATION or provider/customer proof.',
 blockerCodes:[],requiredExternalEvidence:[...REQUIRED_EXTERNAL_EVIDENCE]
};}
function safeCode(error){return typeof error?.code==='string'&&/^STAFFOLOGY_[A-Z0-9_]+$/.test(error.code)?error.code:'STAFFOLOGY_PREFLIGHT_INPUT_INVALID';}

function validatePayrollProofInputs({profile:rawProfile,state,actor,binding:observedBinding,sourceSha}={}){
 const result=baseResult();
 try{
  if(typeof sourceSha!=='string'||!/^[a-f0-9]{40}$/.test(sourceSha)||observedBinding?.candidateSha!==sourceSha)
   fail('STAFFOLOGY_PREFLIGHT_SOURCE_MISMATCH');
  const binding=exactBinding(observedBinding);
  if(rawProfile===null||rawProfile===undefined)fail('STAFFOLOGY_PAYROLL_DORMANT');
  if(typeof rawProfile!=='object'||Array.isArray(rawProfile)||Object.keys(rawProfile).some(key=>!PROFILE_FIELDS.includes(key)))
   fail('STAFFOLOGY_PREFLIGHT_PROFILE_FIELDS_INVALID');
  // This constant satisfies the EXISTING pure parser's credential-shape check.
  // It is deliberately not a usable credential. No credential readiness is claimed.
  const profile=Operations.loadConfiguration({
   WFM_STAFFOLOGY_OPERATION_JSON:JSON.stringify(rawProfile),
   STAFFOLOGY_API_KEY:'offline-structure-check-only',WFM_BUILD_SOURCE_SHA:sourceSha,
   WFM_HOSTED_STAGING:rawProfile.deploymentId===undefined?'true':'false',
   RAILWAY_DEPLOYMENT_ID:binding.deploymentId
  },{readSeal:()=>sourceSha});
  if(Adapter.canonical(profile.binding)!==Adapter.canonical(binding))fail('STAFFOLOGY_PREFLIGHT_BINDING_MISMATCH');
  if(!profile.payroll||!profile.batchManifest)fail('STAFFOLOGY_PAYROLL_DORMANT');
  if(!actor?.email||actor.tenant!==binding.tenant||!Array.isArray(actor.permissions)||!['payroll.export','company.configure'].every(permission=>actor.permissions.includes(permission)))
   fail('STAFFOLOGY_WRITE_NOT_AUTHORIZED');
  // The canonical bridge's approved:true means a reviewed mapping comparison.
  // This preparation never reaches the durable approval issuer or dispatch path.
  const runtime=Bridge.createRuntime({loadState:()=>state});
  const prepared=runtime.prepareBatchManifest(actor,{
   periodId:profile.batchManifest.periodId,batchId:profile.batchManifest.batchId,
   batchChecksum:profile.batchManifest.batchChecksum,mappings:profile.batchManifest.lines
  });
  if(prepared.manifest.unsupportedLineCount!==0||prepared.manifest.mappedLineCount!==prepared.manifest.expectedLineCount)
   fail('STAFFOLOGY_BATCH_COMPONENT_UNSUPPORTED');
  const deliveryIds=new Set();
  for(const line of profile.batchManifest.lines){
   if(line.status!=='mapped')fail('STAFFOLOGY_BATCH_COMPONENT_UNSUPPORTED');
   const expected=line.approval;
   const approval=Object.fromEntries(Operations.APPROVAL_FIELDS.map(key=>[key,expected[key]]));
   const payroll=runtime.preparePayroll(actor,{approved:true,...approval});
   const payload=Adapter.mapPayroll({...payroll,...binding});
   if(payload.source?.sourceLineDigest!==line.lineDigest||payload.employeeId!==expected.staffologyEmployeeId||
      payload.payrollCode!==expected.payrollCode||payload.entryId!==expected.entryId||
      payload.payCodeDefinitionSha256!==expected.payCodeDefinitionSha256||
      payload.basic.hours!==expected.expectedHours||payload.basic.rate!==expected.expectedRate||
      payload.expectedBasicPay!==expected.expectedBasicPay)
    fail('STAFFOLOGY_PAYROLL_SCOPE_MISMATCH');
   const deliveryId=Adapter.businessKey(payload);
   if(deliveryIds.has(deliveryId))fail('STAFFOLOGY_BATCH_COMPONENT_UNSUPPORTED');
   deliveryIds.add(deliveryId);
  }
  return {...result,contractValid:true,sourceSha,
   moduleSha256:Object.fromEntries(Object.entries(MODULES).map(([name,path])=>[name,sha256(readFileSync(path))])),
   profileSha256:Adapter.sha256(rawProfile),stateSha256:Adapter.sha256(state),
   manifestDigest:prepared.manifest.manifestDigest,lineCount:prepared.manifest.expectedLineCount};
 }catch(error){return {...result,blockerCodes:[safeCode(error)]};}
}

function boundedRead(path){if(statSync(path).size>32*1024*1024)fail('STAFFOLOGY_PREFLIGHT_INPUT_TOO_LARGE');return readFileSync(path,'utf8');}
function main(args){
 try{
  const names=['profile','state','actor','binding','seal'],paths={};
  if(args.length!==names.length*2)fail('STAFFOLOGY_PREFLIGHT_ARGUMENTS_INVALID');
  for(let i=0;i<args.length;i+=2){const name=args[i]?.replace(/^--/,'');if(args[i]!==`--${name}`||!names.includes(name)||Object.hasOwn(paths,name)||!args[i+1])fail('STAFFOLOGY_PREFLIGHT_ARGUMENTS_INVALID');paths[name]=args[i+1];}
  const input=Object.fromEntries(names.filter(name=>name!=='seal').map(name=>[name,JSON.parse(boundedRead(paths[name]))]));
  const seal=boundedRead(paths.seal);if(!/^[a-f0-9]{40}\n?$/.test(seal))fail('STAFFOLOGY_PREFLIGHT_SOURCE_MISMATCH');
  return validatePayrollProofInputs({...input,sourceSha:seal.trim()});
 }catch(error){return {...baseResult(),blockerCodes:[safeCode(error)]};}
}
if(require.main===module){const result=main(process.argv.slice(2));process.stdout.write(JSON.stringify(result)+'\n');process.exitCode=result.contractValid?0:1;}
module.exports={validatePayrollProofInputs,main};
