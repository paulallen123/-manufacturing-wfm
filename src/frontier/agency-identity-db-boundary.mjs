export const AGENCY_IDENTITY_DB_BOUNDARY_VERSION='agency-identity-db-boundary-v0.3.0';

export const AGENCY_IDENTITY_DB_BOUNDARY_DDL=`
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='wfm_agency_identity_ingress_owner') THEN
    CREATE ROLE wfm_agency_identity_ingress_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='wfm_agency_identity_ingress_writer') THEN
    CREATE ROLE wfm_agency_identity_ingress_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='wfm_agency_identity_reader') THEN
    CREATE ROLE wfm_agency_identity_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$roles$;

GRANT USAGE, CREATE ON SCHEMA public TO wfm_agency_identity_ingress_owner;
GRANT USAGE ON SCHEMA public TO wfm_agency_identity_ingress_writer, wfm_agency_identity_reader;
REVOKE CREATE ON SCHEMA public FROM wfm_agency_identity_ingress_writer, wfm_agency_identity_reader;

REVOKE ALL ON TABLE public.wfm_agency_identity_observation_ingress_receipts FROM PUBLIC;
REVOKE ALL ON TABLE public.wfm_agency_identity_continuity_observations FROM PUBLIC;
REVOKE ALL ON TABLE public.wfm_agency_identity_observation_ingress_receipts FROM wfm_agency_identity_ingress_writer, wfm_agency_identity_reader;
REVOKE ALL ON TABLE public.wfm_agency_identity_continuity_observations FROM wfm_agency_identity_ingress_writer, wfm_agency_identity_reader;

GRANT SELECT, INSERT ON TABLE public.wfm_agency_identity_observation_ingress_receipts TO wfm_agency_identity_ingress_owner;
GRANT SELECT, INSERT ON TABLE public.wfm_agency_identity_continuity_observations TO wfm_agency_identity_ingress_owner;
GRANT SELECT ON TABLE public.wfm_agency_identity_observation_ingress_receipts TO wfm_agency_identity_reader;
GRANT SELECT ON TABLE public.wfm_agency_identity_continuity_observations TO wfm_agency_identity_reader;

CREATE OR REPLACE FUNCTION public.wfm_lock_agency_identity_assignment_scope_v1(
  p_tenant_id text,
  p_site_id text,
  p_request_id text,
  p_agency_id text,
  p_worker_id text,
  p_assignment_fingerprint text
)
RETURNS TABLE(scope_lock_key bigint, scope_fingerprint text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $scope_lock$
DECLARE
  v_scope_canonical text;
  v_scope_digest bytea;
  v_scope_hex text;
  v_scope_lock_key bigint;
BEGIN
  IF p_tenant_id IS NULL OR btrim(p_tenant_id)='' OR char_length(p_tenant_id)>100 OR p_tenant_id<>btrim(p_tenant_id) OR
     p_site_id IS NULL OR btrim(p_site_id)='' OR char_length(p_site_id)>100 OR p_site_id<>btrim(p_site_id) OR
     p_request_id IS NULL OR btrim(p_request_id)='' OR char_length(p_request_id)>100 OR p_request_id<>btrim(p_request_id) OR
     p_agency_id IS NULL OR btrim(p_agency_id)='' OR char_length(p_agency_id)>100 OR p_agency_id<>btrim(p_agency_id) OR
     p_worker_id IS NULL OR btrim(p_worker_id)='' OR char_length(p_worker_id)>100 OR p_worker_id<>btrim(p_worker_id) OR
     p_assignment_fingerprint !~ '^[0-9a-f]{24}$' THEN
    RAISE EXCEPTION 'identity_scope_lock_invalid';
  END IF;

  v_scope_canonical := '[' ||
    pg_catalog.to_json(p_tenant_id)::text || ',' ||
    pg_catalog.to_json(p_site_id)::text || ',' ||
    pg_catalog.to_json(p_request_id)::text || ',' ||
    pg_catalog.to_json(p_agency_id)::text || ',' ||
    pg_catalog.to_json(p_worker_id)::text || ',' ||
    pg_catalog.to_json(p_assignment_fingerprint)::text || ']';
  v_scope_digest := pg_catalog.sha256(pg_catalog.convert_to(v_scope_canonical,'UTF8'));
  v_scope_hex := pg_catalog.encode(v_scope_digest,'hex');
  v_scope_lock_key := ('x' || pg_catalog.substr(v_scope_hex,1,16))::bit(64)::bigint;

  PERFORM pg_catalog.pg_advisory_xact_lock(v_scope_lock_key);
  RETURN QUERY SELECT v_scope_lock_key, pg_catalog.substr(v_scope_hex,1,24);
END
$scope_lock$;

ALTER FUNCTION public.wfm_lock_agency_identity_assignment_scope_v1(text,text,text,text,text,text)
  OWNER TO wfm_agency_identity_ingress_owner;
REVOKE ALL ON FUNCTION public.wfm_lock_agency_identity_assignment_scope_v1(text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wfm_lock_agency_identity_assignment_scope_v1(text,text,text,text,text,text) TO wfm_agency_identity_ingress_writer, wfm_agency_identity_reader;

CREATE OR REPLACE FUNCTION public.wfm_append_agency_identity_observation_v1(
  p_tenant_id text,
  p_site_id text,
  p_request_id text,
  p_agency_id text,
  p_worker_id text,
  p_assignment_fingerprint text,
  p_assurance_version_id text,
  p_source_system_id text,
  p_source_event_fingerprint text,
  p_subject_fingerprint text,
  p_signal_type text,
  p_observed_at timestamptz,
  p_source_auth_fingerprint text,
  p_binding_fingerprint text,
  p_ingress_version text,
  p_received_at timestamptz,
  p_scope_lock_key bigint
)
RETURNS TABLE(observation_duplicate boolean, receipt_duplicate boolean, scope_fingerprint text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_receipt_count integer := 0;
  v_observation_count integer := 0;
  v_receipt record;
  v_observation record;
  v_database_scope_lock_key bigint;
  v_scope_fingerprint text;
BEGIN
  IF p_tenant_id IS NULL OR btrim(p_tenant_id)='' OR char_length(p_tenant_id)>100 OR p_tenant_id<>btrim(p_tenant_id) OR
     p_site_id IS NULL OR btrim(p_site_id)='' OR char_length(p_site_id)>100 OR p_site_id<>btrim(p_site_id) OR
     p_request_id IS NULL OR btrim(p_request_id)='' OR char_length(p_request_id)>100 OR p_request_id<>btrim(p_request_id) OR
     p_agency_id IS NULL OR btrim(p_agency_id)='' OR char_length(p_agency_id)>100 OR p_agency_id<>btrim(p_agency_id) OR
     p_worker_id IS NULL OR btrim(p_worker_id)='' OR char_length(p_worker_id)>100 OR p_worker_id<>btrim(p_worker_id) OR
     p_source_system_id IS NULL OR btrim(p_source_system_id)='' OR char_length(p_source_system_id)>100 OR p_source_system_id<>btrim(p_source_system_id) OR
     p_ingress_version IS NULL OR btrim(p_ingress_version)='' OR char_length(p_ingress_version)>100 OR p_ingress_version<>btrim(p_ingress_version) OR
     p_assignment_fingerprint !~ '^[0-9a-f]{24}$' OR
     p_assurance_version_id !~ '^[0-9a-f]{32}$' OR
     p_source_event_fingerprint !~ '^[0-9a-f]{32}$' OR
     p_subject_fingerprint !~ '^[0-9a-f]{32}$' OR
     p_source_auth_fingerprint !~ '^[0-9a-f]{32}$' OR
     p_binding_fingerprint !~ '^[0-9a-f]{32}$' OR
     p_signal_type NOT IN ('access_pass','attendance_clock_in','supervised_identity_check','rtw_dvsp_holder_check') OR
     p_observed_at IS NULL OR p_received_at IS NULL THEN
    RAISE EXCEPTION 'identity_observation_boundary_invalid';
  END IF;

  SELECT lock_result.scope_lock_key,lock_result.scope_fingerprint
    INTO STRICT v_database_scope_lock_key,v_scope_fingerprint
    FROM public.wfm_lock_agency_identity_assignment_scope_v1(
      p_tenant_id,p_site_id,p_request_id,p_agency_id,p_worker_id,p_assignment_fingerprint
    ) AS lock_result;

  -- Transitional compatibility only: older callers may still send the mirror
  -- key. It can never choose the lock; the database-owned primitive already
  -- acquired the canonical lock. A mismatching legacy value fails closed.
  IF p_scope_lock_key IS NOT NULL AND p_scope_lock_key IS DISTINCT FROM v_database_scope_lock_key THEN
    RAISE EXCEPTION 'identity_observation_scope_lock_mismatch';
  END IF;

  INSERT INTO public.wfm_agency_identity_observation_ingress_receipts
    (tenant_id,source_system_id,source_event_fingerprint,source_auth_fingerprint,binding_fingerprint,ingress_version,received_at)
  VALUES
    (p_tenant_id,p_source_system_id,p_source_event_fingerprint,p_source_auth_fingerprint,p_binding_fingerprint,p_ingress_version,p_received_at)
  ON CONFLICT (tenant_id,source_system_id,source_event_fingerprint,source_auth_fingerprint) DO NOTHING;
  GET DIAGNOSTICS v_receipt_count = ROW_COUNT;

  IF v_receipt_count = 0 THEN
    SELECT tenant_id,source_system_id,source_event_fingerprint,source_auth_fingerprint,binding_fingerprint,ingress_version,received_at
      INTO STRICT v_receipt
      FROM public.wfm_agency_identity_observation_ingress_receipts
     WHERE tenant_id=p_tenant_id
       AND source_system_id=p_source_system_id
       AND source_event_fingerprint=p_source_event_fingerprint
       AND source_auth_fingerprint=p_source_auth_fingerprint;
    IF v_receipt.binding_fingerprint IS DISTINCT FROM p_binding_fingerprint OR
       v_receipt.ingress_version IS DISTINCT FROM p_ingress_version OR
       v_receipt.received_at IS DISTINCT FROM p_received_at THEN
      RAISE EXCEPTION 'identity_observation_receipt_conflict';
    END IF;
  END IF;

  INSERT INTO public.wfm_agency_identity_continuity_observations
    (tenant_id,site_id,request_id,agency_id,worker_id,assignment_fingerprint,assurance_version_id,source_system_id,source_event_fingerprint,subject_fingerprint,signal_type,observed_at)
  VALUES
    (p_tenant_id,p_site_id,p_request_id,p_agency_id,p_worker_id,p_assignment_fingerprint,p_assurance_version_id,p_source_system_id,p_source_event_fingerprint,p_subject_fingerprint,p_signal_type,p_observed_at)
  ON CONFLICT (tenant_id,source_system_id,source_event_fingerprint) DO NOTHING;
  GET DIAGNOSTICS v_observation_count = ROW_COUNT;

  IF v_observation_count = 0 THEN
    SELECT tenant_id,site_id,request_id,agency_id,worker_id,assignment_fingerprint,assurance_version_id,source_system_id,source_event_fingerprint,subject_fingerprint,signal_type,observed_at
      INTO STRICT v_observation
      FROM public.wfm_agency_identity_continuity_observations
     WHERE tenant_id=p_tenant_id
       AND source_system_id=p_source_system_id
       AND source_event_fingerprint=p_source_event_fingerprint;
    IF v_observation.site_id IS DISTINCT FROM p_site_id OR
       v_observation.request_id IS DISTINCT FROM p_request_id OR
       v_observation.agency_id IS DISTINCT FROM p_agency_id OR
       v_observation.worker_id IS DISTINCT FROM p_worker_id OR
       v_observation.assignment_fingerprint IS DISTINCT FROM p_assignment_fingerprint OR
       v_observation.assurance_version_id IS DISTINCT FROM p_assurance_version_id OR
       v_observation.subject_fingerprint IS DISTINCT FROM p_subject_fingerprint OR
       v_observation.signal_type IS DISTINCT FROM p_signal_type OR
       v_observation.observed_at IS DISTINCT FROM p_observed_at THEN
      RAISE EXCEPTION 'identity_observation_replay_conflict';
    END IF;
  END IF;

  RETURN QUERY SELECT v_observation_count=0, v_receipt_count=0, v_scope_fingerprint;
END
$function$;

ALTER FUNCTION public.wfm_append_agency_identity_observation_v1(text,text,text,text,text,text,text,text,text,text,text,timestamptz,text,text,text,timestamptz,bigint)
  OWNER TO wfm_agency_identity_ingress_owner;
REVOKE CREATE ON SCHEMA public FROM wfm_agency_identity_ingress_owner;
REVOKE ALL ON FUNCTION public.wfm_append_agency_identity_observation_v1(text,text,text,text,text,text,text,text,text,text,text,timestamptz,text,text,text,timestamptz,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wfm_append_agency_identity_observation_v1(text,text,text,text,text,text,text,text,text,text,text,timestamptz,text,text,text,timestamptz,bigint) FROM wfm_agency_identity_reader;
GRANT EXECUTE ON FUNCTION public.wfm_append_agency_identity_observation_v1(text,text,text,text,text,text,text,text,text,text,text,timestamptz,text,text,text,timestamptz,bigint) TO wfm_agency_identity_ingress_writer;
`;

export const AGENCY_IDENTITY_DB_BOUNDARY_AUTHORITY=Object.freeze({
  writerRole:'wfm_agency_identity_ingress_writer',
  readerRole:'wfm_agency_identity_reader',
  ownerRole:'wfm_agency_identity_ingress_owner',
  functionName:'public.wfm_append_agency_identity_observation_v1',
  scopeLockFunctionName:'public.wfm_lock_agency_identity_assignment_scope_v1',
  runtimeDirectTableDmlAllowed:false,
  writerDirectTableDmlAllowed:false,
  writerFunctionExecuteAllowed:true,
  readerFunctionExecuteAllowed:false,
  scopeLockVerifiedServerSide:true,
  databaseOwnedCanonicalScopeLock:true,
  legacyCallerScopeLockKeyOptional:true,
  scopeLockDerivation:'database_owned_sha256_first_signed_64_bits_of_canonical_tenant_site_request_agency_worker_assignment_scope',
  rankingImpact:'none',
  scheduleWriteAuthorized:false,
  clockingWriteAuthorized:false,
  payrollWriteAuthorized:false,
  invoiceWriteAuthorized:false,
});
