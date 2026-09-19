import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENCY_RIGHT_TO_WORK_DVSP_EVIDENCE_DDL,
  createAgencyRightToWorkDvspEvidenceVersion,
  createPostgresAgencyRightToWorkDvspEvidenceStore,
  resolveAgencyRightToWorkDvspEvidenceForCheck,
  toAgencyRightToWorkDvspPolicySnapshot,
} from '../../src/frontier/agency-right-to-work-dvsp-evidence.mjs';

const RAW_REGISTER_REF = 'private-register-evidence://dvsp-1/certificate-2026-09-02';
const BASE = {
  tenantId:'T1', agencyId:'A1', providerId:'DVSP-1', registryStatus:'registered',
  trustFrameworkCertified:true, rightToWorkSupplementaryCodeCertified:true,
  rightToWorkSupplementaryCodeVersion:'1.1', exclusiveForAgencyRightToWork:true,
  effectiveAt:'2026-09-02T00:00:00.000Z', expiresAt:'2027-09-02T00:00:00.000Z',
  registryVerifiedAt:'2026-09-18T09:00:00.000Z', registryEvidenceRef:RAW_REGISTER_REF,
  evidenceSource:'ofdia_statutory_dvs_register', recordedAt:'2026-09-18T09:01:00.000Z',
};

const worker = (providerId='DVSP-1') => ({
  workerId:'W1', agencyId:'A1', rightToWork:{ dvspProviderId:providerId },
});
const agency = { agencyId:'A1' };

test('creates deterministic immutable provider evidence without retaining raw register evidence', () => {
  const a = createAgencyRightToWorkDvspEvidenceVersion(BASE);
  const b = createAgencyRightToWorkDvspEvidenceVersion({ ...BASE, recordedAt:'2026-09-18T09:05:00.000Z' });
  assert.equal(a.evidenceVersionId, b.evidenceVersionId);
  assert.match(a.evidenceVersionId, /^[0-9a-f]{32}$/);
  assert.match(a.registryEvidenceFingerprint, /^[0-9a-f]{24}$/);
  assert.equal(Object.hasOwn(a, 'registryEvidenceRef'), false);
  assert.doesNotMatch(JSON.stringify(a), /private-register-evidence/);
  assert.equal(Object.isFrozen(a), true);
});

test('materialises a policy snapshot bound to tenant, agency, provider and evidence version', () => {
  const evidence = createAgencyRightToWorkDvspEvidenceVersion(BASE);
  const snapshot = toAgencyRightToWorkDvspPolicySnapshot(evidence);
  assert.equal(snapshot.evidenceTenantId, 'T1');
  assert.equal(snapshot.evidenceAgencyId, 'A1');
  assert.equal(snapshot.providerId, 'DVSP-1');
  assert.equal(snapshot.evidenceVersionId, evidence.evidenceVersionId);
  assert.equal(snapshot.registryEvidenceFingerprint, evidence.registryEvidenceFingerprint);
  assert.equal(Object.hasOwn(snapshot, 'registryEvidenceRef'), false);
});

test('rejects malformed validity and evidence timing at version creation', () => {
  assert.throws(() => createAgencyRightToWorkDvspEvidenceVersion({ ...BASE, expiresAt:'2026-09-01T00:00:00.000Z' }), /expiresAt/);
  assert.throws(() => createAgencyRightToWorkDvspEvidenceVersion({ ...BASE, registryVerifiedAt:'2026-09-18T10:00:00.000Z', recordedAt:'2026-09-18T09:00:00.000Z' }), /registryVerifiedAt/);
  assert.throws(() => createAgencyRightToWorkDvspEvidenceVersion({ ...BASE, registryEvidenceRef:'' }), /registryEvidenceRef/);
});

test('PostgreSQL contract is append-only, scoped and resolves only evidence valid at check time', async () => {
  assert.match(AGENCY_RIGHT_TO_WORK_DVSP_EVIDENCE_DDL, /PRIMARY KEY \(tenant_id, agency_id, provider_id, evidence_version_id\)/);
  assert.match(AGENCY_RIGHT_TO_WORK_DVSP_EVIDENCE_DDL, /registry_evidence_fingerprint varchar\(24\) NOT NULL/);
  assert.doesNotMatch(AGENCY_RIGHT_TO_WORK_DVSP_EVIDENCE_DDL, /registry_evidence_ref/);

  const calls = [];
  const evidence = createAgencyRightToWorkDvspEvidenceVersion(BASE);
  const store = createPostgresAgencyRightToWorkDvspEvidenceStore({ query: async (sql, values) => {
    calls.push({ sql, values });
    if (/^\s*INSERT/i.test(sql)) return { rowCount:1, rows:[{ evidence_version_id:evidence.evidenceVersionId }] };
    return { rowCount:1, rows:[{
      tenant_id:evidence.tenantId, agency_id:evidence.agencyId, provider_id:evidence.providerId,
      evidence_version_id:evidence.evidenceVersionId, registry_status:evidence.registryStatus,
      trust_framework_certified:true, right_to_work_supplementary_code_certified:true,
      right_to_work_supplementary_code_version:'1.1', exclusive_for_agency_right_to_work:true,
      effective_at:evidence.effectiveAt, expires_at:evidence.expiresAt,
      registry_verified_at:evidence.registryVerifiedAt, registry_evidence_fingerprint:evidence.registryEvidenceFingerprint,
      evidence_source:evidence.evidenceSource, recorded_at:evidence.recordedAt,
    }] };
  }});

  const saved = await store.recordOnce(evidence);
  assert.equal(saved.recorded, true);
  const resolved = await store.resolveForCheck({ tenantId:'T1', agencyId:'A1', providerId:'DVSP-1', checkedAt:'2026-10-04T10:00:00.000Z' });
  assert.equal(resolved.found, true);
  const select = calls.find(call => /^\s*SELECT/i.test(call.sql));
  assert.match(select.sql, /effective_at <= \$4::timestamptz/);
  assert.match(select.sql, /registry_verified_at <= \$4::timestamptz/);
  assert.match(select.sql, /expires_at IS NULL OR expires_at > \$4::timestamptz/);
  assert.match(select.sql, /LIMIT 2/);
});

test('duplicate append is idempotent rather than overwriting provider history', async () => {
  const evidence = createAgencyRightToWorkDvspEvidenceVersion(BASE);
  const store = createPostgresAgencyRightToWorkDvspEvidenceStore({ query: async () => ({ rowCount:0, rows:[] }) });
  const result = await store.recordOnce(evidence);
  assert.deepEqual(result, { recorded:false, reason:'already_recorded', evidenceVersionId:evidence.evidenceVersionId });
});

test('same-time conflicting versions fail closed rather than picking arbitrary provider evidence', async () => {
  const first = createAgencyRightToWorkDvspEvidenceVersion(BASE);
  const second = createAgencyRightToWorkDvspEvidenceVersion({ ...BASE, registryStatus:'suspended' });
  const rows = [first, second].map((e) => ({
    tenant_id:e.tenantId, agency_id:e.agencyId, provider_id:e.providerId, evidence_version_id:e.evidenceVersionId,
    registry_status:e.registryStatus, trust_framework_certified:e.trustFrameworkCertified,
    right_to_work_supplementary_code_certified:e.rightToWorkSupplementaryCodeCertified,
    right_to_work_supplementary_code_version:e.rightToWorkSupplementaryCodeVersion,
    exclusive_for_agency_right_to_work:e.exclusiveForAgencyRightToWork,
    effective_at:e.effectiveAt, expires_at:e.expiresAt, registry_verified_at:e.registryVerifiedAt,
    registry_evidence_fingerprint:e.registryEvidenceFingerprint, evidence_source:e.evidenceSource, recorded_at:e.recordedAt,
  }));
  const store = createPostgresAgencyRightToWorkDvspEvidenceStore({ query: async () => ({ rowCount:2, rows }) });
  const result = await store.resolveForCheck({ tenantId:'T1', agencyId:'A1', providerId:'DVSP-1', checkedAt:'2026-10-04T10:00:00.000Z' });
  assert.deepEqual(result, { found:false, reason:'ambiguous_provider_evidence_for_check', evidence:null });
});

test('resolver binds the supplying agency and exact provider before returning a policy snapshot', async () => {
  const evidence = createAgencyRightToWorkDvspEvidenceVersion(BASE);
  const evidenceStore = { resolveForCheck: async () => ({ found:true, reason:null, evidence }) };
  const result = await resolveAgencyRightToWorkDvspEvidenceForCheck({
    tenantId:'T1', worker:worker(), agency, checkedAt:'2026-10-04T10:00:00.000Z', evidenceStore,
  });
  assert.equal(result.found, true);
  assert.equal(result.policySnapshot.evidenceVersionId, evidence.evidenceVersionId);

  const mismatched = await resolveAgencyRightToWorkDvspEvidenceForCheck({
    tenantId:'T1', worker:{ ...worker(), agencyId:'A2' }, agency, checkedAt:'2026-10-04T10:00:00.000Z', evidenceStore,
  });
  assert.equal(mismatched.found, false);
  assert.equal(mismatched.reason, 'agency_scope_mismatch');
});

test('missing or failing durable store fails closed', async () => {
  const missing = await resolveAgencyRightToWorkDvspEvidenceForCheck({ tenantId:'T1', worker:worker(), agency, checkedAt:'2026-10-04T10:00:00.000Z' });
  assert.equal(missing.reason, 'dvsp_evidence_store_unavailable');
  const failing = await resolveAgencyRightToWorkDvspEvidenceForCheck({
    tenantId:'T1', worker:worker(), agency, checkedAt:'2026-10-04T10:00:00.000Z',
    evidenceStore:{ resolveForCheck: async () => { throw new Error('db down'); } },
  });
  assert.equal(failing.reason, 'dvsp_evidence_store_unavailable');
});

test('evidence not effective, expired, or observed after the worker check fails closed', async () => {
  const base = createAgencyRightToWorkDvspEvidenceVersion(BASE);
  const resolve = async evidence => resolveAgencyRightToWorkDvspEvidenceForCheck({
    tenantId:'T1', worker:worker(), agency, checkedAt:'2026-10-04T10:00:00.000Z',
    evidenceStore:{ resolveForCheck: async () => ({ found:true, evidence }) },
  });
  assert.equal((await resolve({ ...base, effectiveAt:'2026-10-05T00:00:00.000Z' })).reason, 'dvsp_evidence_not_effective_at_check');
  assert.equal((await resolve({ ...base, expiresAt:'2026-10-04T10:00:00.000Z' })).reason, 'dvsp_evidence_expired_at_check');
  assert.equal((await resolve({ ...base, registryVerifiedAt:'2026-10-04T11:00:00.000Z' })).reason, 'dvsp_registry_evidence_after_worker_check');
});

test('10,000 version constructions are deterministic and never expose raw registry evidence', () => {
  const ids = new Set();
  for (let i = 0; i < 10_000; i += 1) {
    const record = createAgencyRightToWorkDvspEvidenceVersion(BASE);
    ids.add(record.evidenceVersionId);
    assert.equal(JSON.stringify(record).includes(RAW_REGISTER_REF), false);
  }
  assert.equal(ids.size, 1);
});

const FULL_REQUEST = { roleId:'PACK-OP', location:'Plant 1', startAt:'2026-10-05T06:00:00.000Z', endAt:'2026-10-05T14:00:00.000Z' };
const FULL_WORKER = {
  workerId:'W1', agencyId:'A1',
  rightToWork:{
    status:'verified', indefinite:true, engagementType:'workers_contract', employmentCommencedAt:'2026-10-02T09:00:00.000Z',
    checkedByAgencyId:'A1', checkMethod:'rtw_dvsp', checkedAt:'2026-10-04T10:00:00.000Z', evidenceRef:'private-dvsp-output-1', dvspProviderId:'DVSP-1',
    assignmentScope:{ roleId:'PACK-OP', location:'Plant 1', startAt:'2026-10-05T05:00:00.000Z', endAt:'2026-10-05T15:00:00.000Z', restrictionsSatisfied:true },
  },
};
const FULL_AGENCY = { agencyId:'A1', rightToWorkScheme:{ arrangement:'employment_business_supply_to_hirer_own_operations', responsibleParty:'employment_business' } };

test('strict evaluator wrapper refuses DVSP checks when durable evidence cannot be resolved', async () => {
  const { evaluateAgencyRightToWorkWithDvspEvidence } = await import('../../src/frontier/agency-right-to-work-dvsp-evidence.mjs');
  const result = await evaluateAgencyRightToWorkWithDvspEvidence({
    tenantId:'T1', worker:FULL_WORKER, request:FULL_REQUEST, agency:FULL_AGENCY, now:'2026-10-04T12:00:00.000Z',
    evidenceStore:{ resolveForCheck: async () => ({ found:false, reason:'no_provider_evidence_for_check', evidence:null }) },
  });
  assert.equal(result.eligible, false);
  assert.ok(result.failures.includes('right_to_work_dvsp_versioned_provider_evidence_unavailable:no_provider_evidence_for_check'));
  assert.equal(result.evidence.digitalVerificationService.providerEvidenceResolved, false);
});

test('strict evaluator wrapper binds an eligible DVSP check to the exact durable evidence version', async () => {
  const { evaluateAgencyRightToWorkWithDvspEvidence } = await import('../../src/frontier/agency-right-to-work-dvsp-evidence.mjs');
  const evidence = createAgencyRightToWorkDvspEvidenceVersion(BASE);
  const result = await evaluateAgencyRightToWorkWithDvspEvidence({
    tenantId:'T1', worker:FULL_WORKER, request:FULL_REQUEST, agency:FULL_AGENCY, now:'2026-10-04T12:00:00.000Z',
    evidenceStore:{ resolveForCheck: async () => ({ found:true, evidence }) },
  });
  assert.equal(result.eligible, true, result.failures?.join(','));
  assert.equal(result.evidence.digitalVerificationService.providerEvidenceResolved, true);
  assert.equal(result.evidence.digitalVerificationService.providerEvidenceVersionId, evidence.evidenceVersionId);
  assert.equal(result.evidence.digitalVerificationService.providerEvidenceRegistryFingerprint, evidence.registryEvidenceFingerprint);
  assert.doesNotMatch(JSON.stringify(result), /private-register-evidence/);
});
