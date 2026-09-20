import crypto from 'node:crypto';

export const AGENCY_SCHEDULE_AUTHORITY_GUARD_VERSION='agency-schedule-authority-guard-v0.1.0';
export const AGENCY_SCHEDULE_AUTHORITY_GUARD_STORE_VERSION='agency-schedule-authority-guard-store-v0.1.0';

export const AGENCY_SCHEDULE_AUTHORITY_LOCK_SQL=`
WITH accepted AS MATERIALIZED (
  SELECT tenant_id, token_id, site_id, request_id, agency_id, action, consumed_at, assurance_bindings
  FROM wfm_agency_portal_token_consumptions
  WHERE tenant_id = $1
    AND token_id = $2
    AND site_id = $3
    AND request_id = $4
    AND agency_id = $5
  LIMIT 1
  FOR SHARE
), expected AS MATERIALIZED (
  SELECT
    binding->>'workerId' AS worker_id,
    lower(binding->>'assuranceVersionId') AS assurance_version_id
  FROM accepted
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(accepted.assurance_bindings)='array' THEN accepted.assurance_bindings ELSE '[]'::jsonb END
  ) AS entry(binding)
)
SELECT
  accepted.action,
  accepted.consumed_at,
  expected.worker_id,
  expected.assurance_version_id AS accepted_assurance_version_id,
  current.assurance_version_id AS current_assurance_version_id,
  current.site_id AS current_site_id,
  current.request_id AS current_request_id,
  current.assignment_fingerprint,
  current.checked_at,
  current.coverage_until,
  current.promoted_at,
  current.conflicted
FROM accepted
JOIN expected ON true
LEFT JOIN LATERAL (
  SELECT assurance_version_id, site_id, request_id, assignment_fingerprint,
         checked_at, coverage_until, promoted_at, conflicted
  FROM wfm_agency_rtw_assurance_current
  WHERE tenant_id=$1
    AND agency_id=$5
    AND worker_id=expected.worker_id
  LIMIT 1
  FOR SHARE
) AS current ON true
ORDER BY expected.worker_id;
`;

const text=(value,max=200)=>typeof value==='string'?value.trim().slice(0,max):'';
const ms=value=>{const parsed=typeof value==='number'?value:Date.parse(value);return Number.isFinite(parsed)?parsed:null;};
const iso=value=>{const parsed=ms(value);return parsed===null?null:new Date(parsed).toISOString();};
const bool=value=>value===true||value==='t'||value==='true';
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const digest=(value,length=24)=>crypto.createHash('sha256').update(String(value??'')).digest('hex').slice(0,length);
function required(value,name,max=200){const clean=text(value,max+1);if(!clean)throw new TypeError(`${name} is required`);if(clean.length>max)throw new TypeError(`${name} is too long`);return clean;}

function assignmentFingerprint(request={}){
  const scope={roleId:required(request.roleId,'request.roleId',100),location:required(request.location,'request.location',200),startAt:iso(request.startAt),endAt:iso(request.endAt)};
  if(!scope.startAt||!scope.endAt||Date.parse(scope.endAt)<=Date.parse(scope.startAt))throw new TypeError('request assignment window is invalid');
  return digest(JSON.stringify(stable(scope)));
}

function safeRow(row){
  if(!row||typeof row!=='object')return null;
  return {
    action:text(row.action,50),consumedAt:iso(row.consumed_at??row.consumedAt),workerId:text(row.worker_id??row.workerId,100),
    acceptedAssuranceVersionId:text(row.accepted_assurance_version_id??row.acceptedAssuranceVersionId,32).toLowerCase(),
    currentAssuranceVersionId:text(row.current_assurance_version_id??row.currentAssuranceVersionId,32).toLowerCase(),
    currentSiteId:text(row.current_site_id??row.currentSiteId,100),currentRequestId:text(row.current_request_id??row.currentRequestId,100),
    assignmentFingerprint:text(row.assignment_fingerprint??row.assignmentFingerprint,24).toLowerCase(),checkedAt:iso(row.checked_at??row.checkedAt),
    coverageUntil:(row.coverage_until??row.coverageUntil)==null?null:iso(row.coverage_until??row.coverageUntil),promotedAt:iso(row.promoted_at??row.promotedAt),
    conflicted:bool(row.conflicted),
  };
}

export function createPostgresAgencyScheduleAuthorityGuardStore({withTransaction}={}){
  if(typeof withTransaction!=='function')throw new TypeError('withTransaction function is required');
  return Object.freeze({
    version:AGENCY_SCHEDULE_AUTHORITY_GUARD_STORE_VERSION,
    async withLockedAuthority(scope={},evaluate){
      if(typeof evaluate!=='function')throw new TypeError('evaluate function is required');
      const values=[required(scope.tenantId,'tenantId',100),required(scope.tokenId,'tokenId',200),required(scope.siteId,'siteId',100),required(scope.requestId,'requestId',100),required(scope.agencyId,'agencyId',100)];
      return withTransaction(async transaction=>{
        if(!transaction||typeof transaction.query!=='function')throw new TypeError('transaction.query function is required');
        const result=await transaction.query(AGENCY_SCHEDULE_AUTHORITY_LOCK_SQL,values);
        const rows=Array.isArray(result?.rows)?result.rows.map(safeRow).filter(Boolean):[];
        if(rows.length>100)throw new Error('unexpected_schedule_authority_binding_count');
        return evaluate(rows);
      });
    },
  });
}

export async function guardAgencyScheduleAuthority({tenantId,siteId,agencyId,tokenId,request,now,preflight,authorityStore,shadowCriticalSection}={}){
  const fail=(reason,failures=[reason],evidence=[])=>({
    version:AGENCY_SCHEDULE_AUTHORITY_GUARD_VERSION,guardPassed:false,reason,failures:[...new Set(failures)],requestId:text(request?.requestId,100)||null,
    siteId:text(siteId,100)||null,agencyId:text(agencyId,100)||null,acceptedResponseFingerprint:tokenId?digest(tokenId,16):null,
    workerAssuranceBindings:evidence,scheduleHandoffFingerprint:null,guardFingerprint:null,checkedAt:iso(now),scheduleWriteAuthorized:false,
    authorityBoundary:'shadow_atomic_guard_only_no_schedule_payroll_invoice_or_worker_master_mutation',
    privacyBoundary:'no_portal_token_share_code_date_of_birth_document_number_or_raw_right_to_work_evidence_in_guard_output',
  });
  let scope;
  try{scope={tenantId:required(tenantId,'tenantId',100),siteId:required(siteId,'siteId',100),requestId:required(request?.requestId,'request.requestId',100),agencyId:required(agencyId,'agencyId',100),tokenId:required(tokenId,'tokenId',200)};}catch{return fail('schedule_authority_scope_invalid');}
  const nowMs=ms(now);const assignmentEndMs=ms(request?.endAt);if(nowMs===null||assignmentEndMs===null||assignmentEndMs<=nowMs)return fail('schedule_authority_time_window_invalid');
  let assignmentFp;try{assignmentFp=assignmentFingerprint(request);}catch{return fail('schedule_authority_assignment_invalid');}
  if(!preflight||preflight.readyForScheduleHandoff!==true)return fail('schedule_authority_preflight_not_ready');
  const expectedPreflightFingerprint=text(preflight.scheduleHandoffFingerprint,32).toLowerCase();
  if(!/^[0-9a-f]{32}$/.test(expectedPreflightFingerprint))return fail('schedule_authority_preflight_fingerprint_invalid');
  if(text(preflight.requestId,100)!==scope.requestId||text(preflight.siteId,100)!==scope.siteId||text(preflight.agencyId,100)!==scope.agencyId)return fail('schedule_authority_preflight_scope_mismatch');
  if(text(preflight.acceptedResponseFingerprint,16).toLowerCase()!==digest(scope.tokenId,16))return fail('schedule_authority_preflight_response_mismatch');
  if(!authorityStore||typeof authorityStore.withLockedAuthority!=='function')return fail('schedule_authority_store_unavailable');
  try{
    return await authorityStore.withLockedAuthority(scope,async rawRows=>{
      const rows=Array.isArray(rawRows)?rawRows.map(safeRow).filter(Boolean):[];
      if(rows.length===0)return fail('accepted_response_missing_or_unbound');
      const actions=new Set(rows.map(row=>row.action));
      if(actions.size!==1||!['confirm_preferred_worker','partial_fill'].includes(rows[0].action))return fail('accepted_response_not_scheduleable');
      const failures=[];const byWorker=new Map();
      for(const row of rows){
        if(!row.workerId||byWorker.has(row.workerId)){failures.push('accepted_response_assurance_bindings_invalid');continue;}
        byWorker.set(row.workerId,row);
        if(!/^[0-9a-f]{32}$/.test(row.acceptedAssuranceVersionId))failures.push('accepted_response_assurance_version_invalid');
        if(!/^[0-9a-f]{32}$/.test(row.currentAssuranceVersionId))failures.push('current_assurance_missing');
        if(row.currentAssuranceVersionId&&row.acceptedAssuranceVersionId!==row.currentAssuranceVersionId)failures.push('accepted_worker_assurance_changed');
        if(row.currentSiteId!==scope.siteId)failures.push('current_assurance_site_mismatch');
        if(row.currentRequestId!==scope.requestId)failures.push('current_assurance_request_mismatch');
        if(row.conflicted)failures.push('current_assurance_conflicted');
        if(row.assignmentFingerprint!==assignmentFp)failures.push('current_assurance_assignment_mismatch');
        const checkedAtMs=ms(row.checkedAt);const promotedAtMs=ms(row.promotedAt);const consumedAtMs=ms(row.consumedAt);
        if(checkedAtMs===null||checkedAtMs>nowMs)failures.push('current_assurance_checked_at_invalid');
        if(promotedAtMs===null||promotedAtMs>nowMs)failures.push('current_assurance_promoted_at_invalid');
        if(consumedAtMs===null||consumedAtMs>nowMs)failures.push('accepted_response_consumed_at_invalid');
        const coverageUntilMs=row.coverageUntil==null?null:ms(row.coverageUntil);
        if(row.coverageUntil!=null&&(coverageUntilMs===null||coverageUntilMs<assignmentEndMs||coverageUntilMs<nowMs))failures.push('current_assurance_does_not_cover_assignment');
      }
      const evidence=[...byWorker.values()].map(row=>({workerId:row.workerId,assuranceVersionId:row.currentAssuranceVersionId||row.acceptedAssuranceVersionId||null,assignmentFingerprint:row.assignmentFingerprint||null,checkedAt:row.checkedAt,coverageUntil:row.coverageUntil,promotedAt:row.promotedAt,conflicted:row.conflicted})).sort((a,b)=>a.workerId.localeCompare(b.workerId));
      if(failures.length)return fail(failures[0],failures,evidence);
      const handoffEvidence={tenantId:scope.tenantId,siteId:scope.siteId,requestId:scope.requestId,agencyId:scope.agencyId,acceptedResponseFingerprint:digest(scope.tokenId,16),assignmentFingerprint:assignmentFp,bindings:evidence.map(({workerId,assuranceVersionId})=>({workerId,assuranceVersionId}))};
      const lockedHandoffFingerprint=digest(JSON.stringify(stable(handoffEvidence)),32);
      if(lockedHandoffFingerprint!==expectedPreflightFingerprint)return fail('schedule_handoff_changed_since_preflight',['schedule_handoff_changed_since_preflight'],evidence);
      const guardContext=Object.freeze({tenantId:scope.tenantId,siteId:scope.siteId,requestId:scope.requestId,agencyId:scope.agencyId,scheduleHandoffFingerprint:lockedHandoffFingerprint,workerAssuranceBindings:Object.freeze(evidence.map(({workerId,assuranceVersionId})=>Object.freeze({workerId,assuranceVersionId}))),scheduleMutationAuthority:false});
      if(shadowCriticalSection!==undefined){
        if(typeof shadowCriticalSection!=='function')return fail('shadow_critical_section_invalid',['shadow_critical_section_invalid'],evidence);
        try{await shadowCriticalSection(guardContext);}catch{return fail('shadow_critical_section_failed',['shadow_critical_section_failed'],evidence);}
      }
      const guardFingerprint=digest(JSON.stringify(stable({handoffEvidence,guardVersion:AGENCY_SCHEDULE_AUTHORITY_GUARD_VERSION})),32);
      return {version:AGENCY_SCHEDULE_AUTHORITY_GUARD_VERSION,guardPassed:true,reason:null,failures:[],requestId:scope.requestId,siteId:scope.siteId,agencyId:scope.agencyId,acceptedResponseFingerprint:handoffEvidence.acceptedResponseFingerprint,workerAssuranceBindings:evidence,scheduleHandoffFingerprint:lockedHandoffFingerprint,guardFingerprint,checkedAt:new Date(nowMs).toISOString(),scheduleWriteAuthorized:false,authorityBoundary:'shadow_atomic_guard_only_no_schedule_payroll_invoice_or_worker_master_mutation',privacyBoundary:'no_portal_token_share_code_date_of_birth_document_number_or_raw_right_to_work_evidence_in_guard_output',atomicityRule:'future_schedule_write_must_execute_inside_the_same_database_transaction_after_this_locked_revalidation'};
    });
  }catch{return fail('schedule_authority_store_unavailable');}
}
