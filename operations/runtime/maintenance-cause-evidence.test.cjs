'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { assessMaintenanceCauseEvidence } = require('./maintenance-cause-evidence.cjs');

function fixture() {
  return {
    now: '2026-10-13T00:10:00.000Z', maxEvidenceAgeMs: 3600000,
    reliability: {
      contractVersion: 'VECTOR_MAINTENANCE_RELIABILITY_V1', status: 'METRICS_ADVISORY',
      evaluatedAt: '2026-10-13T00:10:00.000Z',
      scope: { tenant: 'tenant-a', site: 'site-a', assetId: 'asset-1' },
      evidence: {
        snapshot: { id: 'window-1', source: 'cmms-a', revision: 'r1', recordHash: 'a'.repeat(64), observedAt: '2026-10-13T00:05:00.000Z' },
        events: [{ id: 'failure-1', revision: 'e1', recordHash: 'b'.repeat(64),
          startedAt: '2026-10-12T10:00:00.000Z', endedAt: '2026-10-12T10:30:00.000Z',
          rootCauseCode: 'bearing', rootCauseEvidenceRef: 'inspection-1' }],
      }, executionAuthority: false,
    },
    failureEventId: 'failure-1',
    cause: {
      tenant: 'tenant-a', site: 'site-a', assetId: 'asset-1', source: 'cmms-a',
      failureEventId: 'failure-1', failureEventRevision: 'e1', failureRecordHash: 'b'.repeat(64),
      rootCauseCode: 'bearing', evidenceRef: 'inspection-1', status: 'RECORDED',
      revision: 'cause-r1', recordHash: 'c'.repeat(64), observedAt: '2026-10-13T00:04:00.000Z',
    },
  };
}

test('binds a source-recorded cause to the exact reliability event without inferring causality', () => {
  const result = assessMaintenanceCauseEvidence(fixture());
  assert.equal(result.status, 'SOURCE_RECORDED');
  assert.equal(result.sourceRecordedCauseCode, 'bearing');
  assert.equal(result.causalStatus, 'UNVERIFIED');
  assert.equal(result.executionAuthority, false);
  assert.equal(result.sourceAuthenticated, false);
  assert.equal(result.evidence.failureRecordHash, 'b'.repeat(64));
  assert.equal(result.evidence.causeRecordHash, 'c'.repeat(64));
  assert.equal(result.cost, undefined);
});

test('missing source-declared cause stays unknown and cannot be filled by another record', () => {
  const input = fixture();
  input.reliability.evidence.events[0].rootCauseCode = null;
  input.reliability.evidence.events[0].rootCauseEvidenceRef = null;
  input.cause = null;
  assert.equal(assessMaintenanceCauseEvidence(input).status, 'UNKNOWN');
  input.cause = fixture().cause;
  assert.equal(assessMaintenanceCauseEvidence(input).status, 'BLOCKED');
});

test('independent cause record may be observed after the failure-window snapshot', () => {
  const input = fixture();
  input.cause.observedAt = '2026-10-13T00:06:00.000Z';
  assert.equal(assessMaintenanceCauseEvidence(input).status, 'SOURCE_RECORDED');
});

test('a cause recorded during a failure can be bound after the event closes', () => {
  const input = fixture();
  input.now = '2026-10-12T10:40:00.000Z';
  input.reliability.evaluatedAt = input.now;
  input.reliability.evidence.snapshot.observedAt = '2026-10-12T10:35:00.000Z';
  input.cause.observedAt = '2026-10-12T10:20:00.000Z';
  assert.equal(assessMaintenanceCauseEvidence(input).status, 'SOURCE_RECORDED');
});

test('mismatched, stale and withdrawn cause records cannot acquire a source-recorded label', () => {
  const cases = [
    x => { x.reliability.status = 'BLOCKED'; },
    x => { x.reliability.evidence.events[0].recordHash = 'd'.repeat(64); },
    x => { x.cause.tenant = 'tenant-b'; },
    x => { x.cause.assetId = 'asset-2'; },
    x => { x.cause.failureEventId = 'failure-2'; },
    x => { x.cause.failureEventRevision = 'e2'; },
    x => { x.cause.failureRecordHash = 'd'.repeat(64); },
    x => { x.cause.rootCauseCode = 'machine'; },
    x => { x.cause.evidenceRef = 'inspection-2'; },
    x => { x.cause.status = 'WITHDRAWN'; },
    x => { x.cause.observedAt = '2026-10-12T09:50:00.000Z'; },
    x => { x.cause.observedAt = '2026-10-12T23:00:00.000Z'; },
    x => { x.cause.recordHash = ['c'.repeat(64)]; },
  ];
  for (const alter of cases) {
    const input = fixture(); alter(input);
    const result = assessMaintenanceCauseEvidence(input);
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.sourceRecordedCauseCode, undefined);
  }
});
