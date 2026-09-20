export const AGENCY_WORK_START_PRINCIPAL_LIFECYCLE_VERSION='agency-work-start-principal-lifecycle-v0.1.0';
export const AGENCY_WORK_START_TENANT_BINDING_ADMIN_ROLE='wfm_agency_work_start_tenant_binding_admin';
export const AGENCY_WORK_START_DB_OWNER_ROLE='wfm_agency_work_start_owner';

export const AGENCY_WORK_START_BIND_PRINCIPAL_SQL=`
SELECT public.wfm_bind_agency_work_start_principal_v1($1,$2,$3);
`;

export const AGENCY_WORK_START_REVOKE_PRINCIPAL_SQL=`
SELECT public.wfm_revoke_agency_work_start_principal_v1($1,$2,$3);
`;

export const AGENCY_WORK_START_PRINCIPAL_LIFECYCLE_DDL=`
ALTER TABLE public.wfm_agency_work_start_principal_tenants
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revocation_fingerprint text;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
     WHERE conrelid='public.wfm_agency_work_start_principal_tenants'::regclass
       AND conname='wfm_agency_work_start_principal_tenants_revocation_fingerprint_check'
  ) THEN
    ALTER TABLE public.wfm_agency_work_start_principal_tenants
      ADD CONSTRAINT wfm_agency_work_start_principal_tenants_revocation_fingerprint_check
      CHECK (revocation_fingerprint IS NULL OR revocation_fingerprint ~ '^[0-9a-f]{24}$');
  END IF;
END
$constraints$;

-- Lifecycle administration is function-only. The admin role cannot enumerate,
-- rewrite, delete, or rebind principal rows directly.
REVOKE ALL ON TABLE public.wfm_agency_work_start_principal_tenants
  FROM wfm_agency_work_start_tenant_binding_admin;

CREATE OR REPLACE FUNCTION public.wfm_bind_agency_work_start_principal_v1(
  p_database_principal name,
  p_tenant_id text,
  p_binding_fingerprint text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $bind$
DECLARE
  v_role record;
  v_inserted name;
BEGIN
  IF p_database_principal IS NULL OR btrim(p_database_principal::text)='' OR
     p_tenant_id IS NULL OR btrim(p_tenant_id)='' OR p_tenant_id<>btrim(p_tenant_id) OR char_length(p_tenant_id)>100 OR
     p_binding_fingerprint !~ '^[0-9a-f]{24}$' THEN
    RAISE EXCEPTION 'work_start_principal_binding_invalid';
  END IF;

  SELECT r.rolcanlogin,r.rolsuper,r.rolcreatedb,r.rolcreaterole
    INTO STRICT v_role
    FROM pg_catalog.pg_roles AS r
   WHERE r.rolname=p_database_principal;

  IF NOT v_role.rolcanlogin OR v_role.rolsuper OR v_role.rolcreatedb OR v_role.rolcreaterole THEN
    RAISE EXCEPTION 'work_start_principal_binding_role_invalid';
  END IF;

  INSERT INTO public.wfm_agency_work_start_principal_tenants(
    database_principal,tenant_id,binding_fingerprint,bound_at,revoked_at,revocation_fingerprint
  ) VALUES (
    p_database_principal,p_tenant_id,p_binding_fingerprint,pg_catalog.clock_timestamp(),NULL,NULL
  )
  ON CONFLICT (database_principal) DO NOTHING
  RETURNING database_principal INTO v_inserted;

  IF v_inserted IS NULL THEN
    RAISE EXCEPTION 'work_start_principal_already_bound';
  END IF;

  RETURN p_binding_fingerprint;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    RAISE EXCEPTION 'work_start_principal_binding_role_missing';
END
$bind$;

ALTER FUNCTION public.wfm_bind_agency_work_start_principal_v1(name,text,text)
  OWNER TO wfm_agency_work_start_owner;
REVOKE ALL ON FUNCTION public.wfm_bind_agency_work_start_principal_v1(name,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wfm_bind_agency_work_start_principal_v1(name,text,text)
  FROM wfm_agency_work_start_reader, wfm_agency_identity_ingress_writer, wfm_agency_identity_reader;
GRANT EXECUTE ON FUNCTION public.wfm_bind_agency_work_start_principal_v1(name,text,text)
  TO wfm_agency_work_start_tenant_binding_admin;

CREATE OR REPLACE FUNCTION public.wfm_revoke_agency_work_start_principal_v1(
  p_database_principal name,
  p_tenant_id text,
  p_revocation_fingerprint text
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $revoke$
DECLARE
  v_revoked_at timestamptz;
BEGIN
  IF p_database_principal IS NULL OR btrim(p_database_principal::text)='' OR
     p_tenant_id IS NULL OR btrim(p_tenant_id)='' OR p_tenant_id<>btrim(p_tenant_id) OR char_length(p_tenant_id)>100 OR
     p_revocation_fingerprint !~ '^[0-9a-f]{24}$' THEN
    RAISE EXCEPTION 'work_start_principal_revocation_invalid';
  END IF;

  UPDATE public.wfm_agency_work_start_principal_tenants
     SET revoked_at=pg_catalog.clock_timestamp(),
         revocation_fingerprint=p_revocation_fingerprint
   WHERE database_principal=p_database_principal
     AND tenant_id=p_tenant_id
     AND revoked_at IS NULL
  RETURNING revoked_at INTO v_revoked_at;

  IF v_revoked_at IS NULL THEN
    RAISE EXCEPTION 'work_start_principal_revocation_failed';
  END IF;

  RETURN v_revoked_at;
END
$revoke$;

ALTER FUNCTION public.wfm_revoke_agency_work_start_principal_v1(name,text,text)
  OWNER TO wfm_agency_work_start_owner;
REVOKE ALL ON FUNCTION public.wfm_revoke_agency_work_start_principal_v1(name,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wfm_revoke_agency_work_start_principal_v1(name,text,text)
  FROM wfm_agency_work_start_reader, wfm_agency_identity_ingress_writer, wfm_agency_identity_reader;
GRANT EXECUTE ON FUNCTION public.wfm_revoke_agency_work_start_principal_v1(name,text,text)
  TO wfm_agency_work_start_tenant_binding_admin;

-- Replaces the v1 guard implementation without changing its signature. Every
-- work-start read revalidates session_user against the durable binding row. FOR SHARE
-- makes revocation serialize with an in-flight work-start transaction: revocation
-- first => the work-start waits and then fails closed; work-start first => the current
-- transaction may finish, revocation waits, and every subsequent call fails closed.
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
  v_revoked_at timestamptz;
BEGIN
  IF p_tenant_id IS NULL OR btrim(p_tenant_id)='' OR char_length(p_tenant_id)>100 OR p_tenant_id<>btrim(p_tenant_id) THEN
    RAISE EXCEPTION 'work_start_tenant_principal_scope_invalid';
  END IF;

  SELECT r.rolcanlogin,r.rolsuper,r.rolcreatedb,r.rolcreaterole
    INTO STRICT v_role
    FROM pg_catalog.pg_roles AS r
   WHERE r.rolname=session_user;

  IF v_role.rolsuper THEN
    RETURN;
  END IF;
  IF NOT v_role.rolcanlogin OR v_role.rolcreatedb OR v_role.rolcreaterole THEN
    RAISE EXCEPTION 'work_start_tenant_principal_invalid';
  END IF;

  SELECT binding.tenant_id,binding.revoked_at
    INTO v_bound_tenant,v_revoked_at
    FROM public.wfm_agency_work_start_principal_tenants AS binding
   WHERE binding.database_principal=session_user
   FOR SHARE;

  IF NOT FOUND OR v_bound_tenant IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'work_start_tenant_principal_unauthorized';
  END IF;
  IF v_revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'work_start_tenant_principal_revoked';
  END IF;
END
$principal_guard$;

ALTER FUNCTION public.wfm_assert_agency_work_start_tenant_principal_v1(text)
  OWNER TO wfm_agency_work_start_owner;
REVOKE ALL ON FUNCTION public.wfm_assert_agency_work_start_tenant_principal_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wfm_assert_agency_work_start_tenant_principal_v1(text)
  FROM wfm_agency_work_start_reader, wfm_agency_work_start_tenant_binding_admin, wfm_agency_identity_ingress_writer, wfm_agency_identity_reader;
`;

export const AGENCY_WORK_START_PRINCIPAL_LIFECYCLE_AUTHORITY=Object.freeze({
  tenantAuthorizationAuthority:'database_session_user_principal_binding',
  bindingMutationAuthority:'security_definer_admin_functions_only',
  directBindingTableAdminDmlAllowed:false,
  tenantRebindingAllowed:false,
  revokedPrincipalReuseAllowed:false,
  tenantChangeRequiresNewDatabasePrincipal:true,
  revocationCheckedEveryControlledRead:true,
  pooledConnectionRevalidatedOnEveryControlledRead:true,
  revocationRacePolicy:'work_start_transaction_or_revocation_then_fail_closed',
  rankingImpact:'none',
  scheduleWriteAuthorized:false,
  clockingWriteAuthorized:false,
  payrollWriteAuthorized:false,
  invoiceWriteAuthorized:false,
  workerMasterWriteAuthorized:false,
});
