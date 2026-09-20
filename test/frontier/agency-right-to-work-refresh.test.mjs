import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENCY_RIGHT_TO_WORK_REFRESH_DDL,
  captureAgencyRightToWorkRefresh,
  createPostgresAgencyRightToWorkRefreshStore,
  issueAgencyRightToWorkRefreshToken,
  normalizeAgencyRightToWorkRefreshSubmission,
  verifyAgencyRightToWorkRefreshToken,
} from '../../src/frontier/agency-right-to-work-refresh.mjs';

const SECRET = 'r'.repeat(64);
const NOW = '2026-10-04T12:00:00.000Z';
const REQUEST = {
  roleId:'PACK-OP', location:'Plant 1, Birmingham',
  startAt:'2026-10-05T06:00:00.000Z', endAt:'2026-10-05T14:00:00.000Z',
};
const EXPECTED = { tenantId:'T1', siteId:'S1', requestId:'R1', agencyId:'A1', workerId:'W1' };
const AGENCY = {
  agencyId:'A1',
  rightToWorkScheme:{ arrangement:'employment_business_supply_to_hirer_own_operations', responsibleParty:'employment_business' },
};

function token(overrides = {}) {
  return issueAgencyRightToWorkRefreshToken({
    ...EXPECTED,
    tokenId:'rtw-refresh-token-1',
    expiresAt:'2026-10-04T13:00:00.000Z',
    request:REQUEST,
    ...overrides,
  }, SECRET);
}

function submission(overrides = {}) {
  return {
    status:'verified',
    indefinite:false,
    validUntil:'2027-12-31T23:59:59.000Z',
    engagementType:'workers_contract',
    employmentCommencedAt:'2026-10-02T09:00:00.000Z',
    checkMethod:'home_office_online',
    checkedAt:'2026-10-04T10:30:00.000Z',
    evidenceRef:'private-home-office-record-123',
    restrictionsSatisfied:true,
    ...overrides,
  };
}

function memoryStore() {
  const used = new Set();
  return {
    records:[],
    async recordOnce(record) {
      const key = `${record.tenantId}:${record.tokenId}`;
      if (used.has(key)) return { recorded:false, reason:'already_recorded' };
      used.add(key);
      this.records.push(structuredClone(record));
      return { recorded:true, reason:null, tokenId:record.tokenId, receivedAt:record.receivedAt };
    },
  };
}

function evaluator(worker, request, agency, { now }) {
  const rtw = worker.rightToWork;
  const failures = [];
  if (rtw.status !== 'verified') failures.push('right_to_work_not_verified');
  if (rtw.checkedByAgencyId !== agency.agencyId) failures.push('right_to_work_checker_agency_mismatch');
  if (!['home_office_online','manual_document','rtw_dvsp','employer_checking_service'].includes(rtw.checkMethod)) failures.push('right_to_work_check_method_not_prescribed');
  if (!rtw.evidenceRef) failures.push('right_to_work_evidence_ref_missing');
  if (Date.parse(rtw.checkedAt) > Date.parse(now)) failures.push('right_to_work_check_in_future');
  if (rtw.assignmentScope.roleId !== request.roleId) failures.push('right_to_work_assignment_role_mismatch');
  if (rtw.assignmentScope.location !== request.location) failures.push('right_to_work_assignment_location_mismatch');
  if (rtw.assignmentScope.restrictionsSatisfied !== true) failures.push('right_to_work_assignment_restrictions_not_confirmed');
  const coverage = rtw.checkMethod === 'employer_checking_service' ? rtw.positiveVerificationNotice?.validUntil : rtw.validUntil;
  if (rtw.indefinite !== true && !(Date.parse(coverage) >= Date.parse(request.endAt))) failures.push('right_to_work_expires_before_shift_end');
  if (rtw.checkMethod === 'employer_checking_service' && rtw.positiveVerificationNotice?.status !== 'positive') failures.push('right_to_work_ecs_positive_verification_notice_not_positive');
  return {
    version:'test-evaluator-contract',
    eligible:failures.length === 0,
    failures,
    warnings:[],
    evidence:{
      evidenceFingerprint:'e'.repeat(24),
      checkMethod:rtw.checkMethod,
      checkedAt:rtw.checkedAt,
      lifecycle:{effectiveCoverageUntil:rtw.indefinite === true ? null : new Date(Date.parse(coverage)).toISOString()},
      assignmentScope:rtw.assignmentScope,
    },
  };
}

test('issues a worker- and assignment-scoped expiring refresh token', () => {
  const issued = token();
  const verified = verifyAgencyRightToWorkRefreshToken(issued, EXPECTED, SECRET, { now:NOW, request:REQUEST });
  assert.equal(verified.valid, true);
  assert.equal(verified.claims.workerId, 'W1');
  assert.equal(verified.claims.purpose, 'agency_right_to_work_refresh');
  assert.equal(verified.claims.assignmentFingerprint.length, 24);
});

test('tamper, expiry and worker-scope mismatches fail before refresh evaluation', () => {
  const issued = token();
  const tampered = `${issued.slice(0, -1)}${issued.endsWith('a') ? 'b' : 'a'}`;
  assert.equal(verifyAgencyRightToWorkRefreshToken(tampered, EXPECTED, SECRET, { now:NOW, request:REQUEST }).reason, 'invalid_signature');
  assert.equal(verifyAgencyRightToWorkRefreshToken(issued, EXPECTED, SECRET, { now:'2026-10-04T14:00:00.000Z', request:REQUEST }).reason, 'expired_token');
  assert.equal(verifyAgencyRightToWorkRefreshToken(issued, { ...EXPECTED, workerId:'W2' }, SECRET, { now:NOW, request:REQUEST }).reason, 'scope_mismatch:workerId');
});

test('server-side expected scope is mandatory rather than optional', () => {
  const issued = token();
  const verified = verifyAgencyRightToWorkRefreshToken(issued, { tenantId:'T1' }, SECRET, { now:NOW, request:REQUEST });
  assert.equal(verified.valid, false);
  assert.equal(verified.reason, 'expected_scope_missing:siteId');
});

test('a token cannot be reused after the authoritative assignment changes', () => {
  const issued = token();
  const changed = { ...REQUEST, endAt:'2026-10-05T16:00:00.000Z' };
  const verified = verifyAgencyRightToWorkRefreshToken(issued, EXPECTED, SECRET, { now:NOW, request:changed });
  assert.equal(verified.valid, false);
  assert.equal(verified.reason, 'assignment_scope_changed');
});

test('normalization derives role, location and assignment window from authoritative request rather than supplier input', () => {
  const verified = verifyAgencyRightToWorkRefreshToken(token(), EXPECTED, SECRET, { now:NOW, request:REQUEST });
  const normalized = normalizeAgencyRightToWorkRefreshSubmission({
    claims:verified.claims,
    request:REQUEST,
    submission:{ ...submission(), assignmentScope:{ roleId:'FORKLIFT', location:'Other site' }, checkedByAgencyId:'A9' },
  });
  assert.equal(normalized.valid, true);
  assert.equal(normalized.rightToWork.checkedByAgencyId, 'A1');
  assert.deepEqual(normalized.rightToWork.assignmentScope, {
    roleId:'PACK-OP', location:'Plant 1, Birmingham', startAt:'2026-10-05T06:00:00.000Z', endAt:'2026-10-05T14:00:00.000Z', restrictionsSatisfied:true,
  });
});

test('default branch right-to-work evaluator contract accepts a complete scoped refresh', async () => {
  const store = memoryStore();
  const result = await captureAgencyRightToWorkRefresh({
    token:token({ tokenId:'default-evaluator' }), expected:EXPECTED, secret:SECRET, now:NOW, request:REQUEST, agency:AGENCY,
    submission:submission(), currentAssuranceCheckedAt:'2026-09-20T09:00:00.000Z', refreshStore:store,
  });
  assert.equal(result.accepted, true);
  assert.equal(result.assurance.eligible, true);
  assert.equal(result.assurance.evidence.checkMethod, 'home_office_online');
});

test('valid refreshed evidence is revalidated before it is atomically recorded', async () => {
  const store = memoryStore();
  const result = await captureAgencyRightToWorkRefresh({
    token:token(), expected:EXPECTED, secret:SECRET, now:NOW, request:REQUEST, agency:AGENCY,
    submission:submission(), currentAssuranceCheckedAt:'2026-09-20T09:00:00.000Z', refreshStore:store, evaluateRightToWork:evaluator,
  });
  assert.equal(result.accepted, true);
  assert.equal(result.assurance.eligible, true);
  assert.equal(store.records.length, 1);
  assert.equal(store.records[0].workerId, 'W1');
  assert.equal(store.records[0].evidenceFingerprint, 'e'.repeat(24));
  assert.match(result.authorityBoundary, /no_worker_record_schedule_payroll_or_invoice_mutation/);
});

test('stale or equal evidence cannot replace a newer assurance and does not consume the token', async () => {
  const store = memoryStore();
  for (const currentAssuranceCheckedAt of ['2026-10-04T10:30:00.000Z','2026-10-04T11:00:00.000Z']) {
    const result = await captureAgencyRightToWorkRefresh({
      token:token({ tokenId:`stale-${currentAssuranceCheckedAt}` }), expected:EXPECTED, secret:SECRET, now:NOW, request:REQUEST, agency:AGENCY,
      submission:submission(), currentAssuranceCheckedAt, refreshStore:store, evaluateRightToWork:evaluator,
    });
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'stale_right_to_work_assurance');
  }
  assert.equal(store.records.length, 0);
});

test('ineligible evidence is rejected before token consumption so the agency can correct the form', async () => {
  const store = memoryStore();
  const issued = token({ tokenId:'correctable' });
  const bad = await captureAgencyRightToWorkRefresh({
    token:issued, expected:EXPECTED, secret:SECRET, now:NOW, request:REQUEST, agency:AGENCY,
    submission:submission({ restrictionsSatisfied:false }), refreshStore:store, evaluateRightToWork:evaluator,
  });
  assert.equal(bad.accepted, false);
  assert.equal(bad.reason, 'right_to_work_assurance_not_eligible');
  assert.equal(store.records.length, 0);

  const fixed = await captureAgencyRightToWorkRefresh({
    token:issued, expected:EXPECTED, secret:SECRET, now:NOW, request:REQUEST, agency:AGENCY,
    submission:submission(), refreshStore:store, evaluateRightToWork:evaluator,
  });
  assert.equal(fixed.accepted, true);
  assert.equal(store.records.length, 1);
});

test('Employer Checking Service refresh requires a positive PVN that covers assignment end', async () => {
  const store = memoryStore();
  const failed = await captureAgencyRightToWorkRefresh({
    token:token({ tokenId:'ecs-bad' }), expected:EXPECTED, secret:SECRET, now:NOW, request:REQUEST, agency:AGENCY,
    submission:submission({ checkMethod:'employer_checking_service', validUntil:'2027-12-31T00:00:00.000Z', positiveVerificationNotice:{ status:'positive', issuedAt:'2026-10-04T09:00:00.000Z', validUntil:'2026-10-05T13:00:00.000Z', evidenceRef:'private-pvn-1' } }),
    refreshStore:store, evaluateRightToWork:evaluator,
  });
  assert.equal(failed.accepted, false);
  assert.ok(failed.assurance.failures.includes('right_to_work_expires_before_shift_end'));

  const passed = await captureAgencyRightToWorkRefresh({
    token:token({ tokenId:'ecs-good' }), expected:EXPECTED, secret:SECRET, now:NOW, request:REQUEST, agency:AGENCY,
    submission:submission({ checkMethod:'employer_checking_service', validUntil:'2026-09-30T00:00:00.000Z', positiveVerificationNotice:{ status:'positive', issuedAt:'2026-10-04T09:00:00.000Z', validUntil:'2027-04-04T09:00:00.000Z', evidenceRef:'private-pvn-2' } }),
    refreshStore:store, evaluateRightToWork:evaluator,
  });
  assert.equal(passed.accepted, true);
  assert.equal(passed.receipt.checkMethod, 'employer_checking_service');
});

test('missing or failing durable storage fails closed after revalidation', async () => {
  const base = { token:token({ tokenId:'store-fail' }), expected:EXPECTED, secret:SECRET, now:NOW, request:REQUEST, agency:AGENCY, submission:submission(), evaluateRightToWork:evaluator };
  const missing = await captureAgencyRightToWorkRefresh(base);
  assert.equal(missing.accepted, false);
  assert.equal(missing.reason, 'refresh_store_unavailable');
  const throwing = await captureAgencyRightToWorkRefresh({ ...base, token:token({ tokenId:'store-throw' }), refreshStore:{ async recordOnce(){ throw new Error('db unavailable'); } } });
  assert.equal(throwing.accepted, false);
  assert.equal(throwing.reason, 'refresh_store_unavailable');
});

test('receipt and durable audit record do not expose raw immigration evidence references', async () => {
  const store = memoryStore();
  const rawEvidenceRef = 'VERY-PRIVATE-SHARE-CODE-LIKE-REFERENCE';
  const rawPvnRef = 'VERY-PRIVATE-PVN-REFERENCE';
  const result = await captureAgencyRightToWorkRefresh({
    token:token({ tokenId:'privacy' }), expected:EXPECTED, secret:SECRET, now:NOW, request:REQUEST, agency:AGENCY,
    submission:submission({ checkMethod:'employer_checking_service', evidenceRef:rawEvidenceRef, positiveVerificationNotice:{ status:'positive', issuedAt:'2026-10-04T09:00:00.000Z', validUntil:'2027-04-04T09:00:00.000Z', evidenceRef:rawPvnRef } }),
    refreshStore:store, evaluateRightToWork:evaluator,
  });
  assert.equal(result.accepted, true);
  assert.doesNotMatch(JSON.stringify(result.receipt), new RegExp(rawEvidenceRef));
  assert.doesNotMatch(JSON.stringify(result.receipt), new RegExp(rawPvnRef));
  assert.doesNotMatch(JSON.stringify(store.records), new RegExp(rawEvidenceRef));
  assert.doesNotMatch(JSON.stringify(store.records), new RegExp(rawPvnRef));
  assert.equal(result.receipt.rawEvidenceStoredInReceipt, false);
});

test('1,000 concurrent submissions of one valid refresh token produce one accepted refresh', async () => {
  const store = memoryStore();
  const issued = token({ tokenId:'concurrency-1000' });
  const results = await Promise.all(Array.from({ length:1000 }, () => captureAgencyRightToWorkRefresh({
    token:issued, expected:EXPECTED, secret:SECRET, now:NOW, request:REQUEST, agency:AGENCY,
    submission:submission(), refreshStore:store, evaluateRightToWork:evaluator,
  })));
  assert.equal(results.filter(result => result.accepted).length, 1);
  assert.equal(results.filter(result => result.reason === 'refresh_token_already_used').length, 999);
  assert.equal(store.records.length, 1);
});

test('10,000 invalid-signature mutations never reach evaluation or durable storage', async () => {
  let evaluations = 0;
  const store = memoryStore();
  const good = token({ tokenId:'mutation-proof' });
  const [body, signature] = good.split('.');
  const requests = [];
  for (let i = 0; i < 10_000; i++) {
    const char = signature[i % signature.length];
    const replacement = char === 'A' ? 'B' : 'A';
    const mutatedSignature = signature.slice(0, i % signature.length) + replacement + signature.slice((i % signature.length) + 1);
    requests.push(captureAgencyRightToWorkRefresh({
      token:`${body}.${mutatedSignature}`, expected:EXPECTED, secret:SECRET, now:NOW, request:REQUEST, agency:AGENCY,
      submission:submission(), refreshStore:store,
      evaluateRightToWork(...args) { evaluations++; return evaluator(...args); },
    }));
  }
  const results = await Promise.all(requests);
  assert.equal(results.filter(result => result.accepted).length, 0);
  assert.equal(results.filter(result => result.reason === 'invalid_signature').length, 10_000);
  assert.equal(evaluations, 0);
  assert.equal(store.records.length, 0);
});

test('PostgreSQL adapter is tenant-token idempotent and persists only fingerprints/metadata', async () => {
  let call;
  const store = createPostgresAgencyRightToWorkRefreshStore({
    async query(sql, values) { call = { sql, values }; return { rowCount:1, rows:[{}] }; },
  });
  const result = await store.recordOnce({
    tenantId:'T1', tokenId:'TK1', siteId:'S1', requestId:'R1', agencyId:'A1', workerId:'W1',
    assignmentFingerprint:'a'.repeat(24), tokenFingerprint:'t'.repeat(24), evidenceFingerprint:'e'.repeat(24),
    checkMethod:'home_office_online', checkedAt:'2026-10-04T10:30:00.000Z', coverageUntil:'2027-12-31T23:59:59.000Z', receivedAt:NOW,
  });
  assert.equal(result.recorded, true);
  assert.match(call.sql, /ON CONFLICT \(tenant_id, token_id\) DO NOTHING/);
  assert.match(AGENCY_RIGHT_TO_WORK_REFRESH_DDL, /PRIMARY KEY \(tenant_id, token_id\)/);
  assert.match(AGENCY_RIGHT_TO_WORK_REFRESH_DDL, /worker_id/);
  assert.doesNotMatch(AGENCY_RIGHT_TO_WORK_REFRESH_DDL, /evidence_ref\b/i);
  assert.doesNotMatch(AGENCY_RIGHT_TO_WORK_REFRESH_DDL, /share_code/i);
  assert.equal(call.values.length, 13);
});
