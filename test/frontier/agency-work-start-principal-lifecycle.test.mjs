import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  AGENCY_WORK_START_BIND_PRINCIPAL_SQL,
  AGENCY_WORK_START_CANONICAL_MIGRATION_DDL,
  AGENCY_WORK_START_CANONICAL_MIGRATION_VERSION,
  AGENCY_WORK_START_PRINCIPAL_LIFECYCLE_AUTHORITY,
  AGENCY_WORK_START_PRINCIPAL_LIFECYCLE_DDL,
  AGENCY_WORK_START_REVOKE_PRINCIPAL_SQL,
} from '../../src/frontier/agency-work-start-principal-lifecycle.mjs';

const ddl=AGENCY_WORK_START_PRINCIPAL_LIFECYCLE_DDL;

test('binding lifecycle removes direct admin table DML and exposes only controlled bind/revoke functions',()=>{
  assert.match(ddl,/REVOKE ALL ON TABLE public\.wfm_agency_work_start_principal_tenants\s+FROM wfm_agency_work_start_tenant_binding_admin/i);
  assert.doesNotMatch(ddl,/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|TRUNCATE)[^;]*wfm_agency_work_start_principal_tenants[^;]*wfm_agency_work_start_tenant_binding_admin/i);
  assert.match(ddl,/GRANT EXECUTE ON FUNCTION public\.wfm_bind_agency_work_start_principal_v1\(name,text,text\)[\s\S]*TO wfm_agency_work_start_tenant_binding_admin/i);
  assert.match(ddl,/GRANT EXECUTE ON FUNCTION public\.wfm_revoke_agency_work_start_principal_v1\(name,text,text\)[\s\S]*TO wfm_agency_work_start_tenant_binding_admin/i);
  assert.match(AGENCY_WORK_START_BIND_PRINCIPAL_SQL,/wfm_bind_agency_work_start_principal_v1\(\$1,\$2,\$3\)/i);
  assert.match(AGENCY_WORK_START_REVOKE_PRINCIPAL_SQL,/wfm_revoke_agency_work_start_principal_v1\(\$1,\$2,\$3\)/i);
});

test('binding is insert-only per principal so rotation requires a new database principal rather than tenant reassignment',()=>{
  const bind=ddl.slice(ddl.indexOf('CREATE OR REPLACE FUNCTION public.wfm_bind_agency_work_start_principal_v1'),ddl.indexOf('CREATE OR REPLACE FUNCTION public.wfm_revoke_agency_work_start_principal_v1'));
  assert.match(bind,/INSERT INTO public\.wfm_agency_work_start_principal_tenants/i);
  assert.match(bind,/ON CONFLICT \(database_principal\) DO NOTHING/i);
  assert.match(bind,/RAISE EXCEPTION 'work_start_principal_already_bound'/i);
  assert.doesNotMatch(bind,/DO UPDATE|SET\s+tenant_id\s*=/i);
  assert.match(bind,/rolcanlogin[\s\S]*rolsuper[\s\S]*rolcreatedb[\s\S]*rolcreaterole/i);
});

test('revocation is durable, tenant-scoped and retains the principal row to prevent credential reuse',()=>{
  const revoke=ddl.slice(ddl.indexOf('CREATE OR REPLACE FUNCTION public.wfm_revoke_agency_work_start_principal_v1'),ddl.indexOf('-- Replaces the v1 guard implementation'));
  assert.match(revoke,/UPDATE public\.wfm_agency_work_start_principal_tenants/i);
  assert.match(revoke,/SET revoked_at=pg_catalog\.clock_timestamp\(\)/i);
  assert.match(revoke,/revocation_fingerprint=p_revocation_fingerprint/i);
  assert.match(revoke,/database_principal=p_database_principal[\s\S]*tenant_id=p_tenant_id[\s\S]*revoked_at IS NULL/i);
  assert.doesNotMatch(revoke,/DELETE FROM public\.wfm_agency_work_start_principal_tenants/i);
});

test('every controlled read revalidates session_user and serializes against revocation using a row share lock',()=>{
  const guard=ddl.slice(ddl.indexOf('CREATE OR REPLACE FUNCTION public.wfm_assert_agency_work_start_tenant_principal_v1'));
  assert.match(guard,/WHERE r\.rolname=session_user/i);
  assert.match(guard,/WHERE binding\.database_principal=session_user[\s\S]*FOR SHARE/i);
  assert.match(guard,/v_bound_tenant IS DISTINCT FROM p_tenant_id[\s\S]*work_start_tenant_principal_unauthorized/i);
  assert.match(guard,/v_revoked_at IS NOT NULL[\s\S]*work_start_tenant_principal_revoked/i);
  assert.doesNotMatch(guard,/current_setting\(|set_config\(|application_name|client_addr/i);
});

test('canonical migration is transactional and always leaves lifecycle hardening after the base boundary',()=>{
  assert.equal(AGENCY_WORK_START_CANONICAL_MIGRATION_VERSION,'agency-work-start-canonical-migration-v0.1.0');
  const migration=AGENCY_WORK_START_CANONICAL_MIGRATION_DDL;
  assert.match(migration,/^\s*BEGIN;/i);
  assert.match(migration,/COMMIT;\s*$/i);
  const baseGrant=migration.indexOf('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.wfm_agency_work_start_principal_tenants TO wfm_agency_work_start_tenant_binding_admin');
  const finalRevoke=migration.lastIndexOf('REVOKE ALL ON TABLE public.wfm_agency_work_start_principal_tenants\n  FROM wfm_agency_work_start_tenant_binding_admin');
  assert.ok(baseGrant>=0&&finalRevoke>baseGrant,'lifecycle ACL hardening must be applied after the base boundary grant');
  const firstGuard=migration.indexOf('CREATE OR REPLACE FUNCTION public.wfm_assert_agency_work_start_tenant_principal_v1');
  const finalGuard=migration.lastIndexOf('CREATE OR REPLACE FUNCTION public.wfm_assert_agency_work_start_tenant_principal_v1');
  assert.ok(firstGuard>=0&&finalGuard>firstGuard,'lifecycle guard must replace the base guard last');
  const hardenedGuard=migration.slice(finalGuard);
  assert.match(hardenedGuard,/binding\.tenant_id,binding\.revoked_at/i);
  assert.match(hardenedGuard,/WHERE binding\.database_principal=session_user[\s\S]*FOR SHARE/i);
  assert.match(hardenedGuard,/work_start_tenant_principal_revoked/i);
  const a=AGENCY_WORK_START_PRINCIPAL_LIFECYCLE_AUTHORITY;
  assert.equal(a.canonicalMigrationOrder,'db_boundary_then_principal_lifecycle');
  assert.equal(a.canonicalMigrationTransactional,true);
  assert.equal(a.canonicalMigrationRollbackOnFailure,true);
  assert.equal(a.canonicalMigrationFinalHardeningRequired,true);
  assert.equal(a.standaloneDbBoundaryAfterLifecycleAuthorized,false);
});

test('production-like runtime race proof installs the canonical work-start migration, never the raw base boundary',()=>{
  const runtimeProof=readFileSync(new URL('./agency-postgres-work-start-runtime-race.test.mjs',import.meta.url),'utf8');
  assert.match(runtimeProof,/import \{AGENCY_WORK_START_CANONICAL_MIGRATION_DDL\} from '\.\.\/\.\.\/src\/frontier\/agency-work-start-principal-lifecycle\.mjs';/);
  assert.match(runtimeProof,/\$\{AGENCY_WORK_START_CANONICAL_MIGRATION_DDL\}/);
  assert.doesNotMatch(runtimeProof,/import \{AGENCY_WORK_START_DB_BOUNDARY_DDL\} from '\.\.\/\.\.\/src\/frontier\/agency-work-start-db-boundary\.mjs';/);
  assert.doesNotMatch(runtimeProof,/\$\{AGENCY_WORK_START_DB_BOUNDARY_DDL\}/);
});

test('lifecycle metadata preserves eligibility/ranking separation and grants no live mutation authority',()=>{
  const a=AGENCY_WORK_START_PRINCIPAL_LIFECYCLE_AUTHORITY;
  assert.equal(a.directBindingTableAdminDmlAllowed,false);
  assert.equal(a.tenantRebindingAllowed,false);
  assert.equal(a.revokedPrincipalReuseAllowed,false);
  assert.equal(a.tenantChangeRequiresNewDatabasePrincipal,true);
  assert.equal(a.revocationCheckedEveryControlledRead,true);
  assert.equal(a.pooledConnectionRevalidatedOnEveryControlledRead,true);
  assert.equal(a.rankingImpact,'none');
  assert.equal(a.scheduleWriteAuthorized,false);
  assert.equal(a.clockingWriteAuthorized,false);
  assert.equal(a.payrollWriteAuthorized,false);
  assert.equal(a.invoiceWriteAuthorized,false);
  assert.equal(a.workerMasterWriteAuthorized,false);
});
