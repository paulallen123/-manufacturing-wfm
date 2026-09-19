import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENCY_IDENTITY_DB_BOUNDARY_AUTHORITY,
  AGENCY_IDENTITY_DB_BOUNDARY_DDL,
  AGENCY_IDENTITY_DB_BOUNDARY_VERSION,
} from '../../src/frontier/agency-identity-db-boundary.mjs';

test('least-privilege identity boundary exposes only controlled functions and keeps runtime evidence DML denied',()=>{
  assert.equal(AGENCY_IDENTITY_DB_BOUNDARY_VERSION,'agency-identity-db-boundary-v0.3.0');
  assert.equal(AGENCY_IDENTITY_DB_BOUNDARY_AUTHORITY.writerDirectTableDmlAllowed,false);
  assert.equal(AGENCY_IDENTITY_DB_BOUNDARY_AUTHORITY.readerFunctionExecuteAllowed,false);
  assert.equal(AGENCY_IDENTITY_DB_BOUNDARY_AUTHORITY.scopeLockVerifiedServerSide,true);
  assert.equal(AGENCY_IDENTITY_DB_BOUNDARY_AUTHORITY.databaseOwnedCanonicalScopeLock,true);
  assert.equal(AGENCY_IDENTITY_DB_BOUNDARY_AUTHORITY.legacyCallerScopeLockKeyOptional,true);
  assert.equal(AGENCY_IDENTITY_DB_BOUNDARY_AUTHORITY.scheduleWriteAuthorized,false);
  assert.equal(AGENCY_IDENTITY_DB_BOUNDARY_AUTHORITY.clockingWriteAuthorized,false);
  assert.equal(AGENCY_IDENTITY_DB_BOUNDARY_AUTHORITY.payrollWriteAuthorized,false);
  assert.equal(AGENCY_IDENTITY_DB_BOUNDARY_AUTHORITY.invoiceWriteAuthorized,false);
  assert.match(AGENCY_IDENTITY_DB_BOUNDARY_DDL,/CREATE ROLE wfm_agency_identity_ingress_owner NOLOGIN/i);
  assert.match(AGENCY_IDENTITY_DB_BOUNDARY_DDL,/CREATE ROLE wfm_agency_identity_ingress_writer NOLOGIN/i);
  assert.match(AGENCY_IDENTITY_DB_BOUNDARY_DDL,/CREATE ROLE wfm_agency_identity_reader NOLOGIN/i);
  assert.match(AGENCY_IDENTITY_DB_BOUNDARY_DDL,/REVOKE ALL ON TABLE public\.wfm_agency_identity_observation_ingress_receipts FROM wfm_agency_identity_ingress_writer, wfm_agency_identity_reader/i);
  assert.match(AGENCY_IDENTITY_DB_BOUNDARY_DDL,/REVOKE ALL ON TABLE public\.wfm_agency_identity_continuity_observations FROM wfm_agency_identity_ingress_writer, wfm_agency_identity_reader/i);
  assert.match(AGENCY_IDENTITY_DB_BOUNDARY_DDL,/GRANT EXECUTE ON FUNCTION public\.wfm_append_agency_identity_observation_v1[\s\S]*TO wfm_agency_identity_ingress_writer/i);
  assert.match(AGENCY_IDENTITY_DB_BOUNDARY_DDL,/GRANT EXECUTE ON FUNCTION public\.wfm_lock_agency_identity_assignment_scope_v1[\s\S]*TO wfm_agency_identity_ingress_writer, wfm_agency_identity_reader/i);
  assert.doesNotMatch(AGENCY_IDENTITY_DB_BOUNDARY_DDL,/GRANT\s+(?:INSERT|UPDATE|DELETE)[\s\S]*TO wfm_agency_identity_ingress_writer/i);
});

test('database-owned assignment lock canonicalises full scope, derives signed 64-bit key and locks before returning evidence',()=>{
  const ddl=AGENCY_IDENTITY_DB_BOUNDARY_DDL;
  const primitive=ddl.indexOf('CREATE OR REPLACE FUNCTION public.wfm_lock_agency_identity_assignment_scope_v1');
  const canonical=ddl.indexOf('v_scope_canonical :=',primitive);
  const sha=ddl.indexOf('pg_catalog.sha256',canonical);
  const signedKey=ddl.indexOf("::bit(64)::bigint",sha);
  const lock=ddl.indexOf('PERFORM pg_catalog.pg_advisory_xact_lock(v_scope_lock_key)',signedKey);
  const returned=ddl.indexOf('RETURN QUERY SELECT v_scope_lock_key',lock);
  assert.ok(primitive>0&&canonical>primitive&&sha>canonical&&signedKey>sha&&lock>signedKey&&returned>lock);
  assert.match(ddl,/pg_catalog\.to_json\(p_tenant_id\)[\s\S]*pg_catalog\.to_json\(p_site_id\)[\s\S]*pg_catalog\.to_json\(p_request_id\)[\s\S]*pg_catalog\.to_json\(p_agency_id\)[\s\S]*pg_catalog\.to_json\(p_worker_id\)[\s\S]*pg_catalog\.to_json\(p_assignment_fingerprint\)/i);
  assert.match(ddl,/RETURNS TABLE\(scope_lock_key bigint, scope_fingerprint text\)/i);
  assert.match(ddl,/SECURITY DEFINER\s+SET search_path = pg_catalog/i);
});

test('controlled append delegates locking to database primitive before either evidence write and legacy caller key cannot choose the lock',()=>{
  const ddl=AGENCY_IDENTITY_DB_BOUNDARY_DDL;
  const append=ddl.indexOf('CREATE OR REPLACE FUNCTION public.wfm_append_agency_identity_observation_v1');
  const sharedLock=ddl.indexOf('FROM public.wfm_lock_agency_identity_assignment_scope_v1',append);
  const legacyCheck=ddl.indexOf('p_scope_lock_key IS NOT NULL',sharedLock);
  const mismatch=ddl.indexOf("RAISE EXCEPTION 'identity_observation_scope_lock_mismatch'",legacyCheck);
  const receiptInsert=ddl.indexOf('INSERT INTO public.wfm_agency_identity_observation_ingress_receipts',mismatch);
  const observationInsert=ddl.indexOf('INSERT INTO public.wfm_agency_identity_continuity_observations',receiptInsert);
  assert.ok(append>0&&sharedLock>append&&legacyCheck>sharedLock&&mismatch>legacyCheck&&receiptInsert>mismatch&&observationInsert>receiptInsert);
  assert.doesNotMatch(ddl.slice(append),/PERFORM pg_catalog\.pg_advisory_xact_lock\(p_scope_lock_key\)/i);
  assert.match(ddl.slice(append),/RETURN QUERY SELECT v_observation_count=0, v_receipt_count=0, v_scope_fingerprint/i);
});

test('controlled append function is security-definer, search-path pinned, append-only and conflict-safe',()=>{
  const ddl=AGENCY_IDENTITY_DB_BOUNDARY_DDL;
  assert.match(ddl,/SECURITY DEFINER\s+SET search_path = pg_catalog/i);
  assert.match(ddl,/ON CONFLICT \(tenant_id,source_system_id,source_event_fingerprint,source_auth_fingerprint\) DO NOTHING/i);
  assert.match(ddl,/ON CONFLICT \(tenant_id,source_system_id,source_event_fingerprint\) DO NOTHING/i);
  assert.match(ddl,/identity_observation_receipt_conflict/);
  assert.match(ddl,/identity_observation_replay_conflict/);
  assert.match(ddl,/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC/i);
  assert.match(ddl,/REVOKE CREATE ON SCHEMA public FROM wfm_agency_identity_ingress_owner/i);
});

test('boundary persists fingerprints and scoped evidence only, never raw badge, payload, photo or biometric content',()=>{
  const ddl=AGENCY_IDENTITY_DB_BOUNDARY_DDL.toLowerCase();
  for(const forbidden of ['raw_badge','raw_payload','webhook_body','signature_value','photo_data','biometric_template','date_of_birth','share_code','document_number']){
    assert.equal(ddl.includes(forbidden),false,forbidden);
  }
  for(const required of ['source_event_fingerprint','source_auth_fingerprint','binding_fingerprint','subject_fingerprint','assurance_version_id','assignment_fingerprint']){
    assert.equal(ddl.includes(required),true,required);
  }
});
