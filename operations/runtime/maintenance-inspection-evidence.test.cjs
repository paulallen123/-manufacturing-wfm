'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assessMaintenanceInspectionEvidence } = require('./maintenance-inspection-evidence.cjs');

const at = '2026-10-13T12:00:00.000Z';
const scope = { tenant: 'synthetic-tenant', site: 'synthetic-site', asset: 'press-1', workOrder: 'wo-1' };
const copy = value => structuredClone(value);
function fixture() {
  return {
    asOf: at,
    expected: { scope: copy(scope), checklistId: 'checklist-1', revision: 'revision-4',
      validFrom: '2026-10-13T08:00:00.000Z', maxAgeMs: 3600000,
      requiredItemIds: ['guard', 'isolation'], sourceRef: 'cmms-contract-4' },
    capture: { scope: copy(scope), checklistId: 'checklist-1', revision: 'revision-4',
      sourceRef: 'cmms-capture-8', capturedAt: '2026-10-13T11:59:00.000Z', complete: true,
      results: ['guard', 'isolation'].map((itemId, i) => ({ itemId, outcome: 'PASS',
        evidenceRef: `signed-inspection-${i}`, observedAt: '2026-10-13T11:55:00.000Z', scope: copy(scope) })) }
  };
}
function blocked(input, code) {
  const r = assessMaintenanceInspectionEvidence(input);
  assert.equal(r.status, 'BLOCKED');
  assert.equal(r.workOrderAuthority, false);
  assert.ok(r.reasons.includes(code), JSON.stringify(r));
}
test('complete scoped checklist is evidence-consistent only and grants no work authority', () => {
  const f = fixture(), before = copy(f);
  const r = assessMaintenanceInspectionEvidence(f);
  assert.equal(r.status, 'EVIDENCE_CONSISTENT');
  assert.equal(r.inspectionOutcome, 'PASS');
  assert.equal(r.workOrderAuthority, false);
  assert.deepEqual(f, before);
});
test('missing or duplicate required items do not establish a completed inspection', () => {
  const missing = fixture(); missing.capture.results.pop(); blocked(missing, 'MISSING_ITEM');
  const duplicate = fixture(); duplicate.capture.results.push(copy(duplicate.capture.results[0])); blocked(duplicate, 'DUPLICATE_ITEM');
  const empty = fixture(); empty.expected.requiredItemIds = []; blocked(empty, 'INVALID_CONTRACT');
});
test('failed, skipped or unexplained item cannot be advisory clear', () => {
  for (const outcome of ['FAIL', 'NOT_APPLICABLE', 'UNKNOWN']) {
    const f = fixture(); f.capture.results[0].outcome = outcome; blocked(f, 'NON_PASS_ITEM');
  }
});
test('tenant, site, asset and work-order scope are bound on capture and every result', () => {
  for (const key of Object.keys(scope)) {
    for (const target of ['capture', 'result']) {
      const f = fixture();
      (target === 'capture' ? f.capture.scope : f.capture.results[0].scope)[key] = 'other';
      blocked(f, 'SCOPE_MISMATCH');
    }
  }
});
test('revision, checklist and source identity drift block', () => {
  for (const key of ['revision', 'checklistId']) {
    const f = fixture(); f.capture[key] = 'other'; blocked(f, 'SOURCE_MISMATCH');
  }
  const noSource = fixture(); noSource.capture.sourceRef = ''; blocked(noSource, 'INVALID_CAPTURE');
});
test('stale, future and pre-effective evidence block', () => {
  const stale = fixture(); stale.capture.capturedAt = '2026-10-13T10:00:00.000Z'; blocked(stale, 'STALE_EVIDENCE');
  const future = fixture(); future.capture.results[0].observedAt = '2026-10-13T12:01:00.000Z'; blocked(future, 'EVIDENCE_TIME');
  const old = fixture(); old.capture.results[0].observedAt = '2026-10-13T07:59:00.000Z'; blocked(old, 'EVIDENCE_TIME');
});
test('caller completeness flag cannot cover missing source observations', () => {
  const f = fixture(); f.capture.complete = false; blocked(f, 'INCOMPLETE_CAPTURE');
  const disguised = fixture(); disguised.capture.results[0].evidenceRef = ''; blocked(disguised, 'INVALID_RESULT');
});
test('active, cyclic and non-JSON packets do not run getters or return success', () => {
  const f = fixture(); let reads = 0;
  Object.defineProperty(f.capture.results[0], 'outcome', { enumerable: true, get() { reads++; return 'PASS'; } });
  blocked(f, 'INVALID_JSON'); assert.equal(reads, 0);
  const proxy = fixture(); proxy.capture = new Proxy(proxy.capture, {}); blocked(proxy, 'INVALID_JSON');
  const cycle = fixture(); cycle.capture.self = cycle.capture; blocked(cycle, 'INVALID_JSON');
});
