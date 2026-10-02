import crypto from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agencyRightToWorkAssignmentFingerprint,
  createPostgresAgencyRightToWorkAssuranceReader,
  evaluateAuthoritativeAgencyRightToWorkAssurance,
  planAgencyLabourFulfilmentWithAuthoritativeRightToWork,
} from '../../src/frontier/agency-right-to-work-authoritative-planner.mjs';
import { issueAgencyRightToWorkRefreshToken } from '../../src/frontier/agency-right-to-work-refresh.mjs';

const NOW = '2026-10-04T12:00:00.000Z';
const START = '2026-10-05T06:00:00.000Z';
const END = '2026-10-05T14:00:00.000Z';
const SECRET = 'authoritative-right-to-work-test-secret-'.repeat(2);

const fp = (value, length = 24) => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, length);

function request(count = 1) {
  return {
    requestId:'REQ-RTW-AUTH-1', hirerName:'Synthetic Manufacturing Ltd', businessNature:'Manufacturing',
    roleId:'PACK-OP', roleName:'Packing Operative', duties:'Operate packing line', location:'Plant 1, Birmingham',
    startAt:START, endAt:END, expectedDuration:'1 shift', daysAndHours:'Monday 06:00-14:00', count,
    requiredSkills:[{id:'packing',level:1}], requiredQualifications:[{id:'food-safety',level:1}],
    healthSafetyRisks:[], controlMeasures:[], expenses:{}, payAndConditions:{}, maxChargePerHour:25,
    standardRole:true, industrialActionReplacement:false,
    rightToWorkArrangement:'employment_business_supply_to_hirer_own_operations',
  };
}

function agency() {
  return {
    agencyId:'A1', approved:true, active:true, responseSlaMinutes:5, performance:{fillReliability:0.9},
    rightToWorkScheme:{
      arrangement:'employment_business_supply_to_hirer_own_operations',
      responsibleParty:'employment_business',
    },
  };
}

function worker(id, { quality = 0.8, rate = 22, evidenceRef = `private-${id}-rtw-evidence`, checkedAt = '2026-10-04T10:00:00.000Z' } = {}) {
  return {
    workerId:id, agencyId:'A1', consentToShare:true, available:true, siteReady:true, restCompliant:true,
    suitabilityStatus:'suitable', availability:{startAt:'2026-10-05T05:00:00.000Z',endAt:'2026-10-05T15:00:00.000Z'},
    inductionValidUntil:'2027-01-01T00:00:00.000Z',
    rightToWork:{
      status:'verified', indefinite:false, validUntil:'2027-12-31T23:59:59.000Z',
      engagementType:'workers_contract', employmentCommencedAt:'2026-10-02T09:00:00.000Z',
      checkedByAgencyId:'A1', checkMethod:'home_office_online', checkedAt, evidenceRef,
      assignmentScope:{roleId:'PACK-OP',location:'Plant 1, Birmingham',startAt:'2026-10-05T05:00:00.000Z',endAt:'2026-10-05T15:00:00.000Z',restrictionsSatisfied:true},
    },
    skills:[{id:'packing',level:2}],
    qualifications:[{id:'food-safety',level:1,status:'valid',validUntil:'2027-12-31T23:59:59.000Z'}],
    awr:{weeksInSameRole:4,equalTreatmentConfirmed:false}, chargeRatePerHour:rate,
    performance:{completedShifts:60,attendanceRate:quality,punctualityRate:quality,qualityScore:quality,productivityScore:quality,completedSiteShifts:20,completedRoleShifts:20},
  };
}

function currentFor(candidate, overrides = {}) {
  const req = request();
  return {
    tenantId:'T1', agencyId:'A1', workerId:candidate.workerId,
    assuranceVersionId:fp(`assurance:${candidate.workerId}:${candidate.rightToWork.checkedAt}`, 32),
    siteId:'S1', requestId:req.requestId,
    assignmentFingerprint:agencyRightToWorkAssignmentFingerprint(req),
    evidenceFingerprint:fp(candidate.rightToWork.evidenceRef),
    checkMethod:candidate.rightToWork.checkMethod,
    checkedAt:candidate.rightToWork.checkedAt,
    coverageUntil:candidate.rightToWork.validUntil,
    promotedAt:NOW,
    conflicted:false,
    ...overrides,
  };
}

function memoryReader(rows = []) {
  const map = new Map(rows.map(row => [`${row.tenantId}:${row.agencyId}:${row.workerId}`, structuredClone(row)]));
  return {
    async getCurrent(scope) {
      return { current:structuredClone(map.get(`${scope.tenantId}:${scope.agencyId}:${scope.workerId}`) ?? null) };
    },
  };
}

function input(candidates, reader, count = 1) {
  return {
    tenantId:'T1', siteId:'S1', now:NOW, request:request(count), agencies:[agency()], candidates,
    rightToWorkAssuranceStore:reader,
    policy:{parallelAgencies:1,responseSlaMinutes:5,autoDispatchApprovedAgencies:true},
  };
}

test('valid current authoritative assurance permits ranking and exposes only privacy-minimised ledger evidence', async () => {
  const candidate = worker('W-VALID', { quality:0.75, rate:24 });
  const current = currentFor(candidate);
  const result = await planAgencyLabourFulfilmentWithAuthoritativeRightToWork(input([candidate], memoryReader([current])));

  assert.equal(result.selectedWorkers.length, 1);
  assert.equal(result.selectedWorkers[0].workerId, 'W-VALID');
  assert.equal(result.selectedWorkers[0].authoritativeRightToWorkAssurance.assuranceVersionId, current.assuranceVersionId);
  assert.equal(result.rightToWorkAuthoritativeGate.authoritativeCount, 1);
  assert.equal(result.rightToWorkAuthoritativeGate.eligibilityBeforeRanking, true);
  assert.doesNotMatch(JSON.stringify(result), /private-W-VALID-rtw-evidence/);
  assert.match(result.authorityBoundary, /no_worker_master_schedule_payroll_or_invoice_mutation/);
});

test('cheaper perfect-performance worker without current assurance gets score null and cannot outrank an authoritative worker', async () => {
  const valid = worker('W-AUTH', { quality:0.62, rate:24 });
  const missing = worker('W-MISSING', { quality:1, rate:15 });
  const result = await planAgencyLabourFulfilmentWithAuthoritativeRightToWork(input([missing, valid], memoryReader([currentFor(valid)])));

  assert.equal(result.selectedWorkers[0].workerId, 'W-AUTH');
  const rejected = result.rejectedWorkers.find(item => item.workerId === 'W-MISSING');
  assert.ok(rejected);
  assert.equal(rejected.score, null);
  assert.ok(rejected.failures.includes('right_to_work_authoritative_assurance_missing'));
});

test('conflict and every authoritative scope/evidence mismatch fail closed before ranking', () => {
  const candidate = worker('W-SCOPE');
  const base = currentFor(candidate);
  const cases = [
    [{...base,conflicted:true}, 'right_to_work_authoritative_assurance_conflicted'],
    [{...base,tenantId:'T9'}, 'right_to_work_authoritative_assurance_tenant_mismatch'],
    [{...base,siteId:'S9'}, 'right_to_work_authoritative_assurance_site_mismatch'],
    [{...base,requestId:'R9'}, 'right_to_work_authoritative_assurance_request_mismatch'],
    [{...base,agencyId:'A9'}, 'right_to_work_authoritative_assurance_agency_mismatch'],
    [{...base,workerId:'W9'}, 'right_to_work_authoritative_assurance_worker_mismatch'],
    [{...base,assignmentFingerprint:'d'.repeat(24)}, 'right_to_work_authoritative_assurance_assignment_mismatch'],
    [{...base,evidenceFingerprint:'e'.repeat(24)}, 'right_to_work_authoritative_assurance_evidence_mismatch'],
    [{...base,checkMethod:'manual_document'}, 'right_to_work_authoritative_assurance_check_method_mismatch'],
    [{...base,checkedAt:'2026-10-04T09:59:00.000Z'}, 'right_to_work_authoritative_assurance_checked_at_mismatch'],
    [{...base,coverageUntil:'2027-12-30T23:59:59.000Z'}, 'right_to_work_authoritative_assurance_coverage_mismatch'],
  ];
  for (const [current, expected] of cases) {
    const gate = evaluateAuthoritativeAgencyRightToWorkAssurance({
      current, tenantId:'T1', siteId:'S1', request:request(), worker:candidate, agency:agency(), now:NOW,
    });
    assert.equal(gate.authoritative, false, expected);
    assert.ok(gate.failures.includes(expected), `${expected}: ${gate.failures.join(',')}`);
  }
});

test('unavailable or throwing assurance reader fails closed and does not rank candidate', async () => {
  const candidate = worker('W-STORE');
  for (const reader of [null, { async getCurrent() { throw new Error('db unavailable'); } }]) {
    const result = await planAgencyLabourFulfilmentWithAuthoritativeRightToWork(input([candidate], reader));
    assert.equal(result.selectedWorkers.length, 0);
    assert.equal(result.rejectedWorkers[0].score, null);
    assert.ok(result.rejectedWorkers[0].failures.includes('right_to_work_authoritative_assurance_store_unavailable'));
  }
});

test('PostgreSQL reader uses exact tenant, agency and worker scope and is read-only', async () => {
  const candidate = worker('W-SQL');
  const current = currentFor(candidate);
  let seenSql = '';
  let seenValues = null;
  const reader = createPostgresAgencyRightToWorkAssuranceReader({ query:async (sql, values) => {
    seenSql = sql;
    seenValues = values;
    return { rows:[{
      tenant_id:current.tenantId, agency_id:current.agencyId, worker_id:current.workerId,
      assurance_version_id:current.assuranceVersionId, site_id:current.siteId, request_id:current.requestId,
      assignment_fingerprint:current.assignmentFingerprint, evidence_fingerprint:current.evidenceFingerprint,
      check_method:current.checkMethod, checked_at:current.checkedAt, coverage_until:current.coverageUntil,
      promoted_at:current.promotedAt, conflicted:false,
    }] };
  }});
  const found = await reader.getCurrent({ tenantId:'T1', agencyId:'A1', workerId:'W-SQL' });
  assert.equal(found.current.assuranceVersionId, current.assuranceVersionId);
  assert.deepEqual(seenValues, ['T1','A1','W-SQL']);
  assert.match(seenSql, /^\s*SELECT\b/i);
  assert.doesNotMatch(seenSql, /\b(INSERT|UPDATE|DELETE)\b/i);
  assert.match(seenSql, /WHERE tenant_id = \$1 AND agency_id = \$2 AND worker_id = \$3/);
});

test('authoritative assignment fingerprint is identical to the signed refresh-token assignment claim', () => {
  const req = request();
  const token = issueAgencyRightToWorkRefreshToken({
    tenantId:'T1', siteId:'S1', requestId:req.requestId, agencyId:'A1', workerId:'W-PARITY', tokenId:'TOK-PARITY',
    expiresAt:'2026-10-04T13:00:00.000Z', request:req,
  }, SECRET);
  const claims = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
  assert.equal(claims.assignmentFingerprint, agencyRightToWorkAssignmentFingerprint(req));
});

test('5,000 cheaper perfect-performance candidates without authoritative assurance never enter ranking', async () => {
  const valid = worker('W-ONLY-AUTH', { quality:0.6, rate:24 });
  const invalid = Array.from({ length:5_000 }, (_, index) => worker(`W-NO-AUTH-${index}`, { quality:1, rate:15 }));
  const result = await planAgencyLabourFulfilmentWithAuthoritativeRightToWork(input([...invalid, valid], memoryReader([currentFor(valid)])));

  assert.equal(result.selectedWorkers.length, 1);
  assert.equal(result.selectedWorkers[0].workerId, 'W-ONLY-AUTH');
  assert.equal(result.rightToWorkAuthoritativeGate.candidateCount, 5_001);
  assert.equal(result.rightToWorkAuthoritativeGate.authoritativeCount, 1);
  assert.equal(result.rightToWorkAuthoritativeGate.rejectedCount, 5_000);
  const invalidRejected = result.rejectedWorkers.filter(item => item.workerId.startsWith('W-NO-AUTH-'));
  assert.equal(invalidRejected.length, 5_000);
  assert.equal(invalidRejected.filter(item => item.score !== null).length, 0);
  assert.equal(invalidRejected.filter(item => !item.failures.includes('right_to_work_authoritative_assurance_missing')).length, 0);
});

test('identical authoritative store state produces deterministic planner evidence', async () => {
  const candidate = worker('W-DETERMINISTIC');
  const current = currentFor(candidate);
  const a = await planAgencyLabourFulfilmentWithAuthoritativeRightToWork(input([candidate], memoryReader([current])));
  const b = await planAgencyLabourFulfilmentWithAuthoritativeRightToWork(input([structuredClone(candidate)], memoryReader([structuredClone(current)])));
  assert.equal(a.reproducibilityHash, b.reproducibilityHash);
  assert.deepEqual(a.selectedWorkers, b.selectedWorkers);
});
