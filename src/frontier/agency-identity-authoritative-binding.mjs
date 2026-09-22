import crypto from 'node:crypto';

export const AGENCY_IDENTITY_AUTHORITATIVE_BINDING_VERSION='agency-identity-authoritative-binding-v0.1.0';
export const AGENCY_IDENTITY_AUTHORITATIVE_BINDING_STORE_VERSION='agency-identity-authoritative-binding-store-v0.1.0';

export const AGENCY_IDENTITY_AUTHORITATIVE_BINDING_DDL=`
CREATE TABLE IF NOT EXISTS wfm_agency_identity_source_subject_bindings (
  tenant_id text NOT NULL,
  source_system_id text NOT NULL,
  source_subject_fingerprint varchar(32) NOT NULL CHECK (source_subject_fingerprint ~ '^[0-9a-f]{32}$'),
  binding_version_id varchar(32) NOT NULL CHECK (binding_version_id ~ '^[0-9a-f]{32}$'),
  agency_id text NOT NULL,
  worker_id text NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, source_system_id, source_subject_fingerprint, binding_version_id),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);
CREATE INDEX IF NOT EXISTS idx_wfm_agency_identity_source_subject_binding_active
  ON wfm_agency_identity_source_subject_bindings
  (tenant_id, source_system_id, source_subject_fingerprint, valid_from, valid_until);
CREATE OR REPLACE FUNCTION wfm_agency_identity_source_subject_binding_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'agency identity source subject bindings are append only';
END;
$$;
DROP TRIGGER IF EXISTS trg_wfm_agency_identity_source_subject_binding_no_update ON wfm_agency_identity_source_subject_bindings;
CREATE TRIGGER trg_wfm_agency_identity_source_subject_binding_no_update
BEFORE UPDATE ON wfm_agency_identity_source_subject_bindings
FOR EACH ROW EXECUTE FUNCTION wfm_agency_identity_source_subject_binding_append_only();
DROP TRIGGER IF EXISTS trg_wfm_agency_identity_source_subject_binding_no_delete ON wfm_agency_identity_source_subject_bindings;
CREATE TRIGGER trg_wfm_agency_identity_source_subject_binding_no_delete
BEFORE DELETE ON wfm_agency_identity_source_subject_bindings
FOR EACH ROW EXECUTE FUNCTION wfm_agency_identity_source_subject_binding_append_only();
`;

const RESOLVE_SQL=`
WITH active_mapping AS MATERIALIZED (
  SELECT tenant_id, source_system_id, source_subject_fingerprint, binding_version_id,
         agency_id, worker_id, valid_from, valid_until, created_at
  FROM wfm_agency_identity_source_subject_bindings
  WHERE tenant_id = $1
    AND source_system_id = $4
    AND source_subject_fingerprint = $5
    AND valid_from <= $6::timestamptz
    AND (valid_until IS NULL OR valid_until >= $6::timestamptz)
  ORDER BY valid_from DESC, binding_version_id
  LIMIT 3
), mapping_gate AS MATERIALIZED (
  SELECT min(tenant_id) AS tenant_id,
         min(source_system_id) AS source_system_id,
         min(source_subject_fingerprint) AS source_subject_fingerprint,
         min(binding_version_id) AS binding_version_id,
         min(agency_id) AS agency_id,
         min(worker_id) AS worker_id,
         min(valid_from) AS valid_from,
         min(valid_until) AS valid_until,
         min(created_at) AS created_at
  FROM active_mapping
  HAVING count(*) = 1
), authoritative AS MATERIALIZED (
  SELECT current.tenant_id, current.site_id, current.request_id, current.agency_id,
         current.worker_id, current.assignment_fingerprint, current.assurance_version_id,
         current.checked_at, current.coverage_until, current.promoted_at,
         mapping.source_system_id, mapping.binding_version_id
  FROM mapping_gate AS mapping
  JOIN wfm_agency_rtw_assurance_current AS current
    ON current.tenant_id = mapping.tenant_id
   AND current.agency_id = mapping.agency_id
   AND current.worker_id = mapping.worker_id
  WHERE current.site_id = $2
    AND current.request_id = $3
    AND current.conflicted = false
    AND current.checked_at <= $6::timestamptz
    AND current.promoted_at <= $6::timestamptz
    AND (current.coverage_until IS NULL OR current.coverage_until >= $6::timestamptz)
)
SELECT authoritative.tenant_id, authoritative.site_id, authoritative.request_id,
       authoritative.agency_id, authoritative.worker_id,
       authoritative.assignment_fingerprint, authoritative.assurance_version_id,
       authoritative.checked_at, authoritative.coverage_until, authoritative.promoted_at,
       authoritative.source_system_id, authoritative.binding_version_id,
       accepted.token_fingerprint, accepted.consumed_at
FROM authoritative
JOIN LATERAL (
  SELECT consumption.token_fingerprint, consumption.consumed_at
  FROM wfm_agency_portal_token_consumptions AS consumption
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(consumption.assurance_bindings) = 'array'
      THEN consumption.assurance_bindings ELSE '[]'::jsonb END
  ) AS entry(binding)
  WHERE consumption.tenant_id = authoritative.tenant_id
    AND consumption.site_id = authoritative.site_id
    AND consumption.request_id = authoritative.request_id
    AND consumption.agency_id = authoritative.agency_id
    AND consumption.action IN ('confirm_preferred_worker','partial_fill')
    AND consumption.consumed_at <= $6::timestamptz
    AND entry.binding->>'workerId' = authoritative.worker_id
    AND lower(entry.binding->>'assuranceVersionId') = lower(authoritative.assurance_version_id)
  ORDER BY consumption.consumed_at DESC, consumption.token_fingerprint DESC
  LIMIT 1
) AS accepted ON true
LIMIT 2;
`;

const text=(value,max=200)=>typeof value==='string'?value.trim().slice(0,max):'';
const time=value=>{const parsed=typeof value==='number'?value:Date.parse(value);return Number.isFinite(parsed)?parsed:null;};
const iso=value=>{const parsed=time(value);return parsed===null?null:new Date(parsed).toISOString();};
const keyBytes=value=>{const key=Buffer.isBuffer(value)?value:Buffer.from(value??'');if(key.length<32)throw new TypeError('fingerprintKey must be at least 32 bytes');return key;};
const hmac=(key,domain,value,length=32)=>crypto.createHmac('sha256',key).update(domain).update('|').update(String(value??'')).digest('hex').slice(0,length);
function required(value,name,max=200){const clean=text(value,max+1);if(!clean||clean.length>max)throw new TypeError(`${name} invalid`);return clean;}
function hex(value,length,name){const clean=required(value,name,length).toLowerCase();if(!new RegExp(`^[0-9a-f]{${length}}$`).test(clean))throw new TypeError(`${name} invalid`);return clean;}

export function agencyIdentitySourceSubjectFingerprint({tenantId,sourceSystemId,sourceSubjectRef}={},fingerprintKey){
  const key=keyBytes(fingerprintKey);
  const canonical=`${required(tenantId,'tenantId',100)}|${required(sourceSystemId,'sourceSystemId',100)}|${required(sourceSubjectRef,'sourceSubjectRef',300)}`;
  return hmac(key,'agency-identity-source-subject-v1',canonical,32);
}

export function agencyIdentityContinuitySubjectFingerprint({tenantId,agencyId,workerId}={},fingerprintKey){
  const key=keyBytes(fingerprintKey);
  const canonical=`${required(tenantId,'tenantId',100)}|${required(agencyId,'agencyId',100)}|${required(workerId,'workerId',100)}`;
  return hmac(key,'agency-identity-continuity-subject-v1',canonical,32);
}

function safeRow(row={}){
  return {
    tenantId:text(row.tenant_id??row.tenantId,100),
    siteId:text(row.site_id??row.siteId,100),
    requestId:text(row.request_id??row.requestId,100),
    agencyId:text(row.agency_id??row.agencyId,100),
    workerId:text(row.worker_id??row.workerId,100),
    assignmentFingerprint:text(row.assignment_fingerprint??row.assignmentFingerprint,24).toLowerCase(),
    assuranceVersionId:text(row.assurance_version_id??row.assuranceVersionId,32).toLowerCase(),
    sourceSystemId:text(row.source_system_id??row.sourceSystemId,100),
    bindingVersionId:text(row.binding_version_id??row.bindingVersionId,32).toLowerCase(),
    tokenFingerprint:text(row.token_fingerprint??row.tokenFingerprint,16).toLowerCase(),
    acceptedAt:iso(row.consumed_at??row.acceptedAt),
    checkedAt:iso(row.checked_at??row.checkedAt),
    coverageUntil:(row.coverage_until??row.coverageUntil)==null?null:iso(row.coverage_until??row.coverageUntil),
    promotedAt:iso(row.promoted_at??row.promotedAt),
  };
}

export function createPostgresAgencyIdentityAuthoritativeBindingResolver({query,fingerprintKey}={}){
  if(typeof query!=='function')throw new TypeError('query required');
  const key=keyBytes(fingerprintKey);
  return Object.freeze({
    version:AGENCY_IDENTITY_AUTHORITATIVE_BINDING_STORE_VERSION,
    async resolveBinding({tenantId,siteId,requestId,sourceSystemId,sourceSubjectRef,observedAt}={}){
      const scope={
        tenantId:required(tenantId,'tenantId',100),
        siteId:required(siteId,'siteId',100),
        requestId:required(requestId,'requestId',100),
        sourceSystemId:required(sourceSystemId,'sourceSystemId',100),
        observedAt:iso(observedAt),
      };
      if(!scope.observedAt)throw new TypeError('observedAt invalid');
      const sourceSubjectFingerprint=agencyIdentitySourceSubjectFingerprint({tenantId:scope.tenantId,sourceSystemId:scope.sourceSystemId,sourceSubjectRef},key);
      const result=await query(RESOLVE_SQL,[scope.tenantId,scope.siteId,scope.requestId,scope.sourceSystemId,sourceSubjectFingerprint,scope.observedAt]);
      const rows=Array.isArray(result?.rows)?result.rows:[];
      if(rows.length!==1)throw new Error('identity_binding_not_authoritative');
      const row=safeRow(rows[0]);
      if(row.tenantId!==scope.tenantId||row.siteId!==scope.siteId||row.requestId!==scope.requestId||row.sourceSystemId!==scope.sourceSystemId)throw new Error('identity_binding_scope_mismatch');
      const assignmentFingerprint=hex(row.assignmentFingerprint,24,'assignmentFingerprint');
      const assuranceVersionId=hex(row.assuranceVersionId,32,'assuranceVersionId');
      const bindingVersionId=hex(row.bindingVersionId,32,'bindingVersionId');
      if(!row.agencyId||!row.workerId||!row.acceptedAt||!row.checkedAt||!row.promotedAt||!row.tokenFingerprint)throw new Error('identity_binding_evidence_incomplete');
      if(time(row.acceptedAt)>time(scope.observedAt)||time(row.checkedAt)>time(scope.observedAt)||time(row.promotedAt)>time(scope.observedAt))throw new Error('identity_binding_evidence_time_invalid');
      if(row.coverageUntil&&time(row.coverageUntil)<time(scope.observedAt))throw new Error('identity_binding_coverage_expired');
      const subjectFingerprint=agencyIdentityContinuitySubjectFingerprint({tenantId:scope.tenantId,agencyId:row.agencyId,workerId:row.workerId},key);
      const bindingEvidenceFingerprint=hmac(key,'agency-identity-authoritative-binding-evidence-v1',JSON.stringify({tenantId:scope.tenantId,siteId:scope.siteId,requestId:scope.requestId,sourceSystemId:scope.sourceSystemId,agencyId:row.agencyId,workerId:row.workerId,assignmentFingerprint,assuranceVersionId,bindingVersionId,tokenFingerprint:row.tokenFingerprint,acceptedAt:row.acceptedAt,checkedAt:row.checkedAt,promotedAt:row.promotedAt}),32);
      return Object.freeze({
        version:AGENCY_IDENTITY_AUTHORITATIVE_BINDING_VERSION,
        tenantId:scope.tenantId,
        siteId:scope.siteId,
        requestId:scope.requestId,
        sourceSystemId:scope.sourceSystemId,
        agencyId:row.agencyId,
        workerId:row.workerId,
        assignmentFingerprint,
        assuranceVersionId,
        subjectFingerprint,
        bindingEvidenceFingerprint,
        acceptedAt:row.acceptedAt,
        bindingVersionId,
        authorityBoundary:'read_only_authoritative_identity_binding_from_active_source_mapping_accepted_agency_response_and_current_rtw_assurance',
        privacyBoundary:'raw_source_subject_reference_is_hmac_fingerprinted_before_database_lookup_and_not_returned_or_persisted_by_this_resolver',
      });
    },
  });
}
