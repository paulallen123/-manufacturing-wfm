export const AGENCY_WORK_START_DB_BOUNDARY_VERSION='agency-work-start-db-boundary-v0.1.0';
export const AGENCY_WORK_START_DB_READER_ROLE='wfm_agency_work_start_reader';
export const AGENCY_WORK_START_DB_OWNER_ROLE='wfm_agency_work_start_owner';

export const AGENCY_WORK_START_SET_LOCAL_ROLE_SQL=`SET LOCAL ROLE ${AGENCY_WORK_START_DB_READER_ROLE};`;

export const AGENCY_WORK_START_LOCKED_SNAPSHOT_SQL=`
SELECT assurance_version_id,
       assignment_fingerprint,
       conflicted,
       token_fingerprint,
       action,
       consumed_at,
       scope_fingerprint
FROM public.wfm_read_agency_work_start_locked_snapshot_v1($1,$2,$3,$4,$5,$6,$7::timestamptz);
`;

export const AGENCY_WORK_START_DB_BOUNDARY_DDL=`
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='wfm_agency_work_start_owner') THEN
    CREATE ROLE wfm_agency_work_start_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='wfm_agency_work_start_reader') THEN
    CREATE ROLE wfm_agency_work_start_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$roles$;

GRANT USAGE ON SCHEMA public TO wfm_agency_work_start_owner, wfm_agency_work_start_reader;
REVOKE CREATE ON SCHEMA public FROM wfm_agency_work_start_owner, wfm_agency_work_start_reader;

-- Runtime work-start code receives read-only evidence access. Column-level grants
-- deliberately exclude raw token identifiers, RTW evidence fingerprints/check
-- method, capture timestamps and ingress authentication material that are not
-- needed to decide this bounded shadow admission.
REVOKE ALL ON TABLE public.wfm_agency_rtw_assurance_current FROM wfm_agency_work_start_reader;
REVOKE ALL ON TABLE public.wfm_agency_portal_token_consumptions FROM wfm_agency_work_start_reader;
REVOKE ALL ON TABLE public.wfm_agency_identity_continuity_observations FROM wfm_agency_work_start_reader;
REVOKE ALL ON TABLE public.wfm_agency_identity_observation_ingress_receipts FROM wfm_agency_work_start_reader;

GRANT SELECT (tenant_id,agency_id,worker_id,assurance_version_id,site_id,request_id,assignment_fingerprint,checked_at,coverage_until,promoted_at,conflicted)
  ON TABLE public.wfm_agency_rtw_assurance_current TO wfm_agency_work_start_reader;
GRANT SELECT (tenant_id,site_id,request_id,agency_id,token_fingerprint,action,consumed_at,assurance_bindings)
  ON TABLE public.wfm_agency_portal_token_consumptions TO wfm_agency_work_start_reader;
GRANT SELECT (tenant_id,site_id,request_id,agency_id,worker_id,assignment_fingerprint,assurance_version_id,source_system_id,source_event_fingerprint,subject_fingerprint,signal_type,observed_at)
  ON TABLE public.wfm_agency_identity_continuity_observations TO wfm_agency_work_start_reader;
GRANT SELECT (tenant_id,source_system_id,source_event_fingerprint,binding_fingerprint)
  ON TABLE public.wfm_agency_identity_observation_ingress_receipts TO wfm_agency_work_start_reader;

-- The NOLOGIN owner exists only so the SECURITY DEFINER snapshot can take row
-- share locks without granting UPDATE capability to the runtime reader. PostgreSQL
-- requires UPDATE privilege on at least one column for SELECT ... FOR SHARE.
REVOKE ALL ON TABLE public.wfm_agency_rtw_assurance_current FROM wfm_agency_work_start_owner;
REVOKE ALL ON TABLE public.wfm_agency_portal_token_consumptions FROM wfm_agency_work_start_owner;
GRANT SELECT (tenant_id,agency_id,worker_id,assurance_version_id,site_id,request_id,assignment_fingerprint,conflicted)
  ON TABLE public.wfm_agency_rtw_assurance_current TO wfm_agency_work_start_owner;
GRANT UPDATE (assurance_version_id)
  ON TABLE public.wfm_agency_rtw_assurance_current TO wfm_agency_work_start_owner;
GRANT SELECT (tenant_id,site_id,request_id,agency_id,token_fingerprint,action,consumed_at,assurance_bindings)
  ON TABLE public.wfm_agency_portal_token_consumptions TO wfm_agency_work_start_owner;
GRANT UPDATE (token_fingerprint)
  ON TABLE public.wfm_agency_portal_token_consumptions TO wfm_agency_work_start_owner;

GRANT EXECUTE ON FUNCTION public.wfm_lock_agency_identity_assignment_scope_v1(text,text,text,text,text,text)
  TO wfm_agency_work_start_owner, wfm_agency_work_start_reader;

CREATE OR REPLACE FUNCTION public.wfm_read_agency_work_start_locked_snapshot_v1(
  p_tenant_id text,
  p_site_id text,
  p_request_id text,
  p_agency_id text,
  p_worker_id text,
  p_assignment_fingerprint text,
  p_now timestamptz
)
RETURNS TABLE(
  assurance_version_id text,
  assignment_fingerprint text,
  conflicted boolean,
  token_fingerprint text,
  action text,
  consumed_at timestamptz,
  scope_fingerprint text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_scope_fingerprint text;
BEGIN
  IF p_tenant_id IS NULL OR btrim(p_tenant_id)='' OR char_length(p_tenant_id)>100 OR p_tenant_id<>btrim(p_tenant_id) OR
     p_site_id IS NULL OR btrim(p_site_id)='' OR char_length(p_site_id)>100 OR p_site_id<>btrim(p_site_id) OR
     p_request_id IS NULL OR btrim(p_request_id)='' OR char_length(p_request_id)>100 OR p_request_id<>btrim(p_request_id) OR
     p_agency_id IS NULL OR btrim(p_agency_id)='' OR char_length(p_agency_id)>100 OR p_agency_id<>btrim(p_agency_id) OR
     p_worker_id IS NULL OR btrim(p_worker_id)='' OR char_length(p_worker_id)>100 OR p_worker_id<>btrim(p_worker_id) OR
     p_assignment_fingerprint !~ '^[0-9a-f]{24}$' OR p_now IS NULL THEN
    RAISE EXCEPTION 'work_start_locked_snapshot_scope_invalid';
  END IF;

  SELECT lock_result.scope_fingerprint
    INTO STRICT v_scope_fingerprint
    FROM public.wfm_lock_agency_identity_assignment_scope_v1(
      p_tenant_id,p_site_id,p_request_id,p_agency_id,p_worker_id,p_assignment_fingerprint
    ) AS lock_result;

  RETURN QUERY
  SELECT current.assurance_version_id::text,
         current.assignment_fingerprint::text,
         current.conflicted,
         accepted.token_fingerprint::text,
         accepted.action,
         accepted.consumed_at,
         v_scope_fingerprint
  FROM LATERAL (
    SELECT r.assurance_version_id,r.assignment_fingerprint,r.conflicted
      FROM public.wfm_agency_rtw_assurance_current AS r
     WHERE r.tenant_id=p_tenant_id
       AND r.site_id=p_site_id
       AND r.request_id=p_request_id
       AND r.agency_id=p_agency_id
       AND r.worker_id=p_worker_id
       AND r.assignment_fingerprint=p_assignment_fingerprint
     LIMIT 1
     FOR SHARE
  ) AS current
  LEFT JOIN LATERAL (
    SELECT consumption.token_fingerprint,consumption.action,consumption.consumed_at
      FROM public.wfm_agency_portal_token_consumptions AS consumption
     WHERE consumption.tenant_id=p_tenant_id
       AND consumption.site_id=p_site_id
       AND consumption.request_id=p_request_id
       AND consumption.agency_id=p_agency_id
       AND consumption.action IN ('confirm_preferred_worker','partial_fill')
       AND consumption.consumed_at<=p_now
       AND EXISTS (
         SELECT 1
           FROM pg_catalog.jsonb_array_elements(
             CASE WHEN pg_catalog.jsonb_typeof(consumption.assurance_bindings)='array'
               THEN consumption.assurance_bindings ELSE '[]'::jsonb END
           ) AS entry(binding)
          WHERE entry.binding->>'workerId'=p_worker_id
            AND pg_catalog.lower(entry.binding->>'assuranceVersionId')=pg_catalog.lower(current.assurance_version_id)
       )
     ORDER BY consumption.consumed_at DESC,consumption.token_fingerprint DESC
     LIMIT 1
     FOR SHARE
  ) AS accepted ON true;
END
$function$;

ALTER FUNCTION public.wfm_read_agency_work_start_locked_snapshot_v1(text,text,text,text,text,text,timestamptz)
  OWNER TO wfm_agency_work_start_owner;
REVOKE ALL ON FUNCTION public.wfm_read_agency_work_start_locked_snapshot_v1(text,text,text,text,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wfm_read_agency_work_start_locked_snapshot_v1(text,text,text,text,text,text,timestamptz) FROM wfm_agency_identity_ingress_writer, wfm_agency_identity_reader;
GRANT EXECUTE ON FUNCTION public.wfm_read_agency_work_start_locked_snapshot_v1(text,text,text,text,text,text,timestamptz)
  TO wfm_agency_work_start_reader;
`;

export const AGENCY_WORK_START_DB_BOUNDARY_AUTHORITY=Object.freeze({
  ownerRole:AGENCY_WORK_START_DB_OWNER_ROLE,
  runtimeRole:AGENCY_WORK_START_DB_READER_ROLE,
  lockedSnapshotFunction:'public.wfm_read_agency_work_start_locked_snapshot_v1',
  directTableInsertAllowed:false,
  directTableUpdateAllowed:false,
  directTableDeleteAllowed:false,
  directTableTruncateAllowed:false,
  exactEvidenceColumnReadsOnly:true,
  canonicalAssignmentLockAuthority:'database_owned',
  rowLockAuthority:'security_definer_no_login_owner_only',
  rankingImpact:'none',
  scheduleWriteAuthorized:false,
  clockingWriteAuthorized:false,
  payrollWriteAuthorized:false,
  invoiceWriteAuthorized:false,
  workerMasterWriteAuthorized:false,
});
