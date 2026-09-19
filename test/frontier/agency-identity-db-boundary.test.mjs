import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENCY_IDENTITY_DB_BOUNDARY_AUTHORITY,
  AGENCY_IDENTITY_DB_BOUNDARY_DDL,
  AGENCY_IDENTITY_DB_BOUNDARY_VERSION,
} from '../../src/frontier/agency-identity-db-boundary.mjs';

test('least-privilege identity boundary exposes only the controlled writer function to the ingress role',()=>{
  assert.equal(AGENCY_IDENTITY_DB_BOUNDARY_VERSION,'agency-identity-db-boundary-v0.1.0');
  assert.equal(AGENCY_IDENTITY_DB_BOUNDARY_AUTHORITY.writerDirectTableDmlAllowed,false);
  assert.equal(AGENCY_IDENTITY_DB_BOUNDARY_AUTHORITY.readerFunctionExecuteAllowed,false);
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
  assert.doesNotMatch(AGENCY_IDENTITY_DB_BOUNDARY_DDL,/GRANT\s+(?:INSERT|UPDATE|DELETE)[\s\S]*TO wfm_agency_identity_ingress_writer/i);
});

test('controlled append function is security-definer, search-path pinned, append-only and lock-before-write',()=>{
  const ddl=AGENCY_IDENTITY_DB_BOUNDARY_DDL;
  const lock=ddl.indexOf('PERFORM pg_catalog.pg_advisory_xact_lock');
  const receiptInsert=ddl.indexOf('INSERT INTO public.wfm_agency_identity_observation_ingress_receipts');
  const observationInsert=ddl.indexOf('INSERT INTO public.wfm_agency_identity_continuity_observations');
  assert.ok(lock>0&&receiptInsert>lock&&observationInsert>receiptInsert);
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
