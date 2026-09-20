import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENCY_WORK_START_DB_BOUNDARY_AUTHORITY,
  AGENCY_WORK_START_DB_BOUNDARY_DDL,
  AGENCY_WORK_START_LOCKED_SNAPSHOT_SQL,
  AGENCY_WORK_START_SET_LOCAL_ROLE_SQL,
} from '../../src/frontier/agency-work-start-db-boundary.mjs';

const ddl=AGENCY_WORK_START_DB_BOUNDARY_DDL;

test('work-start runtime role is NOLOGIN/NOSUPERUSER and receives only exact evidence-column reads plus controlled function execution',()=>{
  assert.match(ddl,/CREATE ROLE wfm_agency_work_start_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT/i);
  assert.match(ddl,/CREATE ROLE wfm_agency_work_start_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT/i);
  assert.match(ddl,/REVOKE CREATE ON SCHEMA public FROM wfm_agency_work_start_owner, wfm_agency_work_start_reader/i);
  assert.match(ddl,/GRANT SELECT \(tenant_id,agency_id,worker_id,assurance_version_id,site_id,request_id,assignment_fingerprint,checked_at,coverage_until,promoted_at,conflicted\)[\s\S]*wfm_agency_work_start_reader/i);
  assert.match(ddl,/GRANT SELECT \(tenant_id,site_id,request_id,agency_id,token_fingerprint,action,consumed_at,assurance_bindings\)[\s\S]*wfm_agency_work_start_reader/i);
  assert.match(ddl,/GRANT SELECT \(tenant_id,source_system_id,source_event_fingerprint,binding_fingerprint\)[\s\S]*wfm_agency_work_start_reader/i);
  assert.match(ddl,/GRANT EXECUTE ON FUNCTION public\.wfm_read_agency_work_start_locked_snapshot_v1[\s\S]*TO wfm_agency_work_start_reader/i);
  assert.doesNotMatch(ddl,/GRANT\s+(?:INSERT|UPDATE|DELETE|TRUNCATE)[^;]*TO wfm_agency_work_start_reader/i);
});

test('controlled locked snapshot uses the database-owned assignment lock before security-definer row locks and returns minimal evidence',()=>{
  assert.match(ddl,/SECURITY DEFINER\s*\nSET search_path = pg_catalog/i);
  const canonical=ddl.indexOf('FROM public.wfm_lock_agency_identity_assignment_scope_v1(');
  const rtw=ddl.indexOf('FROM public.wfm_agency_rtw_assurance_current AS r');
  const portal=ddl.indexOf('FROM public.wfm_agency_portal_token_consumptions AS consumption');
  assert.ok(canonical>0&&rtw>canonical&&portal>rtw);
  assert.match(ddl,/r\.site_id=p_site_id[\s\S]*r\.request_id=p_request_id[\s\S]*r\.assignment_fingerprint=p_assignment_fingerprint/i);
  assert.equal((ddl.match(/FOR SHARE/g)??[]).length,2);
  assert.match(ddl,/scope_fingerprint text/i);
  assert.doesNotMatch(AGENCY_WORK_START_LOCKED_SNAPSHOT_SQL,/wfm_agency_rtw_assurance_current|wfm_agency_portal_token_consumptions|FOR SHARE|\bUPDATE\b|\bINSERT\b|\bDELETE\b/i);
  assert.match(AGENCY_WORK_START_LOCKED_SNAPSHOT_SQL,/wfm_read_agency_work_start_locked_snapshot_v1/i);
});

test('runtime role activation is fixed and cannot be caller-selected',()=>{
  assert.equal(AGENCY_WORK_START_SET_LOCAL_ROLE_SQL,'SET LOCAL ROLE wfm_agency_work_start_reader;');
  assert.doesNotMatch(AGENCY_WORK_START_SET_LOCAL_ROLE_SQL,/\$\d|public|current_user|session_user/i);
});

test('boundary metadata preserves eligibility/ranking separation and grants no live mutation authority',()=>{
  assert.equal(AGENCY_WORK_START_DB_BOUNDARY_AUTHORITY.runtimeRole,'wfm_agency_work_start_reader');
  assert.equal(AGENCY_WORK_START_DB_BOUNDARY_AUTHORITY.exactEvidenceColumnReadsOnly,true);
  assert.equal(AGENCY_WORK_START_DB_BOUNDARY_AUTHORITY.canonicalAssignmentLockAuthority,'database_owned');
  assert.equal(AGENCY_WORK_START_DB_BOUNDARY_AUTHORITY.directTableInsertAllowed,false);
  assert.equal(AGENCY_WORK_START_DB_BOUNDARY_AUTHORITY.directTableUpdateAllowed,false);
  assert.equal(AGENCY_WORK_START_DB_BOUNDARY_AUTHORITY.directTableDeleteAllowed,false);
  assert.equal(AGENCY_WORK_START_DB_BOUNDARY_AUTHORITY.directTableTruncateAllowed,false);
  assert.equal(AGENCY_WORK_START_DB_BOUNDARY_AUTHORITY.rankingImpact,'none');
  assert.equal(AGENCY_WORK_START_DB_BOUNDARY_AUTHORITY.scheduleWriteAuthorized,false);
  assert.equal(AGENCY_WORK_START_DB_BOUNDARY_AUTHORITY.clockingWriteAuthorized,false);
  assert.equal(AGENCY_WORK_START_DB_BOUNDARY_AUTHORITY.payrollWriteAuthorized,false);
  assert.equal(AGENCY_WORK_START_DB_BOUNDARY_AUTHORITY.invoiceWriteAuthorized,false);
  assert.equal(AGENCY_WORK_START_DB_BOUNDARY_AUTHORITY.workerMasterWriteAuthorized,false);
});
