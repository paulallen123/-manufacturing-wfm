export const AGENCY_WORK_START_DB_BOUNDARY_VERSION='agency-work-start-db-boundary-v0.3.0';
export const AGENCY_WORK_START_DB_READER_ROLE='wfm_agency_work_start_reader';
export const AGENCY_WORK_START_DB_OWNER_ROLE='wfm_agency_work_start_owner';
export const AGENCY_WORK_START_TENANT_BINDING_ADMIN_ROLE='wfm_agency_work_start_tenant_binding_admin';

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

export const AGENCY_WORK_START_SCOPED_AUTHORITY_SQL=`
SELECT tenant_id,agency_id,worker_id,assurance_version_id,site_id,request_id,
       assignment_fingerprint,checked_at,coverage_until,promoted_at,conflicted,
       token_fingerprint,action,consumed_at
FROM public.wfm_read_agency_work_start_authority_v1($1,$2,$3,$4,$5,$6,$7::timestamptz);
`;

export const AGENCY_WORK_START_SCOPED_CONTINUITY_SQL=`
SELECT tenant_id,site_id,request_id,agency_id,worker_id,assignment_fingerprint,
       assurance_version_id,source_system_id,source_event_fingerprint,
       subject_fingerprint,signal_type,observed_at,provenance_binding_fingerprints
FROM public.wfm_read_agency_work_start_identity_continuity_v1(
  $1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz
);
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
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='wfm_agency_work_start_tenant_binding_admin') THEN
    CREATE ROLE wfm_agency_work_start_tenant_binding_admin NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$roles$;

GRANT USAGE ON SCHEMA public TO wfm_agency_work_start_owner, wfm_agency_work_start_reader, wfm_agency_work_start_tenant_binding_admin;
REVOKE CREATE ON SCHEMA public FROM wfm_agency_work_start_owner, wfm_agency_work_start_reader, wfm_agency_work_start_tenant_binding_admin;

-- Database-principal -> tenant binding. The runtime role cannot read or mutate this
-- table. Deployment automation may provision one tenant per LOGIN principal through
-- the separate binding-admin role. Multiple principals may serve one tenant, but a
-- principal cannot be bound to more than one tenant because database_principal is
-- the primary key. SECURITY DEFINER reads verify session_user, which SET ROLE cannot
-- forge. PostgreSQL superusers are intentionally outside this boundary because they
-- can bypass all database ACLs already.
CREATE TABLE IF NOT EXISTS public.wfm_agency_work_start_principal_tenants (
  database_principal name PRIMARY KEY,
  tenant_id text NOT NULL CHECK (tenant_id=btrim(tenant_id) AND tenant_id<>'' AND char_length(tenant_id)<=100),
  binding_fingerprint text NOT NULL CHECK (binding_fingerprint ~ '^[0-9a-f]{24}$'),
  bound_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wfm_agency_work_start_principal_tenants OWNER TO wfm_agency_work_start_owner;
REVOKE ALL ON TABLE public.wfm_agency_work_start_principal_tenants FROM PUBLIC;
REVOKE ALL ON TABLE public.wfm_agency_work_start_principal_tenants FROM wfm_agency_work_start_reader;
REVOKE ALL ON TABLE public.wfm_agency_work_start_principal_tenants FROM wfm_agency_identity_ingress_writer, wfm_agency_identity_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.wfm_agency_work_start_principal_tenants TO wfm_agency_work_start_tenant_binding_admin;

CREATE OR REPLACE FUNCTION public.wfm_assert_agency_work_start_tenant_principal_v1(
  p_tenant_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $principal_guard$
DECLARE
  v_role record;
  v_bound_tenant text;
BEGIN
  IF p_tenant_id IS NULL OR btrim(p_tenant_id)='' OR char_length(p_tenant_id)>100 OR p_tenant_id<>btrim(p_tenant_id) THEN
    RAISE EXCEPTION 'work_start_tenant_principal_scope_invalid';
  END IF;

  SELECT r.rolcanlogin,r.rolsuper,r.rolcreatedb,r.rolcreaterole
    INTO STRICT v_role
    FROM pg_catalog.pg_roles AS r
   WHERE r.rolname=session_user;

  -- Superusers can bypass every PostgreSQL ACL and are therefore explicitly outside
  -- the runtime-credential threat model. Production work-start credentials must be
  -- LOGIN, NOSUPERUSER, NOCREATEDB and NOCREATEROLE.
  IF v_role.rolsuper THEN
    RETURN;
  END IF;
  IF NOT v_role.rolcanlogin OR v_role.rolcreatedb OR v_role.rolcreaterole THEN
    RAISE EXCEPTION 'work_start_tenant_principal_invalid';
  END IF;

  SELECT binding.tenant_id
    INTO v_bound_tenant
    FROM public.wfm_agency_work_start_principal_tenants AS binding
   WHERE binding.database_principal=session_user;

  IF NOT FOUND OR v_bound_tenant IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'work_start_tenant_principal_unauthorized';
  END IF;
END
$principal_guard$;

ALTER FUNCTION public.wfm_assert_agency_work_start_tenant_principal_v1(text)
  OWNER TO wfm_agency_work_start_owner;
REVOKE ALL ON FUNCTION public.wfm_assert_agency_work_start_tenant_principal_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wfm_assert_agency_work_start_tenant_principal_v1(text)
  FROM wfm_agency_work_start_reader, wfm_agency_work_start_tenant_binding_admin, wfm_agency_identity_ingress_writer, wfm_agency_identity_reader;

-- Runtime work-start code receives no direct table SELECT or DML capability.
-- Every evidence read must go through an exact-scope SECURITY DEFINER function.
REVOKE ALL ON TABLE public.wfm_agency_rtw_assurance_current FROM wfm_agency_work_start_reader;
REVOKE ALL ON TABLE public.wfm_agency_portal_token_consumptions FROM wfm_agency_work_start_reader;
REVOKE ALL ON TABLE public.wfm_agency_identity_continuity_observations FROM wfm_agency_work_start_reader;
REVOKE ALL ON TABLE public.wfm_agency_identity_observation_ingress_receipts FROM wfm_agency_work_start_reader;

-- The NOLOGIN owner is the only role allowed to read the minimum evidence columns
-- needed by the controlled functions. UPDATE is limited to one harmless column on
-- each row-locked table because PostgreSQL requires UPDATE privilege for FOR SHARE.
REVOKE ALL ON TABLE public.wfm_agency_rtw_assurance_current FROM wfm_agency_work_start_owner;
REVOKE ALL ON TABLE public.wfm_agency_portal_token_consumptions FROM wfm_agency_work_start_owner;
REVOKE ALL ON TABLE public.wfm_agency_identity_continuity_observations FROM wfm_agency_work_start_owner;
REVOKE ALL ON TABLE public.wfm_agency_identity_observation_ingress_receipts FROM wfm_agency_work_start_owner;
GRANT SELECT (tenant_id,agency_id,worker_id,assurance_version_id,site_id,request_id,assignment_fingerprint,checked_at,coverage_until,promoted_at,conflicted)
  ON TABLE public.wfm_agency_rtw_assurance_current TO wfm_agency_work_start_owner;
GRANT UPDATE (assurance_version_id)
  ON TABLE public.wfm_agency_rtw_assurance_current TO wfm_agency_work_start_owner;
GRANT SELECT (tenant_id,site_id,request_id,agency_id,token_fingerprint,action,consumed_at,assurance_bindings)
  ON TABLE public.wfm_agency_portal_token_consumptions TO wfm_agency_work_start_owner;
GRANT UPDATE (token_fingerprint)
  ON TABLE public.wfm_agency_portal_token_consumptions TO wfm_agency_work_start_owner;
GRANT SELECT (tenant_id,site_id,request_id,agency_id,worker_id,assignment_fingerprint,assurance_version_id,source_system_id,source_event_fingerprint,subject_fingerprint,signal_type,observed_at)
  ON TABLE public.wfm_agency_identity_continuity_observations TO wfm_agency_work_start_owner;
GRANT SELECT (tenant_id,source_system_id,source_event_fingerprint,binding_fingerprint)
  ON TABLE public.wfm_agency_identity_observation_ingress_receipts TO wfm_agency_work_start_owner;

REVOKE ALL ON FUNCTION public.wfm_lock_agency_identity_assignment_scope_v1(text,text,text,text,text,text)
  FROM wfm_agency_work_start_reader;
GRANT EXECUTE ON FUNCTION public.wfm_lock_agency_identity_assignment_scope_v1(text,text,text,text,text,text)
  TO wfm_agency_work_start_owner;

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

  PERFORM public.wfm_assert_agency_work_start_tenant_principal_v1(p_tenant_id);

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
REVOKE ALL ON FUNCTION public.wfm_read_agency_work_start_locked_snapshot_v1(text,text,text,text,text,text,timestamptz) FROM wfm_agency_identity_ingress_writer, wfm_agency_identity_reader, wfm_agency_work_start_tenant_binding_admin;
GRANT EXECUTE ON FUNCTION public.wfm_read_agency_work_start_locked_snapshot_v1(text,text,text,text,text,text,timestamptz)
  TO wfm_agency_work_start_reader;

CREATE OR REPLACE FUNCTION public.wfm_read_agency_work_start_authority_v1(
  p_tenant_id text,
  p_site_id text,
  p_request_id text,
  p_agency_id text,
  p_worker_id text,
  p_assignment_fingerprint text,
  p_now timestamptz
)
RETURNS TABLE(
  tenant_id text,
  agency_id text,
  worker_id text,
  assurance_version_id text,
  site_id text,
  request_id text,
  assignment_fingerprint text,
  checked_at timestamptz,
  coverage_until timestamptz,
  promoted_at timestamptz,
  conflicted boolean,
  token_fingerprint text,
  action text,
  consumed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_tenant_id IS NULL OR btrim(p_tenant_id)='' OR char_length(p_tenant_id)>100 OR p_tenant_id<>btrim(p_tenant_id) OR
     p_site_id IS NULL OR btrim(p_site_id)='' OR char_length(p_site_id)>100 OR p_site_id<>btrim(p_site_id) OR
     p_request_id IS NULL OR btrim(p_request_id)='' OR char_length(p_request_id)>100 OR p_request_id<>btrim(p_request_id) OR
     p_agency_id IS NULL OR btrim(p_agency_id)='' OR char_length(p_agency_id)>100 OR p_agency_id<>btrim(p_agency_id) OR
     p_worker_id IS NULL OR btrim(p_worker_id)='' OR char_length(p_worker_id)>100 OR p_worker_id<>btrim(p_worker_id) OR
     p_assignment_fingerprint !~ '^[0-9a-f]{24}$' OR p_now IS NULL THEN
    RAISE EXCEPTION 'work_start_authority_scope_invalid';
  END IF;

  PERFORM public.wfm_assert_agency_work_start_tenant_principal_v1(p_tenant_id);

  RETURN QUERY
  SELECT current.tenant_id,current.agency_id,current.worker_id,current.assurance_version_id,
         current.site_id,current.request_id,current.assignment_fingerprint,current.checked_at,
         current.coverage_until,current.promoted_at,current.conflicted,
         accepted.token_fingerprint,accepted.action,accepted.consumed_at
    FROM public.wfm_agency_rtw_assurance_current AS current
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
    ) AS accepted ON true
   WHERE current.tenant_id=p_tenant_id
     AND current.site_id=p_site_id
     AND current.request_id=p_request_id
     AND current.agency_id=p_agency_id
     AND current.worker_id=p_worker_id
     AND current.assignment_fingerprint=p_assignment_fingerprint
   LIMIT 2;
END
$function$;

ALTER FUNCTION public.wfm_read_agency_work_start_authority_v1(text,text,text,text,text,text,timestamptz)
  OWNER TO wfm_agency_work_start_owner;
REVOKE ALL ON FUNCTION public.wfm_read_agency_work_start_authority_v1(text,text,text,text,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wfm_read_agency_work_start_authority_v1(text,text,text,text,text,text,timestamptz) FROM wfm_agency_identity_ingress_writer, wfm_agency_identity_reader, wfm_agency_work_start_tenant_binding_admin;
GRANT EXECUTE ON FUNCTION public.wfm_read_agency_work_start_authority_v1(text,text,text,text,text,text,timestamptz)
  TO wfm_agency_work_start_reader;

CREATE OR REPLACE FUNCTION public.wfm_read_agency_work_start_identity_continuity_v1(
  p_tenant_id text,
  p_site_id text,
  p_request_id text,
  p_agency_id text,
  p_worker_id text,
  p_assignment_fingerprint text,
  p_assurance_version_id text,
  p_window_start timestamptz,
  p_window_end timestamptz
)
RETURNS TABLE(
  tenant_id text,
  site_id text,
  request_id text,
  agency_id text,
  worker_id text,
  assignment_fingerprint text,
  assurance_version_id text,
  source_system_id text,
  source_event_fingerprint text,
  subject_fingerprint text,
  signal_type text,
  observed_at timestamptz,
  provenance_binding_fingerprints jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_tenant_id IS NULL OR btrim(p_tenant_id)='' OR char_length(p_tenant_id)>100 OR p_tenant_id<>btrim(p_tenant_id) OR
     p_site_id IS NULL OR btrim(p_site_id)='' OR char_length(p_site_id)>100 OR p_site_id<>btrim(p_site_id) OR
     p_request_id IS NULL OR btrim(p_request_id)='' OR char_length(p_request_id)>100 OR p_request_id<>btrim(p_request_id) OR
     p_agency_id IS NULL OR btrim(p_agency_id)='' OR char_length(p_agency_id)>100 OR p_agency_id<>btrim(p_agency_id) OR
     p_worker_id IS NULL OR btrim(p_worker_id)='' OR char_length(p_worker_id)>100 OR p_worker_id<>btrim(p_worker_id) OR
     p_assignment_fingerprint !~ '^[0-9a-f]{24}$' OR
     p_assurance_version_id !~ '^[0-9a-f]{32}$' OR
     p_window_start IS NULL OR p_window_end IS NULL OR p_window_end<p_window_start THEN
    RAISE EXCEPTION 'work_start_identity_continuity_scope_invalid';
  END IF;

  PERFORM public.wfm_assert_agency_work_start_tenant_principal_v1(p_tenant_id);

  RETURN QUERY
  SELECT o.tenant_id,o.site_id,o.request_id,o.agency_id,o.worker_id,o.assignment_fingerprint,
         o.assurance_version_id,o.source_system_id,o.source_event_fingerprint,o.subject_fingerprint,
         o.signal_type,o.observed_at,
         COALESCE((
           SELECT pg_catalog.jsonb_agg(DISTINCT r.binding_fingerprint ORDER BY r.binding_fingerprint)
             FROM public.wfm_agency_identity_observation_ingress_receipts AS r
            WHERE r.tenant_id=p_tenant_id
              AND r.source_system_id=o.source_system_id
              AND r.source_event_fingerprint=o.source_event_fingerprint
         ),'[]'::jsonb) AS provenance_binding_fingerprints
    FROM public.wfm_agency_identity_continuity_observations AS o
   WHERE o.tenant_id=p_tenant_id
     AND o.site_id=p_site_id
     AND o.request_id=p_request_id
     AND o.agency_id=p_agency_id
     AND o.worker_id=p_worker_id
     AND o.assignment_fingerprint=p_assignment_fingerprint
     AND o.assurance_version_id=p_assurance_version_id
     AND o.observed_at>=p_window_start
     AND o.observed_at<=p_window_end
   ORDER BY o.observed_at,o.source_system_id,o.source_event_fingerprint
   LIMIT 201;
END
$function$;

ALTER FUNCTION public.wfm_read_agency_work_start_identity_continuity_v1(text,text,text,text,text,text,text,timestamptz,timestamptz)
  OWNER TO wfm_agency_work_start_owner;
REVOKE ALL ON FUNCTION public.wfm_read_agency_work_start_identity_continuity_v1(text,text,text,text,text,text,text,timestamptz,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wfm_read_agency_work_start_identity_continuity_v1(text,text,text,text,text,text,text,timestamptz,timestamptz) FROM wfm_agency_identity_ingress_writer, wfm_agency_identity_reader, wfm_agency_work_start_tenant_binding_admin;
GRANT EXECUTE ON FUNCTION public.wfm_read_agency_work_start_identity_continuity_v1(text,text,text,text,text,text,text,timestamptz,timestamptz)
  TO wfm_agency_work_start_reader;
`;

export const AGENCY_WORK_START_DB_BOUNDARY_AUTHORITY=Object.freeze({
  ownerRole:AGENCY_WORK_START_DB_OWNER_ROLE,
  runtimeRole:AGENCY_WORK_START_DB_READER_ROLE,
  tenantBindingAdminRole:AGENCY_WORK_START_TENANT_BINDING_ADMIN_ROLE,
  principalTenantBindingTable:'public.wfm_agency_work_start_principal_tenants',
  principalTenantGuardFunction:'public.wfm_assert_agency_work_start_tenant_principal_v1',
  lockedSnapshotFunction:'public.wfm_read_agency_work_start_locked_snapshot_v1',
  scopedAuthorityFunction:'public.wfm_read_agency_work_start_authority_v1',
  scopedIdentityContinuityFunction:'public.wfm_read_agency_work_start_identity_continuity_v1',
  directTableSelectAllowed:false,
  directTableInsertAllowed:false,
  directTableUpdateAllowed:false,
  directTableDeleteAllowed:false,
  directTableTruncateAllowed:false,
  scopedReadFunctionsOnly:true,
  canonicalAssignmentLockAuthority:'database_owned',
  rowLockAuthority:'security_definer_no_login_owner_only',
  tenantAuthorizationAuthority:'database_session_user_principal_binding',
  oneTenantPerDatabasePrincipal:true,
  setRoleCannotChangeTenantPrincipal:true,
  productionPrincipalMustBeLoginNonSuperuser:true,
  superuserOutsideRuntimeThreatBoundary:true,
  rankingImpact:'none',
  scheduleWriteAuthorized:false,
  clockingWriteAuthorized:false,
  payrollWriteAuthorized:false,
  invoiceWriteAuthorized:false,
  workerMasterWriteAuthorized:false,
});