import crypto from 'node:crypto';
import { evaluateAgencyIdentityContinuity } from './agency-identity-continuity.mjs';

export const AGENCY_WORK_START_READINESS_VERSION='agency-work-start-readiness-v0.1.0';
export const AGENCY_WORK_START_AUTHORITY_STORE_VERSION='agency-work-start-authority-store-v0.1.0';

export const AGENCY_WORK_START_AUTHORITY_SQL=`
WITH current AS MATERIALIZED (
  SELECT tenant_id, agency_id, worker_id, assurance_version_id, site_id, request_id,
         assignment_fingerprint, checked_at, coverage_until, promoted_at, conflicted
  FROM wfm_agency_rtw_assurance_current
  WHERE tenant_id = $1
    AND agency_id = $4
    AND worker_id = $5
  LIMIT 2
)
SELECT current.tenant_id, current.agency_id, current.worker_id,
       current.assurance_version_id, current.site_id, current.request_id,
       current.assignment_fingerprint, current.checked_at, current.coverage_until,
       current.promoted_at, current.conflicted,
       accepted.token_fingerprint, accepted.action, accepted.consumed_at
FROM current
LEFT JOIN LATERAL (
  SELECT consumption.token_fingerprint, consumption.action, consumption.consumed_at
  FROM wfm_agency_portal_token_consumptions AS consumption
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(consumption.assurance_bindings)='array'
      THEN consumption.assurance_bindings ELSE '[]'::jsonb END
  ) AS entry(binding)
  WHERE consumption.tenant_id = $1
    AND consumption.site_id = $2
    AND consumption.request_id = $3
    AND consumption.agency_id = $4
    AND consumption.action IN ('confirm_preferred_worker','partial_fill')
    AND consumption.consumed_at <= $6::timestamptz
    AND entry.binding->>'workerId' = current.worker_id
    AND lower(entry.binding->>'assuranceVersionId') = lower(current.assurance_version_id)
  ORDER BY consumption.consumed_at DESC, consumption.token_fingerprint DESC
  LIMIT 1
) AS accepted ON true
ORDER BY accepted.consumed_at DESC NULLS LAST, accepted.token_fingerprint DESC NULLS LAST
LIMIT 3;
`;

const text=(value,max=200)=>typeof value==='string'?value.trim().slice(0,max):'';
// Stored authority is untrusted evidence. Never turn an overlength identifier
// into a different, valid identifier by truncating it before scope comparison.
const authorityText=(value,max)=>{
  if(typeof value!=='string'||value.length>max)return '';
  const clean=value.trim();
  return clean;
};
const ms=value=>{const parsed=typeof value==='number'?value:Date.parse(value);return Number.isFinite(parsed)?parsed:null;};
const iso=value=>{const parsed=ms(value);return parsed===null?null:new Date(parsed).toISOString();};
// PostgreSQL booleans may arrive as primitives or explicit textual aliases.
// Any other value is unknown evidence, never proof that assurance is clear.
const bool=value=>value===true||value==='t'||value==='true'?true:
  value===false||value==='f'||value==='false'?false:null;
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const digest=(value,length=32)=>crypto.createHash('sha256').update(String(value??'')).digest('hex').slice(0,length);
function required(value,name,max=200){const clean=text(value,max+1);if(!clean||clean.length>max)throw new TypeError(`${name} invalid`);return clean;}
function hex(value,length){const clean=text(value,length).toLowerCase();return new RegExp(`^[0-9a-f]{${length}}$`).test(clean)?clean:null;}

function assignmentFingerprint(request={}){
  const scope={roleId:required(request.roleId,'request.roleId',100),location:required(request.location,'request.location',200),startAt:iso(request.startAt),endAt:iso(request.endAt)};
  if(!scope.startAt||!scope.endAt||Date.parse(scope.endAt)<=Date.parse(scope.startAt))throw new TypeError('request assignment window invalid');
  return digest(JSON.stringify(stable(scope)),24);
}

function safeAuthorityRow(row={}){
  return {
    tenantId:authorityText(row.tenant_id??row.tenantId,100),
    siteId:authorityText(row.site_id??row.siteId,100),
    requestId:authorityText(row.request_id??row.requestId,100),
    agencyId:authorityText(row.agency_id??row.agencyId,100),
    workerId:authorityText(row.worker_id??row.workerId,100),
    assuranceVersionId:authorityText(row.assurance_version_id??row.assuranceVersionId,32).toLowerCase(),
    assignmentFingerprint:authorityText(row.assignment_fingerprint??row.assignmentFingerprint,24).toLowerCase(),
    checkedAt:iso(row.checked_at??row.checkedAt),
    // Keep malformed supplied expiry distinct from intentional open-ended null,
    // including when an adapter-normalized row is validated a second time.
    coverageUntil:(row.coverage_until??row.coverageUntil)==null?null:(iso(row.coverage_until??row.coverageUntil)??''),
    promotedAt:iso(row.promoted_at??row.promotedAt),
    conflicted:bool(row.conflicted),
    acceptedResponseFingerprint:authorityText(row.token_fingerprint??row.acceptedResponseFingerprint,16).toLowerCase(),
    acceptedAction:authorityText(row.action??row.acceptedAction,50),
    acceptedAt:iso(row.consumed_at??row.acceptedAt),
  };
}

export function createPostgresAgencyWorkStartAuthorityStore({query}={}){
  if(typeof query!=='function')throw new TypeError('query function is required');
  return Object.freeze({
    version:AGENCY_WORK_START_AUTHORITY_STORE_VERSION,
    async readAuthority(scope={}){
      const now=iso(scope.now);if(!now)throw new TypeError('now invalid');
      const values=[required(scope.tenantId,'tenantId',100),required(scope.siteId,'siteId',100),required(scope.requestId,'requestId',100),required(scope.agencyId,'agencyId',100),required(scope.workerId,'workerId',100),now];
      const result=await query(AGENCY_WORK_START_AUTHORITY_SQL,values);
      const rows=Array.isArray(result?.rows)?result.rows.map(safeAuthorityRow):[];
      if(rows.length>2)throw new Error('unexpected_work_start_authority_count');
      return {rows};
    },
  });
}

function validateAuthority(rows,scope,nowMs,assignmentEndMs){
  if(!Array.isArray(rows)||rows.length===0)return {ok:false,reason:'work_start_authority_missing'};
  if(rows.length!==1)return {ok:false,reason:'work_start_authority_ambiguous'};
  const row=safeAuthorityRow(rows[0]);
  if(row.tenantId!==scope.tenantId||row.siteId!==scope.siteId||row.requestId!==scope.requestId||row.agencyId!==scope.agencyId||row.workerId!==scope.workerId)return {ok:false,reason:'work_start_authority_scope_mismatch'};
  if(!hex(row.assuranceVersionId,32))return {ok:false,reason:'work_start_current_assurance_missing'};
  if(row.assignmentFingerprint!==scope.assignmentFingerprint)return {ok:false,reason:'work_start_assignment_mismatch'};
  if(row.conflicted)return {ok:false,reason:'work_start_current_assurance_conflicted'};
  if(row.conflicted!==false)return {ok:false,reason:'work_start_current_assurance_conflict_unknown'};
  if(!['confirm_preferred_worker','partial_fill'].includes(row.acceptedAction)||!hex(row.acceptedResponseFingerprint,16)||!row.acceptedAt)return {ok:false,reason:'work_start_accepted_response_missing'};
  const checkedAtMs=ms(row.checkedAt),promotedAtMs=ms(row.promotedAt),acceptedAtMs=ms(row.acceptedAt);
  if(checkedAtMs===null||promotedAtMs===null||acceptedAtMs===null||checkedAtMs>nowMs||promotedAtMs>nowMs||acceptedAtMs>nowMs)return {ok:false,reason:'work_start_authority_time_invalid'};
  if(row.coverageUntil!=null){const coverageMs=ms(row.coverageUntil);if(coverageMs===null||coverageMs<assignmentEndMs||coverageMs<nowMs)return {ok:false,reason:'work_start_current_assurance_does_not_cover_assignment'};}
  const evidence={tenantId:row.tenantId,siteId:row.siteId,requestId:row.requestId,agencyId:row.agencyId,workerId:row.workerId,assuranceVersionId:row.assuranceVersionId,assignmentFingerprint:row.assignmentFingerprint,acceptedResponseFingerprint:row.acceptedResponseFingerprint,acceptedAction:row.acceptedAction,acceptedAt:row.acceptedAt,checkedAt:row.checkedAt,coverageUntil:row.coverageUntil,promotedAt:row.promotedAt};
  return {ok:true,row,evidence,authorityFingerprint:digest(JSON.stringify(stable(evidence)),32)};
}

function validateContinuity(result,scope,authority){
  if(!result||result.continuityPassed!==true)return {ok:false,reason:result?.reason||'work_start_identity_continuity_not_proven'};
  if(result.requestId!==scope.requestId||result.siteId!==scope.siteId||result.agencyId!==scope.agencyId||result.workerId!==scope.workerId)return {ok:false,reason:'work_start_identity_continuity_scope_mismatch'};
  if(result.assuranceVersionId!==authority.row.assuranceVersionId||result.assignmentFingerprint!==scope.assignmentFingerprint)return {ok:false,reason:'work_start_identity_continuity_authority_mismatch'};
  if(!hex(result.continuityFingerprint,32)||!hex(result.policyFingerprint,24))return {ok:false,reason:'work_start_identity_continuity_evidence_invalid'};
  if(result.rankingImpact!=='none'||result.scheduleWriteAuthorized!==false||result.payrollWriteAuthorized!==false||result.clockingWriteAuthorized!==false)return {ok:false,reason:'work_start_identity_continuity_authority_invalid'};
  return {ok:true,continuityFingerprint:result.continuityFingerprint.toLowerCase(),policyFingerprint:result.policyFingerprint.toLowerCase(),independentSourceCount:Number(result.independentSourceCount??0),directIdentityObserved:result.directIdentityObserved===true};
}

export async function evaluateAgencyWorkStartReadiness({tenantId,siteId,agencyId,request,workerId,now,policy,authorityStore,continuityStore,evaluateContinuity=evaluateAgencyIdentityContinuity}={}){
  const fail=(reason,{scope=null,authority=null,continuity=null}={})=>Object.freeze({
    version:AGENCY_WORK_START_READINESS_VERSION,
    workStartReady:false,
    reason,
    requestId:scope?.requestId ?? (text(request?.requestId,100)||null),
    siteId:scope?.siteId ?? (text(siteId,100)||null),
    agencyId:scope?.agencyId ?? (text(agencyId,100)||null),
    workerId:scope?.workerId ?? (text(workerId,100)||null),
    assuranceVersionId:authority?.row?.assuranceVersionId??null,
    assignmentFingerprint:scope?.assignmentFingerprint??null,
    acceptedResponseFingerprint:authority?.row?.acceptedResponseFingerprint??null,
    authorityFingerprint:authority?.authorityFingerprint??null,
    continuityFingerprint:continuity?.continuityFingerprint??null,
    policyFingerprint:continuity?.policyFingerprint??null,
    readinessFingerprint:null,
    rankingImpact:'none',
    scheduleWriteAuthorized:false,
    payrollWriteAuthorized:false,
    clockingWriteAuthorized:false,
    workStartWriteAuthorized:false,
    authorityBoundary:'shadow_work_start_readiness_only_no_schedule_clocking_payroll_invoice_or_worker_master_mutation',
    privacyBoundary:'no_raw_badge_provider_subject_signature_photo_biometric_date_of_birth_document_number_share_code_portal_token_or_raw_right_to_work_evidence_in_readiness_output',
  });

  let scope;
  try{
    scope={tenantId:required(tenantId,'tenantId',100),siteId:required(siteId,'siteId',100),requestId:required(request?.requestId,'request.requestId',100),agencyId:required(agencyId,'agencyId',100),workerId:required(workerId,'workerId',100),roleId:required(request?.roleId,'request.roleId',100),assignmentFingerprint:assignmentFingerprint(request)};
  }catch{return fail('work_start_scope_invalid');}
  const nowMs=ms(now),assignmentEndMs=ms(request?.endAt);
  if(nowMs===null||assignmentEndMs===null||nowMs>assignmentEndMs)return fail('work_start_time_invalid',{scope});
  if(!authorityStore||typeof authorityStore.readAuthority!=='function')return fail('work_start_authority_store_unavailable',{scope});
  if(!continuityStore||typeof continuityStore.readObservations!=='function'||typeof evaluateContinuity!=='function')return fail('work_start_identity_continuity_unavailable',{scope});

  const readAuthority=async()=>{
    try{return await authorityStore.readAuthority({...scope,now:new Date(nowMs).toISOString()});}catch{return null;}
  };

  const firstRead=await readAuthority();
  if(!firstRead)return fail('work_start_authority_store_unavailable',{scope});
  const first=validateAuthority(firstRead.rows,scope,nowMs,assignmentEndMs);
  if(!first.ok)return fail(first.reason,{scope,authority:first});

  let continuityRaw;
  try{
    continuityRaw=await evaluateContinuity({tenantId:scope.tenantId,siteId:scope.siteId,agencyId:scope.agencyId,request,workerBinding:{workerId:scope.workerId,assuranceVersionId:first.row.assuranceVersionId},now:new Date(nowMs).toISOString(),policy,continuityStore});
  }catch{return fail('work_start_identity_continuity_unavailable',{scope,authority:first});}
  const continuity=validateContinuity(continuityRaw,scope,first);
  if(!continuity.ok)return fail(continuity.reason,{scope,authority:first,continuity});

  const secondRead=await readAuthority();
  if(!secondRead)return fail('work_start_authority_store_unavailable',{scope,authority:first,continuity});
  const second=validateAuthority(secondRead.rows,scope,nowMs,assignmentEndMs);
  if(!second.ok)return fail(second.reason,{scope,authority:second,continuity});
  if(second.authorityFingerprint!==first.authorityFingerprint)return fail('work_start_authority_changed_during_continuity_evaluation',{scope,authority:second,continuity});

  const readinessEvidence={version:AGENCY_WORK_START_READINESS_VERSION,tenantId:scope.tenantId,siteId:scope.siteId,requestId:scope.requestId,agencyId:scope.agencyId,workerId:scope.workerId,assignmentFingerprint:scope.assignmentFingerprint,assuranceVersionId:first.row.assuranceVersionId,authorityFingerprint:first.authorityFingerprint,continuityFingerprint:continuity.continuityFingerprint,policyFingerprint:continuity.policyFingerprint};
  const readinessFingerprint=digest(JSON.stringify(stable(readinessEvidence)),32);
  return Object.freeze({
    version:AGENCY_WORK_START_READINESS_VERSION,
    workStartReady:true,
    reason:null,
    requestId:scope.requestId,
    siteId:scope.siteId,
    agencyId:scope.agencyId,
    workerId:scope.workerId,
    assuranceVersionId:first.row.assuranceVersionId,
    assignmentFingerprint:scope.assignmentFingerprint,
    acceptedResponseFingerprint:first.row.acceptedResponseFingerprint,
    authorityFingerprint:first.authorityFingerprint,
    continuityFingerprint:continuity.continuityFingerprint,
    policyFingerprint:continuity.policyFingerprint,
    independentSourceCount:continuity.independentSourceCount,
    directIdentityObserved:continuity.directIdentityObserved,
    readinessFingerprint,
    rankingImpact:'none',
    scheduleWriteAuthorized:false,
    payrollWriteAuthorized:false,
    clockingWriteAuthorized:false,
    workStartWriteAuthorized:false,
    authorityBoundary:'shadow_work_start_readiness_only_no_schedule_clocking_payroll_invoice_or_worker_master_mutation',
    privacyBoundary:'no_raw_badge_provider_subject_signature_photo_biometric_date_of_birth_document_number_share_code_portal_token_or_raw_right_to_work_evidence_in_readiness_output',
    consistencyRule:'authoritative_agency_acceptance_and_current_right_to_work_assurance_are_read_before_and_after_identity_continuity_evaluation_and_must_be_unchanged',
  });
}
