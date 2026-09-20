import crypto from 'node:crypto';
import {createPostgresAgencyIdentityContinuityStore} from './agency-identity-continuity.mjs';
import {createPostgresAgencyWorkStartAuthorityStore,evaluateAgencyWorkStartReadiness} from './agency-work-start-readiness.mjs';
import {AGENCY_WORK_START_LOCKED_SNAPSHOT_SQL,AGENCY_WORK_START_SET_LOCAL_ROLE_SQL} from './agency-work-start-db-boundary.mjs';

export const AGENCY_WORK_START_PERMIT_VERSION='agency-work-start-permit-v0.3.0';
export const AGENCY_WORK_START_PERMIT_STORE_VERSION='agency-work-start-permit-store-v0.3.0';
export const AGENCY_WORK_START_PERMIT_LOCK_SQL=AGENCY_WORK_START_LOCKED_SNAPSHOT_SQL;

const text=(value,max=200)=>typeof value==='string'?value.trim().slice(0,max):'';
const ms=value=>{const parsed=typeof value==='number'?value:Date.parse(value);return Number.isFinite(parsed)?parsed:null;};
const iso=value=>{const parsed=ms(value);return parsed===null?null:new Date(parsed).toISOString();};
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const digest=(value,length=32)=>crypto.createHash('sha256').update(String(value??'')).digest('hex').slice(0,length);
function required(value,name,max=200){const clean=text(value,max+1);if(!clean||clean.length>max)throw new TypeError(`${name} invalid`);return clean;}
function hex(value,length){const clean=text(value,length).toLowerCase();return new RegExp(`^[0-9a-f]{${length}}$`).test(clean)?clean:null;}
function makeError(code){const error=new Error(code);error.code=code;return error;}
function assignmentFingerprint(request={}){
  const scope={roleId:required(request.roleId,'request.roleId',100),location:required(request.location,'request.location',200),startAt:iso(request.startAt),endAt:iso(request.endAt)};
  if(!scope.startAt||!scope.endAt||Date.parse(scope.endAt)<=Date.parse(scope.startAt))throw new TypeError('request assignment window invalid');
  return digest(JSON.stringify(stable(scope)),24);
}

export function createPostgresAgencyWorkStartPermitStore({withTransaction}={}){
  if(typeof withTransaction!=='function')throw new TypeError('withTransaction function is required');
  return Object.freeze({
    version:AGENCY_WORK_START_PERMIT_STORE_VERSION,
    concurrencyBoundary:'database_owned_assignment_lock_plus_security_definer_row_locks',
    databaseRoleBoundary:'wfm_agency_work_start_reader',
    async withLockedSnapshot(scope={},evaluate){
      if(typeof evaluate!=='function')throw new TypeError('evaluate function is required');
      const now=iso(scope.now);if(!now)throw new TypeError('now invalid');
      const values=[required(scope.tenantId,'tenantId',100),required(scope.siteId,'siteId',100),required(scope.requestId,'requestId',100),required(scope.agencyId,'agencyId',100),required(scope.workerId,'workerId',100),required(scope.assignmentFingerprint,'assignmentFingerprint',24).toLowerCase(),now];
      if(!hex(values[5],24))throw new TypeError('assignmentFingerprint invalid');
      return withTransaction(async transaction=>{
        if(!transaction||typeof transaction.query!=='function')throw new TypeError('transaction.query function is required');
        const query=(sql,params=[])=>transaction.query(sql,params);
        await query(AGENCY_WORK_START_SET_LOCAL_ROLE_SQL,[]);
        const locked=await query(AGENCY_WORK_START_PERMIT_LOCK_SQL,values);
        const rows=Array.isArray(locked?.rows)?locked.rows:[];
        if(rows.length!==1)throw new Error(rows.length===0?'work_start_permit_authority_missing':'work_start_permit_authority_ambiguous');
        const scopeFingerprint=hex(rows[0]?.scope_fingerprint??rows[0]?.scopeFingerprint,24);
        if(!scopeFingerprint)throw new Error('work_start_permit_scope_lock_invalid');
        return evaluate(Object.freeze({query,lockRow:Object.freeze({...rows[0],scope_fingerprint:scopeFingerprint})}));
      });
    },
  });
}

function validatePrecheck(readiness,scope){
  if(!readiness||readiness.workStartReady!==true)return {ok:false,reason:'work_start_permit_precheck_not_ready'};
  if(readiness.rankingImpact!=='none'||readiness.scheduleWriteAuthorized!==false||readiness.payrollWriteAuthorized!==false||readiness.clockingWriteAuthorized!==false||readiness.workStartWriteAuthorized!==false)return {ok:false,reason:'work_start_permit_precheck_authority_invalid'};
  if(text(readiness.requestId,100)!==scope.requestId||text(readiness.siteId,100)!==scope.siteId||text(readiness.agencyId,100)!==scope.agencyId||text(readiness.workerId,100)!==scope.workerId)return {ok:false,reason:'work_start_permit_precheck_scope_mismatch'};
  if(text(readiness.assignmentFingerprint,24).toLowerCase()!==scope.assignmentFingerprint)return {ok:false,reason:'work_start_permit_precheck_assignment_mismatch'};
  for(const [key,length] of [['assuranceVersionId',32],['acceptedResponseFingerprint',16],['authorityFingerprint',32],['continuityFingerprint',32],['policyFingerprint',24],['readinessFingerprint',32]])if(!hex(readiness[key],length))return {ok:false,reason:'work_start_permit_precheck_evidence_invalid'};
  return {ok:true};
}

function compareLockedReadiness(precheck,locked){
  if(!locked||locked.workStartReady!==true)return {ok:false,reason:locked?.reason||'work_start_permit_locked_readiness_not_ready'};
  for(const key of ['requestId','siteId','agencyId','workerId'])if(text(locked[key],100)!==text(precheck[key],100))return {ok:false,reason:'work_start_readiness_changed_since_precheck'};
  for(const key of ['assuranceVersionId','assignmentFingerprint','acceptedResponseFingerprint','authorityFingerprint','continuityFingerprint','policyFingerprint','readinessFingerprint'])if(text(locked[key],200).toLowerCase()!==text(precheck[key],200).toLowerCase())return {ok:false,reason:'work_start_readiness_changed_since_precheck'};
  if(locked.rankingImpact!=='none'||locked.scheduleWriteAuthorized!==false||locked.payrollWriteAuthorized!==false||locked.clockingWriteAuthorized!==false||locked.workStartWriteAuthorized!==false)return {ok:false,reason:'work_start_permit_locked_authority_invalid'};
  return {ok:true};
}

function validateCommand(command,expected){
  if(!command||typeof command!=='object'||Array.isArray(command))return {ok:false,reason:'work_start_command_invalid'};
  const allowed=['acceptedResponseFingerprint','agencyId','assignmentFingerprint','assuranceVersionId','authorityFingerprint','continuityFingerprint','policyFingerprint','readinessFingerprint','requestId','siteId','tenantId','type','workerId'];
  const unexpected=Object.keys(command).filter(key=>!allowed.includes(key));
  if(unexpected.length)return {ok:false,reason:'work_start_command_unexpected_field'};
  if(text(command.type,80)!=='shadow_work_start_admission')return {ok:false,reason:'work_start_command_type_invalid'};
  for(const key of ['tenantId','siteId','requestId','agencyId','workerId'])if(text(command[key],100)!==expected[key])return {ok:false,reason:`work_start_command_${key.replace(/[A-Z]/g,m=>`_${m.toLowerCase()}`)}_mismatch`};
  for(const [key,length] of [['assignmentFingerprint',24],['assuranceVersionId',32],['acceptedResponseFingerprint',16],['authorityFingerprint',32],['continuityFingerprint',32],['policyFingerprint',24],['readinessFingerprint',32]])if(text(command[key],length).toLowerCase()!==expected[key])return {ok:false,reason:`work_start_command_${key.replace(/[A-Z]/g,m=>`_${m.toLowerCase()}`)}_mismatch`};
  return {ok:true};
}

const issuedPermits=new WeakMap();

export function consumeAgencyWorkStartPermitAtIngress(permit,command={}){
  const state=permit&&typeof permit==='object'?issuedPermits.get(permit):null;
  if(!state)throw makeError('work_start_permit_untrusted');
  if(!state.active)throw makeError('work_start_permit_expired');
  if(state.consumed)throw makeError('work_start_permit_already_consumed');
  const checked=validateCommand(command,state.expected);
  if(!checked.ok){state.failure=checked.reason;throw makeError(checked.reason);}
  state.consumed=true;
  const expected=state.expected;
  const evidence={type:'shadow_work_start_admission',...expected};
  const shadowAdmissionFingerprint=digest(JSON.stringify(stable(evidence)),32);
  const envelope=Object.freeze({
    version:AGENCY_WORK_START_PERMIT_VERSION,
    acceptedForShadow:true,
    requestId:expected.requestId,siteId:expected.siteId,agencyId:expected.agencyId,workerId:expected.workerId,
    assuranceVersionId:expected.assuranceVersionId,assignmentFingerprint:expected.assignmentFingerprint,
    acceptedResponseFingerprint:expected.acceptedResponseFingerprint,authorityFingerprint:expected.authorityFingerprint,
    continuityFingerprint:expected.continuityFingerprint,policyFingerprint:expected.policyFingerprint,readinessFingerprint:expected.readinessFingerprint,
    shadowAdmissionFingerprint,
    rankingImpact:'none',scheduleWriteAuthorized:false,payrollWriteAuthorized:false,clockingWriteAuthorized:false,workStartWriteAuthorized:false,
    authorityBoundary:'shadow_work_start_admission_envelope_only_no_live_schedule_clocking_payroll_invoice_or_worker_master_mutation',
  });
  state.envelope=envelope;
  return envelope;
}

function fail(reason,{scope=null,lockedReadiness=null,envelope=null}={}){
  return Object.freeze({
    version:AGENCY_WORK_START_PERMIT_VERSION,permitPassed:false,reason,
    requestId:scope?.requestId??null,siteId:scope?.siteId??null,agencyId:scope?.agencyId??null,workerId:scope?.workerId??null,
    assuranceVersionId:lockedReadiness?.assuranceVersionId??null,assignmentFingerprint:scope?.assignmentFingerprint??null,
    readinessFingerprint:lockedReadiness?.readinessFingerprint??null,shadowAdmissionFingerprint:envelope?.shadowAdmissionFingerprint??null,
    rankingImpact:'none',scheduleWriteAuthorized:false,payrollWriteAuthorized:false,clockingWriteAuthorized:false,workStartWriteAuthorized:false,
    authorityBoundary:'transaction_scoped_shadow_work_start_permit_only_no_live_schedule_clocking_payroll_invoice_or_worker_master_mutation',
    privacyBoundary:'no_raw_badge_provider_subject_signature_photo_biometric_date_of_birth_document_number_share_code_portal_token_or_raw_right_to_work_evidence_in_permit_output',
  });
}

export async function evaluateAgencyWorkStartPermit({tenantId,siteId,agencyId,request,workerId,now,policy,readiness,permitStore,shadowWorkStartCommand,evaluateReadiness=evaluateAgencyWorkStartReadiness}={}){
  let scope;
  try{scope={tenantId:required(tenantId,'tenantId',100),siteId:required(siteId,'siteId',100),requestId:required(request?.requestId,'request.requestId',100),agencyId:required(agencyId,'agencyId',100),workerId:required(workerId,'workerId',100),assignmentFingerprint:assignmentFingerprint(request),now:required(iso(now),'now',40)};}catch{return fail('work_start_permit_scope_invalid');}
  const precheck=validatePrecheck(readiness,scope);if(!precheck.ok)return fail(precheck.reason,{scope});
  if(!permitStore||typeof permitStore.withLockedSnapshot!=='function')return fail('work_start_permit_store_unavailable',{scope});
  if(typeof shadowWorkStartCommand!=='function')return fail('shadow_work_start_command_required',{scope});
  if(typeof evaluateReadiness!=='function')return fail('work_start_permit_readiness_evaluator_unavailable',{scope});

  try{
    return await permitStore.withLockedSnapshot(scope,async ({query})=>{
      const authorityStore=createPostgresAgencyWorkStartAuthorityStore({query});
      const continuityStore=createPostgresAgencyIdentityContinuityStore({query});
      let lockedReadiness;
      try{lockedReadiness=await evaluateReadiness({tenantId:scope.tenantId,siteId:scope.siteId,agencyId:scope.agencyId,request,workerId:scope.workerId,now:scope.now,policy,authorityStore,continuityStore});}
      catch{return fail('work_start_permit_locked_readiness_unavailable',{scope});}
      const compared=compareLockedReadiness(readiness,lockedReadiness);if(!compared.ok)return fail(compared.reason,{scope,lockedReadiness});
      const expected=Object.freeze({
        tenantId:scope.tenantId,siteId:scope.siteId,requestId:scope.requestId,agencyId:scope.agencyId,workerId:scope.workerId,
        assignmentFingerprint:scope.assignmentFingerprint,assuranceVersionId:lockedReadiness.assuranceVersionId.toLowerCase(),
        acceptedResponseFingerprint:lockedReadiness.acceptedResponseFingerprint.toLowerCase(),authorityFingerprint:lockedReadiness.authorityFingerprint.toLowerCase(),
        continuityFingerprint:lockedReadiness.continuityFingerprint.toLowerCase(),policyFingerprint:lockedReadiness.policyFingerprint.toLowerCase(),readinessFingerprint:lockedReadiness.readinessFingerprint.toLowerCase(),
      });
      const state={active:true,consumed:false,failure:null,envelope:null,expected};
      let permit;
      permit=Object.freeze({version:AGENCY_WORK_START_PERMIT_VERSION,consume(command={}){return consumeAgencyWorkStartPermitAtIngress(permit,command);}});
      issuedPermits.set(permit,state);
      try{
        await shadowWorkStartCommand(permit);
        if(!state.consumed)return fail(state.failure??'work_start_permit_not_consumed',{scope,lockedReadiness});
      }catch(error){
        return fail(state.failure??(text(error?.code,100)||'shadow_work_start_command_failed'),{scope,lockedReadiness,envelope:state.envelope});
      }finally{state.active=false;}
      return Object.freeze({
        version:AGENCY_WORK_START_PERMIT_VERSION,permitPassed:true,reason:null,
        requestId:scope.requestId,siteId:scope.siteId,agencyId:scope.agencyId,workerId:scope.workerId,
        assuranceVersionId:expected.assuranceVersionId,assignmentFingerprint:expected.assignmentFingerprint,
        acceptedResponseFingerprint:expected.acceptedResponseFingerprint,authorityFingerprint:expected.authorityFingerprint,
        continuityFingerprint:expected.continuityFingerprint,policyFingerprint:expected.policyFingerprint,readinessFingerprint:expected.readinessFingerprint,
        shadowAdmissionFingerprint:state.envelope.shadowAdmissionFingerprint,
        rankingImpact:'none',scheduleWriteAuthorized:false,payrollWriteAuthorized:false,clockingWriteAuthorized:false,workStartWriteAuthorized:false,
        authorityBoundary:'transaction_scoped_shadow_work_start_permit_only_no_live_schedule_clocking_payroll_invoice_or_worker_master_mutation',
        privacyBoundary:'no_raw_badge_provider_subject_signature_photo_biometric_date_of_birth_document_number_share_code_portal_token_or_raw_right_to_work_evidence_in_permit_output',
        atomicityRule:'current_right_to_work_accepted_response_and_authenticated_identity_continuity_are_revalidated_under_the_same_database_owned_assignment_scope_lock_used_by_authenticated_identity_observation_ingress_and_under_a_dedicated_read_only_runtime_role_before_the_one_shot_shadow_work_start_command_is_consumed',
      });
    });
  }catch{return fail('work_start_permit_store_unavailable',{scope});}
}
