import {createPostgresAgencyWorkStartPrecheck} from './agency-work-start-precheck.mjs';
import {createPostgresAgencyWorkStartPermitStore,evaluateAgencyWorkStartPermit} from './agency-work-start-permit.mjs';

export const AGENCY_WORK_START_RUNTIME_VERSION='agency-work-start-runtime-v0.1.0';

const text=(value,max=200)=>typeof value==='string'?value.trim().slice(0,max):'';

function fail(reason,input={},readiness=null){
  return Object.freeze({
    version:AGENCY_WORK_START_RUNTIME_VERSION,
    permitPassed:false,
    reason,
    requestId:text(input.request?.requestId,100)||null,
    siteId:text(input.siteId,100)||null,
    agencyId:text(input.agencyId,100)||null,
    workerId:text(input.workerId,100)||null,
    readinessFingerprint:text(readiness?.readinessFingerprint,32)||null,
    rankingImpact:'none',
    scheduleWriteAuthorized:false,
    clockingWriteAuthorized:false,
    payrollWriteAuthorized:false,
    invoiceWriteAuthorized:false,
    workerMasterWriteAuthorized:false,
    workStartWriteAuthorized:false,
    authorityBoundary:'canonical_tenant_bound_precheck_then_locked_one_shot_shadow_work_start_permit_only',
    privacyBoundary:'no_raw_badge_provider_subject_signature_photo_biometric_date_of_birth_document_number_share_code_portal_token_or_raw_right_to_work_evidence_in_runtime_output',
  });
}

function canonicalInput(input={}){
  return {
    tenantId:input.tenantId,
    siteId:input.siteId,
    agencyId:input.agencyId,
    request:input.request,
    workerId:input.workerId,
    now:input.now,
    policy:input.policy,
  };
}

export function createPostgresAgencyWorkStartRuntime({withTransaction}={}){
  if(typeof withTransaction!=='function')throw new TypeError('withTransaction function is required');
  const precheckBoundary=createPostgresAgencyWorkStartPrecheck({withTransaction});
  const permitStore=createPostgresAgencyWorkStartPermitStore({withTransaction});
  const issuedReadiness=new WeakSet();
  const usedReadiness=new WeakSet();

  return Object.freeze({
    version:AGENCY_WORK_START_RUNTIME_VERSION,
    credentialBoundary:'same_tenant_bound_session_user_transaction_factory_for_precheck_and_permit',
    evidenceBoundary:'exact_scope_security_definer_functions_only',
    precheckTrustBoundary:'same_runtime_instance_object_identity_one_use',
    rankingImpact:'none',
    scheduleWriteAuthorized:false,
    clockingWriteAuthorized:false,
    payrollWriteAuthorized:false,
    invoiceWriteAuthorized:false,
    workerMasterWriteAuthorized:false,
    async evaluateReadiness(input={}){
      const readiness=await precheckBoundary.evaluate(canonicalInput(input));
      if(readiness&&typeof readiness==='object')issuedReadiness.add(readiness);
      return readiness;
    },
    async evaluatePermit(input={}){
      const readiness=input.readiness;
      if(!readiness||typeof readiness!=='object'||!issuedReadiness.has(readiness))return fail('work_start_runtime_precheck_untrusted',input,readiness);
      if(usedReadiness.has(readiness))return fail('work_start_runtime_precheck_already_used',input,readiness);
      usedReadiness.add(readiness);
      const scope=canonicalInput(input);
      return evaluateAgencyWorkStartPermit({
        ...scope,
        readiness,
        permitStore,
        shadowWorkStartCommand:input.shadowWorkStartCommand,
      });
    },
  });
}
