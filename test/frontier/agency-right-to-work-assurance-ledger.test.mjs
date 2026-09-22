import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENCY_RIGHT_TO_WORK_ASSURANCE_DDL,
  createAgencyRightToWorkAssuranceVersion,
  createPostgresAgencyRightToWorkAssuranceStore,
  promoteAgencyRightToWorkRefreshAssurance,
} from '../../src/frontier/agency-right-to-work-assurance-ledger.mjs';

const NOW = '2026-10-04T12:00:00.000Z';
const REQUEST = { roleId:'PACK-OP', location:'Plant 1, Birmingham', startAt:'2026-10-05T06:00:00.000Z', endAt:'2026-10-05T14:00:00.000Z' };
const AGENCY = { agencyId:'A1' };
const RAW = 'PRIVATE-HOME-OFFICE-EVIDENCE-123';

function rightToWork(overrides = {}) {
  return {
    status:'verified',
    indefinite:false,
    validUntil:'2027-12-31T23:59:59.000Z',
    engagementType:'workers_contract',
    employmentCommencedAt:'2026-10-02T09:00:00.000Z',
    checkedByAgencyId:'A1',
    checkMethod:'home_office_online',
    checkedAt:'2026-10-04T10:30:00.000Z',
    evidenceRef:RAW,
    assignmentScope:{ roleId:'PACK-OP', location:'Plant 1, Birmingham', startAt:'2026-10-05T06:00:00.000Z', endAt:'2026-10-05T14:00:00.000Z', restrictionsSatisfied:true },
    ...overrides,
  };
}

function evaluator(worker, request, agency) {
  const rtw = worker.rightToWork;
  const failures = [];
  if (rtw.status !== 'verified') failures.push('right_to_work_not_verified');
  if (rtw.checkedByAgencyId !== agency.agencyId) failures.push('right_to_work_checker_agency_mismatch');
  if (rtw.assignmentScope.roleId !== request.roleId) failures.push('right_to_work_assignment_role_mismatch');
  if (rtw.assignmentScope.location !== request.location) failures.push('right_to_work_assignment_location_mismatch');
  if (rtw.assignmentScope.restrictionsSatisfied !== true) failures.push('right_to_work_assignment_restrictions_not_confirmed');
  const evidenceFingerprint = rtw.evidenceRef === RAW ? 'a'.repeat(24) : 'b'.repeat(24);
  return {
    eligible:failures.length === 0,
    failures,
    evidence:{
      evidenceFingerprint,
      checkMethod:rtw.checkMethod,
      checkedAt:rtw.checkedAt,
      lifecycle:{ effectiveCoverageUntil:rtw.indefinite ? null : rtw.validUntil },
      assignmentScope:rtw.assignmentScope,
    },
  };
}

function acceptedRefresh(overrides = {}) {
  return {
    accepted:true,
    receipt:{
      refreshRecorded:true,
      eligibleAfterRefresh:true,
      tenantId:'T1', siteId:'S1', requestId:'R1', agencyId:'A1', workerId:'W1',
      assignmentFingerprint:'c'.repeat(24),
      evidenceFingerprint:'a'.repeat(24),
      checkMethod:'home_office_online',
      checkedAt:'2026-10-04T10:30:00.000Z',
      ...overrides,
    },
  };
}

function memoryStore() {
  const history = new Map();
  const current = new Map();
  return {
    history,
    current,
    async promote(record) {
      const key = `${record.tenantId}:${record.agencyId}:${record.workerId}`;
      history.set(`${key}:${record.assuranceVersionId}`, structuredClone(record));
      const prior = current.get(key);
      if (!prior || Date.parse(record.checkedAt) > Date.parse(prior.checkedAt)) {
        current.set(key, { ...structuredClone(record), conflicted:false });
      } else if (Date.parse(record.checkedAt) === Date.parse(prior.checkedAt) && record.assuranceVersionId !== prior.assuranceVersionId) {
        current.set(key, { ...prior, conflicted:true });
      }
      return { current:structuredClone(current.get(key)) };
    },
  };
}

test('eligible accepted refresh produces a deterministic privacy-minimised assurance version', () => {
  const built1 = createAgencyRightToWorkAssuranceVersion({ acceptedRefresh:acceptedRefresh(), rightToWork:rightToWork(), request:REQUEST, agency:AGENCY, now:NOW, evaluateRightToWork:evaluator });
  const built2 = createAgencyRightToWorkAssuranceVersion({ acceptedRefresh:acceptedRefresh(), rightToWork:rightToWork(), request:REQUEST, agency:AGENCY, now:NOW, evaluateRightToWork:evaluator });
  assert.equal(built1.valid, true);
  assert.equal(built1.version.assuranceVersionId, built2.version.assuranceVersionId);
  assert.equal(built1.version.assuranceVersionId.length, 32);
  assert.doesNotMatch(JSON.stringify(built1.version), /PRIVATE-HOME-OFFICE-EVIDENCE/);
  assert.equal(built1.version.evidenceFingerprint, 'a'.repeat(24));
});

test('promotion re-runs eligibility and refuses evidence that no longer matches the accepted refresh', async () => {
  const store = memoryStore();
  const result = await promoteAgencyRightToWorkRefreshAssurance({
    acceptedRefresh:acceptedRefresh(),
    rightToWork:rightToWork({ evidenceRef:'DIFFERENT-PRIVATE-EVIDENCE' }),
    request:REQUEST, agency:AGENCY, now:NOW, assuranceStore:store, evaluateRightToWork:evaluator,
  });
  assert.equal(result.authoritative, false);
  assert.equal(result.reason, 'refresh_evidence_fingerprint_mismatch');
  assert.equal(store.history.size, 0);
});

test('newer eligible assurance becomes current and an older later-arriving refresh cannot overwrite it', async () => {
  const store = memoryStore();
  const newerRtw = rightToWork({ checkedAt:'2026-10-04T11:00:00.000Z' });
  const newerRefresh = acceptedRefresh({ checkedAt:'2026-10-04T11:00:00.000Z' });
  const newer = await promoteAgencyRightToWorkRefreshAssurance({ acceptedRefresh:newerRefresh, rightToWork:newerRtw, request:REQUEST, agency:AGENCY, now:NOW, assuranceStore:store, evaluateRightToWork:evaluator });
  assert.equal(newer.authoritative, true);

  const older = await promoteAgencyRightToWorkRefreshAssurance({ acceptedRefresh:acceptedRefresh(), rightToWork:rightToWork(), request:REQUEST, agency:AGENCY, now:NOW, assuranceStore:store, evaluateRightToWork:evaluator });
  assert.equal(older.authoritative, false);
  assert.equal(older.reason, 'newer_assurance_already_current');
  assert.equal(older.current.assuranceVersionId, newer.version.assuranceVersionId);
  assert.equal(store.history.size, 2);
});

test('different evidence at the same check time marks the authoritative state conflicted and fails closed', async () => {
  const store = memoryStore();
  const first = await promoteAgencyRightToWorkRefreshAssurance({ acceptedRefresh:acceptedRefresh(), rightToWork:rightToWork(), request:REQUEST, agency:AGENCY, now:NOW, assuranceStore:store, evaluateRightToWork:evaluator });
  assert.equal(first.authoritative, true);

  const conflictingRefresh = acceptedRefresh({ evidenceFingerprint:'b'.repeat(24) });
  const conflicting = await promoteAgencyRightToWorkRefreshAssurance({
    acceptedRefresh:conflictingRefresh,
    rightToWork:rightToWork({ evidenceRef:'DIFFERENT-PRIVATE-EVIDENCE' }),
    request:REQUEST, agency:AGENCY, now:NOW, assuranceStore:store, evaluateRightToWork:evaluator,
  });
  assert.equal(conflicting.authoritative, false);
  assert.equal(conflicting.reason, 'ambiguous_same_check_time');
  assert.equal(conflicting.current.conflicted, true);
  assert.equal(store.history.size, 2);
});

test('a later valid assurance clears an earlier same-time conflict', async () => {
  const store = memoryStore();
  await promoteAgencyRightToWorkRefreshAssurance({ acceptedRefresh:acceptedRefresh(), rightToWork:rightToWork(), request:REQUEST, agency:AGENCY, now:NOW, assuranceStore:store, evaluateRightToWork:evaluator });
  await promoteAgencyRightToWorkRefreshAssurance({ acceptedRefresh:acceptedRefresh({ evidenceFingerprint:'b'.repeat(24) }), rightToWork:rightToWork({ evidenceRef:'DIFFERENT-PRIVATE-EVIDENCE' }), request:REQUEST, agency:AGENCY, now:NOW, assuranceStore:store, evaluateRightToWork:evaluator });

  const laterRtw = rightToWork({ checkedAt:'2026-10-04T11:15:00.000Z' });
  const later = await promoteAgencyRightToWorkRefreshAssurance({ acceptedRefresh:acceptedRefresh({ checkedAt:'2026-10-04T11:15:00.000Z' }), rightToWork:laterRtw, request:REQUEST, agency:AGENCY, now:NOW, assuranceStore:store, evaluateRightToWork:evaluator });
  assert.equal(later.authoritative, true);
  assert.equal(later.current.conflicted, false);
});

test('missing durable assurance store fails closed without claiming authoritative state', async () => {
  const result = await promoteAgencyRightToWorkRefreshAssurance({ acceptedRefresh:acceptedRefresh(), rightToWork:rightToWork(), request:REQUEST, agency:AGENCY, now:NOW, evaluateRightToWork:evaluator });
  assert.equal(result.authoritative, false);
  assert.equal(result.reason, 'assurance_store_unavailable');
});

test('receipt scope mismatch fails before storage', async () => {
  const store = memoryStore();
  const result = await promoteAgencyRightToWorkRefreshAssurance({
    acceptedRefresh:acceptedRefresh({ agencyId:'A9' }), rightToWork:rightToWork(), request:REQUEST, agency:AGENCY, now:NOW, assuranceStore:store, evaluateRightToWork:evaluator,
  });
  assert.equal(result.authoritative, false);
  assert.equal(result.reason, 'candidate_agency_scope_mismatch');
  assert.equal(store.history.size, 0);
});

test('PostgreSQL contract preserves immutable history and uses checked-at CAS with explicit same-time conflict state', async () => {
  assert.match(AGENCY_RIGHT_TO_WORK_ASSURANCE_DDL, /wfm_agency_rtw_assurance_history/);
  assert.match(AGENCY_RIGHT_TO_WORK_ASSURANCE_DDL, /wfm_agency_rtw_assurance_current/);
  let seenSql = '';
  const store = createPostgresAgencyRightToWorkAssuranceStore({ query:async (sql, values) => {
    seenSql = sql;
    return { rows:[{
      tenant_id:values[0], agency_id:values[1], worker_id:values[2], assurance_version_id:values[3],
      site_id:values[4], request_id:values[5], assignment_fingerprint:values[6], evidence_fingerprint:values[7],
      check_method:values[8], checked_at:values[9], coverage_until:values[10], promoted_at:values[11], conflicted:false,
    }] };
  }});
  const built = createAgencyRightToWorkAssuranceVersion({ acceptedRefresh:acceptedRefresh(), rightToWork:rightToWork(), request:REQUEST, agency:AGENCY, now:NOW, evaluateRightToWork:evaluator });
  const result = await store.promote(built.version);
  assert.equal(result.current.assuranceVersionId, built.version.assuranceVersionId);
  assert.match(seenSql, /ON CONFLICT \(tenant_id, agency_id, worker_id\) DO UPDATE/);
  assert.match(seenSql, /EXCLUDED\.checked_at >= wfm_agency_rtw_assurance_current\.checked_at/);
  assert.match(seenSql, /EXCLUDED\.assurance_version_id <> wfm_agency_rtw_assurance_current\.assurance_version_id THEN true/);
});

test('10,000 stale promotion attempts cannot replace one newer authoritative assurance', async () => {
  const store = memoryStore();
  const newerRtw = rightToWork({ checkedAt:'2026-10-04T11:59:00.000Z' });
  const newerRefresh = acceptedRefresh({ checkedAt:'2026-10-04T11:59:00.000Z' });
  const newest = await promoteAgencyRightToWorkRefreshAssurance({ acceptedRefresh:newerRefresh, rightToWork:newerRtw, request:REQUEST, agency:AGENCY, now:NOW, assuranceStore:store, evaluateRightToWork:evaluator });
  const results = await Promise.all(Array.from({ length:10_000 }, (_, i) => {
    const minute = String(i % 50).padStart(2, '0');
    const checkedAt = `2026-10-04T10:${minute}:00.000Z`;
    return promoteAgencyRightToWorkRefreshAssurance({ acceptedRefresh:acceptedRefresh({ checkedAt }), rightToWork:rightToWork({ checkedAt }), request:REQUEST, agency:AGENCY, now:NOW, assuranceStore:store, evaluateRightToWork:evaluator });
  }));
  assert.equal(results.filter(r => r.authoritative).length, 0);
  assert.equal([...store.current.values()][0].assuranceVersionId, newest.version.assuranceVersionId);
});
